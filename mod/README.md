# Haunted Crew mod (Fabric, Minecraft 26.3)

Shows each Kiro agent session as a ghost. Status colours: blue working, yellow waiting for you (floats to the nearest player), red error, grey idle.

## Build

Needs JDK 25 to run Gradle (Loom requirement).

```bash
export JAVA_HOME=/path/to/jdk-25
./gradlew build            # jar in build/libs, runs unit tests
./gradlew runServer        # dev server in run/
./gradlew runClient        # dev client
```

## Connect to the bridge

- **Same PC and OS user as the launcher:** automatic. The mod reads `~/.haunted-crew/bridge.json` and
  `tokens.json`, rechecks every 10 s, and never copies those tokens into its config.
- **Elsewhere:** `/crew pair <code> <ws://host:port/stream>` (or the console's **Enter pairing code**).
  The tokens are saved to `config/hauntedcrew.json` (owner read/write only), or set
  `HAUNTED_CREW_VIEW_TOKEN` / `HAUNTED_CREW_COMMAND_TOKEN` instead.

Tokens stay on the server: never sent to clients, chat or logs. A wrong token shows as `unauthorized`
in `/crew status`. For a remote bridge use `wss://` behind TLS; `ws://` to a non-local host logs a warning.

## Agent console

Press **K** (Options → Controls → Haunted Crew). Ghosts in a sidebar, one chat per ghost plus `# crew`,
activity steps, inline approval cards, Kiro sign-in, onboarding and pairing. The server relays
actions to the bridge with the command token; only operators and the singleplayer world owner can
command, everyone else watches.

## Haunted Office world type

Create New World → World Type → **Haunted Office**. Dedicated server: `level-type=hauntedcrew\:haunted_office` in `server.properties` (new world only).

The world is empty void with the office pasted at 0 64 0. On first start the mod sets spawn inside the office, freezes time at midnight, stops weather and mob spawning.

### Build your own office

1. In any Creative world, build the room (max 96 blocks per side).
2. Mark spots with **Structure Blocks in Data mode**, metadata:
   - `desk` – where a ghost floats (one per agent; put it above the desk, in front of the monitor)
   - `screen`, `taskwall`, `bell` – for the big screen, task wall and hook bell
   - `spawn` – where players appear
3. Save: `/crew office save <corner1> <corner2>`. The world now uses that office (`<world>/generated/hauntedcrew/structure/office.nbt`).
4. Test it: `/crew office place` pastes it at your feet and moves ghosts to its desks.
5. Ship it: copy that `office.nbt` to `src/main/resources/data/hauntedcrew/structure/office.nbt`.

Markers become air when placed; their positions are stored in `<world>/hauntedcrew/office.json`.

## Commands (op level 2)

| Command | Does |
|---|---|
| `/crew status` | Bridge state, session count, loaded ghosts |
| `/crew reload` | Re-read config and reconnect |
| `/crew anchor` | Extra ghosts (beyond desks) gather around your position (saved) |
| `/crew office place` | Paste the office at your position |
| `/crew office save <from> <to>` | Save a region as this world's office |
| `/crew pair <code> [url]` | Pair this server with a bridge using a launcher code |

## Notes

- Ghosts are not saved with the world. The bridge's `hello` message recreates them, and they respawn when the anchor area is loaded.
- Players need the mod installed to see the ghost model (custom entity).
