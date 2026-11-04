package dev.hauntedcrew;

import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import net.minecraft.ChatFormatting;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntitySpawnReason;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.phys.Vec3;

/**
 * Boo, the tour ghost at the office gate (top hat, lantern). Right-click for the next tip of a
 * short tutorial; players walking up get a hint. Not saved with the world: respawned at the
 * office's "guide" marker whenever that area is loaded. Server thread only.
 */
final class Guide {
	static final String TAG = "hauntedcrew_guide";
	private static final double GREET_RANGE = 7;
	private static final int ORANGE = 0xFF9A3C, TEXT = 0xECE8F4, DIM = 0xA59CB8, CMD = 0x7DD3FC;

	private static Vec3 home;
	private static UUID id;
	private static int ticks;
	private static final Map<UUID, Integer> step = new HashMap<>();
	private static final Set<UUID> greeted = new HashSet<>();

	private Guide() {}

	static boolean isGuide(Entity e) {
		return e.entityTags().contains(TAG);
	}

	static void setHome(int[] marker) {
		home = marker == null ? null : new Vec3(marker[0] + 0.5, marker[1] + 0.6, marker[2] + 0.5);
		id = null;
	}

	static void tick(MinecraftServer server) {
		if (home == null || ++ticks % 20 != 0) return;
		ServerLevel level = server.overworld();
		Entity existing = id == null ? null : level.getEntity(id);
		if (existing == null || !existing.isAlive()) {
			if (level.isPositionEntityTicking(BlockPos.containing(home))) spawn(level);
			return;
		}
		for (ServerPlayer p : level.players()) {
			if (p.distanceToSqr(existing) > GREET_RANGE * GREET_RANGE || !greeted.add(p.getUUID())) continue;
			p.sendOverlayMessage(c("👻 New here? Right-click Boo for a quick tour!", ORANGE));
		}
	}

	private static void spawn(ServerLevel level) {
		GhostEntity g = HauntedCrew.GHOST.create(level, EntitySpawnReason.COMMAND);
		if (g == null) return;
		g.snapTo(home.x, home.y, home.z, 180, 0);
		g.setJob(CrewProtocol.Job.GUIDE);
		g.addTag(TAG);
		g.setCustomName(c("Boo, your guide", ORANGE).copy().append(c("  (right-click me)", DIM)));
		g.setCustomNameVisible(true);
		if (level.addFreshEntity(g)) id = g.getUUID();
	}

	/** Bob in place and turn toward the nearest player. */
	static void idle(GhostEntity g, ServerLevel level) {
		if (home == null) return;
		g.setPos(home.x, home.y + Math.sin(g.tickCount / 12.0) * 0.12, home.z);
		g.setDeltaMovement(Vec3.ZERO);
		Player p = level.getNearestPlayer(g, 12);
		if (p == null) return;
		Vec3 d = p.position().subtract(g.position());
		float yaw = (float) Math.toDegrees(Math.atan2(-d.x, d.z));
		g.setYRot(yaw);
		g.setYHeadRot(yaw);
		g.yBodyRot = yaw;
	}

	static void talk(GhostEntity g, ServerPlayer player) {
		List<List<Component>> pages = pages();
		int i = step.getOrDefault(player.getUUID(), 0) % pages.size();
		step.put(player.getUUID(), i + 1);
		player.sendSystemMessage(c("", TEXT));
		player.sendSystemMessage(c("👻 Boo", ORANGE).copy().withStyle(ChatFormatting.BOLD)
			.append(c("  ·  tip " + (i + 1) + " of " + pages.size(), DIM).copy().withStyle(s -> s.withBold(false))));
		for (Component line : pages.get(i)) player.sendSystemMessage(line);
		if (i + 1 < pages.size()) player.sendSystemMessage(c("Right-click me for the next tip.", DIM));
		g.level().playSound(null, g.getX(), g.getY(), g.getZ(), SoundEvents.AMETHYST_BLOCK_CHIME, SoundSource.NEUTRAL, 1f, 1.2f + i * 0.05f);
	}

	private static List<List<Component>> pages() {
		boolean connected = "connected".equals(HauntedCrew.bridgeState());
		return List.of(
			List.of(c("Welcome to the Haunted Office! Every ghost inside is one of your Kiro AI agents, working on your real project. Let me show you around.", TEXT)),
			connected
				? List.of(c("✔ Your crew is connected to Kiro. You're ready to go.", 0x4ADE80))
				: List.of(c("First, connect your crew. On this PC, open a terminal in your project folder and run:", TEXT),
					c("   npx haunted-crew", CMD),
					c("Add --demo to try it without a Kiro account. The game finds it by itself.", DIM)),
			List.of(c("Open the Agent Console: right-click the ghost item in your hotbar, or press K. Click + New ghost, pick a job (Planner, Coder, Tester…) and type a task, just like chatting with an AI.", TEXT)),
				List.of(c("Want a whole team? In the console, open Workflows: chain ghosts with arrows (plan → code → test → review), or make your own agents from a prompt or a SKILL.md. Press Run and watch them hand work to each other.", TEXT)),
			List.of(c("Your ghost floats to a desk and gets to work. Its name tag shows what it's doing, and the big screen inside shows the whole crew live.", TEXT)),
			List.of(c("When a ghost glows and floats over to you, it needs your OK: it wants to edit a file or run a command. Open the console and press Allow or Reject.", TEXT)),
			List.of(c("Hold the Screen Remote and right-click to switch the big screen: Dashboard → Live code (see every edit as it happens) → Website (your project) → Web search → Activity. Left-click the screen to use it like a browser.", TEXT)),
			List.of(c("Friends can join your world and watch. Only you and operators give orders.", TEXT),
				c("Server on another PC? Use /crew pair with the code the launcher prints.", DIM)),
			List.of(c("That's the tour! Head inside, the desks are waiting.", TEXT),
				c("Right-click me any time to hear it again.", DIM)));
	}

	private static MutableComponent c(String text, int color) {
		return Component.literal(text).withStyle(s -> s.withColor(color));
	}
}
