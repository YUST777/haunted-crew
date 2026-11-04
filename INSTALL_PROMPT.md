# Install Haunted Crew with your AI agent

Copy everything in the box below and paste it into Kiro (or any coding agent that can run
terminal commands). It will set up Haunted Crew for the project you have open.

```text
Install Haunted Crew for this project: it shows my Kiro agents as ghosts in a Minecraft office.
Do every step yourself and check each result before the next one. Only ask me for things you
cannot do (installing apps, signing in, clicking in the game).

1. Check: `node --version` (need 20+), `kiro-cli --version`, `java -version` (optional).
   If Node or kiro-cli is missing, tell me where to get it (nodejs.org, kiro.dev/downloads) and wait.
2. Install the mod into Minecraft Java 26.3 (Fabric Loader + Fabric API + Haunted Crew):
   `npx -y -p haunted-crew haunted-crew-minecraft`
   Read its output. If it can't find my Minecraft folder, ask me for it and rerun with
   `--minecraft-dir "<folder>"`. If Java is missing, ask me to run https://fabricmc.net/use/installer/
   for 26.3, then rerun.
3. Run `kiro-cli whoami`. If I'm not signed in, run `kiro-cli login` and wait for me.
4. In this project folder, start the bridge in the background and keep it running:
   `npx -y haunted-crew .`
   Confirm its output shows the hooks installed, "signed in" and "running on 127.0.0.1:8787".
5. Then tell me: open the Minecraft launcher, pick the Fabric 26.3 profile, create a world with
   World Type "Haunted Office", right-click Boo for a tour, press K to summon ghosts.
   Also give me the "workflows" link the bridge printed: it opens the workflow editor.
```

Using Kiro? You can also install it as a **Kiro Power**: Powers panel → Add Custom Power →
Import power from GitHub → paste this repository's URL. Then ask Kiro "set up Haunted Crew".
