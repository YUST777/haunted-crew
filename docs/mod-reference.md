# Haunted Crew Fabric mod: exhaustive reference

Scope: every Java file under `mod/src/main/java/dev/hauntedcrew`, `mod/src/client/java/dev/hauntedcrew/client`, and `mod/src/test/java/dev/hauntedcrew`, plus `mod/src/main/resources` (fabric.mod.json, lang, item/block/model JSON, ghost model, world preset, tag, office template) and `mod/README.md`. Target: Minecraft 26.3, Java 25, Fabric Loader 0.20.1, Fabric API 0.165.0+26.3, mod version 0.1.0.

Every value below was read from the code or resource files. Items marked **Not verified** at the end of the document were not checked.

## Table of contents

1. [Mod metadata and dependencies](#1-mod-metadata-and-dependencies)
2. [Registered content](#2-registered-content)
3. [Server entry point and lifecycle (HauntedCrew)](#3-server-entry-point-and-lifecycle-hauntedcrew)
4. [Commands (/crew)](#4-commands-crew)
5. [Keybinding, items and in-world controls](#5-keybinding-items-and-in-world-controls)
6. [Config file config/hauntedcrew.json](#6-config-file-confighauntedcrewjson)
7. [CrewProtocol: bridge messages, Job, Status, Session](#7-crewprotocol-bridge-messages-job-status-session)
8. [CrewManager and GhostEntity: ghosts, desks, slots, reconcile](#8-crewmanager-and-ghostentity-ghosts-desks-slots-reconcile)
9. [Office builder](#9-office-builder)
10. [Big screen: ScreenWall, ScreenEntity, frame pipeline](#10-big-screen-screenwall-screenentity-frame-pipeline)
11. [Client: ghost rendering and client state](#11-client-ghost-rendering-and-client-state)
12. [Client screens](#12-client-screens)
13. [Guide NPC (Boo)](#13-guide-npc-boo)
14. [Payloads and ConsoleService: every action and what the server does](#14-payloads-and-consoleservice-every-action-and-what-the-server-does)
15. [BridgeClient and bridge HTTP calls](#15-bridgeclient-and-bridge-http-calls)
16. [Build and test](#16-build-and-test)
17. [Source map](#17-source-map)
18. [Not verified](#18-not-verified)

---

## 1. Mod metadata and dependencies

Source: `mod/src/main/resources/fabric.mod.json`, `mod/build.gradle`, `mod/gradle.properties`.

| Field | Value |
|---|---|
| `schemaVersion` | 1 |
| `id` | `hauntedcrew` |
| `version` | `${version}` (expanded from `gradle.properties` `version=0.1.0` by `processResources`) |
| `name` | Haunted Crew |
| `description` | Watch your Kiro agents work as ghosts in a haunted office. |
| `authors` | `["Haunted Crew team"]` |
| `license` | MIT |
| `icon` | `assets/hauntedcrew/icon.png` |
| `environment` | `*` (both sides) |
| `entrypoints.main` | `dev.hauntedcrew.HauntedCrew` |
| `entrypoints.client` | `dev.hauntedcrew.client.HauntedCrewClient` |
| `depends.fabricloader` | `>=0.20.1` |
| `depends.minecraft` | `~26.3` |
| `depends.java` | `>=25` |
| `depends.fabric-api` | `*` |

There is no `mixins` JSON, no access widener, and no `src/client/resources` directory. The mod does not use mixins.

Build inputs (`gradle.properties`): `minecraft_version=26.3`, `loader_version=0.20.1`, `loom_version=1.19-SNAPSHOT`, `fabric_api_version=0.165.0+26.3`, `junit_version=5.11.4`, `group=dev.hauntedcrew`, `version=0.1.0`. Gradle JVM args `-Xmx2G`, parallel and configuration cache enabled.

Build script (`build.gradle`): Fabric Loom plugin; `loom.splitEnvironmentSourceSets()`; one Loom mod `hauntedcrew` built from the `main` and `client` source sets; dependencies `minecraft`, `fabric-loader`, `fabric-api`, and JUnit 5 for tests; Java toolchain 25 and `options.release = 25`; `withSourcesJar()`; the jar includes `LICENSE` renamed to `LICENSE_hauntedcrew`.

## 2. Registered content

### 2.1 Registry summary

| Kind | Registry id | Java field | Class | Registered in |
|---|---|---|---|---|
| Entity type | `hauntedcrew:ghost` | `HauntedCrew.GHOST` | `GhostEntity` (extends `PathfinderMob`) | `HauntedCrew` static init |
| Entity type | `hauntedcrew:screen` | `HauntedCrew.SCREEN` | `ScreenEntity` (extends `Entity`) | `HauntedCrew` static init |
| Block | `hauntedcrew:monitor` | `HauntedCrew.MONITOR` | `MonitorBlock` (extends `HorizontalDirectionalBlock`) | `HauntedCrew` static init |
| Item (block item) | `hauntedcrew:monitor` | `HauntedCrew.MONITOR_ITEM` | `BlockItem` wrapping `MONITOR` | `HauntedCrew` static init |
| Item | `hauntedcrew:screen_remote` | `HauntedCrew.SCREEN_REMOTE` | `CrewItem`, kind `REMOTE` | `HauntedCrew.item(...)` |
| Item | `hauntedcrew:agent_console` | `HauntedCrew.AGENT_CONSOLE` | `CrewItem`, kind `CONSOLE` | `HauntedCrew.item(...)` |
| Keybinding | `key.hauntedcrew.console` | `HauntedCrewClient.OPEN_CONSOLE` | `KeyMapping` | `HauntedCrewClient` |
| Key category | `hauntedcrew:main` | `HauntedCrewClient.CATEGORY` | `KeyMapping.Category` | `HauntedCrewClient` |
| Payload type | `hauntedcrew:console` | `ConsolePayloads.ToClient.TYPE` | clientbound play | `HauntedCrew.onInitialize` |
| Payload type | `hauntedcrew:screen_frame` | `ConsolePayloads.ScreenFrame.TYPE` | clientbound play | `HauntedCrew.onInitialize` |
| Payload type | `hauntedcrew:console_action` | `ConsolePayloads.ToServer.TYPE` | serverbound play | `HauntedCrew.onInitialize` |
| Model layer | `hauntedcrew:ghost` (layer `main`) | `GhostModel.LAYER` | `GhostModel` | `HauntedCrewClient` |
| Structure template | `hauntedcrew:office` | `Office.TEMPLATE` | `StructureTemplate` file `data/hauntedcrew/structure/office.nbt` | `Office` |
| World preset | `hauntedcrew:haunted_office` | (datapack JSON) | `data/hauntedcrew/worldgen/world_preset/haunted_office.json` | datapack |

Nothing else is registered: no custom sounds, no creative tab (`CreativeModeTab` is not referenced anywhere in the mod), no spawn eggs, no custom attributes beyond the ghost's default attributes, no block entities, no menus or recipes.

Entity details:
- `hauntedcrew:ghost`: `MobCategory.MISC`, size 0.7 x 0.9, `noSave()`, `fireImmune()`, `clientTrackingRange(10)`. Default attributes from `GhostEntity.createAttributes()`: `MAX_HEALTH` 20.0, `MOVEMENT_SPEED` 0.3, registered with `FabricDefaultAttributeRegistry`.
- `hauntedcrew:screen`: `MobCategory.MISC`, size 0.5 x 0.5, `noSave()`, `clientTrackingRange(10)`.

Block details (`MonitorBlock`): `Block.box(1, 0, 1, 15, 14, 15)` collision and outline shape; properties `strength(1.0f)`, `noOcclusion()`, `lightLevel(state -> 7)`, `sound(SoundType.METAL)`; `FACING` property (horizontal); on placement the block faces the placing player (`getHorizontalDirection().getOpposite()`); default state FACING north. Item properties: `stacksTo` not set (default), `useBlockDescriptionPrefix()`.

Item details (`CrewItem`): `stacksTo(1)`. Both items are one stack per slot.

Textures and models: `models/block/monitor.json` (parent `minecraft:block/block`, 8 box elements, one of which has `light_emission` 15 and `shade` false for the glowing screen face); `blockstates/monitor.json` (`facing=north` 0 degrees, east 90, south 180, west 270); `items/monitor.json`, `items/agent_console.json`, `items/screen_remote.json` (item models); `models/item/agent_console.json` and `models/item/screen_remote.json` (parent `minecraft:item/generated`); textures `textures/block/monitor.png`, `textures/item/agent_console.png`, `textures/item/screen_remote.png`, `textures/entity/ghost.png`, `icon.png`.

Ghost model file `models/entity/ghost.json`: texture size 256 x 128, scale 0.5, 67 parts (body plus cap, side, hem, tail, arm, and accessory parts). Accessory parts named `acc_<job>_*`; their parent part (`body`, `left_arm`, or `right_arm`) is listed in section 11.

Sounds: no sound events are registered. The mod plays vanilla `SoundEvents.AMETHYST_BLOCK_CHIME` (Guide tips) and `SoundEvents.NOTE_BLOCK_BELL` (approval prompt).

### 2.2 Lang keys (`assets/hauntedcrew/lang/en_us.json`)

| Key | Text |
|---|---|
| `generator.hauntedcrew.haunted_office` | Haunted Office |
| `entity.hauntedcrew.ghost` | Kiro Ghost |
| `entity.hauntedcrew.screen` | Big Screen |
| `block.hauntedcrew.monitor` | Agent Monitor (also used for the monitor block item) |
| `item.hauntedcrew.agent_console` | Agent Console |
| `item.hauntedcrew.screen_remote` | Screen Remote |
| `key.category.hauntedcrew.main` | Haunted Crew |
| `key.hauntedcrew.console` | Open agent console |
| `screen.hauntedcrew.console` | Haunted Crew Console |
| `screen.hauntedcrew.console.input` | Message |

No lang keys exist for the workflow, merge, browser or Ghost Rush screens. Those screens use literal English strings.

### 2.3 World type and worldgen

- `data/hauntedcrew/worldgen/world_preset/haunted_office.json`: preset with four dimensions. `minecraft:overworld` is a `minecraft:flat` generator with biome `minecraft:the_void`, `features` false, `lakes` false, `layers` empty, `structure_overrides` empty. `minecraft:the_end` and `minecraft:the_nether` use the vanilla noise generators (`minecraft:end` and `minecraft:nether` settings).
- `data/minecraft/tags/worldgen/world_preset/normal.json`: `replace: false`, `values: ["hauntedcrew:haunted_office"]`. This adds the preset to the Create New World World Type list.
- `data/hauntedcrew/structure/office.nbt`: the shipped office template (section 9).

## 3. Server entry point and lifecycle (HauntedCrew)

Class `dev.hauntedcrew.HauntedCrew` (`ModInitializer`). Purpose: registers content, owns the server-side singletons (`CrewConfig`, `CrewManager`, `ConsoleService`, `ScreenWall`, `BridgeClient`), and wires events.

Static constants: `MOD_ID = "hauntedcrew"`, `LOG` (slf4j), `KIT_TAG = "hauntedcrew_kit2"`. Helper `id(path)` returns `Identifier` in namespace `hauntedcrew`.

`onInitialize()` in order:
1. `FabricDefaultAttributeRegistry.register(GHOST, GhostEntity.createAttributes())`.
2. Registers payload types: clientbound play `ToClient` (`console`), clientbound play `ScreenFrame` (`screen_frame`), serverbound play `ToServer` (`console_action`).
3. Registers the server receiver for `ToServer`: calls `console.handle(player, json)` when a console exists.
4. `configFile = FabricLoader.getConfigDir().resolve("hauntedcrew.json")`.
5. `SERVER_STARTED` runs `start(server)`. `SERVER_STOPPING` runs `stop()`.
6. `END_SERVER_TICK`: `manager.tick()`, `Guide.tick(server)`, `screen.tick(console.sessions(), console.lines(), bridgeState())` when both exist, and every 200 ticks (about 10 s) `rediscover(server)` when config is loaded.
7. `CommandRegistrationCallback` registers the `/crew` tree (section 4).
8. `ServerPlayConnectionEvents.JOIN`: on the next server tick, if the big screen exists and the player does not have tag `hauntedcrew_kit2`, the tag is added and the player gets the kit (`giveKit`). If the office has a spawn marker, that same first-join player is teleported to it with `tp <name> <x> <y> <z> 180 0` (x and z are the marker centre, y is the marker's block y).

`start(server)`:
1. `CrewConfig.load(configFile)`. On `IOException`, logs an error and returns. Then no manager, console or screen exist and `/crew status` reports not paired or not connected.
2. `Office.load(server)`. If no layout file exists and `Office.isOfficeWorld(server)` is true, `Office.setUpNewWorld(server)` builds the office.
3. `manager = new CrewManager(server, anchorOf(...))`, `console = new ConsoleService(server, config, HauntedCrew::bridgeState)`.
4. If the office exists: `manager.setDesks(deskSeats)`, `officeSpawn = spawn`, `Guide.setHome(guide marker)`, and if a `screen` marker exists `screen = new ScreenWall(server, screenMarker)`.
5. `connect(server)`.

`stop()`: stops the bridge, clears the manager (removes all sessions and ghosts), nulls manager, console, and screen (screen clear discards its display entities).

`connect(server)`: if the source is not `paired`, calls `config.discoverLocal()`. If `config.validate()` returns a problem, logs `waiting for a bridge: <problem>` and returns. Logs a warning if `insecureRemote()`. Starts `BridgeClient` on `config.url() + "?frames=1"` (or `&frames=1` if the URL already has a query), with token `config.token()`. Each text message: if it starts with `{"type":"frame"`, goes to `forwardFrame`; otherwise `CrewProtocol.parse` and on the server thread `manager.apply(msg)` and `console.apply(msg)`.

`rediscover(server)`: only when the source is not `paired`. Re-runs `discoverLocal()`. If a launcher is found and (no bridge exists or the URL/token changed and the bridge state is not CONNECTED), calls `reconnect`.

`reconnect(server)`: stops the bridge, sets it null, calls `Guide.setHome(null)`, then `connect`. Note: `Guide.setHome(null)` clears the guide's home until `start` runs again (`/crew reload` or a server restart); `reconnect` is called by pairing and by rediscovery.

`bridgeState()`: if no bridge: `"not paired"` when config source is `none` (or config is null), else `"not connected"`. Otherwise the `BridgeClient.State` name in lowercase: `stopped`, `connecting`, `connected`, `retrying`, `unauthorized`.

`pair(server, code, url, reply)`: section 6.3.

`forwardFrame(server, json)`: section 10.4.

`giveKit(player)`: for slot index 0 `AGENT_CONSOLE` and slot index 1 `SCREEN_REMOTE`: skips an item the player already has; puts the stack in that inventory slot if empty, otherwise adds it.

`cycleScreen(player)`: section 5.3.

`anchorOf(server, cfg, office)`: returns the config anchor if set; else the office layout centre; else the bottom centre of the server's respawn position.

## 4. Commands (/crew)

Registered in `HauntedCrew.registerCommands`. Root literal `crew`, `.requires(Commands.hasPermission(Commands.LEVEL_GAMEMASTERS))` applies to every subcommand. `LEVEL_GAMEMASTERS` is the vanilla permission level 2 (README: "op level 2"); this is the only permission check for `/crew`.

| Syntax | Effect | Output |
|---|---|---|
| `/crew status` | Reports bridge state, URL and source, session count and loaded ghost count. | `Haunted Crew: bridge <state> at <url> (<source>), <N> session(s), <M> ghost(s) loaded` |
| `/crew reload` | `stop()` then `start(server)`: re-reads config, rebuilds the office layout and manager, reconnects. | `Haunted Crew: config reloaded` (broadcast to ops) |
| `/bigscreen <mode>` | Sets the big screen to `dashboard`, `code`, `website`, `search` or `activity` (same as the Screen Remote) and starts the page it needs. For the world owner or an operator, no cheats needed. Needs an office world; fails with the mode list otherwise. |
| `/crew anchor` | Sets the config anchor to the command source's position, saves the config, and moves non-desk ghosts there. Fails if the mod is not running. | `Haunted Crew: ghosts now gather here` |
| `/crew kit` | Gives the calling player the Agent Console and Screen Remote (same slots as the join kit). Requires a player. Works without an office. | `Haunted Crew: here are your tools (console, dashboard, activity log)` |
| `/crew pair <code>` | Pairs with the bridge using a launcher code, default URL is the current config URL. | `Haunted Crew: <result message>` |
| `/crew pair <code> <url>` | Same, with `<url>` (greedy string). | same |
| `/crew office place` | Pastes the office template with its floor centre at the command source's block position, saves `office.json`, and sets the desks. Does not rebuild the screen wall or guide. | `Haunted Crew: office placed with <N> desk(s)`, or `Office template not found` |
| `/crew office save <from> <to>` | Saves the region between two block positions as this world's office template (`BlockPosArgument`, loaded blocks). Max 96 blocks per side. Does not update `office.json`. | `Haunted Crew: office saved under <dir>` |

Pair messages from `/crew pair` are prefixed `Haunted Crew: `. If the mod has no config (not running): `Haunted Crew is not running.` The `pair` result messages are in section 6.3.

## 5. Keybinding, items and in-world controls

### 5.1 Keybinding

- Name `key.hauntedcrew.console` ("Open agent console"), default `InputConstants.KEY_K` (keyboard), category `KeyMapping.Category.register(HauntedCrew.id("main"))` shown as "Haunted Crew" under Options > Controls > Key Binds. Registered with `KeyMappingHelper.registerKeyMapping`.
- Each client tick, while the key is clicked and no other screen is open and the player exists, `openConsole()` runs.
- `openConsole()`: if `ClientConsole.available()` is false (the server did not accept the `console_action` payload), prints `Haunted Crew isn't installed on this server.` Otherwise sends action `open` and opens `ConsoleScreen`.

### 5.2 Items

| Item | Right-click (use) | Left-click on the big screen | Sneak + right-click | Sneak + left-click on the big screen |
|---|---|---|---|---|
| Agent Console (`agent_console`) | Opens `ConsoleScreen` (client `UseItemCallback`). Sends `open`. | No effect (client returns PASS for non-remote; AttackBlock handler only for the remote). | Same as right-click. | Same. |
| Screen Remote (`screen_remote`) | Server: cycles the big screen mode (section 5.3). Client: nothing (PASS). | Client: sends `screen_click` with the hit point (u, v) on the screen quad, then opens `BrowserScreen`. Returns FAIL, so no block is broken. | Client: opens `BrowserScreen` directly (no server action; the server's `use` does nothing when sneaking). | Client: sends `screen_scroll` with text `500` (scroll down) and returns FAIL. |

Left-click with the remote, when the ray misses every `ScreenEntity` within 40 blocks, returns FAIL and does nothing else. Only the client does the hit test (`clickScreen`); the server then checks trust for `screen_` actions (section 14).

### 5.3 Screen Remote cycle (server, `HauntedCrew.cycleScreen`)

- No big screen in this world: overlay `No big screen here. Use a Haunted Office world.`
- Caller not trusted (`ConsoleService.isTrusted`: operator level 2 or singleplayer owner): overlay `Only the world owner or an operator can switch the screen.`
- Otherwise mode advances `ordinal + 1` modulo 5 over `DASHBOARD, CODE, WEBSITE, SEARCH, ACTIVITY`. Overlay `Big screen: <label>` (plus `  ·  click it · sneak+use to type` for web modes).
- Side effects by new mode: `CODE` sends `/browser/open` with `{"url":"code"}`; `WEBSITE` sends `/browser/open` with `{"url":"preview"}`; `SEARCH` sends `/browser/open` with `{"url":"https://duckduckgo.com/"}`; `DASHBOARD` and `ACTIVITY` send `/browser/stop` with an empty object.
- The mode is server-wide (one screen per world), not per player.

### 5.4 Other in-world controls

- Boo the guide: main-hand right-click (section 13).
- Ghost right-click: no special behaviour (vanilla `mobInteract` on a non-guide ghost).
- Monitor block: decorative desk monitor; glows (model `light_emission` 15, block light 7); no interaction code.

## 6. Config file config/hauntedcrew.json

Class `CrewConfig`. Purpose: the server-side config and the token store. Path: `FabricLoader.getConfigDir()/hauntedcrew.json`, i.e. `config/hauntedcrew.json` in the game directory. Gson, pretty-printed, HTML escaping disabled.

### 6.1 Keys

| Key | Type | Default when created | Meaning |
|---|---|---|---|
| `bridgeUrl` | string | `ws://127.0.0.1:8787/stream` | Bridge WebSocket stream URL. Must be `ws://` or `wss://` with a host. Used unless a launcher is found on this PC (local source). |
| `viewToken` | string | `""` | Bridge view token. Sent in `Authorization: Bearer` on the stream and for read endpoints. |
| `commandToken` | string | `""` | Bridge command token. Enables commands (spawn, prompt, permissions, workflow writes, browser control). Empty means watch-only. |
| `anchor` | object `{x, y, z}` (doubles, overworld coordinates) | absent (null) | Position where ghosts beyond the desks gather. Written by `/crew anchor`. Gson omits it when null. |

A fresh config is created with `bridgeUrl`, `viewToken` and `commandToken` (empty strings). Written by `save()`: writes `<file>.tmp`, sets POSIX permissions `rw-------` (ignored where unsupported), then atomic move over the file. The shipped `run/config/hauntedcrew.json` in the dev run directory has exactly these three keys.

### 6.2 Environment variables

| Variable | Read by | Effect |
|---|---|---|
| `HAUNTED_CREW_VIEW_TOKEN` | `token()`, `source()`, `isLocal()` | If non-blank, overrides the view token and makes the source `paired`. |
| `HAUNTED_CREW_COMMAND_TOKEN` | `commandToken()` | If non-blank, overrides the command token. |
| `HAUNTED_CREW_HOME` | `discoverLocal()` | Directory to read launcher files from instead of `~/.haunted-crew` (`user.home`). |

No environment variable overrides the URL.

### 6.3 Token resolution and sources

- `token()` = first non-blank of: env `HAUNTED_CREW_VIEW_TOKEN`, config `viewToken`, local launcher view token.
- `commandToken()` = first non-blank of: env `HAUNTED_CREW_COMMAND_TOKEN`, config `commandToken`, and the local launcher command token only when the local source is in use.
- `isLocal()` = env view token blank AND config `viewToken` blank AND a local view token was found.
- `url()` = local launcher URL when `isLocal()` and a local URL was found; otherwise `bridgeUrl`.
- `source()`: `paired` when env view token or config `viewToken` is non-blank; else `local` when a launcher view token was found; else `none`.

Local auto-discovery (`discoverLocal()`): reads `<dir>/bridge.json` (field `url`, required) and `<dir>/tokens.json` (field `view`, required; `command` optional). Any failure clears the local values and returns false. Local values are `transient` and never saved to the config file. Runs at start (when not paired) and every 10 s (rediscovery).

`validate()`: returns a problem string when the token is empty (`not paired: run haunted-crew on this PC, or /crew pair <code> <url>`), the URL is not a valid URI, the scheme is not `ws` or `wss` (`bridgeUrl must start with ws:// or wss://`), or there is no host. Otherwise null.

`insecureRemote()`: true when the URL scheme is `ws` and the host is not one of `127.0.0.1`, `localhost`, `::1`, `[::1]`. Logged as a warning on connect (the view token is sent unencrypted).

`httpBase()`: the URL's authority with `http` (for `ws`) or `https` (for `wss`). Used for every HTTP call to the bridge.

### 6.4 Pairing

Entry points: `/crew pair <code> [url]` (ops/`LEVEL_GAMEMASTERS`) and console action `pair` (trusted players only, section 14). Both call `HauntedCrew.pair(server, code, url, reply)`:
1. Stream URL = the given URL (trimmed), or the current `config.url()` if none.
2. The URL must parse and have scheme `ws` or `wss` and an authority. Otherwise replies `That bridge address is not valid.` (parse failure) or `Bridge address must look like ws://host:8787/stream`.
3. HTTP base = `https://` (for wss) or `http://` (for ws) plus the authority. Sends `POST <base>/pair` with JSON body `{"code": "<code>"}`, `Content-Type: application/json`, 10 s timeout, HTTP/1.1, no Authorization header.
4. Network error: `Could not reach the bridge at <base>. Is haunted-crew running?`
5. HTTP 429: `Too many tries. Wait a minute.` Any other non-200: `That code is wrong or expired. Use the newest one from the launcher.`
6. HTTP 200: reads JSON fields `view` and `command`, sets `viewToken` and `commandToken`, sets `bridgeUrl` to the stream URL, saves the config. Save or parse failure: `Paired, but could not save the config: <message>`.
7. On success: reconnects and replies `Paired with the bridge. Your crew is on its way.`

The README's note that tokens are never sent to clients, chat or logs is a design statement; the code sends the view and command tokens only to the bridge, and the console only receives state fields (`source`, `bridge`, `canCommand`).

### 6.5 Anchor

`anchor` is the gathering point for ghosts beyond the desk seats (section 8.3). Set with `/crew anchor` (saved in config, applied immediately with `manager.setAnchor`). With no config anchor, the office centre is used (centre of the desk seats, or the office origin plus half the size). With no office, the server's respawn position (bottom centre) is used.

## 7. CrewProtocol: bridge messages, Job, Status, Session

Class `CrewProtocol` (pure Java, no Minecraft types, unit tested). Parses the bridge stream and defines the agent model.

### 7.1 Message parsing (`CrewProtocol.parse`)

- Input must be a JSON object, else `IllegalArgumentException` (`message is not an object`). Invalid JSON also throws `IllegalArgumentException`.
- `type == "hello"`: returns `Hello(sessions, lines)`. `sessions` is the `sessions` array (each element must be an object with a `session` id, otherwise skipped); `lines` is the `history` array (each converted by `line()`, nulls dropped).
- `type == "event"`: if `event.kind == "session_end"` and `event.session` exists, returns `SessionEnded(id)`. Otherwise returns `Update(session, line)` where `session` is the `session` object (null if missing or invalid, in which case the whole message yields null) and `line` is `line(event)` (may be null).
- Any other `type`: returns null (ignored).

### 7.2 Status enum

`IDLE, WORKING, WAITING, ERROR`. Parsed from the bridge `status` string: `"working"`, `"waiting"`, `"error"`; anything else (including missing) is IDLE.

### 7.3 Job enum

Values: `PLANNER, CODER, TESTER, REVIEWER, DOCS, RESEARCHER, GUIDE`.
- `WORKERS = {PLANNER, CODER, TESTER, REVIEWER, DOCS, RESEARCHER}` (every job except GUIDE). Used to pick a job from the seat when the name gives none.
- `Job.fromName(name)` (case-insensitive substring tests, first match wins):

| Substring(s) | Job |
|---|---|
| `plan`, `spec`, `lead` | PLANNER |
| `test`, `qa` | TESTER |
| `review` | REVIEWER |
| `doc`, `writ` | DOCS |
| `research`, `search`, `scout` | RESEARCHER |
| `cod`, `dev`, `build`, `engineer` | CODER |
| (none) | null |

GUIDE is never returned by `fromName`; it is assigned to the tour ghost only.

### 7.4 Session record

`Session(String id, String agent, Status status, String lastKind, String category, String file, String task, boolean console, Permission permission, String model, String draft, String thinking)`

| Field | Source key | Limits |
|---|---|---|
| `id` | `session` (required; session skipped without it) | `str`: 80 chars, control chars and `§` replaced by spaces, trimmed |
| `agent` | `agent` | 80 chars |
| `status` | `status` | enum parse |
| `lastKind` | `lastKind` | 80 chars |
| `category` | `category` | 80 chars |
| `file` | `file` | 80 chars |
| `task` | `task` | 80 chars |
| `console` | `console` | true only if JSON boolean true. Console agents accept prompts; others are watch-only ("from Kiro IDE"). |
| `permission` | `permission` | object with `id` (required), `title` (default `Run a tool`), `options` (max 4, each needs `id`, `name` defaults to `id`) |
| `model` | `model` | 80 chars |
| `draft` | `draft` | multiline, 1500 chars, `…` at the end when cut |
| `thinking` | `thinking` | multiline, 1200 chars |

`activity()` (text on the ghost's name tag and in lists):
- WAITING: `needs your approval` if a permission is pending, else `waiting for you`.
- ERROR: `hit an error`. IDLE: `idle`.
- WORKING: if `task` is set and `lastKind` is `task_start` or `task_end`: `task: <task>`. If `lastKind` starts with `file_`: `editing <file>`. If `lastKind` is `prompt` or `thought`: `thinking` (when thinking text is set, or no draft) else `writing a reply`. Otherwise by `category`: `read` -> `reading <file>`, `write` -> `writing <file>`, `shell` -> `running a command`, `web` -> `searching the web`, `mcp` -> `using a tool`, `subagent` -> `calling a helper`, `spec` -> `updating the spec`, anything else or none -> `working`. (`<file>` is the file name with a leading space, or empty.)

`label()`: `agent` if set, else `Ghost ` plus the first 6 characters of `id`.

### 7.5 Feed lines (`Line` record)

`Line(long ts, String session, String agent, String kind, String text)`. Built by `CrewProtocol.line(e)` from an event object (needs `kind` and `session`; `ts` numeric or 0; `agent` from the event). Text by kind:

| Bridge kind | Feed text | Null (no line) |
|---|---|---|
| `session_start` | `joined the crew` | no |
| `session_end` | `left the crew` | no |
| `prompt` | `▶ <text>` (or `got a new prompt` if no text) | no |
| `tool_start` | the tool name if no file and tool is set; else the activity text for the category | no |
| `tool_end` | `<tool> failed` when `ok` is false (or `a tool failed`) | yes, when `ok` is not false |
| `file_create` | `created <file>` | no |
| `file_save` | `edited <file>` | no |
| `file_delete` | `deleted <file>` | no |
| `task_start` | `started task: <task>` | no |
| `task_end` | `finished task: <task>` | no |
| `message`, `thought` | the text (multiline, 1500 or 1200 chars) | if no text |
| `permission` | `asked to <request.title>` (or `asked to use a tool`) | no |
| `permission_resolved` | the text | if no text |
| `stop` | `finished` | no |
| `error` | `error: <text>` (or `error: unknown`) | no |
| any other kind | none | yes |

Other event text (`text(e, "text", 600)`) is capped at 600 characters.

### 7.6 Message records

- `Option(String id, String name)`
- `Permission(String id, String title, List<Option> options)`
- `Line(...)` (above)
- `Hello(List<Session> sessions, List<Line> lines)`
- `Update(Session session, Line line)` (line may be null)
- `SessionEnded(String id)`
- `sealed interface Message permits Hello, Update, SessionEnded`

### 7.7 How a session maps to the ghost, its colour, glow, held item, and desk

| Status | Ghost name tag colour (server) | Scoreboard team (server) | Team outline colour | Glowing tag | Ghost body tint (client) | Arm pose (client) |
|---|---|---|---|---|---|---|
| WORKING | `0x55AAFF` | `hauntedcrew_working` | BLUE | no | `0xFFE4ECFF` | both arms swing: left `sin(t*0.6)*0.5`, right `-sin(t*0.6+1.5)*0.5` |
| WAITING | `0xFFDD55` | `hauntedcrew_waiting` | YELLOW | yes | `0xFFFFF4C8` | left arm raised: `zRot = -1.2 + sin(t*0.3)*0.2` |
| ERROR | `0xFF5555` | `hauntedcrew_error` | RED | yes | `0xFFFFCCCC` | none |
| IDLE | `0xAAAAAA` | `hauntedcrew_idle` | GRAY | no | `0xFFE2E2E2` | none |

- The name tag text is `<label> · <activity>`, coloured by the table above.
- The glow is the vanilla glowing tag. The outline colour comes from the team colour (vanilla clients see it too).
- Held item: none. The ghost holds no item. The job's prop is a model part (`acc_<job>_*`) shown only for that job (section 11). Every ghost has body bob `sin(t*0.1)*2.4` regardless of status.
- Desk: a ghost's home is a desk seat when it has one (section 8.3). A WAITING ghost leaves its desk and floats toward the nearest player instead (section 8.4).

## 8. CrewManager and GhostEntity: ghosts, desks, slots, reconcile

### 8.1 CrewManager (`dev.hauntedcrew.CrewManager`)

Purpose: one ghost per bridge session. Server thread only. Session state (`LinkedHashMap sessions`) is the source of truth; ghosts are views.

Constants: `MAX_GHOSTS = 80`, `RING_RADIUS = 4.0`, `RECONCILE_TICKS = 20` (1 s).

State: `server`, `sessions`, `ghosts` (session id -> ghost UUID), `slots` (session id -> slot int), `anchor` (Vec3), `desks` (List<Vec3>), `ticks`.

- Constructor calls `resetTeams()`: removes members from every scoreboard team whose name starts with `hauntedcrew_` (teams are saved with the world).
- `apply(message)`:
  - `Hello`: updates every session in the hello; removes sessions not in it.
  - `Update`: `update(session)`.
  - `SessionEnded`: `remove(id)`.
- `update(s)`: if the session is new and there are already 80 sessions, ignore it. Else store it and `sync(id)`.
- `sync(id)`: finds or spawns the ghost (spawn returns null if the home position is not entity-ticking yet; retried at the next reconcile). Then sets status, job (`Job.fromName(agent)` or, if null, `WORKERS[slot % 6]`), custom name (`label · activity`, status colour), glowing (WAITING or ERROR), and team (section 7.7).
- `spawn(id)`: home = `homeFor(id)`. Requires `level.isPositionEntityTicking(home)`. Creates a `GhostEntity` with `EntitySpawnReason.COMMAND`, snaps it to home, sets home, `setCustomNameVisible(true)`, adds it to the overworld, records UUID.
- `remove(id)`: removes session and slot, removes the ghost from its team, discards the ghost.
- `tick()`: every 20 server ticks, `sync` every session, then discards every `GhostEntity` in the overworld whose UUID is not a known ghost and which is not the guide (orphans from earlier runs).
- `clear()`: removes every session.
- `ghostCount()`: number of known ghosts still alive.
- `setDesks(list)`: stores desks and re-homes existing ghosts. `setAnchor(vec)`: stores anchor and re-homes.

Team handling (`joinTeam`): team `hauntedcrew_<status>` is created on first use with colour BLUE (WORKING), YELLOW (WAITING), RED (ERROR), GRAY (IDLE). The ghost joins its status team (leaves others implicitly).

### 8.2 Slots

- Each session gets the smallest free integer slot (`computeIfAbsent`), kept until the session ends. Slots are not reused while the session lives.
- `homeFor(id)`: if `slot < desks.size()`, home is that desk seat. Otherwise `slot -= desks.size()`, and:
  - `ring = slot / 12`, `level = ring / 2`
  - `angle = ((slot % 12) + (ring % 2) * 0.5) * (2π / 12)`
  - `radius = RING_RADIUS + (ring % 2) * 3.0` (4.0 or 7.0)
  - home = `anchor + (cos(angle)*radius, 1.5 + level*1.8, sin(angle)*radius)`
- So with no desks, ghosts 0-11 form a ring of radius 4.0 at height 1.5, ghosts 12-23 a ring of radius 7.0 at height 1.5 (offset half a step), 24-35 a ring of radius 4.0 at height 3.3, and so on.
- Desk seats come from the office (section 9): `Vec3(x + 0.5, y + 0.2, z + 0.5)` per desk marker, sorted by z then x. The shipped template has 8 desks, so the first 8 sessions get desks.

### 8.3 Reconcile loop

- Every server tick `CrewManager.tick()` increments a counter; every 20th tick it re-syncs all sessions (creating missing ghosts, updating names, glow and teams), then discards orphan ghosts (see 8.1).
- Ghosts are not saved (`noSave`), so they vanish when their chunk unloads. The reconcile loop respawns them once the home position is entity-ticking again.
- Orphan removal applies only to `GhostEntity` instances. The guide is exempt (`Guide.isGuide`). Screen display entities are not touched by this loop; they are managed by `ScreenWall` (section 10).

### 8.4 GhostEntity (`dev.hauntedcrew.GhostEntity`)

Class `GhostEntity extends PathfinderMob`. Purpose: one Kiro agent session. Floats (`setNoGravity(true)`), silent, `noPhysics = true`.

Synced data: `STATUS` (int, ordinal of Status, default IDLE), `JOB` (int, ordinal of Job, default CODER). Accessors `status()`, `setStatus`, `job()`, `setJob`.

Constants: `SPEED = 0.18` (blocks per tick toward target), `APPROACH_DISTANCE = 2.5`, `SEEK_PLAYER_RANGE = 32` (blocks).

Movement (`moveServerSide`, every tick, server only):
- The guide is handled separately (section 13).
- Target = `home`. If status is WAITING and `level.getNearestPlayer(this, 32)` is not null: target = player position + (unit vector from player to ghost, or (1,0,0) if they coincide) * 2.5, plus (0, 1.2, 0).
- If the distance to target is under 0.05, stop. Otherwise step `min(0.18, dist)` toward the target per tick.
- When the distance is over 0.3, the ghost turns to face its direction of travel (yaw and head yaw).

Invulnerability and immovability: `hurtServer` returns false, `isPushable` false, `doPush` does nothing, `removeWhenFarAway` false, `isAffectedByPotions` false.

Interaction: main-hand right-click on the guide calls `Guide.talk`; other ghosts use the vanilla handler.

Attributes: max health 20, movement speed 0.3 (the movement code does not use vanilla pathfinding).

## 9. Office builder

Classes: `Office` (builder and layout), `HauntedCrew` (commands and start-up calls), `ScreenWall` (screen geometry from markers). Template id `hauntedcrew:office`, file `data/hauntedcrew/structure/office.nbt` (468,946 bytes).

### 9.1 What the builder does

- Structure block markers: a structure block in DATA mode inside the template with `metadata` equal to one of: `desk`, `screen`, `taskwall`, `bell`, `spawn`, `guide` (case-insensitive, trimmed). Any other metadata leaves the marker block in place.
- `place(server, center)`: origin = `center` offset by `(-sizeX/2, 0, -sizeZ/2)`. Pastes the template with `UPDATE_CLIENTS`. For each DATA-mode marker with a known metadata value: records its position in the layout, then sets the block to air. Markers with unknown metadata are left in place. Desks are sorted by z, then x. The layout is saved as JSON to `<world>/hauntedcrew/office.json` (written via `office.json.tmp` and atomic move).
- `setUpNewWorld(server)` (first start of a `Haunted Office` world, i.e. the overworld is flat with no layers and there is no `office.json`): places the office at `(0, 64, 0)`, sets the respawn point to the spawn marker (or the office centre) with yaw 180, then sets gamerules `ADVANCE_TIME` false, `ADVANCE_WEATHER` false, `SPAWN_MOBS` false, `SPAWN_MONSTERS` false, `SPAWN_PHANTOMS` false, `RESPAWN_RADIUS` 0, and runs `time set midnight`.
- `saveRegion(server, a, b)`: normalises the corners, rejects sizes above `MAX_SIZE = 96` on any side (`office is larger than 96 blocks on a side`), fills the template from the world (entities not included; `minecraft:structure_void` blocks ignored), sets author `Haunted Crew`, saves template `hauntedcrew:office`. Returns `<world>/generated/hauntedcrew`.
- `load(server)`: reads `<world>/hauntedcrew/office.json`. Bad JSON logs an error and returns empty.
- `Layout` fields: `origin`, `size`, `desks` (list of `[x,y,z]`), `screen`, `taskwall`, `bell`, `spawn`, `guide`. `deskSeats()` (section 8.2). `center()`: average of desk seats if any, else origin plus half the size in x and z (plus 1 in y).

Notes: `taskwall` and `bell` are read and stored in the layout, but no other code uses them (checked with grep).

### 9.2 Shipped template (`data/hauntedcrew/structure/office.nbt`)

Measured from the NBT file (template-local coordinates, before placement):
- Size: 57 x 48 x 60.
- Blocks: 164,160 entries; 132,979 are `minecraft:air`. Most common other blocks: `minecraft:deepslate_tiles` (7,992), `minecraft:stone_bricks` (4,919), `minecraft:dark_oak_planks` (3,599), `minecraft:stone` (2,597), `minecraft:coarse_dirt` (2,205).
- Palette: 141 entries.
- Structure blocks: 13, all in DATA mode.

Markers (template-local `[x, y, z]`):

| Marker | Position | Count |
|---|---|---|
| desk | `[18,4,17]`, `[23,4,17]`, `[33,4,17]`, `[38,4,17]`, `[18,5,23]`, `[23,5,23]`, `[33,5,23]`, `[38,5,23]` | 8 |
| screen | `[28,8,8]` | 1 |
| taskwall | `[42,9,10]` | 1 |
| bell | `[40,3,29]` | 1 |
| spawn | `[28,1,56]` | 1 |
| guide | `[30,1,52]` | 1 |

The screen marker at `[28, 8, 8]` gives a wall 15 blocks wide and 7 high (section 10.2).

Build-your-own workflow (from the README, matching code): build in Creative, mark spots with DATA-mode structure blocks, `/crew office save <from> <to>`, test with `/crew office place`, copy `<world>/generated/hauntedcrew/structure/office.nbt` into `src/main/resources/data/hauntedcrew/structure/office.nbt`. The README also says markers become air when placed and positions go to `<world>/hauntedcrew/office.json`; both match the code.

Sample saved layout (`run/saves/New World (2)/hauntedcrew/office.json`, a dev world): origin `[-28, 64, -30]`, size `[57, 48, 60]`, 8 desks, screen `[0, 72, -22]`, taskwall `[14, 73, -20]`, bell `[12, 67, -1]`, spawn `[0, 65, 26]`.

## 10. Big screen: ScreenWall, ScreenEntity, frame pipeline

### 10.1 ScreenEntity (`dev.hauntedcrew.ScreenEntity`)

Purpose: invisible anchor for the live browser picture. Synced floats `WIDTH` (default 14.6) and `HEIGHT` (default 6.6). Not saved, not hurt, no gravity, `noPhysics`. The client renderer draws a quad of that size facing south (section 10.5).

### 10.2 ScreenWall (`dev.hauntedcrew.ScreenWall`)

Purpose: the big screen on the office's north wall, built from vanilla display entities (block and text displays) so everyone sees it. Tagged `hauntedcrew_screen`.

Geometry from the `screen` marker `(mx, my, mz)`: `left = mx + 0.5 - 7.5`, `bottom = my - 3`, `face = mz`. Coordinates in the panels are blocks from the bottom-left corner. The screen is 15 x 7 blocks.

Modes (`ScreenWall.Mode`, label and `web()` flag):

| Mode | Label | Web | Shows |
|---|---|---|---|
| `DASHBOARD` | Dashboard | no | Panels: header, four crew cards, live activity feed, NEEDS YOU, SPEC TASKS (below) |
| `CODE` | Live code | yes | Live browser frames (ScreenEntity quad) |
| `WEBSITE` | Website preview | yes | Live browser frames |
| `SEARCH` | Web search | yes | Live browser frames |
| `ACTIVITY` | Activity log | no | Crew list (left) and activity feed (right) |

Ticking (`tick(sessions, lines, bridge)`): runs every 20 server ticks, only when the screen's centre chunk is entity-ticking. On the first run it discards every tagged text and block display of this screen and every `ScreenEntity` in the world (leftovers from an earlier run).

Dashboard layout (block coordinates):
- Header bar (gray concrete) at y 6.25 to 6.85 with an orange accent line at 6.15 to 6.25. Title `HAUNTED CREW` (orange). Stats line: `<N> on shift    <W> working    <A> waiting    <E> errors`. Live tag: `● live` (green) when the bridge is `connected`, else `● <bridge state>` (orange).
- Four crew cards (x 0.3 to 4.5, each 1.2 high, stacked): card i shows session i's label and activity; the status strip is coloured by status. Empty first card: `No ghosts yet` and `Press K to summon one`.
- Live activity (middle, x 4.7 to 10.3): title `LIVE ACTIVITY` and up to 16 most recent feed lines formatted `HH:mm <agent> <text>`. Empty: `Waiting for the crew…`.
- NEEDS YOU (right top, x 10.5 to 14.7, y 4.35 to 5.95): turns orange when any session has a pending permission. Lists up to 2 entries `<label>: <permission title>` and `press K to answer`. Empty: `Nobody right now`.
- SPEC TASKS (right bottom, y 0.3 to 4.15): from `task_start` and `task_end` feed lines; finished tasks show `✔` in green, open tasks `○`; last 11 shown. Empty: `Kiro spec tasks` / `appear here`.

Activity layout: left column `HAUNTED CREW`, `<N> ghosts · <M> busy`, then session rows (`■ <label>` coloured by status, plus the activity line) until the list reaches 11 lines. Empty: `Press K to summon` (connected) or `Bridge <state>`. Right column: `LIVE ACTIVITY`, then `⚠ <N> need approval (K)` (orange) or the literal text `full view: localhost:8787`, then the last 9 feed lines.

Feed line colours (`lineColor`): `error` and `tool_end` `0xFF6B6B`; `permission` and `stop` `0xFFFFC94D`; `message` `0xFFFFFFFF`; `prompt` `0xFFCDB4FF`; `task_end` `0xFF4ADE80`; others `0xFFCFC8DE`.

Mode changes: `setMode(next)` clears all parts and sets the mode (redraw next tick). The mode is server-wide.

`clear()`: discards every part entity and clears the cache.

Panel building: `panel()` draws a black concrete frame with a lighter inset face; `rect()` and `text()` create or update block and text displays keyed by name (text is updated only when its string changes); display entities get brightness override and view range 2.0. Text displays use a `FIXED` billboard, full brightness, transparent background, and a uniform transform scale equal to the call's scale argument (for example 1.4 for the title, 1.05 for the feed); `PX = 0.025` is used only to convert a pixel width into a line width for wrapping.

### 10.3 Frame pipeline (server side)

1. The bridge stream carries JSON messages whose text starts with `{"type":"frame"`. Each has `data` (base64 JPEG) and optionally `url`.
2. `HauntedCrew.forwardFrame` ignores frames unless the screen exists and its mode is web. It decodes base64, reduces the URL for display (contains `/preview` becomes `project preview`; contains `/code#` becomes `live code`; URL capped at 2000 characters), and sends a `ScreenFrame(jpeg, url)` to every player whose client can receive `screen_frame`.
3. `ScreenFrame` codec: byte array up to 2 MiB, then UTF-8 string up to 2048 characters.

### 10.4 Frame pipeline (client side)

- `HauntedCrewClient` receives `screen_frame` and calls `ScreenTexture.update(jpeg, url)`.
- `ScreenTexture` keeps only the newest JPEG (`AtomicReference`). Frames are decoded only while someone looked at the screen in the last 2 seconds (`touch()` is called by `ScreenRenderer.submit` and by `BrowserScreen` rendering). Decoding runs on a daemon thread `hauntedcrew-screen-decode`: `NativeImage.read(bytes)` first, `javax.imageio` fallback (converted to an opaque `NativeImage`).
- The decoded image is uploaded on the render thread via `Minecraft.execute`: a `DynamicTexture` registered as `hauntedcrew:dynamic/screen` (re-created when the size changes; otherwise pixels are copied into the existing texture).
- `ScreenTexture.url` holds the current page label; `BrowserScreen` shows it in the address bar.

### 10.5 ScreenRenderer

`ScreenRenderer extends EntityRenderer<ScreenEntity>`. `shouldRender` always true (the entity is tiny but the picture is wide). Submits a quad of `width x height` facing south (`+z`), full-bright, render type `entitySolid` with the dynamic texture, drawn only when `ScreenTexture.ready()`.

### 10.6 Screen Remote interactions with the big screen

See section 5.2 and 5.3. Server-side `screen_*` actions are in section 14.4.

## 11. Client: ghost rendering and client state

### 11.1 GhostRenderer and GhostRenderState

- `GhostRenderer extends MobRenderer<GhostEntity, GhostRenderState, GhostModel>`, shadow radius 0.3.
- Texture `hauntedcrew:textures/entity/ghost.png`.
- Scale 0.5 (the model is authored at double pixel density).
- Body tint (`getModelTint`) by status: WORKING `0xFFE4ECFF`, WAITING `0xFFFFF4C8`, ERROR `0xFFFFCCCC`, IDLE `0xFFE2E2E2`.
- `GhostRenderState` adds `status` (default IDLE) and `job` (default CODER), copied from the entity each frame.

### 11.2 GhostModel

- Built from `assets/hauntedcrew/models/entity/ghost.json` (a Blender-exported model; the header comment says `tools/ghost/paint_ghost.py` generates it, which is outside `mod/`). Layer `hauntedcrew:ghost` main.
- Parts are created in file order; each part's parent must come before it.
- Accessory parts are named `acc_<job>_<name>`. `jobOf` matches the lowercase job name, so the job set is planner, coder, tester, reviewer, docs, researcher, guide. Each accessory part is visible only when its job equals the ghost's job.
- Animation (`setupAnim`): body bobs by `sin(t*0.1)*2.4`; WORKING swings arms; WAITING raises the left arm.

Accessory parts by job (from the model file; parent part in brackets):

| Job | Parts (parent) |
|---|---|
| planner | `acc_planner_brim`, `acc_planner_cone1`, `acc_planner_band`, `acc_planner_cone2`, `acc_planner_cone3`, `acc_planner_tip` (body); `acc_planner_scroll`, `acc_planner_ribbon` (right_arm) |
| coder | `acc_coder_dome`, `acc_coder_top`, `acc_coder_ridge`, `acc_coder_brim` (body); `acc_coder_handle`, `acc_coder_head`, `acc_coder_tip` (left_arm) |
| tester | `acc_tester_strap`, `acc_tester_frame_l`, `acc_tester_frame_r`, `acc_tester_lens_l`, `acc_tester_lens_r` (body); `acc_tester_bottle`, `acc_tester_neck`, `acc_tester_cork` (right_arm) |
| reviewer | `acc_reviewer_brim`, `acc_reviewer_crown`, `acc_reviewer_band`, `acc_reviewer_dent` (body); `acc_reviewer_handle`, `acc_reviewer_lens`, `acc_reviewer_ring_t`, `acc_reviewer_ring_b`, `acc_reviewer_ring_l`, `acc_reviewer_ring_r` (left_arm) |
| docs | `acc_docs_quill`, `acc_docs_spine` (body); `acc_docs_board_a`, `acc_docs_board_b`, `acc_docs_pages`, `acc_docs_back` (right_arm) |
| researcher | `acc_researcher_brim`, `acc_researcher_crown`, `acc_researcher_band` (body); `acc_researcher_case`, `acc_researcher_face`, `acc_researcher_needle` (left_arm) |
| guide | `acc_guide_brim`, `acc_guide_crown`, `acc_guide_band`, `acc_guide_bow_l`, `acc_guide_bow_r`, `acc_guide_knot` (body); `acc_guide_hook`, `acc_guide_cap`, `acc_guide_glass`, `acc_guide_base` (left_arm) |

### 11.3 ClientConsole (`dev.hauntedcrew.client.ClientConsole`)

Purpose: client copy of console state, fed by `console` payloads, and the sender for `console_action`.

State: `sessions` (LinkedHashMap by id), `lines` (ArrayDeque, max 200), `canCommand`, `bridge` (default `?`), `source` (default `none`), `kiro` (last Kiro status), `loginUrl`, `loginCode`, `loginLines`, `notice` and `noticeAt` (toast), `version` (bumped on change), and the workflow/merge answers `workflows`, `workflowRun`, `workflowSaved`, `skills`, `usage`, `merges`, `mergeDiff`, `mergeAnswer`, with `workflowVersion`.

`receive(json)` handles view types: `snapshot` (replaces sessions and lines, sets canCommand, bridge, source; clears Kiro if not connected), `kiro`, `update`, `ended`, `workflows`, `workflow_run`, `workflow_saved`, `skills`, `usage`, `merges`, `merge_diff`, `merge_answered`, `notice`. Unknown types are ignored.

`send(action, session, text, requestId, optionId)` sends `ConsolePayloads.Action` as JSON in `console_action`. `kiroReady()` = Kiro signed in or demo. `connected()` = bridge state `connected`. `available()` = the server accepts `console_action`.

### 11.4 Other client classes

- `HauntedCrewClient` (`ClientModInitializer`): registers the model layer, entity renderers (`GHOST` to GhostRenderer, `SCREEN` to ScreenRenderer), the screen frame and console receivers, the key mapping, the item use and attack-block callbacks, and the key tick handler (section 5).
- `GhostRenderState`: render state (section 11.1).

## 12. Client screens

All client screens are `net.minecraft.client.gui.screens.Screen` subclasses. Their input is zoomed by a factor `k` (half the GUI scale, rounded to whole pixels, at most 1) so they stay readable at large GUI scales.

### 12.1 ConsoleScreen (`dev.hauntedcrew.client.ConsoleScreen`, 1378 lines)

Opened by the key `K`, the Agent Console item, the Boo guide, and the console's own sidebar. Title component `screen.hauntedcrew.console`.

Look: two themes. Minecraft style is the default (`mc = true`). `-Dhauntedcrew.ui=kiro` starts in the purple Kiro theme. `F6` toggles between them. Minecraft style uses bevelled grey boxes, gold and chat colours, and text shadows.

Modes (`Mode`): `CHAT`, `NEW_GHOST` (summon), `PAIR`. `Esc` in a non-chat mode returns to `CHAT`.

Layout:
- Sidebar (width 118 if the screen is narrower than 460 virtual px, else 156): `Haunted Crew` heading with a planner avatar; button `+  New ghost` (requires command rights); button `Play Ghost Rush` (opens `GhostRushScreen`); button `Workflows` (opens `WorkflowScreen`); button `Merges` (opens `MergeScreen`); `CHANNELS` with `# crew` (count of ghosts and `N need you`); `GHOSTS` list sorted with WAITING ghosts first, scrollable (mouse wheel over the sidebar), each row an avatar, label, and activity.
- Sidebar footer: `Bridge <state>` with a status dot, and the Kiro line: `Kiro …` (unknown), `Kiro demo mode` or `Kiro signed in`, or `Kiro` plus `sign in ›` (sends `kiro_login` when command rights exist).
- Header: title (`# crew`, the ghost label, `Summon a ghost`, or `Pair with a bridge`) and a subtitle: activity, `<N> queued` (count of prompts without a stop or error since), the model short name, and `from Kiro IDE, watch-only` for non-console ghosts.
- Chat area: one conversation per ghost, or the `#crew` channel with every ghost (names shown on each message, user messages shown as `you → <name>`).
- Input: single line `EditBox`, max 4000 characters. Placeholder text depends on state (examples: `Message the crew with @Name, e.g. @Coder fix the tests`, `Message <label>…`, `<label> runs in Kiro IDE: watch-only`, `Watch-only: ask the world owner to command`, `Connect a bridge first`, `Name your ghost, e.g. Coder, then Enter`, `HC-XXXX-XXXX  ws://bridge-host:8787/stream`).

Message content:
- User bubble (purple): prompt text. Agent bubble: reply text rendered as plain chat (`#` headings removed, `- ` and `* ` become `• `, `**`, `__` and backticks removed, blank lines collapsed). Agent name shown in `#crew` or when the speaker changes.
- Thinking block: while a ghost works, `✻ Thinking… <N>s` with the last 8 steps and the last 4 lines of thinking text. When finished, `✻ Thought for <N>s  ·  <N> steps  ›` (click to expand or collapse). Expanded state is remembered per turn.
- Activity block: steps not in a thinking block show the last 6 steps (`… N earlier steps`). Step icons: `✖` for tool_end/error, `⚠` permission, `✔` approval or task end or stop, `✎` file changes, `▸` task start, `◦` reading, `›` running, `•` otherwise.
- Typing indicator: `<name> is working` (or `<A> and <B> are working`, or `<N> ghosts are working`) with three animated dots, for non-console ghosts (Kiro IDE) that are working.
- Streaming reply: a draft bubble with a blinking `▍`.
- Approval card: `⚠  Needs your approval`, `<label> wants to: <title>`, then one button per option (options with id containing `allow`, case-insensitive, are green, others red; no options gives a Deny button with no id). Only command rights can answer: other viewers see `Only the world owner or an operator can answer.`
- Bubble hover actions: `Copy` (copies text, toast `Copied`) on all bubbles; `Retry` on your own messages when command rights exist and the session exists and the text does not end with `…` (resends the same text as a prompt).
- Context ring next to the send button (console ghosts only): fill shows estimated context use (about a quarter of the characters of prompt, message and thought lines) against a window of 1,000,000 tokens for `claude-*` and `auto` models, else 256,000. Colour: red above 85 %, yellow above 60 %, green otherwise. Click shows a panel: `Context ~<tokens> of <window> (<pct>%)` and `Credits` from the bridge usage answer (`loading…` until it arrives; `Credits  <N> left of <T> (<P>% used)`, plan and reset text, or `demo mode: example numbers`), and requests `kiro_usage`.
- Model button (next to the ring, labels such as `Haiku 5.5 ▾`): opens a menu of models `claude-haiku-5.5` (`Haiku 5.5 · fast · 0.06x`), `qwen3-coder-next` (`Qwen3 Coder · 0.05x`), `claude-sonnet-5.5` (`Sonnet 5.5 · 1.3x`), `claude-opus-5.5` (`Opus 5.5 · 2x`), `auto` (`Auto · 1x`). Choosing one sends `model`. Switching is refused while the ghost is working (toast `Wait for <label> to finish before switching model`).
- Send button `➤` (enabled when the input has text and command rights, or in PAIR mode). When the ghost is WORKING and the input is blank, the send button becomes a red `Stop` button that sends `interrupt`.
- Suggestion chips (idle console ghost, empty input): job-specific quick prompts, for example Planner: `Plan the next steps`, `List the risks`, `Split this into tasks`; Coder: `Fix the failing tests`, `Explain this codebase`, `Refactor the largest file`; Tester: `Run the tests`, `Find untested code`, `Add a regression test`; Reviewer: `Review the latest change`, `Look for security issues`, `Check for missing tests`; Docs: `Update the README`, `Document the public API`, `Write a changelog entry`; Researcher: `Find where login is handled`, `Summarize the architecture`, `List the dependencies`. Clicking sends the prompt.
- `↓ newest` button when scrolled up. Mouse wheel scrolls the chat (24 px per notch).

Mentions: typing `@` at a word start opens a list (max 6) of console ghosts whose names start with the text typed after `@`. `↑`/`↓` choose, `Tab` or `Enter` or a click inserts `@<Name> `. Names may contain spaces.

Sending text (`submit`):
- In `PAIR`: sends `pair` with text = the code and session = the optional bridge URL (the first whitespace-separated word is the code).
- In `NEW_GHOST`: summons a ghost named with the text (section below).
- In `CHAT` with no selected ghost: the text must start with `@Name` (longest matching ghost name wins; otherwise the first word). Missing ghost: toast `No ghost called <name> here. Summon one first.`; missing message: `Add a message after the name.`; no `@`: `Start with @Name to pick a ghost, e.g. @Coder fix the tests`.
- In `CHAT` with a selected console ghost: sends `prompt` with that session id and the text. Non-console ghosts: toast `<label> runs in Kiro IDE and can't take messages from here.`
- Kiro not signed in: toast `Sign in to Kiro first: use the Sign in button.` and nothing is sent.

Summon (`summon(name)`): needs command rights and Kiro ready. Sends `spawn` with text = name and optionId = the selected model id (default `claude-haiku-5.5`). Toast `Summoning <name> on <model label>…`. Selects the new ghost when it appears (matched by agent name).
Summon card (empty chat or `NEW_GHOST` mode): buttons `Planner`, `Coder`, `Tester`, `Reviewer`, `Docs`, `Researcher` (each summons with that name), and a `Model: <label> ⟳` button that cycles the model.

Kiro sign-in card (connected, Kiro not ready): `Sign in to Kiro so your ghosts can work` with `Sign in` (sends `kiro_login`); if the CLI is not installed on the bridge machine: `Kiro CLI isn't installed on the bridge PC` and `Install it from kiro.dev/downloads, or restart the launcher with --demo.`; while a device sign-in is in progress: `Finish signing in to Kiro in your browser`, the device code, an `Open sign-in page` button (opens the URL after confirmation), and `waiting…`. While a code is open, `kiro_status` is sent every 60 ticks (3 s).

Onboarding card (not connected and no source): step 1 `On the PC with your project, run:` and the command `npx haunted-crew` (`Same PC? That's it, this screen updates itself.`); step 2 `Server on another machine?` with `Enter pairing code`, which switches to PAIR mode.

Pair card: `Type the code the launcher printed, then the bridge address:`, the example `HC-XXXX-XXXX  ws://that-pc:8787/stream`, and `Each code works once, for 10 minutes. Esc to go back.` (the 10-minute and once-only wording is display text; the bridge enforces it, which is not verified here).

Toast: a line above the input, shown for 6 seconds.

Opened screens from the sidebar: `GhostRushScreen(parent=this)`, `WorkflowScreen(this)`, `MergeScreen(this)`.

### 12.2 WorkflowScreen (`dev.hauntedcrew.client.WorkflowScreen`, 1078 lines)

Purpose: the workflow builder, a node canvas. Boxes are start (the task), agent (a ghost), and end (results). Arrows connect boxes. The bridge stores and runs workflows; the screen talks to it through `wf_*`, `agent_*` actions.

Look: follows the console look (`ConsoleScreen.mc`).

Top bar: `Workflows` title; `◀` and `▶` cycle saved workflows (default: the first saved workflow, or the first template as an unsaved copy); name box (max 60 characters; empty saves as `Untitled workflow`); `New` (clears the canvas to one start box named `New workflow`); `Save` or `Save*` when unsaved changes (sends `wf_save`; needs edit rights); `Delete` (sends `wf_delete` for the saved workflow); right: `▶ Run` or `■ Stop` (`Stop` sends `wf_stop` with the run id). Status text shows at the top.

Left palette (`ADD A BOX`): `Start (the task)`; one entry per job `Planner`, `Coder`, `Tester`, `Reviewer`, `Docs`, `Researcher` (agent box with that job); `End (results)`. `MY AGENTS` lists custom agents (`★ <name>`); clicking adds an agent box with that agent's job, model and id; `edit` opens the agent editor; `+ New` creates a custom agent. `TEMPLATES` lists the bridge's templates (clicking loads a copy).

Canvas: boxes are 104 x 34 px at zoom 1. Start boxes have no input dot; end boxes have no output dot. Drag a box to move it (edit rights). Drag from a box's right dot onto another box to add an arrow (start boxes cannot be targets; a connection that would form a loop is refused with status `That arrow would make a loop`; duplicates are ignored). Click an arrow's middle `×` to delete it. Drag on empty canvas to pan. Mouse wheel zooms (factor 1.1, clamped 0.3 to 1.6) around the pointer. Delete or Backspace removes the selected box when no text field has focus and edit rights exist; deleting a box removes its arrows.

Clicking a box selects it. Auto-connect: adding a box while a box is selected (not an end box) adds an arrow from the selected box.

Inspector (right panel):
- Start box: `START BOX · TASK` with a multi-line task field (max 4000 characters).
- Agent box: `AGENT BOX`; `Ghost name` field (max 40, sanitised to letters, digits, underscore, space, dot and hyphen); `Job` cycles the six jobs; `Model` cycles `Crew default` (empty), `Haiku 5.5 · 0.06x`, `Qwen3 Coder · 0.05x`, `Sonnet 5.5 · 1.3x`, `Opus 5.5 · 2x`, `Auto · 1x`; `Custom` cycles `none` and each custom agent (sets id, name, job, and model if the agent has one); `Instructions` multi-line field (max 6000 characters); `Delete box` (edit rights).
- End box: `Collects every result.`
- Run panel (`RUN`): run status (`running`, `done`, failed) and each step's status with seconds; the detail text (error or output) of the selected box, or of the end box when nothing is selected.

Save and run:
- Save sends `wf_save` with the workflow JSON (`id` when saved, `name`, `nodes` with `id`, `type`, `x`, `y` and `data`, `edges` with `from` and `to`). Node data: agent `name`, `job`, `model`, `agentId`, `instructions`; start `task`. Limit 60,000 characters (else status `Workflow too big to send: shorten some instructions`).
- Run: needs edit rights and at least one agent box. If the workflow has unsaved changes or was never saved, it saves first and then runs. Run sends `wf_run` with the workflow id and the start box's task. Status `Starting…`, then `Running… watch the ghosts in the office` (the bridge runs agents; their ghosts appear in the office).
- While a run is `running`, the screen asks `wf_run_get` once per second; a result of `done` or failed shows `Run <status>`.

Custom agent editor (modal): fields `Agent name` (max 40), `Job` cycle, `Model` cycle (same as above), source toggle `Plain prompt` or `SKILL.md`, `Load SKILL.md from project ⟳` (cycles the bridge's `/api/skills` list and fills the instructions, `no SKILL.md in project` when empty), instructions (max 8000 characters, `Its instructions are given to the ghost before every task.`). Buttons `Save agent` (sends `agent_save`), `Cancel`, and for saved agents `Delete` (sends `agent_delete`). `Esc` closes the editor.

Permissions: without edit rights (`canEdit` false from the bridge workflows list), the screen is view-only (status `view only: ask an operator to edit`); palette, box editing, save, run, and delete are disabled.

### 12.3 MergeScreen (`dev.hauntedcrew.client.MergeScreen`, 259 lines)

Purpose: review of ghost work. Each finished workflow run that changed files waits on its own git branch. Requires the bridge started with `--worktrees` (otherwise shows `Worktrees are off.`).

Layout: `Merges` title with `ghost work waiting for your OK`; `Close` button. Left list: each item is a run with name, `+<added> -<removed>  <files> file(s)`, and status (shown unless `pending`). Right pane: the diff of the selected run (requested with `merge_diff` when selected; `Loading diff...` while waiting). Diff colours: lines starting `+++`, `---`, `diff ` gold; `+` green; `-` red; `@@` aqua; other lines light grey. Tabs become four spaces. Mouse wheel scrolls 3 lines per notch. The list refreshes every 60 ticks (`merge_list`).

Actions (only for items with status `pending` or `conflict`): `Merge` (answer `Merge`), `Reject` (answer `Reject`), `Request changes` (opens a text field; Enter sends answer `Request changes` with the text; Esc cancels). For other statuses: `Working on it: <status>...`. The answer's result shows as a notice (`Result: <status> <sha>`) and `Sent: <option>` is shown after sending.

Answer JSON (`merge_answer`): `{"option": "Merge" | "Reject" | "Request changes", "text": "..."}` (text only for Request changes).

### 12.4 BrowserScreen (`dev.hauntedcrew.client.BrowserScreen`, 275 lines)

Purpose: remote control of the big screen's browser. Opened by sneak + right-click with the Screen Remote, or by clicking the big screen with the remote. Everyone sees the same page on the wall.

Toolbar: `◀` back (`screen_nav back`), `▶` forward (`screen_nav forward`), `⟳` reload (`screen_nav reload`), an address bar (max 500 characters; initially the current page label; follows page changes while not focused), `✕` close.

Address bar: click to focus; Enter sends `screen_go` with the text (empty input or the text `project preview` is ignored). The server treats text with no spaces that looks like a URL or domain as a URL (adding `https://` if needed); anything else becomes a DuckDuckGo search.

Page: the box keeps the frame's aspect ratio (1280 x 598). Click on the page sends `screen_click` with the relative position (u, v) in 0..1 (four decimals) and focuses the page for typing. Mouse wheel sends `screen_scroll` with `(int)(-dy*120)`.

Typing (page focused): typed characters are buffered and sent as `screen_text` after 120 ms of no more typing, or at once before any key or click. Keys sent as `screen_key`: Backspace, Enter, Tab, Delete, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Home, End, PageUp, PageDown. Shift + Tab, Left, Right, Home or End sends `Shift+<Key>`. Ctrl + A, X, Z or Y sends `Control+a` (etc.). Ctrl + V pastes the Minecraft clipboard as `screen_text` (newlines replaced, at most 200 characters). Esc closes the screen.

Placeholder when no frame is available: `Switch the big screen to Website or Web search (right-click the remote)`. Hint line at the bottom: `Click the page, then type   ·   wheel scrolls   ·   Esc closes   ·   everyone sees this on the big screen` (or `Enter to go   ·   click the page to type into it` while the address bar has focus).

Server handling of these actions: section 14.4. Only web modes accept page actions.

### 12.5 GhostRushScreen (`dev.hauntedcrew.client.GhostRushScreen`, 423 lines)

Purpose: a client-only maze game opened from the console sidebar (`Play Ghost Rush`). Nothing is sent to the server. High score is `static` (kept in memory until the game closes). Title `GHOST RUSH`.

Rules:
- You are the ghost. Eat orbs: small dots `.` score 10, lantern orbs `o` score 50.
- The Muncher (a pumpkin) hunts you. Level 1 starts with one Muncher; more are added on later levels (level 3 and 4 get 2, level 5 and up get 3).
- Eating a lantern (`o`) scares all Munchers for `max(60, 160 - level*15)` ticks, slows them (0.6 of their speed), and resets the eat combo.
- Touching a scared Muncher eats it: score `200 << min(combo, 3)`, that is 200, 400, 800 or 1600, combo increments. The Muncher returns to its patch after 50 ticks.
- Touching a Muncher that is not scared costs a life. Lives start at 3. After a catch the game waits 30 ticks, then resets positions (state CAUGHT). At 0 lives the game is over (`Game over · Space to play again`).
- Clearing all orbs shows `Level clear!` for 40 ticks, then the next level starts (faster: Muncher speed `min(0.15, 0.105 + level*0.008)`; ghost speed 0.16 tiles per tick).
- The maze has tunnels: row 7 wraps horizontally.
- The Muncher chases by shortest path (BFS) with some random turns early on (chance `max(0.05, 0.3 - level*0.05)` at each tile centre), or flees while scared.

Controls: arrow keys or W, A, S, D set the direction (the ghost turns at tile centres, and may reverse at any time); the first key press starts the game from READY. Space restarts after game over. Esc (also on the game's exit) returns to the console and stores the best score.

Text: `Score <n>`, `Level <n>   Best <n>`, banners `Press an arrow key or WASD`, `The Muncher got you!`, `Level clear!`, `Game over  ·  Space to play again`. Footer: `You're the ghost! Eat souls, dodge the Muncher, lanterns scare it.  Esc: back`.

## 13. Guide NPC (Boo)

Class `Guide` (server only, package-private static). A `GhostEntity` with job GUIDE, tag `hauntedcrew_guide`, name `Boo, your guide  (right-click me)`, name visible, spawned at the office's `guide` marker (block position `+0.5, +0.6, +0.5`, yaw 180).

Behaviour:
- `Guide.tick` every 20 server ticks: respawns Boo if missing and the home chunk is entity-ticking.
- Greeting: when a player is within 7 blocks of Boo, once per player per run, overlay `👻 New here? Right-click Boo for a quick tour!` (orange).
- Idle (`Guide.idle`, called from the ghost's movement): stays at home with a vertical bob `sin(tickCount/12) * 0.12`, zero velocity, and turns to face the nearest player within 12 blocks.
- Right-click (main hand) calls `Guide.talk`: shows the next tip, cycling through the tip list; each tip is headed `👻 Boo  ·  tip <i> of <n>` and ends with `Right-click me for the next tip.` until the last tip. Plays `AMETHYST_BLOCK_CHIME` (pitch 1.2 + 0.05 per tip index).

Tip list: 9 tips (the connected message appears when the bridge state is `connected`, otherwise a connect instruction):
1. Welcome to the Haunted Office! Every ghost inside is one of your Kiro AI agents, working on your real project. Let me show you around.
2. (connected) `✔ Your crew is connected to Kiro. You're ready to go.` (not connected) `First, connect your crew. On this PC, open a terminal in your project folder and run:` then `   npx haunted-crew`, then `Add --demo to try it without a Kiro account. The game finds it by itself.`
3. Open the Agent Console: right-click the ghost item in your hotbar, or press K. Click + New ghost, pick a job (Planner, Coder, Tester…) and type a task, just like chatting with an AI.
4. Want a whole team? In the console, open Workflows: chain ghosts with arrows (plan → code → test → review), or make your own agents from a prompt or a SKILL.md. Press Run and watch them hand work to each other.
5. Your ghost floats to a desk and gets to work. Its name tag shows what it's doing, and the big screen inside shows the whole crew live.
6. When a ghost glows and floats over to you, it needs your OK: it wants to edit a file or run a command. Open the console and press Allow or Reject.
7. Hold the Screen Remote and right-click to switch the big screen: Dashboard → Live code (see every edit as it happens) → Website (your project) → Web search → Activity. Left-click the screen to use it like a browser.
8. Friends can join your world and watch. Only you and operators give orders. (Second line) Server on another PC? Use /crew pair with the code the launcher prints.
9. That's the tour! Head inside, the desks are waiting. (Second line) Right-click me any time to hear it again.

Tip texts are quoted from the source code.

The guide is excluded from orphan cleanup (`Guide.isGuide`). It does not join desks; `CrewManager` never assigns it a session. Its position is not saved (guide ghosts are `noSave`).

## 14. Payloads and ConsoleService: every action and what the server does

### 14.1 Payloads

`ConsolePayloads` (records). Three play payloads:
- `ToClient(String json)`: id `hauntedcrew:console`, clientbound, `stringUtf8` limit 1,048,576. Carries `View` records serialised by Gson.
- `ScreenFrame(byte[] jpeg, String url)`: id `hauntedcrew:screen_frame`, clientbound, JPEG up to 2 MiB, url up to 2048 characters.
- `ToServer(String json)`: id `hauntedcrew:console_action`, serverbound, JSON, `stringUtf8` limit 65,536 as passed in the codec.

`View(String type, List<Session> sessions, List<Line> lines, Session session, Line line, String ended, Boolean canCommand, String bridge, String notice, String source, Kiro kiro, String data)`.

`Kiro(Boolean signedIn, Boolean installed, Boolean demo, String user, String url, String code, List<String> lines, String error)`.

`Action(String action, String session, String text, String requestId, String optionId)`.

### 14.2 Server-to-client view types (`View.type`)

| Type | Sent by | Carries | Client effect |
|---|---|---|---|
| `snapshot` | `sendSnapshot` (on `open`, on Hello, after pair) | sessions, lines (max 200), canCommand, bridge state, source | replaces the client's sessions and lines |
| `update` | `apply(Update)` broadcast | session, line (may be null) | upserts session and appends line |
| `ended` | `apply(SessionEnded)` broadcast | ended id, `left the crew` line | removes session, appends line |
| `kiro` | `kiroStatus` and `kiroLogin` | kiro | Kiro state and sign-in progress |
| `notice` | `notice(...)` | notice text | toast |
| `workflows` | `wf_list` and refreshes | data (bridge JSON) | workflow list |
| `workflow_run` | `wf_run`, `wf_run_get`, `wf_stop` | data | run state |
| `workflow_saved` | `wf_save` | data | saved workflow |
| `skills` | `wf_skills` | data | skills list |
| `usage` | `kiro_usage` | data | credits and plan |
| `merges` | `merge_list` | data | merge list |
| `merge_diff` | `merge_diff` | data | diff |
| `merge_answered` | `merge_answer` | data | answer result |

Other server behaviour on updates: a `permission` feed line sends a chat message to every player who can command (`⚠ <label> needs your OK: <text>  (press K to Allow or Reject)`) with a `NOTE_BLOCK_BELL` sound (volume 0.8, pitch 1.4). The `asked to ` prefix is removed from the text.

### 14.3 Client-to-server actions and server handling

Server rule order in `ConsoleService.handle(player, json)`:
1. Malformed JSON or null `action`: ignored.
2. `open`: sends snapshot and Kiro status to that player. No rights needed.
3. `kiro_status`: asks the bridge for Kiro status (view token). No rights needed.
4. `pair`: requires trust (operator or singleplayer owner); otherwise notice `Only the world owner or an operator can pair.`; empty text ignored; runs `HauntedCrew.pair` (session field = optional URL) and sends a notice plus a snapshot.
5. Any action starting with `wf_`, `agent_`, or `merge_`, or equal to `kiro_usage`: `workflowAction` (no cooldown; see the table in 14.5).
6. Any `screen_` action without command rights: silently ignored.
7. Any other action without command rights: notice `Watch-only: this server has no bridge command token.` (no command token configured) or `Only operators can command agents.`
8. `screen_` actions: `screenAction` (no cooldown).
9. Other actions: per-player cooldown of 300 ms (silently dropped if too soon).
10. `kiro_login`: `POST /kiro/login` with the command token; on failure notice `Could not start Kiro sign-in: <error>` or `Could not start Kiro sign-in.`; on success sends `kiro` view.
11. `spawn`, `prompt`, `model`, `interrupt`, `permission`: POST to the bridge (section 15). Other action strings: ignored.

Command rights (`canCommand`) = command token configured AND the player is trusted (`LEVEL_GAMEMASTERS` permission or singleplayer owner). Trust alone is used for screen switching and pairing.

### 14.4 Console and screen actions (client to server)

| Action | Sent by | Client fields | Server behaviour |
|---|---|---|---|
| `open` | `HauntedCrewClient.openConsole` | none | snapshot + Kiro status to the sender |
| `kiro_status` | `ConsoleScreen` (every 60 ticks while a sign-in code is open) | none | `GET /kiro/status` (view token), reply `kiro` |
| `kiro_login` | `ConsoleScreen` (`Sign in` buttons) | none | `POST /kiro/login` (command token), reply `kiro` or notice |
| `kiro_usage` | `ConsoleScreen` (context panel opened, command rights) | none | `GET /kiro/usage`, reply `usage` (see 15) |
| `pair` | `ConsoleScreen` (PAIR mode) | text = code, session = optional URL | pairing (trust required) |
| `spawn` | `ConsoleScreen` (summon) | text = ghost name, optionId = model id or null | `POST /agents` with `{"name": text, "model": optionId}` (model omitted if blank); on success notice `Summoned <name>.` |
| `prompt` | `ConsoleScreen` (send, suggestion chips, Retry) | session = session id, text | `POST /agents/<id>/prompt` with `{"text": text}`; session required |
| `model` | `ConsoleScreen` (model menu) | session, text = model id | `POST /agents/<id>/model` with `{"model": text}`; session and text required |
| `interrupt` | `ConsoleScreen` (Stop button) | session | `POST /agents/<id>/interrupt` with `{}`; session required |
| `dismiss` | `ConsoleScreen` (right-click a ghost > Dismiss ghost) | session | `POST /agents/<id>/dismiss` with `{}`; session required |
| `permission` | `ConsoleScreen` (approval buttons) | session, requestId = permission id, optionId = option id (null for the Deny button) | `POST /agents/<id>/permission` with `{"requestId": ..., "optionId": ...}`; session and requestId required |
| `screen_click` | `HauntedCrewClient.clickScreen` (wall click), `BrowserScreen` (page click) | text = `x,y` in 0..1 | `POST /browser/click` with `{"x": x, "y": y}` (page modes only) |
| `screen_scroll` | `HauntedCrewClient` (sneak + left-click on wall, value `500`), `BrowserScreen` (wheel) | text = integer pixels | `POST /browser/scroll` with `{"dy": n}` (page modes only); non-integers ignored |
| `screen_text` | `BrowserScreen` (typing, paste) | text (max 200 characters, longer is dropped) | `POST /browser/type` with `{"text": text, "submit": false}` |
| `screen_key` | `BrowserScreen` (keys) | text = key name | `POST /browser/key` with `{"key": text}` |
| `screen_nav` | `BrowserScreen` toolbar | text = `back`, `forward` or `reload` (others ignored) | `POST /browser/back`, `/browser/forward` or `/browser/reload` with `{}` |
| `screen_go` | `BrowserScreen` (address bar Enter) | text (max 500 characters) | URL (if no spaces and starts with `http://`, `https://` or looks like a domain; `https://` added when missing) else DuckDuckGo search `https://duckduckgo.com/?q=<encoded>`; `POST /browser/open` with `{"url": ...}` |
| `screen_type` | not sent by the client (server only) | text | if it looks like a URL, `/browser/open`; else in SEARCH mode, DuckDuckGo search; else `POST /browser/type` with `{"text": text}` |

Screen action rules: all `screen_*` actions do nothing unless the big screen exists and its mode is a web mode (`CODE`, `WEBSITE`, `SEARCH`) and the text is not null. Rights: command rights (section 14.3 rule 6). `screen_scroll` text must parse as an integer. `screen_click` text must be `x,y` with two parseable doubles (otherwise ignored).

Other actions in `ConsoleService` not sent by any client class (server-only handling): `screen_type` (above). Also note `model` and `interrupt` are handled by the server but are not documented in the `ConsolePayloads` Javadoc.

### 14.5 Workflow, custom agent, merge and usage actions

Handled by `workflowAction`. Read actions (`wf_list`, `wf_skills`, `wf_run_get`, `kiro_usage`, `merge_list`, `merge_diff`) need no command rights and use the command token if the player has command rights, else the view token. Write and run actions need command rights; without them: notice `Only operators can change or run workflows.` (or the watch-only text when no command token exists). If the token is empty, nothing happens.

| Action | HTTP | Path | Body | Reply view | After success |
|---|---|---|---|---|---|
| `wf_list` | GET | `/api/workflows` | none | `workflows` | none |
| `wf_skills` | GET | `/api/skills` | none | `skills` | none |
| `wf_save` | PUT | `/api/workflows` | `text` (the workflow JSON from the client) | `workflow_saved` | sends the bridge answer as `workflow_saved` |
| `wf_delete` | DELETE | `/api/workflows/<session>` | none | `workflows` | re-list (`wf_list`) |
| `wf_run` | POST | `/api/workflows/<session>/run` | `{"task": text}` | `workflow_run` | none |
| `wf_run_get` | GET | `/api/workflows/runs/<session>` | none | `workflow_run` | none |
| `wf_stop` | POST | `/api/workflows/runs/<session>/stop` | `{}` | `workflow_run` | none |
| `agent_save` | PUT | `/api/crew-agents` | `text` (agent JSON) | `workflows` | re-list |
| `agent_delete` | DELETE | `/api/crew-agents/<session>` | none | `workflows` | re-list |
| `kiro_usage` | GET | `/kiro/usage` | none | `usage` | none |
| `merge_list` | GET | `/api/merges` | none | `merges` | none |
| `merge_diff` | GET | `/api/merges/<session>/diff` | none | `merge_diff` | none |
| `merge_answer` | POST | `/api/merges/<session>/answer` | `text` (the answer JSON) | `merge_answered` | none |

`<session>` is the request's `session` field (URL-encoded). Missing session on `wf_delete`, `wf_run`, `wf_stop`, `wf_run_get`: nothing sent. Bridge errors: notice `Workflow: <error>` (the bridge's JSON `error` field, else the raw body, capped at 160 characters); network errors: notice `Bridge unreachable: <exception class>`.

Each HTTP request has `Authorization: Bearer <token>` and `Content-Type: application/json`, with a 30 s timeout.

### 14.6 ConsoleService (`dev.hauntedcrew.ConsoleService`, 458 lines)

Purpose: server side of the in-game console. Keeps the feed (max 200 lines), sends views, relays actions to the bridge. Server thread, except HTTP callbacks which hop back with `server.execute`.

Constants: `MAX_LINES = 200`, `ACTION_COOLDOWN_MS = 300`. HTTP client HTTP/1.1 with 5 s connect timeout (the default HTTP/2 upgrade would reach the bridge's WebSocket handler).

Hello: clears sessions and lines, keeps the last 200 history lines, and sends a snapshot plus Kiro status to every online player.
Update: stores the session, appends the line, broadcasts `update`, and for a `permission` line calls `askInChat`.
SessionEnded: removes the session, appends a `left the crew` line, broadcasts `ended`.

`isTrusted(player)`: `LEVEL_GAMEMASTERS` permission or `server.isSingleplayerOwner`. `canCommand(player)`: command token configured AND trusted.

`snapshot` includes `canCommand` (per player), `bridge` (the bridge state string), and `source` (`paired`, `local`, `none`).

## 15. BridgeClient and bridge HTTP calls

### 15.1 BridgeClient (`dev.hauntedcrew.BridgeClient`)

Purpose: WebSocket client for the bridge stream. Daemon scheduler thread `hauntedcrew-bridge`. Messages are passed to the callback on the WebSocket thread; callers hop to the server thread.

States (`BridgeClient.State`): `STOPPED`, `CONNECTING`, `CONNECTED`, `RETRYING`, `UNAUTHORIZED`.

Connect:
- `java.net.http.HttpClient` with 5 s connect timeout.
- Header `Authorization: Bearer <view token>`.
- Target URI: `config.url()` plus `?frames=1` (or `&frames=1`), set by `HauntedCrew.connect`. The `frames=1` parameter asks the bridge to stream browser frames.
- On handshake HTTP 401 or 403: state `UNAUTHORIZED`, logs `bridge rejected the view token (<code>). Check viewToken in config/hauntedcrew.json.`, retries after 60 s.
- Other failures: state `RETRYING`, backoff retry.

Receive:
- `onOpen`: state `CONNECTED`, backoff reset to 1 s, requests one message.
- `onText`: accumulates fragments; a message over 4,194,304 characters aborts the socket and reconnects; the complete message goes to the callback, a runtime exception from the callback is logged and ignored.
- `onClose` (not stopped): logs `bridge closed the stream (<code> <reason>), reconnecting` and reconnects once.
- `onError` (not stopped): logs and reconnects once (`end()` guards against double reconnect).

Retry backoff: starts at 1000 ms, doubles to a maximum of 30,000 ms, plus random jitter up to a quarter of the current backoff. Reset to 1000 on open.

`stop()`: stopped flag, state `STOPPED`, sends WebSocket close (`NORMAL_CLOSURE`, `server stopping`), shuts down the scheduler.

### 15.2 Roles (view versus command)

- The stream (WebSocket) always uses the view token. The view token gives read-only state: hello, events, frames.
- Command actions use the command token in `Authorization`: `/agents...`, `/browser/...`, `/kiro/login`, workflow and merge writes and runs, merge answers.
- Read-only HTTP (workflow list, skills, usage, merge list and diff, run status, Kiro status) uses the command token when the player may command, else the view token.
- Pairing uses no token (`POST /pair` with the launcher code).
- Which players may command: section 14.3 (command token configured and operator level or singleplayer owner).

### 15.3 HTTP endpoints called by the mod

| Method | Path | Token | Called from |
|---|---|---|---|
| GET | `/kiro/status` | view (`config.token()`) | `ConsoleService.kiroStatus` |
| POST | `/kiro/login` | command | `ConsoleService.kiroLogin` |
| GET | `/kiro/usage` | command or view | `workflowAction` (`kiro_usage`) |
| POST | `/pair` (body `{"code": ...}`) | none | `HauntedCrew.pair` |
| POST | `/agents` (body `{"name", "model"?}`) | command | spawn |
| POST | `/agents/<id>/prompt` | command | prompt |
| POST | `/agents/<id>/model` | command | model |
| POST | `/agents/<id>/interrupt` | command | interrupt |
| POST | `/agents/<id>/dismiss` | command | dismiss |
| POST | `/agents/<id>/permission` | command | permission |
| POST | `/browser/open`, `/browser/stop`, `/browser/click`, `/browser/scroll`, `/browser/type`, `/browser/key`, `/browser/back`, `/browser/forward`, `/browser/reload` | command | ScreenWall and screen actions |
| GET, PUT, DELETE | `/api/workflows`, `/api/workflows/<id>`, `/api/workflows/<id>/run`, `/api/workflows/runs/<id>`, `/api/workflows/runs/<id>/stop` | as in 14.5 | workflow actions |
| GET, PUT, DELETE | `/api/skills`, `/api/crew-agents`, `/api/crew-agents/<id>` | as in 14.5 | workflow actions |
| GET, POST | `/api/merges`, `/api/merges/<id>/diff`, `/api/merges/<id>/answer` | as in 14.5 | merge actions |

Note: the README says the bridge's `hello` message recreates ghosts after a restart; ghosts are not saved with the world.

## 16. Build and test

From `mod/README.md`: needs JDK 25 to run Gradle (Loom requirement).

```bash
export JAVA_HOME=/path/to/jdk-25
./gradlew build            # jar in build/libs, runs unit tests
./gradlew runServer        # dev server in run/
./gradlew runClient        # dev client
```

Tasks named in the README: `build`, `runServer`, `runClient`. Gradle wrapper is in `gradle/wrapper`. Build output: jar in `build/libs` (plus sources jar, from `withSourcesJar()`).

Unit tests (JUnit 5, `useJUnitPlatform()`):
- `CrewConfigTest` (5 tests): default config creation with owner-only permissions (POSIX only), validation rules, plain `ws://` to a remote host flagged, anchor round trip, invalid JSON raises IOException.
- `CrewProtocolTest` (8 tests): hello sessions parsing, event updates and session end, control and `§` stripping with length cap, unknown status is IDLE and unknown type ignored, job from agent name, feed lines and permissions, agent replies keep line breaks, malformed input rejected.

## 17. Source map

Main (`mod/src/main/java/dev/hauntedcrew`):

| File | Purpose |
|---|---|
| `HauntedCrew.java` | Mod initializer: registers entities, block, items, payloads; lifecycle; `/crew` commands; join kit and teleport; pairing; frame forwarding; Screen Remote cycle. |
| `CrewConfig.java` | Config file `config/hauntedcrew.json`: bridge URL, tokens, anchor; env overrides; launcher discovery; validation. |
| `CrewProtocol.java` | Parses bridge messages (hello, event, session end) into Session, Line, Permission records; Status, Job enums. Pure Java. |
| `CrewManager.java` | One ghost per session: spawn, desks and rings, status teams, reconcile every second, orphan cleanup. |
| `GhostEntity.java` | The ghost mob: status and job synced data, floating movement to desk or nearest player, invulnerable. |
| `Guide.java` | Boo, the tour ghost at the gate: tips, greetings, idle bob. |
| `Office.java` | Office template: placement, markers, layout file, new-world setup (gamerules, spawn), saving a region. |
| `ScreenWall.java` | Big screen built from display entities: dashboard, activity log, web modes; geometry from the screen marker. |
| `ScreenEntity.java` | Invisible anchor entity for the live browser quad on the big screen. |
| `MonitorBlock.java` | Desk monitor block: horizontal facing, collision shape, placed facing the player. |
| `CrewItem.java` | Agent Console and Screen Remote items; the remote's right-click cycles the big screen on the server. |
| `ConsoleService.java` | Server side of the console: feed, snapshots, actions to the bridge, workflows, merges, big-screen controls. |
| `ConsolePayloads.java` | Packet records: ToClient (`console`), ScreenFrame (`screen_frame`), ToServer (`console_action`), and the View, Kiro, Action JSON records. |
| `BridgeClient.java` | WebSocket client for the bridge stream with bearer auth, backoff reconnects, 4M-character message cap. |

Client (`mod/src/client/java/dev/hauntedcrew/client`):

| File | Purpose |
|---|---|
| `HauntedCrewClient.java` | Client initializer: key K binding, model layer and renderers, payload receivers, item use and attack callbacks, console opening. |
| `ClientConsole.java` | Client copy of console state fed by `console` payloads, plus `send()` for `console_action`. |
| `ConsoleScreen.java` | The agent console: sidebar, chat per ghost, #crew channel, thinking and activity blocks, approvals, Kiro card, onboarding, pairing, model and context controls. |
| `WorkflowScreen.java` | Workflow builder canvas: boxes and arrows, inspector, run panel, custom agent editor, templates, SKILL.md loading. |
| `MergeScreen.java` | Merge review: list of runs, colored diff, Merge, Reject, Request changes. |
| `BrowserScreen.java` | Remote control for the big screen's browser: toolbar, address bar, page clicks, typing, keys, scroll. |
| `GhostRushScreen.java` | Client-only maze chase mini-game (Ghost Rush). |
| `GhostRenderer.java` | Renders the ghost with the status tint and texture. |
| `GhostRenderState.java` | Render state carrying the ghost's status and job. |
| `GhostModel.java` | Builds the ghost model from `models/entity/ghost.json`; shows the job's accessory parts; arm and body animation. |
| `ScreenRenderer.java` | Draws the browser frame as a full-bright quad over the big screen. |
| `ScreenTexture.java` | Decodes incoming JPEG frames off-thread and uploads the latest one as a dynamic texture. |

Test (`mod/src/test/java/dev/hauntedcrew`):

| File | Purpose |
|---|---|
| `CrewConfigTest.java` | Unit tests for config creation, validation, insecure-remote flag, anchor round trip, invalid JSON. |
| `CrewProtocolTest.java` | Unit tests for bridge message parsing, activity text, jobs from names, feed lines and permissions. |

Resources (non-Java, `mod/src/main/resources`): `fabric.mod.json` (mod metadata); `assets/hauntedcrew/lang/en_us.json` (lang keys); `assets/hauntedcrew/blockstates/monitor.json`; `assets/hauntedcrew/models/block/monitor.json`; `assets/hauntedcrew/models/item/agent_console.json` and `screen_remote.json`; `assets/hauntedcrew/models/entity/ghost.json` (ghost model, 67 parts); `assets/hauntedcrew/items/agent_console.json`, `monitor.json`, `screen_remote.json`; textures under `assets/hauntedcrew/textures/` (block monitor, entity ghost, item agent_console, screen_remote); `assets/hauntedcrew/icon.png`; `data/hauntedcrew/structure/office.nbt` (office template); `data/hauntedcrew/worldgen/world_preset/haunted_office.json`; `data/minecraft/tags/worldgen/world_preset/normal.json`.

## 18. Not verified

- Bridge behaviour: all bridge endpoints and their responses are outside `mod/`. Only the mod's calls and how it handles replies were checked.
- Runtime behaviour: nothing was built, run, or rendered. Gradle build, unit tests, and in-game visuals were not checked.
- Asset contents: textures (`ghost.png` and the item and block PNGs) and the icon were not inspected. Ghost model UV and bounds were not checked beyond part names, parents and counts.
- Office template: only the block palette counts, marker positions and size were read from `office.nbt`. Other block placements were not examined.
- `Commands.LEVEL_GAMEMASTERS` value 2 comes from the README and vanilla naming; the library constant itself was not read.
- `tools/ghost/paint_ghost.py` (cited in the GhostModel comment) is not inside `mod/` and was not checked.
- Guide tip text and UI strings are quoted from code; their exact display in-game was not seen.
- The `hello`, `event`, `frame`, and `permission` message shapes are as parsed by `CrewProtocol` and `HauntedCrew`; the bridge's own schema was not checked.
- `mod/src/main/resources` has no `mixins` file, and no `src/client/resources` directory exists (checked with `find`).
