package dev.hauntedcrew;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.net.http.WebSocketHandshakeException;
import java.time.Duration;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import org.slf4j.Logger;

/**
 * WebSocket client for the bridge's /stream. Authenticates with the view token in the
 * Authorization header and reconnects with exponential backoff. Messages are handed to
 * {@code onMessage} on the WebSocket thread; callers must hop to the server thread.
 */
public final class BridgeClient {
	public enum State { STOPPED, CONNECTING, CONNECTED, RETRYING, UNAUTHORIZED }

	private static final int MAX_MESSAGE_CHARS = 4 * 1024 * 1024;
	private static final long MAX_BACKOFF_MS = 30_000;
	private static final long UNAUTHORIZED_BACKOFF_MS = 60_000;

	private final URI uri;
	private final String token;
	private final Consumer<String> onMessage;
	private final Logger log;
	private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
	private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor(r -> {
		Thread t = new Thread(r, "hauntedcrew-bridge");
		t.setDaemon(true);
		return t;
	});

	private volatile State state = State.STOPPED;
	private volatile WebSocket socket;
	private volatile boolean stopped;
	private long backoffMs = 1000;

	public BridgeClient(URI uri, String token, Consumer<String> onMessage, Logger log) {
		this.uri = uri;
		this.token = token;
		this.onMessage = onMessage;
		this.log = log;
	}

	public State state() {
		return state;
	}

	public void start() {
		scheduler.execute(this::connect);
	}

	public void stop() {
		stopped = true;
		state = State.STOPPED;
		WebSocket ws = socket;
		if (ws != null) ws.sendClose(WebSocket.NORMAL_CLOSURE, "server stopping").exceptionally(e -> null);
		scheduler.shutdownNow();
	}

	private void connect() {
		if (stopped) return;
		state = State.CONNECTING;
		http.newWebSocketBuilder()
			.header("Authorization", "Bearer " + token)
			.connectTimeout(Duration.ofSeconds(5))
			.buildAsync(uri, new Listener())
			.whenComplete((ws, err) -> {
				if (err == null) {
					socket = ws;
					return;
				}
				Throwable cause = err.getCause() != null ? err.getCause() : err;
				if (cause instanceof WebSocketHandshakeException h && (h.getResponse().statusCode() == 401 || h.getResponse().statusCode() == 403)) {
					state = State.UNAUTHORIZED;
					log.error("[hauntedcrew] bridge rejected the view token ({}). Check viewToken in config/hauntedcrew.json.", h.getResponse().statusCode());
					schedule(UNAUTHORIZED_BACKOFF_MS);
				} else {
					log.warn("[hauntedcrew] cannot reach bridge at {}: {}", uri, cause.toString());
					retry();
				}
			});
	}

	private void retry() {
		if (stopped) return;
		state = State.RETRYING;
		long jitter = ThreadLocalRandom.current().nextLong(backoffMs / 4 + 1);
		schedule(backoffMs + jitter);
		backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
	}

	private void schedule(long delayMs) {
		if (stopped) return;
		try {
			scheduler.schedule(this::connect, delayMs, TimeUnit.MILLISECONDS);
		} catch (java.util.concurrent.RejectedExecutionException ignored) {
			// stopping
		}
	}

	private final class Listener implements WebSocket.Listener {
		private final StringBuilder buffer = new StringBuilder();
		private boolean ended; // onClose and onError can both fire; reconnect once per connection

		private synchronized void end() {
			if (ended || stopped) return;
			ended = true;
			retry();
		}

		@Override
		public void onOpen(WebSocket ws) {
			state = State.CONNECTED;
			backoffMs = 1000;
			log.info("[hauntedcrew] connected to bridge {}", uri);
			ws.request(1);
		}

		@Override
		public CompletionStage<?> onText(WebSocket ws, CharSequence data, boolean last) {
			if (buffer.length() + data.length() > MAX_MESSAGE_CHARS) {
				log.warn("[hauntedcrew] bridge message too large, reconnecting");
				buffer.setLength(0);
				ws.abort();
				end();
				return null;
			}
			buffer.append(data);
			if (last) {
				String msg = buffer.toString();
				buffer.setLength(0);
				try {
					onMessage.accept(msg);
				} catch (RuntimeException e) {
					log.warn("[hauntedcrew] bad bridge message: {}", e.getMessage());
				}
			}
			ws.request(1);
			return null;
		}

		@Override
		public CompletionStage<?> onClose(WebSocket ws, int code, String reason) {
			if (!stopped) {
				log.warn("[hauntedcrew] bridge closed the stream ({} {}), reconnecting", code, reason);
				end();
			}
			return CompletableFuture.completedFuture(null);
		}

		@Override
		public void onError(WebSocket ws, Throwable error) {
			if (!stopped) {
				log.warn("[hauntedcrew] bridge stream error: {}", error.toString());
				end();
			}
		}
	}
}
