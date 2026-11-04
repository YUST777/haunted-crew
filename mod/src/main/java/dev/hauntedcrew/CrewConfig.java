package dev.hauntedcrew;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonParseException;
import java.io.IOException;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.Set;

/**
 * Server-side config at config/hauntedcrew.json. Holds the bridge view token, so it is created
 * owner-read/write only and the token is never sent to clients, chat or logs.
 */
public final class CrewConfig {
	private static final Gson GSON = new GsonBuilder().setPrettyPrinting().disableHtmlEscaping().create();
	private static final Set<String> LOOPBACK = Set.of("127.0.0.1", "localhost", "::1", "[::1]");

	public String bridgeUrl = "ws://127.0.0.1:8787/stream";
	public String viewToken = "";
	/** Optional. Lets ops start and prompt agents from the console. Leave empty for watch-only. */
	public String commandToken = "";
	public Anchor anchor = null;

	// Filled from ~/.haunted-crew (written by the `haunted-crew` launcher) when this file has no token:
	// Minecraft on the same PC and OS user connects with zero setup. Never saved to the config file.
	private transient String localUrl, localView, localCommand;

	public static final class Anchor {
		// Overworld coordinates.
		public double x, y, z;
	}

	private static String firstNonBlank(String... values) {
		for (String v : values) if (v != null && !v.isBlank()) return v.trim();
		return "";
	}

	/** Effective token: HAUNTED_CREW_VIEW_TOKEN wins so servers can keep secrets out of files. */
	public String token() {
		return firstNonBlank(System.getenv("HAUNTED_CREW_VIEW_TOKEN"), viewToken, localView);
	}

	public String commandToken() {
		return firstNonBlank(System.getenv("HAUNTED_CREW_COMMAND_TOKEN"), commandToken, isLocal() ? localCommand : null);
	}

	private boolean isLocal() {
		return firstNonBlank(System.getenv("HAUNTED_CREW_VIEW_TOKEN"), viewToken).isEmpty() && localView != null;
	}

	/** Where the bridge stream is: the configured URL, or the local launcher's. */
	public String url() {
		return isLocal() && localUrl != null ? localUrl : bridgeUrl;
	}

	/** "paired" (config/env), "local" (auto-found launcher) or "none". */
	public String source() {
		if (!firstNonBlank(System.getenv("HAUNTED_CREW_VIEW_TOKEN"), viewToken).isEmpty()) return "paired";
		return localView != null ? "local" : "none";
	}

	/** Looks for a `haunted-crew` launcher running as this OS user. Returns true when one was found. */
	public boolean discoverLocal() {
		String home = firstNonBlank(System.getenv("HAUNTED_CREW_HOME"));
		Path dir = home.isEmpty() ? Path.of(System.getProperty("user.home"), ".haunted-crew") : Path.of(home);
		try {
			com.google.gson.JsonObject bridge = GSON.fromJson(Files.readString(dir.resolve("bridge.json")), com.google.gson.JsonObject.class);
			com.google.gson.JsonObject tokens = GSON.fromJson(Files.readString(dir.resolve("tokens.json")), com.google.gson.JsonObject.class);
			localUrl = bridge.get("url").getAsString();
			localView = tokens.get("view").getAsString();
			localCommand = tokens.has("command") ? tokens.get("command").getAsString() : null;
			return true;
		} catch (IOException | RuntimeException e) {
			localUrl = localView = localCommand = null;
			return false;
		}
	}

	/** http(s)://host:port of the bridge, derived from the stream URL (ws -> http, wss -> https). */
	public String httpBase() {
		URI uri = URI.create(url());
		String scheme = "wss".equals(uri.getScheme()) ? "https" : "http";
		return scheme + "://" + uri.getRawAuthority();
	}

	/** Returns a problem description, or null when the config can be used to connect. */
	public String validate() {
		if (token().isEmpty()) return "not paired: run `haunted-crew` on this PC, or /crew pair <code> <url>";
		URI uri;
		try {
			uri = URI.create(url());
		} catch (IllegalArgumentException e) {
			return "bridgeUrl is not a valid URI";
		}
		if (!"ws".equals(uri.getScheme()) && !"wss".equals(uri.getScheme())) return "bridgeUrl must start with ws:// or wss://";
		if (uri.getHost() == null) return "bridgeUrl has no host";
		return null;
	}

	/** True when the token would travel unencrypted over the network. */
	public boolean insecureRemote() {
		URI uri = URI.create(url());
		return "ws".equals(uri.getScheme()) && !LOOPBACK.contains(uri.getHost());
	}

	public static CrewConfig load(Path file) throws IOException {
		if (!Files.exists(file)) {
			CrewConfig fresh = new CrewConfig();
			fresh.save(file);
			return fresh;
		}
		try {
			CrewConfig cfg = GSON.fromJson(Files.readString(file), CrewConfig.class);
			return cfg == null ? new CrewConfig() : cfg;
		} catch (JsonParseException e) {
			throw new IOException("Invalid JSON in " + file + ": " + e.getMessage(), e);
		}
	}

	public void save(Path file) throws IOException {
		Files.createDirectories(file.getParent());
		Path tmp = file.resolveSibling(file.getFileName() + ".tmp");
		Files.writeString(tmp, GSON.toJson(this));
		restrict(tmp);
		Files.move(tmp, file, java.nio.file.StandardCopyOption.REPLACE_EXISTING, java.nio.file.StandardCopyOption.ATOMIC_MOVE);
	}

	private static void restrict(Path file) {
		try {
			Files.setPosixFilePermissions(file, PosixFilePermissions.fromString("rw-------"));
		} catch (UnsupportedOperationException | IOException ignored) {
			// Windows: no POSIX permissions; the file lives in the server's own config dir.
		}
	}
}
