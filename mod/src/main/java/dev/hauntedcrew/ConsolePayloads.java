package dev.hauntedcrew;

import java.util.List;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;

/** Console packets. Both carry JSON (Gson-serialised records below) to keep the protocol in one place. */
public final class ConsolePayloads {
	private ConsolePayloads() {}

	/**
	 * Server -> client. type: "snapshot" (full state), "update" (one session/line), "ended", "notice", "kiro",
	 * and for the workflow builder "workflows", "workflow_run", "skills" (data = the bridge's JSON answer).
	 */
	public record View(String type, List<CrewProtocol.Session> sessions, List<CrewProtocol.Line> lines, CrewProtocol.Session session,
		CrewProtocol.Line line, String ended, Boolean canCommand, String bridge, String notice, String source, Kiro kiro, String data) {
		static View of(String type) {
			return new View(type, null, null, null, null, null, null, null, null, null, null, null);
		}

		static View data(String type, String json) {
			return new View(type, null, null, null, null, null, null, null, null, null, null, json);
		}

		View withNotice(String text) {
			return new View(type, sessions, lines, session, line, ended, canCommand, bridge, text, source, kiro, data);
		}
	}

	/** Kiro account state as the bridge sees it, plus an in-progress device sign-in (url + code). */
	public record Kiro(Boolean signedIn, Boolean installed, Boolean demo, String user, String url, String code, List<String> lines, String error) {}

	/**
	 * Client -> server. action: "open", "spawn" (text = name, optionId = Kiro model id or null),
	 * workflow builder: "wf_list", "wf_skills", "wf_save" / "agent_save" (text = JSON), "wf_delete" / "agent_delete" (session = id),
	 * "wf_run" (session = workflow id, text = task), "wf_run_get" / "wf_stop" (session = run id), "prompt", "permission" (optionId null = deny),
	 * "pair" (text = code, session = optional bridge URL), "kiro_status", "kiro_login",
	 * "screen_click" (text = "x,y" in 0..1), "screen_scroll" (text = pixels), "screen_type" (text: search / URL / typed+Enter),
	 * "screen_text" (raw text, no Enter), "screen_key" (key name), "screen_nav" (back | forward | reload).
	 */
	public record Action(String action, String session, String text, String requestId, String optionId) {}

	public record ToClient(String json) implements CustomPacketPayload {
		public static final Type<ToClient> TYPE = new Type<>(HauntedCrew.id("console"));
		public static final StreamCodec<FriendlyByteBuf, ToClient> CODEC =
			StreamCodec.composite(ByteBufCodecs.stringUtf8(1 << 20), ToClient::json, ToClient::new);

		@Override
		public Type<ToClient> type() {
			return TYPE;
		}
	}

	/** Server -> client: one JPEG frame of the big screen's browser, and the page it shows. */
	public record ScreenFrame(byte[] jpeg, String url) implements CustomPacketPayload {
		public static final Type<ScreenFrame> TYPE = new Type<>(HauntedCrew.id("screen_frame"));
		public static final StreamCodec<FriendlyByteBuf, ScreenFrame> CODEC = StreamCodec.composite(
			ByteBufCodecs.byteArray(2 << 20), ScreenFrame::jpeg, ByteBufCodecs.stringUtf8(2048), ScreenFrame::url, ScreenFrame::new);

		@Override
		public Type<ScreenFrame> type() {
			return TYPE;
		}
	}

	public record ToServer(String json) implements CustomPacketPayload {
		public static final Type<ToServer> TYPE = new Type<>(HauntedCrew.id("console_action"));
		public static final StreamCodec<FriendlyByteBuf, ToServer> CODEC =
			StreamCodec.composite(ByteBufCodecs.stringUtf8(1 << 16), ToServer::json, ToServer::new); // workflows can be long

		@Override
		public Type<ToServer> type() {
			return TYPE;
		}
	}
}
