package dev.hauntedcrew;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonParseException;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Vec3i;
import net.minecraft.resources.Identifier;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.util.RandomSource;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.gamerules.GameRules;
import net.minecraft.world.level.levelgen.FlatLevelSource;
import net.minecraft.world.level.levelgen.structure.templatesystem.StructurePlaceSettings;
import net.minecraft.world.level.levelgen.structure.templatesystem.StructureTemplate;
import net.minecraft.world.level.storage.LevelData;
import net.minecraft.world.level.storage.LevelResource;
import net.minecraft.world.phys.Vec3;

/**
 * The agent office: a structure template (data/hauntedcrew/structure/office.nbt, or a world's own
 * saved copy) pasted into the world. Structure blocks in DATA mode inside it are markers:
 * "desk" (one per ghost), "screen", "taskwall", "bell", "spawn", "guide" (the tour ghost). Markers are removed on placement and
 * their positions stored in <world>/hauntedcrew/office.json.
 */
public final class Office {
	public static final Identifier TEMPLATE = HauntedCrew.id("office");
	public static final int MAX_SIZE = 96;
	private static final BlockPos DEFAULT_CENTER = new BlockPos(0, 64, 0);
	private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();

	private Office() {}

	/** Marker positions inside a placed office. Coordinates are overworld block positions. */
	public static final class Layout {
		public int[] origin;
		public int[] size;
		public List<int[]> desks = new ArrayList<>();
		public int[] screen, taskwall, bell, spawn, guide;

		public List<Vec3> deskSeats() {
			List<Vec3> seats = new ArrayList<>();
			for (int[] d : desks) seats.add(new Vec3(d[0] + 0.5, d[1] + 0.2, d[2] + 0.5));
			return seats;
		}

		public Vec3 center() {
			// The office room may sit inside a bigger build (house, grounds): centre on the desks.
			if (!desks.isEmpty()) {
				double x = 0, y = 0, z = 0;
				for (int[] d : desks) { x += d[0] + 0.5; y += d[1]; z += d[2] + 0.5; }
				return new Vec3(x / desks.size(), y / desks.size(), z / desks.size());
			}
			return new Vec3(origin[0] + size[0] / 2.0, origin[1] + 1, origin[2] + size[2] / 2.0);
		}
	}

	private static Path layoutFile(MinecraftServer server) {
		return server.getWorldPath(LevelResource.ROOT).resolve("hauntedcrew").resolve("office.json");
	}

	public static Optional<Layout> load(MinecraftServer server) {
		Path file = layoutFile(server);
		if (!Files.exists(file)) return Optional.empty();
		try {
			return Optional.ofNullable(GSON.fromJson(Files.readString(file), Layout.class));
		} catch (IOException | JsonParseException e) {
			HauntedCrew.LOG.error("[hauntedcrew] cannot read {}: {}", file, e.getMessage());
			return Optional.empty();
		}
	}

	private static void save(MinecraftServer server, Layout layout) throws IOException {
		Path file = layoutFile(server);
		Files.createDirectories(file.getParent());
		Path tmp = file.resolveSibling("office.json.tmp");
		Files.writeString(tmp, GSON.toJson(layout));
		Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
	}

	/** True for worlds made with the Haunted Office preset (empty flat overworld). */
	public static boolean isOfficeWorld(MinecraftServer server) {
		return server.overworld().getChunkSource().getGenerator() instanceof FlatLevelSource flat
			&& flat.settings().getLayersInfo().isEmpty();
	}

	/** First start of a Haunted Office world: paste the office at the centre and set up a quiet night. */
	public static Optional<Layout> setUpNewWorld(MinecraftServer server) throws IOException {
		Optional<Layout> layout = place(server, DEFAULT_CENTER);
		if (layout.isEmpty()) return layout;
		ServerLevel level = server.overworld();
		Layout l = layout.get();
		BlockPos spawn = l.spawn != null ? new BlockPos(l.spawn[0], l.spawn[1], l.spawn[2]) : BlockPos.containing(l.center());
		server.setRespawnData(LevelData.RespawnData.of(Level.OVERWORLD, spawn, 180, 0)); // face the big screen (north)
		GameRules rules = server.getGameRules();
		rules.set(GameRules.ADVANCE_TIME, false, server);
		rules.set(GameRules.ADVANCE_WEATHER, false, server);
		rules.set(GameRules.SPAWN_MOBS, false, server);
		rules.set(GameRules.SPAWN_MONSTERS, false, server);
		rules.set(GameRules.SPAWN_PHANTOMS, false, server);
		rules.set(GameRules.RESPAWN_RADIUS, 0, server);
		server.getCommands().performPrefixedCommand(server.createCommandSourceStack().withSuppressedOutput(), "time set midnight");
		HauntedCrew.LOG.info("[hauntedcrew] built the Haunted Office in {} ({} desks)", level.dimension().identifier(), l.desks.size());
		return layout;
	}

	/** Pastes the office with its floor centre at {@code center}; returns the stored layout. */
	public static Optional<Layout> place(MinecraftServer server, BlockPos center) throws IOException {
		Optional<StructureTemplate> found = server.getStructureTemplateManager().get(TEMPLATE);
		if (found.isEmpty()) {
			HauntedCrew.LOG.error("[hauntedcrew] office template {} not found", TEMPLATE);
			return Optional.empty();
		}
		StructureTemplate template = found.get();
		Vec3i size = template.getSize();
		BlockPos origin = center.offset(-size.getX() / 2, 0, -size.getZ() / 2);
		StructurePlaceSettings settings = new StructurePlaceSettings();
		ServerLevel level = server.overworld();
		template.placeInWorld(level, origin, origin, settings, RandomSource.create(), Block.UPDATE_CLIENTS);

		Layout layout = new Layout();
		layout.origin = new int[] {origin.getX(), origin.getY(), origin.getZ()};
		layout.size = new int[] {size.getX(), size.getY(), size.getZ()};
		for (StructureTemplate.StructureBlockInfo info : template.filterBlocks(origin, settings, Blocks.STRUCTURE_BLOCK)) {
			if (info.nbt() == null || !"DATA".equals(info.nbt().getStringOr("mode", ""))) continue;
			BlockPos p = info.pos();
			int[] xyz = {p.getX(), p.getY(), p.getZ()};
			switch (info.nbt().getStringOr("metadata", "").trim().toLowerCase()) {
				case "desk" -> layout.desks.add(xyz);
				case "screen" -> layout.screen = xyz;
				case "taskwall" -> layout.taskwall = xyz;
				case "bell" -> layout.bell = xyz;
				case "spawn" -> layout.spawn = xyz;
				case "guide" -> layout.guide = xyz;
				default -> {
					continue; // unknown marker: leave the block so the builder notices
				}
			}
			level.setBlock(p, Blocks.AIR.defaultBlockState(), Block.UPDATE_CLIENTS);
		}
		// Stable seat order: left to right, front to back.
		layout.desks.sort((a, b) -> a[2] != b[2] ? Integer.compare(a[2], b[2]) : Integer.compare(a[0], b[0]));
		save(server, layout);
		return Optional.of(layout);
	}

	/** Saves the region between two corners as this world's office template. Returns the file path. */
	public static Path saveRegion(MinecraftServer server, BlockPos a, BlockPos b) throws IOException {
		BlockPos min = BlockPos.min(a, b);
		BlockPos max = BlockPos.max(a, b);
		Vec3i size = new Vec3i(max.getX() - min.getX() + 1, max.getY() - min.getY() + 1, max.getZ() - min.getZ() + 1);
		if (size.getX() > MAX_SIZE || size.getY() > MAX_SIZE || size.getZ() > MAX_SIZE) {
			throw new IOException("office is larger than " + MAX_SIZE + " blocks on a side");
		}
		StructureTemplate template = server.getStructureTemplateManager().getOrCreate(TEMPLATE);
		template.fillFromWorld(server.overworld(), min, size, false, List.of(Blocks.STRUCTURE_VOID));
		template.setAuthor("Haunted Crew");
		if (!server.getStructureTemplateManager().save(TEMPLATE)) throw new IOException("could not write the template");
		return server.getWorldPath(LevelResource.GENERATED_DIR).resolve(TEMPLATE.getNamespace());
	}
}
