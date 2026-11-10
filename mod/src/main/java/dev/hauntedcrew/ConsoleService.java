package dev.hauntedcrew;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import com.google.gson.JsonParser;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;
import net.fabricmc.fabric.api.networking.v1.ServerPlayNetworking;
import net.minecraft.commands.Commands;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;

/**
 * Server side of the in-game agent console: keeps the feed, sends it to players with the mod,
 * and relays console actions to the bridge. Only ops (level 2) can act, and only when the server
 * has the bridge command token; everyone else watches. Server thread only, except HTTP callbacks.
 */
public final class ConsoleService {
	private static final int MAX_LINES = 200;
	private static final long ACTION_COOLDOWN_MS = 300;
	private static final Gson GSON = new Gson();

	private final MinecraftServer server;
	private final CrewConfig config;
	private final Supplier<String> bridgeState;
	private final Map<String, CrewProtocol.Session> sessions = new LinkedHashMap<>();
	private final ArrayDeque<CrewProtocol.Line> lines = new ArrayDeque<>();
	private final Map<UUID, Long> lastAction = new HashMap<>();
	// HTTP/1.1: the default HTTP/2 attempt sends "Upgrade: h2c", which Node routes to the WebSocket handler.
	private final HttpClient http = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).connectTimeout(Duration.ofSeconds(5)).build();

	public ConsoleService(MinecraftServer server, CrewConfig config, Supplier<String> bridgeState) {
		this.server = server;
		this.config = config;
		this.bridgeState = bridgeState;
	}

	public void apply(CrewProtocol.Message message) {
		switch (message) {
			case CrewProtocol.Hello hello -> {
				sessions.clear();
				for (CrewProtocol.Session s : hello.sessions()) sessions.put(s.id(), s);
				lines.clear();
				List<CrewProtocol.Line> recent = hello.lines();
				for (CrewProtocol.Line l : recent.subList(Math.max(0, recent.size() - MAX_LINES), recent.size())) lines.addLast(l);
				for (ServerPlayer p : server.getPlayerList().getPlayers()) {
					sendSnapshot(p);
					kiroStatus(p);
				}
			}
			case CrewProtocol.Update u -> {
				sessions.put(u.session().id(), u.session());
				if (u.line() != null) addLine(u.line());
				broadcast(new ConsolePayloads.View("update", null, null, u.session(), u.line(), null, null, null, null, null, null, null));
				if (u.line() != null && "permission".equals(u.line().kind())) askInChat(u.session(), u.line().text());
			}
			case CrewProtocol.SessionEnded end -> {
				CrewProtocol.Session gone = sessions.remove(end.id());
				CrewProtocol.Line line = new CrewProtocol.Line(System.currentTimeMillis(), end.id(), gone == null ? null : gone.agent(), "session_end", "left the crew");
				addLine(line);
				broadcast(new ConsolePayloads.View("ended", null, null, null, line, end.id(), null, null, null, null, null, null));
			}
		}
	}

	/** A ghost needs approval: tell everyone who can give it, in chat, with a sound. */
	private void askInChat(CrewProtocol.Session s, String what) {
		net.minecraft.network.chat.Component msg = net.minecraft.network.chat.Component.literal("⚠ " + s.label() + " needs your OK: ")
			.withStyle(st -> st.withColor(0xFFC94D))
			.append(net.minecraft.network.chat.Component.literal(what.replaceFirst("^asked to ", "")).withStyle(st -> st.withColor(0xECE8F4)))
			.append(net.minecraft.network.chat.Component.literal("  (press K to Allow or Reject)").withStyle(st -> st.withColor(0xA59CB8)));
		for (ServerPlayer p : server.getPlayerList().getPlayers()) {
			if (!canCommand(p)) continue;
			p.sendSystemMessage(msg);
			p.level().playSound(null, p.getX(), p.getY(), p.getZ(), net.minecraft.sounds.SoundEvents.NOTE_BLOCK_BELL, net.minecraft.sounds.SoundSource.PLAYERS, 0.8f, 1.4f);
		}
	}

	public java.util.Collection<CrewProtocol.Session> sessions() {
		return sessions.values();
	}

	public List<CrewProtocol.Line> lines() {
		return new ArrayList<>(lines);
	}

	private void addLine(CrewProtocol.Line line) {
		lines.addLast(line);
		while (lines.size() > MAX_LINES) lines.removeFirst();
	}

	/** Ops, or the owner of a singleplayer / LAN world. */
	public boolean isTrusted(ServerPlayer player) {
		return Commands.LEVEL_GAMEMASTERS.check(player.permissions()) || server.isSingleplayerOwner(player.nameAndId());
	}

	public boolean canCommand(ServerPlayer player) {
		return !config.commandToken().isEmpty() && isTrusted(player);
	}

	public void sendSnapshot(ServerPlayer player) {
		send(player, new ConsolePayloads.View("snapshot", List.copyOf(sessions.values()), new ArrayList<>(lines), null, null, null,
			canCommand(player), bridgeState.get(), null, config.source(), null, null));
	}

	private void notice(ServerPlayer player, String text) {
		send(player, ConsolePayloads.View.of("notice").withNotice(text));
	}

	private void sendKiro(ServerPlayer player, ConsolePayloads.Kiro kiro) {
		send(player, new ConsolePayloads.View("kiro", null, null, null, null, null, null, null, null, null, kiro, null));
	}

	private HttpRequest.Builder bridgeRequest(String path, String token) {
		return HttpRequest.newBuilder(URI.create(config.httpBase() + path)).timeout(Duration.ofSeconds(30)).header("Authorization", "Bearer " + token);
	}

	private void kiroStatus(ServerPlayer player) {
		if (config.token().isEmpty()) return;
		http.sendAsync(bridgeRequest("/kiro/status", config.token()).GET().build(), HttpResponse.BodyHandlers.ofString())
			.whenComplete((res, err) -> server.execute(() -> {
				if (err == null && res.statusCode() == 200) sendKiro(player, parseKiro(res.body()));
			}));
	}

	private void kiroLogin(ServerPlayer player) {
		http.sendAsync(bridgeRequest("/kiro/login", config.commandToken()).POST(HttpRequest.BodyPublishers.noBody()).build(), HttpResponse.BodyHandlers.ofString())
			.whenComplete((res, err) -> server.execute(() -> {
				if (err != null || res.statusCode() != 200) {
					notice(player, "Could not start Kiro sign-in" + (res != null ? ": " + errorOf(res.body()) : "."));
					return;
				}
				sendKiro(player, parseKiro(res.body()));
			}));
	}

	private static ConsolePayloads.Kiro parseKiro(String body) {
		try {
			return GSON.fromJson(body, ConsolePayloads.Kiro.class);
		} catch (JsonParseException e) {
			return null;
		}
	}

	private void broadcast(ConsolePayloads.View view) {
		String json = GSON.toJson(view);
		for (ServerPlayer p : server.getPlayerList().getPlayers()) {
			if (ServerPlayNetworking.canSend(p, ConsolePayloads.ToClient.TYPE)) ServerPlayNetworking.send(p, new ConsolePayloads.ToClient(json));
		}
	}

	private static void send(ServerPlayer player, ConsolePayloads.View view) {
		if (ServerPlayNetworking.canSend(player, ConsolePayloads.ToClient.TYPE)) ServerPlayNetworking.send(player, new ConsolePayloads.ToClient(GSON.toJson(view)));
	}

	public void handle(ServerPlayer player, String json) {
		ConsolePayloads.Action action;
		try {
			action = GSON.fromJson(json, ConsolePayloads.Action.class);
		} catch (JsonParseException e) {
			return;
		}
		if (action == null || action.action() == null) return;
		if ("open".equals(action.action())) {
			sendSnapshot(player);
			kiroStatus(player);
			return;
		}
		if ("kiro_status".equals(action.action())) {
			kiroStatus(player);
			return;
		}
		if ("pair".equals(action.action())) {
			if (!isTrusted(player)) {
				notice(player, "Only the world owner or an operator can pair.");
				return;
			}
			if (action.text() == null || action.text().isBlank()) return;
			HauntedCrew.pair(server, action.text().trim(), action.session(), msg -> {
				notice(player, msg);
				sendSnapshot(player);
			});
			return;
		}
		if (action.action().startsWith("wf_") || action.action().startsWith("agent_") || action.action().startsWith("merge_") || "kiro_usage".equals(action.action())) {
			workflowAction(player, action);
			return;
		}
		if (!canCommand(player) && action.action().startsWith("screen_")) return;
		if (!canCommand(player)) {
			notice(player, config.commandToken().isEmpty() ? "Watch-only: this server has no bridge command token." : "Only operators can command agents.");
			return;
		}
		// Screen actions (typing, clicks) skip the chat cooldown; the browser is local and cheap to drive.
		if (action.action().startsWith("screen_")) {
			screenAction(player, action);
			return;
		}
		long now = System.currentTimeMillis();
		if (now - lastAction.getOrDefault(player.getUUID(), 0L) < ACTION_COOLDOWN_MS) return;
		lastAction.put(player.getUUID(), now);

		if ("kiro_login".equals(action.action())) {
			kiroLogin(player);
			return;
		}
		JsonObject body = new JsonObject();
		String path;
		switch (action.action()) {
			case "spawn" -> {
				body.addProperty("name", action.text());
				if (action.optionId() != null && !action.optionId().isBlank()) body.addProperty("model", action.optionId());
				path = "/agents";
			}
			case "prompt" -> {
				if (action.session() == null) return;
				body.addProperty("text", action.text());
				path = "/agents/" + URLEncoder.encode(action.session(), StandardCharsets.UTF_8) + "/prompt";
			}
			case "model" -> {
				if (action.session() == null || action.text() == null) return;
				body.addProperty("model", action.text());
				path = "/agents/" + URLEncoder.encode(action.session(), StandardCharsets.UTF_8) + "/model";
			}
			case "interrupt" -> {
				if (action.session() == null) return;
				path = "/agents/" + URLEncoder.encode(action.session(), StandardCharsets.UTF_8) + "/interrupt";
			}
			case "permission" -> {
				if (action.session() == null || action.requestId() == null) return;
				body.addProperty("requestId", action.requestId());
				body.addProperty("optionId", action.optionId());
				path = "/agents/" + URLEncoder.encode(action.session(), StandardCharsets.UTF_8) + "/permission";
			}
			default -> {
				return;
			}
		}
		HttpRequest req = bridgeRequest(path, config.commandToken())
			.header("Content-Type", "application/json")
			.POST(HttpRequest.BodyPublishers.ofString(body.toString()))
			.build();
		String verb = action.action();
		http.sendAsync(req, HttpResponse.BodyHandlers.ofString()).whenComplete((res, err) -> server.execute(() -> {
			if (err != null) {
				notice(player, "Bridge unreachable: " + err.getClass().getSimpleName());
			} else if (res.statusCode() / 100 != 2) {
				notice(player, "Bridge said no (" + res.statusCode() + "): " + errorOf(res.body()));
			} else if ("spawn".equals(verb)) {
				notice(player, "Summoned " + action.text() + ".");
			}
		}));
	}

	/**
	 * Workflow builder screen: relays to the bridge's /api routes. Anyone may look (view token);
	 * saving, deleting and running need {@link #canCommand}. Answers go back as "workflows",
	 * "workflow_run" or "skills" views carrying the bridge's JSON.
	 */
	private void workflowAction(ServerPlayer player, ConsolePayloads.Action a) {
		boolean read = "wf_list".equals(a.action()) || "wf_run_get".equals(a.action()) || "wf_skills".equals(a.action()) || "kiro_usage".equals(a.action()) || "merge_list".equals(a.action()) || "merge_diff".equals(a.action());
		if (!read && !canCommand(player)) {
			notice(player, config.commandToken().isEmpty() ? "Watch-only: this server has no bridge command token." : "Only operators can change or run workflows.");
			return;
		}
		String token = canCommand(player) ? config.commandToken() : config.token();
		if (token.isEmpty()) return;
		String id = a.session() == null ? "" : URLEncoder.encode(a.session(), StandardCharsets.UTF_8);
		String method = "GET", path, body = null, reply = "workflows";
		switch (a.action()) {
			case "kiro_usage" -> {
				path = "/kiro/usage";
				reply = "usage";
			}
			case "merge_list" -> {
				path = "/api/merges";
				reply = "merges";
			}
			case "merge_diff" -> {
				path = "/api/merges/" + id + "/diff";
				reply = "merge_diff";
			}
			case "merge_answer" -> {
				// text is {"option": "Merge" | "Reject" | "Request changes", "text": "..."}; the bridge checks the command token
				method = "POST";
				path = "/api/merges/" + id + "/answer";
				body = a.text();
				reply = "merge_answered";
			}
			case "wf_list" -> path = "/api/workflows";
			case "wf_skills" -> {
				path = "/api/skills";
				reply = "skills";
			}
			case "wf_save" -> {
				method = "PUT";
				path = "/api/workflows";
				body = a.text();
				reply = "workflow_saved";
			}
			case "wf_delete" -> {
				method = "DELETE";
				path = "/api/workflows/" + id;
			}
			case "agent_save" -> {
				method = "PUT";
				path = "/api/crew-agents";
				body = a.text();
			}
			case "agent_delete" -> {
				method = "DELETE";
				path = "/api/crew-agents/" + id;
			}
			case "wf_run" -> {
				method = "POST";
				path = "/api/workflows/" + id + "/run";
				JsonObject o = new JsonObject();
				o.addProperty("task", a.text() == null ? "" : a.text());
				body = o.toString();
				reply = "workflow_run";
			}
			case "wf_run_get" -> {
				path = "/api/workflows/runs/" + id;
				reply = "workflow_run";
			}
			case "wf_stop" -> {
				method = "POST";
				path = "/api/workflows/runs/" + id + "/stop";
				body = "{}";
				reply = "workflow_run";
			}
			default -> {
				return;
			}
		}
		if ((a.action().startsWith("wf_") && id.isEmpty() && (a.action().equals("wf_delete") || a.action().startsWith("wf_run") || a.action().equals("wf_stop")))) return;
		HttpRequest.Builder req = bridgeRequest(path, token).header("Content-Type", "application/json");
		req = body == null ? req.method(method, HttpRequest.BodyPublishers.noBody()) : req.method(method, HttpRequest.BodyPublishers.ofString(body));
		boolean refreshAfter = !read && !"wf_run".equals(a.action()) && !"wf_stop".equals(a.action()) && !"merge_answer".equals(a.action());
		String replyType = reply;
		http.sendAsync(req.build(), HttpResponse.BodyHandlers.ofString()).whenComplete((res, err) -> server.execute(() -> {
			if (err != null) {
				notice(player, "Bridge unreachable: " + err.getClass().getSimpleName());
				return;
			}
			if (res.statusCode() / 100 != 2) {
				notice(player, "Workflow: " + errorOf(res.body()));
				return;
			}
			if (refreshAfter && !"workflow_saved".equals(replyType)) workflowAction(player, new ConsolePayloads.Action("wf_list", null, null, null, null));
			else send(player, ConsolePayloads.View.data(replyType, res.body()));
		}));
	}

	/** POSTs to a /browser/* route; failures show on the player's action bar. */
	public void browser(ServerPlayer player, String path, String key, Object value) {
		if (config.commandToken().isEmpty()) return;
		JsonObject body = new JsonObject();
		if (key != null) {
			if (value instanceof Number n) body.addProperty(key, n);
			else body.addProperty(key, String.valueOf(value));
		}
		http.sendAsync(bridgeRequest(path, config.commandToken()).header("Content-Type", "application/json")
				.POST(HttpRequest.BodyPublishers.ofString(body.toString())).build(), HttpResponse.BodyHandlers.ofString())
			.whenComplete((res, err) -> server.execute(() -> {
				if (err != null) player.sendOverlayMessage(net.minecraft.network.chat.Component.literal("Big screen: bridge unreachable"));
				else if (res.statusCode() / 100 != 2) player.sendOverlayMessage(net.minecraft.network.chat.Component.literal("Big screen: " + errorOf(res.body())));
			}));
	}

	private void screenAction(ServerPlayer player, ConsolePayloads.Action action) {
		ScreenWall.Mode mode = HauntedCrew.screenMode();
		if (mode == null || !mode.web() || action.text() == null) return;
		switch (action.action()) {
			case "screen_click" -> {
				String[] xy = action.text().split(",");
				try {
					double x = Double.parseDouble(xy[0]), y = Double.parseDouble(xy[1]);
					JsonObject body = new JsonObject();
					body.addProperty("x", x);
					body.addProperty("y", y);
					post(player, "/browser/click", body);
				} catch (RuntimeException ignored) {
					// malformed coordinates
				}
			}
			case "screen_scroll" -> {
				try {
					browser(player, "/browser/scroll", "dy", Integer.parseInt(action.text()));
				} catch (NumberFormatException ignored) {
					// not a number
				}
			}
			case "screen_text" -> {
				if (action.text().length() > 200) return;
				JsonObject body = new JsonObject();
				body.addProperty("text", action.text());
				body.addProperty("submit", false);
				post(player, "/browser/type", body);
			}
			case "screen_key" -> browser(player, "/browser/key", "key", action.text());
			case "screen_nav" -> {
				if (List.of("back", "forward", "reload").contains(action.text())) browser(player, "/browser/" + action.text(), null, null);
			}
			case "screen_go" -> {
				// Address bar: open a URL, otherwise search DuckDuckGo.
				String text = action.text().strip();
				if (text.isEmpty() || text.length() > 500) return;
				boolean url = !text.contains(" ") && (text.startsWith("http://") || text.startsWith("https://") || text.matches("[\\w-]+(\\.[\\w-]+)+(/.*)?"));
				browser(player, "/browser/open", "url", url ? (text.startsWith("http") ? text : "https://" + text)
					: "https://duckduckgo.com/?q=" + java.net.URLEncoder.encode(text, StandardCharsets.UTF_8));
			}
			case "screen_type" -> {
				String text = action.text().strip();
				if (text.isEmpty() || text.length() > 500) return;
				boolean looksLikeUrl = !text.contains(" ") && (text.startsWith("http://") || text.startsWith("https://") || text.matches("[\\w-]+(\\.[\\w-]+)+(/.*)?"));
				if (looksLikeUrl) browser(player, "/browser/open", "url", text.startsWith("http") ? text : "https://" + text);
				else if (mode == ScreenWall.Mode.SEARCH) browser(player, "/browser/open", "url", "https://duckduckgo.com/?q=" + java.net.URLEncoder.encode(text, StandardCharsets.UTF_8));
				else browser(player, "/browser/type", "text", text);
			}
			default -> {
				// unknown screen action
			}
		}
	}

	private void post(ServerPlayer player, String path, JsonObject body) {
		http.sendAsync(bridgeRequest(path, config.commandToken()).header("Content-Type", "application/json")
				.POST(HttpRequest.BodyPublishers.ofString(body.toString())).build(), HttpResponse.BodyHandlers.ofString())
			.whenComplete((res, err) -> {
				if (err == null && res.statusCode() / 100 != 2) server.execute(() -> player.sendOverlayMessage(net.minecraft.network.chat.Component.literal("Big screen: " + errorOf(res.body()))));
			});
	}

	private static String errorOf(String body) {
		try {
			JsonObject o = JsonParser.parseString(body).getAsJsonObject();
			String msg = o.has("error") ? o.get("error").getAsString() : body;
			return msg.length() > 160 ? msg.substring(0, 159) + "…" : msg;
		} catch (RuntimeException e) {
			return "unexpected response";
		}
	}
}
