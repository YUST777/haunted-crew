package dev.hauntedcrew.client;

import com.google.gson.Gson;
import com.google.gson.JsonParseException;
import dev.hauntedcrew.ConsolePayloads;
import dev.hauntedcrew.CrewProtocol;
import java.util.ArrayDeque;
import java.util.LinkedHashMap;
import java.util.Map;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayNetworking;

/** Client copy of the console state, fed by the server's ConsolePayloads.ToClient packets. */
public final class ClientConsole {
	private static final int MAX_LINES = 200;
	private static final Gson GSON = new Gson();

	static final Map<String, CrewProtocol.Session> sessions = new LinkedHashMap<>();
	static final ArrayDeque<CrewProtocol.Line> lines = new ArrayDeque<>();
	static boolean canCommand;
	static String bridge = "?";
	static String source = "none";
	static ConsolePayloads.Kiro kiro;
	/** In-progress Kiro device sign-in: open loginUrl, enter loginCode. Cleared once signed in. */
	static String loginUrl, loginCode;
	static java.util.List<String> loginLines = java.util.List.of();
	static String notice;
	static long noticeAt;
	/** Bumped on every change so the open screen can refresh its widgets. */
	static int version;
	// Workflow builder: the bridge's latest JSON answers (see WorkflowScreen).
	static String workflows, workflowRun, workflowSaved, skills, usage, merges, mergeDiff, mergeAnswer;
	static int workflowVersion;

	private ClientConsole() {}

	static void receive(String json) {
		ConsolePayloads.View v;
		try {
			v = GSON.fromJson(json, ConsolePayloads.View.class);
		} catch (JsonParseException e) {
			return;
		}
		if (v == null || v.type() == null) return;
		switch (v.type()) {
			case "tutorial" -> net.minecraft.client.Minecraft.getInstance().execute(
				() -> net.minecraft.client.Minecraft.getInstance().gui.setScreen(new TutorialScreen()));
			case "snapshot" -> {
				sessions.clear();
				if (v.sessions() != null) for (CrewProtocol.Session s : v.sessions()) sessions.put(s.id(), s);
				lines.clear();
				if (v.lines() != null) v.lines().forEach(ClientConsole::add);
				canCommand = Boolean.TRUE.equals(v.canCommand());
				bridge = v.bridge() == null ? "?" : v.bridge();
				source = v.source() == null ? "none" : v.source();
				if (!connected()) kiro = null; // stale until the bridge answers again
			}
			case "kiro" -> {
				if (v.kiro() == null) return;
				kiro = v.kiro();
				if (v.kiro().url() != null || v.kiro().code() != null) {
					loginUrl = v.kiro().url();
					loginCode = v.kiro().code();
					loginLines = v.kiro().lines() == null ? java.util.List.of() : v.kiro().lines();
				}
				if (Boolean.TRUE.equals(v.kiro().signedIn()) && loginCode != null) {
					loginUrl = loginCode = null;
					notice = "Signed in to Kiro. Your ghosts can work now.";
					noticeAt = System.currentTimeMillis();
				}
				if (v.kiro().error() != null) {
					notice = "Kiro sign-in: " + v.kiro().error();
					noticeAt = System.currentTimeMillis();
				}
			}
			case "update" -> {
				if (v.session() != null) sessions.put(v.session().id(), v.session());
				if (v.line() != null) add(v.line());
			}
			case "ended" -> {
				if (v.ended() != null) sessions.remove(v.ended());
				if (v.line() != null) add(v.line());
			}
			case "workflows", "workflow_run", "workflow_saved", "skills" -> {
				switch (v.type()) {
					case "workflows" -> workflows = v.data();
					case "workflow_run" -> workflowRun = v.data();
					case "workflow_saved" -> workflowSaved = v.data();
					default -> skills = v.data();
				}
				workflowVersion++;
				return;
			}
			case "usage" -> usage = v.data();
			case "merges", "merge_diff", "merge_answered" -> {
				switch (v.type()) {
					case "merges" -> merges = v.data();
					case "merge_diff" -> mergeDiff = v.data();
					default -> mergeAnswer = v.data();
				}
				workflowVersion++;
				return;
			}
			case "notice" -> {
				notice = v.notice();
				noticeAt = System.currentTimeMillis();
			}
			default -> {
				return;
			}
		}
		version++;
	}

	private static void add(CrewProtocol.Line line) {
		lines.addLast(line);
		while (lines.size() > MAX_LINES) lines.removeFirst();
	}

	static void send(String action, String session, String text, String requestId, String optionId) {
		if (!ClientPlayNetworking.canSend(ConsolePayloads.ToServer.TYPE)) return;
		ClientPlayNetworking.send(new ConsolePayloads.ToServer(GSON.toJson(new ConsolePayloads.Action(action, session, text, requestId, optionId))));
	}

	static boolean kiroReady() {
		return kiro != null && (Boolean.TRUE.equals(kiro.signedIn()) || Boolean.TRUE.equals(kiro.demo()));
	}

	static boolean connected() {
		return "connected".equals(bridge);
	}

	static boolean available() {
		return ClientPlayNetworking.canSend(ConsolePayloads.ToServer.TYPE);
	}
}
