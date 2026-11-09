package dev.hauntedcrew;

import com.mojang.math.Transformation;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.util.Brightness;
import net.minecraft.world.entity.Display;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntitySpawnReason;
import net.minecraft.world.entity.EntityTypes;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.state.BlockState;
import org.joml.Quaternionf;
import org.joml.Vector3f;

/**
 * The big screen on the office's north wall, built from vanilla display entities so every player sees
 * it. Two views, switched with the screen items: DASHBOARD (panels laid out like the web dashboard)
 * and ACTIVITY (a scrolling log). Coordinates are in blocks from the screen's bottom-left corner;
 * the default office screen is 15 x 7 blocks around the "screen" marker.
 */
public final class ScreenWall {
	public enum Mode {
		DASHBOARD("Dashboard"), CODE("Live code"), WEBSITE("Website preview"), SEARCH("Web search"), ACTIVITY("Activity log");

		public final String label;

		Mode(String label) {
			this.label = label;
		}

		public boolean web() {
			return this == CODE || this == WEBSITE || this == SEARCH;
		}
	}

	private static final String TAG = "hauntedcrew_screen";
	private static final float PX = 0.025f; // text display pixel size in blocks at scale 1
	private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("HH:mm").withZone(ZoneId.systemDefault());
	private static final int ORANGE = 0xFF9A3C, DIM = 0x9A90B0, TEXT = 0xECE8F4, BLUE = 0x9CC4FF, WARN = 0xFFC94D;

	private final MinecraftServer server;
	private final double left, bottom, face;
	private final Map<String, UUID> parts = new LinkedHashMap<>();
	private final Map<String, String> shown = new HashMap<>();
	private Mode mode = Mode.DASHBOARD;
	private boolean strayCleared;
	private int ticks;

	public ScreenWall(MinecraftServer server, BlockPos marker) {
		this.server = server;
		this.left = marker.getX() + 0.5 - 7.5;
		this.bottom = marker.getY() - 3;
		this.face = marker.getZ();
	}

	public Mode mode() {
		return mode;
	}

	public void setMode(Mode next) {
		if (next == mode) return;
		clear();
		mode = next;
		ticks = 19; // redraw on the next tick
	}

	public void tick(Collection<CrewProtocol.Session> sessions, List<CrewProtocol.Line> lines, String bridge) {
		if (++ticks % 20 != 0) return;
		ServerLevel level = server.overworld();
		if (!level.isPositionEntityTicking(BlockPos.containing(left + 7.5, bottom + 3, face))) return;
		if (!strayCleared) {
			// Panels from an earlier run were saved with the world; start fresh.
			for (Display d : level.getEntities(EntityTypes.TEXT_DISPLAY, d -> d.entityTags().contains(TAG))) d.discard();
			for (Display d : level.getEntities(EntityTypes.BLOCK_DISPLAY, d -> d.entityTags().contains(TAG))) d.discard();
			for (ScreenEntity e : level.getEntities(HauntedCrew.SCREEN, e -> true)) e.discard();
			strayCleared = true;
		}
		if (mode.web()) web(level);
		else if (mode == Mode.DASHBOARD) dashboard(level, sessions, lines, bridge);
		else activity(level, sessions, lines, bridge);
	}

	public void clear() {
		ServerLevel level = server.overworld();
		for (UUID id : parts.values()) {
			if (level.getEntity(id) instanceof Entity e) e.discard();
		}
		parts.clear();
		shown.clear();
	}

	// ---------------------------------------------------------------- views

	/** Browser modes: one quad showing the frames streamed from the bridge's headless Chrome. */
	private void web(ServerLevel level) {
		if (existing(level, "web", ScreenEntity.class) != null) return;
		ScreenEntity e = HauntedCrew.SCREEN.create(level, EntitySpawnReason.COMMAND);
		if (e == null) return;
		e.snapTo(left + 7.5, bottom + 0.2, face + 0.03, 0, 0);
		e.setSize(14.6f, 6.6f);
		spawn(level, "web", e);
	}

	private void dashboard(ServerLevel level, Collection<CrewProtocol.Session> sessions, List<CrewProtocol.Line> lines, String bridge) {
		List<CrewProtocol.Session> crew = new ArrayList<>(sessions);
		long working = crew.stream().filter(s -> s.status() == CrewProtocol.Status.WORKING).count();
		long waiting = crew.stream().filter(s -> s.status() == CrewProtocol.Status.WAITING).count();
		long errors = crew.stream().filter(s -> s.status() == CrewProtocol.Status.ERROR).count();
		List<CrewProtocol.Session> needs = crew.stream().filter(s -> s.permission() != null).toList();

		// Header bar with a pumpkin accent line.
		panel(level, "header", 0.2, 6.25, 14.8, 6.85, Blocks.DARK_OAK_PLANKS.defaultBlockState());
		rect(level, "accent", 0.2, 6.15, 14.8, 6.25, Blocks.GOLD_BLOCK.defaultBlockState());
		text(level, "title", 2.3, 6.36, 1.4, 0, false, c("HAUNTED CREW", ORANGE));
		text(level, "stats", 10.2, 6.38, 1.1, 0, false, c(crew.size() + " on shift    " + working + " working    " + waiting + " waiting    " + errors + " errors", TEXT));
		text(level, "live", 5.8, 6.38, 1.1, 0, false, c("connected".equals(bridge) ? "● live" : "● " + bridge, "connected".equals(bridge) ? 0x4ADE80 : WARN));

		// Crew cards (left column).
		for (int i = 0; i < 4; i++) {
			double top = 5.95 - i * 1.32, bot = top - 1.2;
			CrewProtocol.Session s = i < crew.size() ? crew.get(i) : null;
			panel(level, "card" + i, 0.3, bot, 4.5, top, Blocks.DEEPSLATE.defaultBlockState());
			rect(level, "strip" + i, 0.37, bot + 0.07, 0.5, top - 0.07, s == null ? Blocks.STONE.defaultBlockState() : statusBlock(s.status()), 0.008);
			Component body = s == null
				? c(i == 0 ? "No ghosts yet" : "", DIM).copy().append("\n").append(c(i == 0 ? "Press K to summon one" : "", DIM))
				: c(fit(s.label(), 16), TEXT).copy().append("\n").append(c(fit(s.activity(), 22), s.status() == CrewProtocol.Status.WAITING ? WARN : DIM));
			text(level, "crew" + i, 2.45, bot + 0.18, 1.25, 0, false, body);
		}

		// Live activity panel (middle).
		panel(level, "feedbg", 4.7, 0.3, 10.3, 5.95, Blocks.DEEPSLATE.defaultBlockState());
		double fScale = 1.05;
		int fWidth = (int) (5.3 / (PX * fScale));
		List<Component> feed = new ArrayList<>();
		feed.add(c("LIVE ACTIVITY", ORANGE));
		feed.add(Component.empty());
		List<CrewProtocol.Line> recent = lines.subList(Math.max(0, lines.size() - 16), lines.size());
		if (recent.isEmpty()) feed.add(c("Waiting for the crew…", DIM));
		for (CrewProtocol.Line l : recent) feed.add(logLine(l, 8, 20));
		text(level, "feed", 7.5, 0.42, fScale, fWidth, true, padded(feed, 18, fWidth));

		// Needs you (right, top) turns orange when someone is waiting for approval.
		panel(level, "needsbg", 10.5, 4.35, 14.7, 5.95, needs.isEmpty() ? Blocks.DEEPSLATE.defaultBlockState() : Blocks.CONCRETE.orange().defaultBlockState());
		MutableComponent need = c("NEEDS YOU", needs.isEmpty() ? ORANGE : 0x2A1A05).copy();
		if (needs.isEmpty()) need.append("\n").append(c("Nobody right now", DIM));
		for (int i = 0; i < Math.min(2, needs.size()); i++) {
			CrewProtocol.Session s = needs.get(i);
			need.append("\n").append(c(fit(s.label() + ": " + s.permission().title(), 24), 0x1A1005));
		}
		if (!needs.isEmpty()) need.append("\n").append(c("press K to answer", 0x3A2408));
		text(level, "needs", 12.6, 4.5, 1.05, 0, false, need);

		// Spec tasks (right, bottom), from Kiro task events.
		panel(level, "tasksbg", 10.5, 0.3, 14.7, 4.15, Blocks.DEEPSLATE.defaultBlockState());
		Map<String, Boolean> tasks = new LinkedHashMap<>();
		for (CrewProtocol.Line l : lines) {
			if ("task_start".equals(l.kind())) tasks.putIfAbsent(l.text().replaceFirst("^started task: ", ""), false);
			if ("task_end".equals(l.kind())) tasks.put(l.text().replaceFirst("^finished task: ", ""), true);
		}
		double tScale = 1.0;
		int tWidth = (int) (3.9 / (PX * tScale));
		List<Component> t = new ArrayList<>();
		t.add(c("SPEC TASKS", ORANGE));
		t.add(Component.empty());
		if (tasks.isEmpty()) {
			t.add(c("Kiro spec tasks", DIM));
			t.add(c("appear here", DIM));
		}
		List<Map.Entry<String, Boolean>> entries = new ArrayList<>(tasks.entrySet());
		for (Map.Entry<String, Boolean> e : entries.subList(Math.max(0, entries.size() - 11), entries.size())) {
			t.add(c((e.getValue() ? "✔ " : "○ ") + fit(e.getKey(), 24), e.getValue() ? 0x4ADE80 : TEXT));
		}
		text(level, "tasks", 12.6, 0.42, tScale, tWidth, true, padded(t, 13, tWidth));
	}

	private void activity(ServerLevel level, Collection<CrewProtocol.Session> sessions, List<CrewProtocol.Line> lines, String bridge) {
		double scale = 1.9;
		List<Component> crew = new ArrayList<>();
		crew.add(c("HAUNTED CREW", ORANGE));
		long working = sessions.stream().filter(s -> s.status() == CrewProtocol.Status.WORKING).count();
		crew.add(c(sessions.size() + " ghosts · " + working + " busy", DIM));
		crew.add(Component.empty());
		if (sessions.isEmpty()) crew.add(c("connected".equals(bridge) ? "Press K to summon" : "Bridge " + bridge, DIM));
		for (CrewProtocol.Session s : sessions) {
			if (crew.size() >= 11) break;
			crew.add(c("■ ", statusColor(s.status())).copy().append(c(fit(s.label(), 13), TEXT)));
			crew.add(c("   " + fit(s.activity(), 16), s.status() == CrewProtocol.Status.WAITING ? WARN : DIM));
		}
		int crewW = (int) (5.0 / (PX * scale));
		text(level, "logcrew", 2.9, 0.3, scale, crewW, true, padded(crew, 12, crewW));

		List<Component> feed = new ArrayList<>();
		feed.add(c("LIVE ACTIVITY", ORANGE));
		long waiting = sessions.stream().filter(s -> s.permission() != null).count();
		feed.add(c(waiting > 0 ? "⚠ " + waiting + " need approval (K)" : "full view: localhost:8787", waiting > 0 ? WARN : DIM));
		feed.add(Component.empty());
		List<CrewProtocol.Line> recent = lines.subList(Math.max(0, lines.size() - 9), lines.size());
		if (recent.isEmpty()) feed.add(c("Waiting for the crew…", DIM));
		for (CrewProtocol.Line l : recent) feed.add(logLine(l, 8, 19));
		int feedW = (int) (9.0 / (PX * scale));
		text(level, "logfeed", 10.0, 0.3, scale, feedW, true, padded(feed, 12, feedW));
	}

	// ---------------------------------------------------------------- building blocks

	/** A flat coloured panel from (x0, y0) to (x1, y1), just in front of the screen. */
	private void rect(ServerLevel level, String key, double x0, double y0, double x1, double y1, BlockState state) {
		rect(level, key, x0, y0, x1, y1, state, 0);
	}

	/** Minecraft-style panel: a dark blackstone frame with a lighter inset face (z-layered so nothing flickers). */
	private void panel(ServerLevel level, String key, double x0, double y0, double x1, double y1, BlockState face) {
		rect(level, key + "_f", x0, y0, x1, y1, Blocks.POLISHED_BLACKSTONE.defaultBlockState(), 0);
		rect(level, key, x0 + 0.07, y0 + 0.07, x1 - 0.07, y1 - 0.07, face, 0.004);
	}

	private void rect(ServerLevel level, String key, double x0, double y0, double x1, double y1, BlockState state, double dz) {
		Display.BlockDisplay d = existing(level, key, Display.BlockDisplay.class);
		if (d == null) {
			d = EntityTypes.BLOCK_DISPLAY.create(level, EntitySpawnReason.COMMAND);
			if (d == null) return;
			d.snapTo(left + x0, bottom + y0, face + 0.01 + dz, 0, 0);
			d.setTransformation(new Transformation(new Vector3f(), new Quaternionf(), new Vector3f((float) (x1 - x0), (float) (y1 - y0), 0.004f), new Quaternionf()));
			d.setBrightnessOverride(new Brightness(12, 12));
			d.setViewRange(2.0f);
			spawn(level, key, d);
		}
		if (d.getBlockState() != state) d.setBlockState(state);
	}

	/** Text whose bottom edge sits at y, centred on x (left-aligned inside a fixed width when width > 0). */
	private void text(ServerLevel level, String key, double x, double y, double scale, int width, boolean alignLeft, Component content) {
		Display.TextDisplay d = existing(level, key, Display.TextDisplay.class);
		if (d == null) {
			d = EntityTypes.TEXT_DISPLAY.create(level, EntitySpawnReason.COMMAND);
			if (d == null) return;
			d.snapTo(left + x, bottom + y, face + 0.04, 0, 0);
			d.setBillboardConstraints(Display.BillboardConstraints.FIXED);
			d.setBrightnessOverride(Brightness.FULL_BRIGHT);
			d.setBackgroundColor(0);
			d.setLineWidth(width > 0 ? width + 8 : 400);
			if (alignLeft) d.setFlags(Display.TextDisplay.FLAG_ALIGN_LEFT);
			d.setViewRange(2.0f);
			float s = (float) scale;
			d.setTransformation(new Transformation(new Vector3f(), new Quaternionf(), new Vector3f(s, s, s), new Quaternionf()));
			spawn(level, key, d);
		}
		String now = content.getString();
		if (!now.equals(shown.get(key))) {
			d.setText(content);
			shown.put(key, now);
		}
	}

	private <T extends Entity> T existing(ServerLevel level, String key, Class<T> type) {
		UUID id = parts.get(key);
		Entity e = id == null ? null : level.getEntity(id);
		return type.isInstance(e) && e.isAlive() ? type.cast(e) : null;
	}

	private void spawn(ServerLevel level, String key, Entity e) {
		e.addTag(TAG);
		if (level.addFreshEntity(e)) parts.put(key, e.getUUID());
	}

	/**
	 * Fixed number of lines plus a last line of spaces as wide as the panel, so left-aligned text always
	 * starts at the panel's left edge no matter how long the visible lines are.
	 */
	private static Component padded(List<Component> rows, int lines, int widthPx) {
		MutableComponent out = Component.empty();
		for (int i = 0; i < lines; i++) {
			if (i > 0) out.append("\n");
			if (i < rows.size()) out.append(rows.get(i));
		}
		return out.append("\n").append(" ".repeat(Math.max(1, widthPx / 4)));
	}

	private static Component logLine(CrewProtocol.Line l, int whoMax, int textMax) {
		String who = l.agent() != null ? l.agent() : "Ghost";
		return c(TIME.format(Instant.ofEpochMilli(l.ts())) + " ", 0x6E6880).copy()
			.append(c(fit(who, whoMax) + " ", BLUE))
			.append(c(fit(l.text().replace('\n', ' '), textMax), lineColor(l.kind())));
	}

	private static Component c(String s, int color) {
		return Component.literal(s).withColor(color);
	}

	private static String fit(String s, int max) {
		return s.length() <= max ? s : s.substring(0, max - 1) + "…";
	}

	private static BlockState statusBlock(CrewProtocol.Status s) {
		return switch (s) {
			case WORKING -> Blocks.CONCRETE.lightBlue().defaultBlockState();
			case WAITING -> Blocks.CONCRETE.yellow().defaultBlockState();
			case ERROR -> Blocks.CONCRETE.red().defaultBlockState();
			case IDLE -> Blocks.CONCRETE.lightGray().defaultBlockState();
		};
	}

	private static int statusColor(CrewProtocol.Status s) {
		return switch (s) {
			case WORKING -> 0x5AA9FF;
			case WAITING -> WARN;
			case ERROR -> 0xFF6B6B;
			case IDLE -> 0x6E6880;
		};
	}

	private static int lineColor(String kind) {
		if (kind == null) return 0xCFC8DE;
		return switch (kind) {
			case "error", "tool_end" -> 0xFF6B6B;
			case "permission", "stop" -> WARN;
			case "message" -> 0xFFFFFF;
			case "prompt" -> 0xCDB4FF;
			case "task_end" -> 0x4ADE80;
			default -> 0xCFC8DE;
		};
	}
}
