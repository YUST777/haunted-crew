package dev.hauntedcrew;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

/** Parses bridge stream messages. Pure Java (no Minecraft types) so it is unit-testable. */
public final class CrewProtocol {
	private CrewProtocol() {}

	public enum Status {
		IDLE, WORKING, WAITING, ERROR;

		static Status parse(String s) {
			if (s == null) return IDLE;
			return switch (s) {
				case "working" -> WORKING;
				case "waiting" -> WAITING;
				case "error" -> ERROR;
				default -> IDLE;
			};
		}
	}

	/** Agent role; picks the ghost's hat and tool. */
	public enum Job {
		PLANNER, CODER, TESTER, REVIEWER, DOCS, RESEARCHER,
		/** The tour guide at the gate (top hat, lantern); never an agent's job. */
		GUIDE;

		/** Jobs agents can have (everything but GUIDE). */
		public static final Job[] WORKERS = {PLANNER, CODER, TESTER, REVIEWER, DOCS, RESEARCHER};

		/** Guesses the job from an agent name like "Spec Planner" or "qa-bot". Null when unclear. */
		public static Job fromName(String name) {
			if (name == null) return null;
			String n = name.toLowerCase();
			if (n.contains("plan") || n.contains("spec") || n.contains("lead")) return PLANNER;
			if (n.contains("test") || n.contains("qa")) return TESTER;
			if (n.contains("review")) return REVIEWER;
			if (n.contains("doc") || n.contains("writ")) return DOCS;
			if (n.contains("research") || n.contains("search") || n.contains("scout")) return RESEARCHER;
			if (n.contains("cod") || n.contains("dev") || n.contains("build") || n.contains("engineer")) return CODER;
			return null;
		}
	}

	public record Option(String id, String name) {}

	/** A tool call waiting for the player's approval (console agents only). */
	public record Permission(String id, String title, List<Option> options) {}

	/** One console feed line. {@code text} is already human-readable. */
	public record Line(long ts, String session, String agent, String kind, String text) {}

	/**
	 * @param console  true for agents started from the Minecraft console (they accept prompts);
	 *                 hook-reported agents are watch-only.
	 * @param model    Kiro model id (console agents), or null.
	 * @param draft    the reply streaming in right now, or null.
	 * @param thinking the agent's thinking streaming in right now, or null.
	 */
	public record Session(String id, String agent, Status status, String lastKind, String category, String file, String task,
		boolean console, Permission permission, String model, String draft, String thinking) {
		/** Short line shown on the ghost's name tag. */
		public String activity() {
			return switch (status) {
				case WAITING -> permission != null ? "needs your approval" : "waiting for you";
				case ERROR -> "hit an error";
				case IDLE -> "idle";
				case WORKING -> workingActivity();
			};
		}

		private String workingActivity() {
			if (task != null && ("task_start".equals(lastKind) || "task_end".equals(lastKind))) return "task: " + task;
			String where = file != null ? " " + file : "";
			if (lastKind != null && lastKind.startsWith("file_")) return "editing" + where;
			if ("prompt".equals(lastKind) || "thought".equals(lastKind)) return thinking != null || draft == null ? "thinking" : "writing a reply";
			if (category == null) return "working";
			return switch (category) {
				case "read" -> "reading" + where;
				case "write" -> "writing" + where;
				case "shell" -> "running a command";
				case "web" -> "searching the web";
				case "mcp" -> "using a tool";
				case "subagent" -> "calling a helper";
				case "spec" -> "updating the spec";
				default -> "working";
			};
		}

		public String label() {
			if (agent != null) return agent;
			return "Ghost " + (id.length() > 6 ? id.substring(0, 6) : id);
		}
	}

	public sealed interface Message permits Hello, Update, SessionEnded {}

	public record Hello(List<Session> sessions, List<Line> lines) implements Message {}

	/** {@code line} is null for events not worth a feed line (e.g. a tool finishing fine). */
	public record Update(Session session, Line line) implements Message {}

	public record SessionEnded(String id) implements Message {}

	/** Returns null for messages we do not use. Throws IllegalArgumentException on malformed JSON. */
	public static Message parse(String json) {
		JsonElement root;
		try {
			root = JsonParser.parseString(json);
		} catch (RuntimeException e) {
			throw new IllegalArgumentException("invalid JSON", e);
		}
		if (!root.isJsonObject()) throw new IllegalArgumentException("message is not an object");
		JsonObject msg = root.getAsJsonObject();
		String type = str(msg, "type");
		if ("hello".equals(type)) {
			List<Session> sessions = new ArrayList<>();
			JsonArray arr = msg.has("sessions") && msg.get("sessions").isJsonArray() ? msg.getAsJsonArray("sessions") : new JsonArray();
			for (JsonElement e : arr) {
				if (e.isJsonObject()) {
					Session s = session(e.getAsJsonObject());
					if (s != null) sessions.add(s);
				}
			}
			List<Line> lines = new ArrayList<>();
			JsonArray history = msg.has("history") && msg.get("history").isJsonArray() ? msg.getAsJsonArray("history") : new JsonArray();
			for (JsonElement e : history) {
				if (!e.isJsonObject()) continue;
				Line line = line(e.getAsJsonObject());
				if (line != null) lines.add(line);
			}
			return new Hello(List.copyOf(sessions), List.copyOf(lines));
		}
		if ("event".equals(type)) {
			JsonObject event = obj(msg, "event");
			if (event != null && "session_end".equals(str(event, "kind"))) {
				String id = str(event, "session");
				return id == null ? null : new SessionEnded(id);
			}
			JsonObject s = obj(msg, "session");
			Session session = s == null ? null : session(s);
			return session == null ? null : new Update(session, event == null ? null : line(event));
		}
		return null;
	}

	private static Session session(JsonObject o) {
		String id = str(o, "session");
		if (id == null) return null;
		JsonElement c = o.get("console");
		boolean console = c != null && c.isJsonPrimitive() && c.getAsJsonPrimitive().isBoolean() && c.getAsBoolean();
		return new Session(id, str(o, "agent"), Status.parse(str(o, "status")), str(o, "lastKind"), str(o, "category"), str(o, "file"),
			str(o, "task"), console, permission(obj(o, "permission")), str(o, "model"), multiline(o, "draft", 1500), multiline(o, "thinking", 1200));
	}

	private static Permission permission(JsonObject o) {
		if (o == null) return null;
		String id = str(o, "id");
		if (id == null) return null;
		List<Option> options = new ArrayList<>();
		JsonElement arr = o.get("options");
		if (arr != null && arr.isJsonArray()) {
			for (JsonElement e : arr.getAsJsonArray()) {
				if (!e.isJsonObject() || options.size() >= 4) continue;
				String oid = str(e.getAsJsonObject(), "id");
				if (oid != null) options.add(new Option(oid, Objects.requireNonNullElse(str(e.getAsJsonObject(), "name"), oid)));
			}
		}
		return new Permission(id, Objects.requireNonNullElse(str(o, "title"), "Run a tool"), List.copyOf(options));
	}

	/** Turns a bridge event into a feed line, or null when it would only be noise. */
	static Line line(JsonObject e) {
		String kind = str(e, "kind");
		String session = str(e, "session");
		if (kind == null || session == null) return null;
		JsonElement tsEl = e.get("ts");
		long ts = tsEl != null && tsEl.isJsonPrimitive() && tsEl.getAsJsonPrimitive().isNumber() ? tsEl.getAsLong() : 0;
		String file = str(e, "file");
		String where = file != null ? " " + file : "";
		String text = "message".equals(kind) ? multiline(e, "text", 1500) : "thought".equals(kind) ? multiline(e, "text", 1200) : text(e, "text", 600);
		JsonElement okEl = e.get("ok");
		boolean failed = okEl != null && okEl.isJsonPrimitive() && okEl.getAsJsonPrimitive().isBoolean() && !okEl.getAsBoolean();
		JsonObject request = obj(e, "request");
		String out = switch (kind) {
			case "session_start" -> "joined the crew";
			case "session_end" -> "left the crew";
			case "prompt" -> text != null ? "▶ " + text : "got a new prompt";
			case "tool_start" -> {
				String cat = str(e, "category");
				String tool = str(e, "tool");
				Session tmp = new Session(session, null, Status.WORKING, kind, cat, file, null, false, null, null, null, null);
				String act = tmp.activity();
				// No file to show (e.g. a search): the tool's own title says more than "reading".
				yield file == null && tool != null ? tool : act;
			}
			case "tool_end" -> failed ? Objects.requireNonNullElse(str(e, "tool"), "a tool") + " failed" : null;
			case "file_create" -> "created" + where;
			case "file_save" -> "edited" + where;
			case "file_delete" -> "deleted" + where;
			case "task_start" -> "started task: " + Objects.requireNonNullElse(str(e, "task"), "?");
			case "task_end" -> "finished task: " + Objects.requireNonNullElse(str(e, "task"), "?");
			case "message", "thought" -> text;
			case "permission" -> "asked to " + (request != null ? Objects.requireNonNullElse(str(request, "title"), "use a tool") : "use a tool");
			case "permission_resolved" -> text != null ? text : null;
			case "stop" -> "finished";
			case "error" -> "error: " + Objects.requireNonNullElse(text, "unknown");
			default -> null;
		};
		return out == null ? null : new Line(ts, session, str(e, "agent"), kind, out);
	}

	private static JsonObject obj(JsonObject o, String key) {
		JsonElement e = o.get(key);
		return e != null && e.isJsonObject() ? e.getAsJsonObject() : null;
	}

	/** Strings only, capped and stripped of control/formatting characters (§ is Minecraft's format code). */
	private static String str(JsonObject o, String key) {
		return text(o, key, 80);
	}

	/** Like text() but keeps line breaks (agent replies are markdown). */
	private static String multiline(JsonObject o, String key, int max) {
		JsonElement e = o.get(key);
		if (e == null || !e.isJsonPrimitive() || !e.getAsJsonPrimitive().isString()) return null;
		String s = e.getAsString().replace("\r", "").replaceAll("[\\p{Cntrl}&&[^\n]]|§", " ").replaceAll("\n{3,}", "\n\n").strip();
		if (s.isEmpty()) return null;
		return s.length() > max ? s.substring(0, max - 1) + "…" : s;
	}

	private static String text(JsonObject o, String key, int max) {
		JsonElement e = o.get(key);
		if (e == null || !e.isJsonPrimitive() || !e.getAsJsonPrimitive().isString()) return null;
		String s = e.getAsString().replaceAll("[\\p{Cntrl}§]", " ").trim();
		if (s.isEmpty()) return null;
		return s.length() > max ? s.substring(0, max - 1) + "…" : s;
	}
}
