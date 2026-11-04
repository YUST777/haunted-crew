#!/usr/bin/env node
// Puts Haunted Crew into Minecraft Java, so a person (or a Kiro agent following the Haunted Crew
// power) never copies jars by hand:
//   1. Fabric Loader for Minecraft 26.3 (runs the official Fabric installer; needs Java)
//   2. Fabric API (from Modrinth)
//   3. the Haunted Crew mod (bundled with this package, or --jar path/to/hauntedcrew.jar)
//
// usage: haunted-crew-minecraft [--minecraft-dir DIR] [--jar FILE] [--dry-run]
// Safe to re-run: installed pieces are detected and skipped; an older Haunted Crew jar is replaced.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, platform, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MC_VERSION = '26.3';
const UA = { 'user-agent': 'haunted-crew-installer (github.com/haunted-crew)' };
const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const dry = args.includes('--dry-run');
const ok = (s) => console.log(`  \x1b[32m✔\x1b[0m ${s}`);
const warn = (s) => console.log(`  \x1b[33m!\x1b[0m ${s}`);

export function defaultMinecraftDir(os = platform(), env = process.env, home = homedir()) {
  if (os === 'win32') return join(env.APPDATA ?? join(home, 'AppData', 'Roaming'), '.minecraft');
  if (os === 'darwin') return join(home, 'Library', 'Application Support', 'minecraft');
  return join(home, '.minecraft');
}

/** The bundled mod jar (npm package) or the dev build in the repo. */
export function findModJar(from = here) {
  for (const dir of [join(from, '..', 'minecraft'), join(from, '..', '..', 'mod', 'build', 'libs')]) {
    if (!existsSync(dir)) continue;
    const jar = readdirSync(dir).find((f) => /^hauntedcrew-.*\.jar$/.test(f) && !f.includes('sources'));
    if (jar) return join(dir, jar);
  }
  return null;
}

async function download(url, file) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`download failed (${res.status}): ${url}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

async function main() {
  const mc = opt('minecraft-dir') ?? defaultMinecraftDir();
  console.log(`\n  👻 Haunted Crew → Minecraft ${MC_VERSION}\n  minecraft folder: ${mc}${dry ? '   (dry run)' : ''}\n`);
  if (!existsSync(mc)) {
    warn('Minecraft folder not found. Install Minecraft Java and start it once, or pass --minecraft-dir.');
    process.exit(1);
  }
  const mods = join(mc, 'mods');
  if (!dry) mkdirSync(mods, { recursive: true });

  // 1. Fabric Loader: a versions/fabric-loader-<v>-26.3 folder means the launcher has a Fabric profile.
  const versions = existsSync(join(mc, 'versions')) ? readdirSync(join(mc, 'versions')) : [];
  const loader = versions.find((v) => v.startsWith('fabric-loader-') && v.endsWith(`-${MC_VERSION}`));
  if (loader) ok(`Fabric Loader already installed (${loader})`);
  else {
    const installers = await (await fetch('https://meta.fabricmc.net/v2/versions/installer', { headers: UA })).json();
    const url = installers.find((i) => i.stable)?.url;
    if (!url) throw new Error('could not find the Fabric installer');
    if (dry) ok(`would run the Fabric installer for ${MC_VERSION}`);
    else {
      const jar = join(tmpdir(), basename(url));
      await download(url, jar);
      // No launcher_profiles.json (launcher never opened here, or another launcher): skip the profile.
      const profile = existsSync(join(mc, 'launcher_profiles.json')) ? [] : ['-noprofile'];
      try {
        execFileSync(process.env.JAVA ?? 'java', ['-jar', jar, 'client', '-mcversion', MC_VERSION, '-dir', mc, ...profile], { stdio: 'inherit' });
        ok(`Fabric Loader installed${profile.length ? ' (no launcher profile created: pick Fabric in your launcher)' : ` (pick the "fabric-loader-…-${MC_VERSION}" profile in the launcher)`}`);
      } catch (err) {
        warn(err.code === 'ENOENT' ? 'Java not found.' : 'The Fabric installer failed (see above).');
        warn(`Install Fabric by hand: https://fabricmc.net/use/installer/ (Minecraft ${MC_VERSION}), then run this again.`);
      } finally {
        rmSync(jar, { force: true });
      }
    }
  }

  // 2. Fabric API.
  const have = readdirSync(existsSync(mods) ? mods : mc).filter((f) => f.endsWith('.jar'));
  const api = have.find((f) => /^fabric-api-.*\.jar$/.test(f));
  if (api) ok(`Fabric API already installed (${api})`);
  else {
    const q = new URLSearchParams({ game_versions: JSON.stringify([MC_VERSION]), loaders: JSON.stringify(['fabric']) });
    const list = await (await fetch(`https://api.modrinth.com/v2/project/fabric-api/version?${q}`, { headers: UA })).json();
    const file = list[0]?.files?.find((f) => f.primary) ?? list[0]?.files?.[0];
    if (!file) throw new Error(`no Fabric API build for ${MC_VERSION} on Modrinth`);
    if (!dry) await download(file.url, join(mods, file.filename));
    ok(`Fabric API ${list[0].version_number} ${dry ? 'would be ' : ''}installed`);
  }

  // 3. Haunted Crew itself (replaces older versions).
  const jar = opt('jar') ?? findModJar();
  if (!jar || !existsSync(jar)) {
    warn('Haunted Crew mod jar not found. Pass --jar path/to/hauntedcrew-<version>.jar (from the GitHub release).');
    process.exit(1);
  }
  for (const old of have.filter((f) => /^hauntedcrew-.*\.jar$/.test(f) && f !== basename(jar))) {
    if (!dry) rmSync(join(mods, old));
    ok(`removed older ${old}`);
  }
  if (!dry) copyFileSync(jar, join(mods, basename(jar)));
  ok(`${basename(jar)} ${dry ? 'would be ' : ''}installed in ${mods}`);

  console.log(`
  Next: open the Minecraft launcher, pick the Fabric ${MC_VERSION} profile, Play.
  Create a world with the "Haunted Office" world type, then press K.
`);
}

// Run directly (npx links bin files, so compare real paths).
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  main().catch((err) => {
    console.error(`  ✖ ${err.message}`);
    process.exit(1);
  });
}
