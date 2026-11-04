package dev.hauntedcrew;

import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.Style;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntitySpawnReason;
import net.minecraft.world.phys.Vec3;
import net.minecraft.world.scores.PlayerTeam;
import net.minecraft.world.scores.Scoreboard;
import net.minecraft.world.scores.TeamColor;

/**
 * Keeps one ghost per bridge session. Must only be called on the server thread.
 *
 * Session state is the source of truth; ghost entities are views of it. Ghosts are not saved and
 * vanish when their chunk unloads, so {@link #tick} respawns them once the anchor area is loaded
 * again and removes any orphans.
 */
public final class CrewManager {
	private static final int MAX_GHOSTS = 80;
	private static final double RING_RADIUS = 4.0;
	private static final int RECONCILE_TICKS = 20;

	private final MinecraftServer server;
	private final Map<String, CrewProtocol.Session> sessions = new LinkedHashMap<>();
	private final Map<String, UUID> ghosts = new HashMap<>();
	private final Map<String, Integer> slots = new HashMap<>();
	private Vec3 anchor;
	private List<Vec3> desks = List.of();
	private int ticks;

	public CrewManager(MinecraftServer server, Vec3 anchor) {
		this.server = server;
		this.anchor = anchor;
		resetTeams();
	}

	// Teams are saved with the world; drop members left over from ghosts of a previous run.
	private void resetTeams() {
		Scoreboard board = server.getScoreboard();
		for (PlayerTeam team : Set.copyOf(board.getPlayerTeams())) {
			if (!team.getName().startsWith("hauntedcrew_")) continue;
			for (String member : Set.copyOf(team.getPlayers())) board.removePlayerFromTeam(member, team);
		}
	}

	public int sessionCount() {
		return sessions.size();
	}

	public int ghostCount() {
		return (int) ghosts.values().stream().filter(uuid -> ghost(uuid).isPresent()).count();
	}

	public void setDesks(List<Vec3> desks) {
		this.desks = List.copyOf(desks);
		rehome();
	}

	public void setAnchor(Vec3 anchor) {
		this.anchor = anchor;
		rehome();
	}

	private void rehome() {
		for (Map.Entry<String, UUID> e : ghosts.entrySet()) {
			ghost(e.getValue()).ifPresent(g -> g.setHome(homeFor(e.getKey())));
		}
	}

	public void apply(CrewProtocol.Message message) {
		switch (message) {
			case CrewProtocol.Hello hello -> {
				Set<String> live = new HashSet<>();
				for (CrewProtocol.Session s : hello.sessions()) {
					live.add(s.id());
					update(s);
				}
				for (String id : Set.copyOf(sessions.keySet())) if (!live.contains(id)) remove(id);
			}
			case CrewProtocol.Update u -> update(u.session());
			case CrewProtocol.SessionEnded end -> remove(end.id());
		}
	}

	public void tick() {
		if (++ticks % RECONCILE_TICKS != 0) return;
		for (String id : sessions.keySet()) sync(id);
		Set<UUID> known = Set.copyOf(ghosts.values());
		for (GhostEntity g : server.overworld().getEntities(HauntedCrew.GHOST, g -> !known.contains(g.getUUID()) && !Guide.isGuide(g))) g.discard();
	}

	public void clear() {
		for (String id : Set.copyOf(sessions.keySet())) remove(id);
	}

	private void update(CrewProtocol.Session s) {
		if (!sessions.containsKey(s.id()) && sessions.size() >= MAX_GHOSTS) return;
		sessions.put(s.id(), s);
		sync(s.id());
	}

	private void sync(String id) {
		CrewProtocol.Session s = sessions.get(id);
		GhostEntity ghost = Optional.ofNullable(ghosts.get(id)).flatMap(this::ghost).orElse(null);
		if (ghost == null) {
			ghost = spawn(id);
			if (ghost == null) return; // area not loaded yet; retried on the next reconcile
		}
		ghost.setStatus(s.status());
		CrewProtocol.Job job = CrewProtocol.Job.fromName(s.agent());
		// Unknown names get a job from their seat, so a crew of unnamed agents still looks varied.
		ghost.setJob(job != null ? job : CrewProtocol.Job.WORKERS[slots.getOrDefault(id, 0) % CrewProtocol.Job.WORKERS.length]);
		ghost.setCustomName(Component.literal(s.label() + " · " + s.activity()).withStyle(Style.EMPTY.withColor(colorFor(s.status()))));
		ghost.setGlowingTag(s.status() == CrewProtocol.Status.WAITING || s.status() == CrewProtocol.Status.ERROR);
		joinTeam(ghost, s.status());
	}

	private GhostEntity spawn(String id) {
		ServerLevel level = server.overworld();
		Vec3 home = homeFor(id);
		if (!level.isPositionEntityTicking(BlockPos.containing(home))) return null;
		GhostEntity ghost = HauntedCrew.GHOST.create(level, EntitySpawnReason.COMMAND);
		if (ghost == null) return null;
		ghost.snapTo(home.x, home.y, home.z, 0, 0);
		ghost.setHome(home);
		ghost.setCustomNameVisible(true);
		if (!level.addFreshEntity(ghost)) return null;
		ghosts.put(id, ghost.getUUID());
		return ghost;
	}

	private void remove(String id) {
		sessions.remove(id);
		slots.remove(id);
		UUID uuid = ghosts.remove(id);
		if (uuid != null) {
			ghost(uuid).ifPresent(g -> {
				server.getScoreboard().removePlayerFromTeam(g.getScoreboardName());
				g.discard();
			});
		}
	}

	private Optional<GhostEntity> ghost(UUID uuid) {
		Entity e = server.overworld().getEntity(uuid);
		return e instanceof GhostEntity g && g.isAlive() ? Optional.of(g) : Optional.empty();
	}

	// Each session keeps a slot until it ends: office desks first, then a ring around the anchor.
	private Vec3 homeFor(String id) {
		int slot = slots.computeIfAbsent(id, k -> {
			for (int i = 0; ; i++) if (!slots.containsValue(i)) return i;
		});
		if (slot < desks.size()) return desks.get(slot);
		slot -= desks.size();
		// A big crew floats in stacked rings of 12 (two radii per level), so it stays inside the room.
		int ring = slot / 12, level = ring / 2;
		double angle = (slot % 12 + (ring % 2) * 0.5) * (2 * Math.PI / 12);
		double radius = RING_RADIUS + (ring % 2) * 3.0;
		return anchor.add(Math.cos(angle) * radius, 1.5 + level * 1.8, Math.sin(angle) * radius);
	}

	private static int colorFor(CrewProtocol.Status status) {
		return switch (status) {
			case WORKING -> 0x55AAFF;
			case WAITING -> 0xFFDD55;
			case ERROR -> 0xFF5555;
			case IDLE -> 0xAAAAAA;
		};
	}

	// Team colour drives the glow outline colour on vanilla clients too.
	private void joinTeam(GhostEntity ghost, CrewProtocol.Status status) {
		Scoreboard board = server.getScoreboard();
		String name = "hauntedcrew_" + status.name().toLowerCase();
		PlayerTeam team = board.getPlayerTeam(name);
		if (team == null) {
			team = board.addPlayerTeam(name);
			team.setColor(Optional.of(switch (status) {
				case WORKING -> TeamColor.BLUE;
				case WAITING -> TeamColor.YELLOW;
				case ERROR -> TeamColor.RED;
				case IDLE -> TeamColor.GRAY;
			}));
		}
		if (board.getPlayersTeam(ghost.getScoreboardName()) != team) board.addPlayerToTeam(ghost.getScoreboardName(), team);
	}
}
