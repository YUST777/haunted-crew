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
	/** Players Boo is leading home; value false = still flying out to fetch them. */
	private static final Map<UUID, Boolean> leading = new HashMap<>();

	private Guide() {}

	static boolean isGuide(Entity e) {
		return e.entityTags().contains(TAG);
	}

	private static Vec3 inside;

	static void setInside(Vec3 v) {
		inside = v;
	}

	/** Tour finished or skipped: walk the player into the office (desk area). */
	static void sendInside(ServerPlayer p) {
		leading.remove(p.getUUID());
		if (inside == null) return;
		p.teleportTo(inside.x, inside.y + 0.1, inside.z);
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

	/** First visit: Boo flies to the player, then leads them home and starts the tour there. */
	static void lead(ServerPlayer p) {
		leading.put(p.getUUID(), false);
		greeted.add(p.getUUID());
	}

	/** Lead a player home, or bob in place and turn toward the nearest player. */
	static void idle(GhostEntity g, ServerLevel level) {
		if (home == null) return;
		ServerPlayer lead = null;
		for (var it = leading.keySet().iterator(); it.hasNext() && lead == null;) {
			lead = level.getServer().getPlayerList().getPlayer(it.next());
			if (lead == null) it.remove();
		}
		if (lead != null) {
			leadStep(g, lead);
			return;
		}
		g.setPos(home.x, home.y + Math.sin(g.tickCount / 12.0) * 0.12, home.z);
		g.setDeltaMovement(Vec3.ZERO);
		Player p = level.getNearestPlayer(g, 12);
		if (p != null) face(g, p.position().subtract(g.position()));
	}

	private static void leadStep(GhostEntity g, ServerPlayer p) {
		UUID pid = p.getUUID();
		boolean fetched = leading.get(pid);
		Vec3 target = fetched ? home : p.position().add(0, 1.4, 0);
		Vec3 delta = target.subtract(g.position());
		double dist = delta.length();
		if (!fetched) {
			if (dist < 3) {
				leading.put(pid, true);
				p.sendOverlayMessage(c("👻 Follow Boo to the office!", ORANGE));
			} else g.setPos(g.position().add(delta.scale(0.35 / dist)));
		} else if (dist < 0.4) {
			leading.remove(pid);
			p.sendOverlayMessage(c("👻 You're home!", ORANGE));
			talk(g, p);
		} else if (p.distanceToSqr(g) > 36) {
			p.sendOverlayMessage(c("👻 Boo is waiting. Follow me!", ORANGE));
			face(g, p.position().subtract(g.position()));
			return;
		} else g.setPos(g.position().add(delta.scale(Math.min(0.2, dist) / dist)));
		g.setDeltaMovement(Vec3.ZERO);
		face(g, fetched ? delta : p.position().subtract(g.position()));
	}

	private static void face(GhostEntity g, Vec3 d) {
		float yaw = (float) Math.toDegrees(Math.atan2(-d.x, d.z));
		g.setYRot(yaw);
		g.setYHeadRot(yaw);
		g.yBodyRot = yaw;
	}

	/** Open the tutorial widget on the player's screen. */
	static void talk(GhostEntity g, ServerPlayer player) {
		if (net.fabricmc.fabric.api.networking.v1.ServerPlayNetworking.canSend(player, ConsolePayloads.ToClient.TYPE))
			net.fabricmc.fabric.api.networking.v1.ServerPlayNetworking.send(player, new ConsolePayloads.ToClient("{\"type\":\"tutorial\"}"));
		g.level().playSound(null, g.getX(), g.getY(), g.getZ(), SoundEvents.AMETHYST_BLOCK_CHIME, SoundSource.NEUTRAL, 1f, 1.2f);
	}

	private static MutableComponent c(String text, int color) {
		return Component.literal(text).withStyle(s -> s.withColor(color));
	}
}
