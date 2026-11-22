package dev.hauntedcrew;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.StringArgumentType;
import java.io.IOException;
import java.net.URI;
import java.nio.file.Path;
import java.util.Optional;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry;
import net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents;
import net.fabricmc.fabric.api.networking.v1.ServerPlayNetworking;
import net.fabricmc.fabric.api.object.builder.v1.entity.FabricDefaultAttributeRegistry;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.commands.arguments.coordinates.BlockPosArgument;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Registry;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.registries.Registries;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;
import net.minecraft.resources.ResourceKey;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.MobCategory;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.SoundType;
import net.minecraft.world.level.block.state.BlockBehaviour;
import net.minecraft.world.phys.Vec3;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public final class HauntedCrew implements ModInitializer {
	public static final String MOD_ID = "hauntedcrew";
	public static final Logger LOG = LoggerFactory.getLogger(MOD_ID);

	private static final ResourceKey<EntityType<?>> GHOST_KEY = ResourceKey.create(Registries.ENTITY_TYPE, id("ghost"));
	public static final EntityType<GhostEntity> GHOST = Registry.register(
		BuiltInRegistries.ENTITY_TYPE,
		GHOST_KEY,
		EntityType.Builder.of(GhostEntity::new, MobCategory.MISC).sized(0.7f, 0.9f).noSave().fireImmune().clientTrackingRange(10).build(GHOST_KEY)
	);

	private static final ResourceKey<Block> MONITOR_KEY = ResourceKey.create(Registries.BLOCK, id("monitor"));
	public static final Block MONITOR = Registry.register(BuiltInRegistries.BLOCK, MONITOR_KEY, new MonitorBlock(
		BlockBehaviour.Properties.of().setId(MONITOR_KEY).strength(1.0f).noOcclusion().lightLevel(state -> 7).sound(SoundType.METAL)));
	private static final ResourceKey<Item> MONITOR_ITEM_KEY = ResourceKey.create(Registries.ITEM, id("monitor"));
	public static final Item MONITOR_ITEM = Registry.register(BuiltInRegistries.ITEM, MONITOR_ITEM_KEY,
		new BlockItem(MONITOR, new Item.Properties().setId(MONITOR_ITEM_KEY).useBlockDescriptionPrefix()));

	public static final Item SCREEN_REMOTE = item("screen_remote", CrewItem.Kind.REMOTE);
	public static final Item AGENT_CONSOLE = item("agent_console", CrewItem.Kind.CONSOLE);
	private static final String KIT_TAG = "hauntedcrew_kit2";

	private static final ResourceKey<EntityType<?>> SCREEN_KEY = ResourceKey.create(Registries.ENTITY_TYPE, id("screen"));
	public static final EntityType<ScreenEntity> SCREEN = Registry.register(BuiltInRegistries.ENTITY_TYPE, SCREEN_KEY,
		EntityType.Builder.<ScreenEntity>of(ScreenEntity::new, MobCategory.MISC).sized(0.5f, 0.5f).noSave().clientTrackingRange(10).build(SCREEN_KEY));

	private static Item item(String name, CrewItem.Kind kind) {
		ResourceKey<Item> key = ResourceKey.create(Registries.ITEM, id(name));
		return Registry.register(BuiltInRegistries.ITEM, key, new CrewItem(new Item.Properties().setId(key).stacksTo(1), kind));
	}

	private static Path configFile;
	private static CrewConfig config;
	private static CrewManager manager;
	private static ConsoleService console;
	private static ScreenWall screen;
	private static BridgeClient bridge;
	private static int discoverTicks;
	private static int[] officeSpawn;

	public static Identifier id(String path) {
		return Identifier.fromNamespaceAndPath(MOD_ID, path);
	}

	@Override
	public void onInitialize() {
		FabricDefaultAttributeRegistry.register(GHOST, GhostEntity.createAttributes());
		PayloadTypeRegistry.clientboundPlay().register(ConsolePayloads.ToClient.TYPE, ConsolePayloads.ToClient.CODEC);
		PayloadTypeRegistry.serverboundPlay().register(ConsolePayloads.ToServer.TYPE, ConsolePayloads.ToServer.CODEC);
		PayloadTypeRegistry.clientboundPlay().register(ConsolePayloads.ScreenFrame.TYPE, ConsolePayloads.ScreenFrame.CODEC);
		ServerPlayNetworking.registerGlobalReceiver(ConsolePayloads.ToServer.TYPE, (payload, context) -> {
			if (console != null) console.handle(context.player(), payload.json());
		});
		configFile = FabricLoader.getInstance().getConfigDir().resolve("hauntedcrew.json");

		ServerLifecycleEvents.SERVER_STARTED.register(HauntedCrew::start);
		ServerLifecycleEvents.SERVER_STOPPING.register(server -> stop());
		ServerTickEvents.END_SERVER_TICK.register(server -> {
			if (manager != null) manager.tick();
			Guide.tick(server);
			if (screen != null && console != null) screen.tick(console.sessions(), console.lines(), bridgeState());
			if (config != null && ++discoverTicks % 200 == 0) rediscover(server);
		});
		CommandRegistrationCallback.EVENT.register((dispatcher, registryAccess, selection) -> registerCommands(dispatcher));
		// First visit to a Haunted Office world: hand out the console and screen tools.
		ServerPlayConnectionEvents.JOIN.register((handler, sender, server) -> server.execute(() -> {
			ServerPlayer p = handler.player;
			if (screen != null && p.entityTags().add(KIT_TAG)) {
				giveKit(p);
				// First visit: start at the office's spawn marker (the gate), facing the house.
				if (officeSpawn != null) server.getCommands().performPrefixedCommand(server.createCommandSourceStack().withSuppressedOutput(),
					String.format(java.util.Locale.ROOT, "tp %s %.1f %d %.1f 180 0", p.getGameProfile().name(), officeSpawn[0] + 0.5, officeSpawn[1], officeSpawn[2] + 0.5));
				Guide.lead(p);
			}
		}));
	}

	private static void start(MinecraftServer server) {
		try {
			config = CrewConfig.load(configFile);
		} catch (IOException e) {
			LOG.error("[hauntedcrew] cannot read {}: {}", configFile, e.getMessage());
			return;
		}
		Optional<Office.Layout> office = Office.load(server);
		if (office.isEmpty() && Office.isOfficeWorld(server)) {
			try {
				office = Office.setUpNewWorld(server);
			} catch (IOException e) {
				LOG.error("[hauntedcrew] could not build the office: {}", e.getMessage());
			}
		}
		manager = new CrewManager(server, anchorOf(server, config, office));
		console = new ConsoleService(server, config, HauntedCrew::bridgeState);
		office.ifPresent(l -> manager.setDesks(l.deskSeats()));
		officeSpawn = office.map(l -> l.spawn).orElse(null);
		Guide.setHome(office.map(l -> l.guide).orElse(null));
		Guide.setInside(office.map(Office.Layout::center).orElse(null));
		office.filter(l -> l.screen != null).ifPresent(l -> screen = new ScreenWall(server, new BlockPos(l.screen[0], l.screen[1], l.screen[2])));
		connect(server);
	}

	private static void connect(MinecraftServer server) {
		if (!"paired".equals(config.source())) config.discoverLocal();
		String problem = config.validate();
		if (problem != null) {
			LOG.info("[hauntedcrew] waiting for a bridge: {}", problem);
			return;
		}
		if (config.insecureRemote()) {
			LOG.warn("[hauntedcrew] bridge URL uses ws:// to a remote host; the view token is sent unencrypted. Use wss:// behind TLS.");
		}
		LOG.info("[hauntedcrew] using {} bridge at {}", config.source(), config.url());
		String streamUrl = config.url() + (config.url().contains("?") ? "&" : "?") + "frames=1";
		bridge = new BridgeClient(URI.create(streamUrl), config.token(), text -> {
			if (text.startsWith("{\"type\":\"frame\"")) {
				forwardFrame(server, text);
				return;
			}
			CrewProtocol.Message msg = CrewProtocol.parse(text);
			if (msg != null) server.execute(() -> {
				if (manager != null) manager.apply(msg);
				if (console != null) console.apply(msg);
			});
		}, LOG);
		bridge.start();
	}

	// Every 10 s: pick up a launcher started after the world, or one that moved to a new port.
	private static void rediscover(MinecraftServer server) {
		if ("paired".equals(config.source())) return;
		String before = config.url() + config.token();
		boolean found = config.discoverLocal();
		boolean changed = !before.equals(config.url() + config.token());
		if (found && (bridge == null || (changed && bridge.state() != BridgeClient.State.CONNECTED))) reconnect(server);
	}

	static void reconnect(MinecraftServer server) {
		if (bridge != null) bridge.stop();
		bridge = null;
		Guide.setHome(null);
		connect(server);
	}

	static CrewConfig config() {
		return config;
	}

	static String bridgeState() {
		if (bridge == null) return "none".equals(config == null ? "none" : config.source()) ? "not paired" : "not connected";
		return bridge.state().name().toLowerCase();
	}

	/** Exchanges a launcher pairing code for tokens, saves them, reconnects. Server thread. */
	static void pair(MinecraftServer server, String code, String url, java.util.function.Consumer<String> reply) {
		String streamUrl = url == null || url.isBlank() ? config.url() : url.trim();
		URI uri;
		try {
			uri = URI.create(streamUrl);
		} catch (IllegalArgumentException e) {
			reply.accept("That bridge address is not valid.");
			return;
		}
		if (!"ws".equals(uri.getScheme()) && !"wss".equals(uri.getScheme()) || uri.getRawAuthority() == null) {
			reply.accept("Bridge address must look like ws://host:8787/stream");
			return;
		}
		String base = ("wss".equals(uri.getScheme()) ? "https://" : "http://") + uri.getRawAuthority();
		com.google.gson.JsonObject body = new com.google.gson.JsonObject();
		body.addProperty("code", code);
		java.net.http.HttpRequest req = java.net.http.HttpRequest.newBuilder(URI.create(base + "/pair"))
			.timeout(java.time.Duration.ofSeconds(10)).header("Content-Type", "application/json")
			.POST(java.net.http.HttpRequest.BodyPublishers.ofString(body.toString())).build();
		java.net.http.HttpClient.newBuilder().version(java.net.http.HttpClient.Version.HTTP_1_1).build().sendAsync(req, java.net.http.HttpResponse.BodyHandlers.ofString()).whenComplete((res, err) -> server.execute(() -> {
			if (err != null) {
				reply.accept("Could not reach the bridge at " + base + ". Is haunted-crew running?");
				return;
			}
			if (res.statusCode() != 200) {
				reply.accept(res.statusCode() == 429 ? "Too many tries. Wait a minute." : "That code is wrong or expired. Use the newest one from the launcher.");
				return;
			}
			try {
				com.google.gson.JsonObject tokens = com.google.gson.JsonParser.parseString(res.body()).getAsJsonObject();
				config.viewToken = tokens.get("view").getAsString();
				config.commandToken = tokens.get("command").getAsString();
				config.bridgeUrl = streamUrl;
				config.save(configFile);
			} catch (IOException | RuntimeException e) {
				reply.accept("Paired, but could not save the config: " + e.getMessage());
				return;
			}
			reconnect(server);
			reply.accept("Paired with the bridge. Your crew is on its way.");
		}));
	}

	// Browser frames from the bridge go straight to every client with the mod (only while the screen shows a page).
	private static void forwardFrame(MinecraftServer server, String json) {
		if (screen == null || !screen.mode().web()) return;
		byte[] jpeg;
		String url;
		try {
			com.google.gson.JsonObject o = com.google.gson.JsonParser.parseString(json).getAsJsonObject();
			jpeg = java.util.Base64.getDecoder().decode(o.get("data").getAsString());
			url = o.has("url") ? o.get("url").getAsString() : "";
			// The preview URL carries the view token; players only need to see that it's the project preview.
			if (url.contains("/preview")) url = "project preview";
			else if (url.contains("/code#")) url = "live code";
			if (url.length() > 2000) url = url.substring(0, 2000);
		} catch (RuntimeException e) {
			return;
		}
		String shownUrl = url;
		server.execute(() -> {
			ConsolePayloads.ScreenFrame frame = new ConsolePayloads.ScreenFrame(jpeg, shownUrl);
			for (ServerPlayer p : server.getPlayerList().getPlayers()) {
				if (ServerPlayNetworking.canSend(p, ConsolePayloads.ScreenFrame.TYPE)) ServerPlayNetworking.send(p, frame);
			}
		});
	}

	static ScreenWall.Mode screenMode() {
		return screen == null ? null : screen.mode();
	}

	static void giveKit(ServerPlayer player) {
		Item[] kit = {AGENT_CONSOLE, SCREEN_REMOTE};
		for (int i = 0; i < kit.length; i++) {
			Item item = kit[i];
			if (player.getInventory().contains(st -> st.getItem() == item)) continue;
			ItemStack stack = new ItemStack(item);
			if (player.getInventory().getItem(i).isEmpty()) player.getInventory().setItem(i, stack);
			else player.getInventory().add(stack);
		}
	}

	/** Screen Remote right-click: next view (Dashboard -> Live code -> Website preview -> Web search -> Activity log). */
	static void cycleScreen(ServerPlayer player) {
		if (screen == null) {
			player.sendOverlayMessage(Component.literal("No big screen here. Use a Haunted Office world."));
			return;
		}
		if (console == null || !console.isTrusted(player)) {
			player.sendOverlayMessage(Component.literal("Only the world owner or an operator can switch the screen."));
			return;
		}
		ScreenWall.Mode[] all = ScreenWall.Mode.values();
		setScreenMode(player, all[(screen.mode().ordinal() + 1) % all.length]);
	}

	/** Puts the big screen in `next` and starts the page it needs. */
	static void setScreenMode(ServerPlayer player, ScreenWall.Mode next) {
		screen.setMode(next);
		String hint = next.web() ? "  ·  click it · sneak+use to type" : "";
		player.sendOverlayMessage(Component.literal("Big screen: " + next.label + hint).withColor(0xFF9A3C));
		switch (next) {
			case CODE -> console.browser(player, "/browser/open", "url", "code");
			case WEBSITE -> console.browser(player, "/browser/open", "url", "preview");
			case SEARCH -> console.browser(player, "/browser/open", "url", "https://duckduckgo.com/");
			default -> console.browser(player, "/browser/stop", null, null);
		}
	}

	private static void stop() {
		if (bridge != null) bridge.stop();
		bridge = null;
		if (manager != null) manager.clear();
		manager = null;
		console = null;
		if (screen != null) screen.clear();
		screen = null;
	}

	private static Vec3 anchorOf(MinecraftServer server, CrewConfig cfg, Optional<Office.Layout> office) {
		if (cfg.anchor != null) return new Vec3(cfg.anchor.x, cfg.anchor.y, cfg.anchor.z);
		if (office.isPresent()) return office.get().center();
		return Vec3.atBottomCenterOf(server.getRespawnData().pos());
	}

	private static int pairCommand(CommandSourceStack source, String code, String url) {
		if (config == null) {
			source.sendFailure(Component.literal("Haunted Crew is not running."));
			return 0;
		}
		pair(source.getServer(), code, url, msg -> source.sendSuccess(() -> Component.literal("Haunted Crew: " + msg), false));
		source.sendSuccess(() -> Component.literal("Haunted Crew: pairing…"), false);
		return 1;
	}

	private static void registerCommands(CommandDispatcher<CommandSourceStack> dispatcher) {
		// /bigscreen <mode>: same as the Screen Remote, for the world owner or an operator (no cheats needed).
		dispatcher.register(Commands.literal("bigscreen")
			.requires(src -> src.getEntity() instanceof ServerPlayer p && console != null && console.isTrusted(p))
			.then(Commands.argument("mode", com.mojang.brigadier.arguments.StringArgumentType.word()).executes(ctx -> {
				String want = com.mojang.brigadier.arguments.StringArgumentType.getString(ctx, "mode");
				for (ScreenWall.Mode m : ScreenWall.Mode.values()) {
					if (m.name().equalsIgnoreCase(want) && screen != null) {
						setScreenMode(ctx.getSource().getPlayerOrException(), m);
						return 1;
					}
				}
				ctx.getSource().sendFailure(Component.literal("Modes: dashboard, code, website, search, activity (needs an office)"));
				return 0;
			})));
		dispatcher.register(Commands.literal("crew")
			.requires(Commands.hasPermission(Commands.LEVEL_GAMEMASTERS))
			.then(Commands.literal("status").executes(ctx -> {
				String state = bridgeState();
				int sessions = manager == null ? 0 : manager.sessionCount();
				int ghosts = manager == null ? 0 : manager.ghostCount();
				String url = config == null ? "?" : config.url() + " (" + config.source() + ")";
				ctx.getSource().sendSuccess(() -> Component.literal("Haunted Crew: bridge " + state + " at " + url + ", "
					+ sessions + " session(s), " + ghosts + " ghost(s) loaded"), false);
				return 1;
			}))
			.then(Commands.literal("reload").executes(ctx -> {
				MinecraftServer server = ctx.getSource().getServer();
				stop();
				start(server);
				ctx.getSource().sendSuccess(() -> Component.literal("Haunted Crew: config reloaded"), true);
				return 1;
			}))
			.then(Commands.literal("anchor").executes(ctx -> {
				if (config == null || manager == null) {
					ctx.getSource().sendFailure(Component.literal("Haunted Crew is not running; fix config and /crew reload"));
					return 0;
				}
				Vec3 pos = ctx.getSource().getPosition();
				CrewConfig.Anchor a = new CrewConfig.Anchor();
				a.x = pos.x;
				a.y = pos.y;
				a.z = pos.z;
				config.anchor = a;
				try {
					config.save(configFile);
				} catch (IOException e) {
					ctx.getSource().sendFailure(Component.literal("Could not save config: " + e.getMessage()));
					return 0;
				}
				manager.setAnchor(pos);
				ctx.getSource().sendSuccess(() -> Component.literal("Haunted Crew: ghosts now gather here"), true);
				return 1;
			}))
			.then(Commands.literal("kit").executes(ctx -> {
				giveKit(ctx.getSource().getPlayerOrException());
				ctx.getSource().sendSuccess(() -> Component.literal("Haunted Crew: here are your tools (console, dashboard, activity log)"), false);
				return 1;
			}))
			.then(Commands.literal("pair")
				.then(Commands.argument("code", StringArgumentType.string())
					.executes(ctx -> pairCommand(ctx.getSource(), StringArgumentType.getString(ctx, "code"), null))
					.then(Commands.argument("url", StringArgumentType.greedyString())
						.executes(ctx -> pairCommand(ctx.getSource(), StringArgumentType.getString(ctx, "code"), StringArgumentType.getString(ctx, "url"))))))
			.then(Commands.literal("office")
				.then(Commands.literal("place").executes(ctx -> {
					MinecraftServer server = ctx.getSource().getServer();
					try {
						Optional<Office.Layout> layout = Office.place(server, BlockPos.containing(ctx.getSource().getPosition()));
						if (layout.isEmpty()) {
							ctx.getSource().sendFailure(Component.literal("Office template not found"));
							return 0;
						}
						if (manager != null) manager.setDesks(layout.get().deskSeats());
						int desks = layout.get().desks.size();
						ctx.getSource().sendSuccess(() -> Component.literal("Haunted Crew: office placed with " + desks + " desk(s)"), true);
						return 1;
					} catch (IOException e) {
						ctx.getSource().sendFailure(Component.literal("Could not place office: " + e.getMessage()));
						return 0;
					}
				}))
				.then(Commands.literal("save")
					.then(Commands.argument("from", BlockPosArgument.blockPos())
						.then(Commands.argument("to", BlockPosArgument.blockPos()).executes(ctx -> {
							BlockPos from = BlockPosArgument.getLoadedBlockPos(ctx, "from");
							BlockPos to = BlockPosArgument.getLoadedBlockPos(ctx, "to");
							try {
								Path dir = Office.saveRegion(ctx.getSource().getServer(), from, to);
								ctx.getSource().sendSuccess(() -> Component.literal("Haunted Crew: office saved under " + dir), true);
								return 1;
							} catch (IOException e) {
								ctx.getSource().sendFailure(Component.literal("Could not save office: " + e.getMessage()));
								return 0;
							}
						}))))));
	}
}
