---
name: haunted-crew-setup
description: Install and start Haunted Crew (Kiro agents as ghosts in Minecraft) for the current project. Use when the user asks to install, set up, start or fix Haunted Crew.
---

# Set up Haunted Crew

Haunted Crew shows Kiro agents as ghosts in a Minecraft office and lets the user command them
from inside the game. Work through the steps in order. Run each command yourself, read its
output, and fix problems before moving on. Ask the user only for things you cannot do
(installing Minecraft, signing in, clicking in the game).

## Step 1: Check what is installed

Run these and note the results:

```bash
node --version        # needs v20 or newer
kiro-cli --version    # Kiro CLI, used to run the ghost agents
java -version         # optional: only needed to install Fabric automatically
```

- Node missing or older than 20: ask the user to install Node.js LTS from https://nodejs.org, then continue.
- kiro-cli missing: ask the user to install it from https://kiro.dev/downloads.
- Minecraft Java Edition must be installed and started at least once. If you cannot find the
  Minecraft folder in Step 2, ask the user to do that.

## Step 2: Put the mod into Minecraft

```bash
npx -y -p haunted-crew haunted-crew-minecraft
```

This installs, for Minecraft 26.3: Fabric Loader, Fabric API and the Haunted Crew mod. It is safe
to run again. Read every line it prints:

- "Minecraft folder not found": the user has not started Minecraft Java yet, or uses a custom
  folder. Ask for the folder and run again with `--minecraft-dir "<folder>"`.
- "Java not found" or "Fabric installer failed": ask the user to run the Fabric installer from
  https://fabricmc.net/use/installer/ for Minecraft 26.3, then run the command again.
- If `npx` cannot find the `haunted-crew` package, use the source instead:
  `git clone https://github.com/haunted-crew/haunted-crew && cd haunted-crew/bridge && npm install`, then
  build the mod jar (`cd ../mod && ./gradlew build`, needs JDK 25) and run
  `node bin/install-minecraft.mjs --jar ../mod/build/libs/hauntedcrew-0.1.0.jar` from `bridge/`.

## Step 3: Sign in to Kiro

```bash
kiro-cli whoami
```

If it says the user is not logged in, run `kiro-cli login` and tell the user to finish the sign-in
in their browser. Continue when `kiro-cli whoami` shows an account.

## Step 4: Start the bridge for this project

Start it in the background from the project folder (the folder the ghosts should work on), and
keep it running:

```bash
npx -y haunted-crew .
```

Useful options: `--model claude-sonnet-5.5` (default is the fast, cheap `claude-haiku-5.5`),
`--mcp` (give ghosts the user's MCP servers; slower), `--demo` (pretend agents, no Kiro account).

Check its output: it must show "Kiro hooks ✔", "signed in" and "running on 127.0.0.1:8787".
If port 8787 is busy, add `--port 8788`.

## Step 5: Tell the user how to play

Tell the user, in short steps:

1. Open the Minecraft launcher, choose the **Fabric 26.3** profile, press Play.
2. Singleplayer → Create New World → World Type: **Haunted Office** → Create.
3. Walk through the gate. Right-click **Boo**, the guide ghost, for a tour.
4. Press **K** to open the Agent Console. Click **+ New ghost**, pick a job, and type a task.
5. To chain ghosts into a team, open the **workflows** link the bridge printed
   (`http://127.0.0.1:8787/workflows#token=…`): pick a template or draw boxes and arrows, make
   custom agents from a prompt or a SKILL.md, then press Run and watch the ghosts work in the game.

The game finds the bridge on the same computer by itself. For a Minecraft server on another
machine, the bridge prints a pairing command (`/crew pair HC-XXXX-XXXX ws://<this-pc>:8787/stream`)
for the user to run in the game.

## Troubleshooting

- Console says "Bridge not paired": the bridge is not running, or runs on another port. Restart Step 4.
- Ghosts say "Sign in to Kiro first": run `kiro-cli login`, then restart the bridge.
- Nothing shows in Minecraft: check that `mods` contains `fabric-api-*.jar` and `hauntedcrew-*.jar`
  (run Step 2 again), and that the Fabric profile was chosen in the launcher.
