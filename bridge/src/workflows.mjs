import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AgentError } from './agents.mjs';
import { createMailbox } from './mailbox.mjs';
import { createMemory, extract as extractMemories } from './memory.mjs';
import { createSharedData } from './shared-data.mjs';
import { createRunStore } from './runstore.mjs';
import { MergeError } from './worktrees.mjs';

// Workflows: boxes and arrows drawn in the editor page (/workflows). A "start" box holds the task,
// each "agent" box becomes a real ghost (a Kiro agent) that gets the task plus the results of the
// boxes pointing at it, and "end" collects the results. Boxes whose inputs are ready run in
// parallel. Custom agents are reusable boxes: a name, model, job, and instructions written as a
// plain prompt or a SKILL.md. Saved per project in .haunted-crew/workflows.json.

const MAX_NODES = 30;
const MAX_TEXT = 12_000;
const MAX_RUNS = 20;
const ID_RE = /^[\w-]{1,64}$/;
const NODE_TYPES = new Set(['start', 'agent', 'end']);
const MODEL_RE = /^[\w.:-]{1,64}$/;
const JOBS = new Set(['Planner', 'Coder', 'Tester', 'Reviewer', 'Docs', 'Researcher']);

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
// Ghost names allow letters, digits, spaces, . - _ (see agents.mjs).
export const ghostName = (s) => str(s, 40).replace(/[^\w .-]/g, '').trim() || 'Ghost';

/** Reads `name` / `description` from SKILL.md frontmatter; the rest is the instructions. */
export function parseSkill(text) {
  const t = str(text, MAX_TEXT).replace(/\r/g, '');
  const m = t.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { name: '', description: '', instructions: t.trim() };
  const field = (k) => (m[1].match(new RegExp(`^${k}:\\s*(.*)$`, 'm'))?.[1] ?? '').trim().replace(/^["']|["']$/g, '');
  return { name: field('name'), description: field('description'), instructions: m[2].trim() };
}

function cleanAgent(a) {
  if (!a || typeof a !== 'object') throw new AgentError(400, 'agent must be an object');
  const skill = a.source === 'skill' ? parseSkill(a.instructions) : null;
  const out = {
    id: ID_RE.test(a.id ?? '') ? a.id : randomUUID(),
    name: ghostName(a.name || skill?.name),
    job: JOBS.has(a.job) ? a.job : 'Coder',
    model: MODEL_RE.test(a.model ?? '') ? a.model : '',
    source: a.source === 'skill' ? 'skill' : 'prompt',
    description: str(a.description || skill?.description, 200),
    instructions: str(a.instructions, MAX_TEXT),
  };
  return out;
}

export function cleanWorkflow(w) {
  if (!w || typeof w !== 'object') throw new AgentError(400, 'workflow must be an object');
  const nodes = Array.isArray(w.nodes) ? w.nodes : [];
  if (nodes.length > MAX_NODES) throw new AgentError(400, `at most ${MAX_NODES} boxes`);
  const ids = new Set();
  const clean = nodes.map((n) => {
    if (!n || !ID_RE.test(String(n.id)) || !NODE_TYPES.has(n.type)) throw new AgentError(400, 'bad box');
    if (ids.has(String(n.id))) throw new AgentError(400, 'duplicate box id');
    ids.add(String(n.id));
    const d = n.data && typeof n.data === 'object' ? n.data : {};
    return {
      id: String(n.id), type: n.type,
      x: Number.isFinite(n.x) ? Math.round(n.x) : 0, y: Number.isFinite(n.y) ? Math.round(n.y) : 0,
      data: n.type === 'agent'
        ? { name: ghostName(d.name), job: JOBS.has(d.job) ? d.job : 'Coder', model: MODEL_RE.test(d.model ?? '') ? d.model : '',
          agentId: ID_RE.test(d.agentId ?? '') ? d.agentId : '', instructions: str(d.instructions, MAX_TEXT), lead: d.lead === true }
        : n.type === 'start' ? { task: str(d.task, MAX_TEXT) } : {},
    };
  });
  const edges = (Array.isArray(w.edges) ? w.edges : []).filter((e) => ids.has(String(e?.from)) && ids.has(String(e?.to)) && e.from !== e.to)
    .map((e) => ({ from: String(e.from), to: String(e.to) }));
  const out = { id: ID_RE.test(w.id ?? '') ? w.id : randomUUID(), name: str(w.name, 60).trim() || 'Untitled workflow', description: str(w.description, 300), nodes: clean, edges };
  order(out); // throws on loops
  return out;
}

/** Topological order; throws when the arrows make a loop. */
export function order(w) {
  const indeg = new Map(w.nodes.map((n) => [n.id, 0]));
  for (const e of w.edges) indeg.set(e.to, indeg.get(e.to) + 1);
  const queue = w.nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  const out = [];
  while (queue.length) {
    const id = queue.shift();
    out.push(id);
    for (const e of w.edges) if (e.from === id && indeg.set(e.to, indeg.get(e.to) - 1).get(e.to) === 0) queue.push(e.to);
  }
  if (out.length !== w.nodes.length) throw new AgentError(400, 'the arrows make a loop; workflows must flow one way');
  return out;
}

// ---------------------------------------------------------------- templates

const box = (id, type, x, y, data = {}) => ({ id, type, x, y, data });
// House rules every blender_insta box gets (from its CLAUDE.md and minecraft-short Phase 0).
const BI = 'You work in the blender_insta workspace (Minecraft shorts made in Blender). House rules: never render a video on this PC (MX450), previews only; real Minecraft assets, particles and sounds, nothing invented; titles in the Minecraft font, flat white, soft shadow, static; keep each project self-contained (copy from shared/, no links); never delete outputs or kill the user\'s Blender; never print projects/output/.env*; do not move projects/output/. Write mistakes to vault/Mistakes Log.md.\n\n';
const agentBox = (id, x, y, name, job, instructions) => box(id, 'agent', x, y, { name, job, model: '', agentId: '', instructions });
const chain = (...ids) => ids.slice(1).map((to, i) => ({ from: ids[i], to }));

export const TEMPLATES = [
  {
    id: 'tpl-feature', name: 'Feature: plan → code → test → review',
    description: 'A planner writes the steps, a coder builds them, a tester checks them, a reviewer signs off.',
    nodes: [
      box('start', 'start', 40, 160, { task: 'Describe the feature here' }),
      agentBox('plan', 280, 160, 'Planner', 'Planner', 'Read the code that matters and write a short, numbered implementation plan. Do not change files.'),
      agentBox('code', 520, 160, 'Coder', 'Coder', 'Implement the plan with the smallest change that works. Keep the existing style.'),
      agentBox('test', 760, 160, 'Tester', 'Tester', 'Add or update tests for the change and run them. Report what passed or failed.'),
      agentBox('review', 1000, 160, 'Reviewer', 'Reviewer', 'Review the change for bugs and risks. Do not edit files. List problems, or say it is good to go.'),
      box('end', 'end', 1240, 160),
    ],
    edges: chain('start', 'plan', 'code', 'test', 'review', 'end'),
  },
  {
    id: 'tpl-lead', name: 'Lead delegates: lead → coder, tester, reviewer',
    description: 'A lead splits the task, hands subtasks to its teammates at run time, reads their results, sends fixes back, and finishes when satisfied.',
    nodes: [
      box('start', 'start', 40, 200, { task: 'Describe the task here' }),
      box('lead', 'agent', 280, 200, { name: 'Lead', job: 'Planner', model: '', agentId: '', lead: true, instructions: 'Break the task into subtasks. Send code to Coder, then have Tester run tests and Reviewer check the change. If either finds problems, send them back to Coder. Finish only when tests pass and the review is clean.' }),
      agentBox('code', 560, 60, 'Coder', 'Coder', 'Implement exactly what you are assigned with the smallest change that works.'),
      agentBox('test', 560, 200, 'Tester', 'Tester', 'Run or write tests for what you are assigned. Report pass/fail with the command output.'),
      agentBox('review', 560, 340, 'Reviewer', 'Reviewer', 'Review what you are assigned for bugs and risks. Do not edit files.'),
      box('end', 'end', 820, 200),
    ],
    edges: [...chain('start', 'lead'), { from: 'lead', to: 'code' }, { from: 'lead', to: 'test' }, { from: 'lead', to: 'review' }, ...chain('lead', 'end')],
  },
  {
    id: 'tpl-bugfix', name: 'Bug fix: investigate → fix → verify',
    description: 'Find the root cause first, fix it once, then prove it is fixed.',
    nodes: [
      box('start', 'start', 40, 160, { task: 'Describe the bug: what happens, what should happen' }),
      agentBox('find', 300, 160, 'Investigator', 'Researcher', 'Find the root cause of the bug. Read code, do not edit. Report the file, line and why.'),
      agentBox('fix', 560, 160, 'Fixer', 'Coder', 'Fix the root cause described above in the shared code, not only the symptom.'),
      agentBox('verify', 820, 160, 'Verifier', 'Tester', 'Write a test that would have caught the bug, run it, and confirm the fix.'),
      box('end', 'end', 1080, 160),
    ],
    edges: chain('start', 'find', 'fix', 'verify', 'end'),
  },
  {
    id: 'tpl-parallel', name: 'Parallel: plan → code + docs → review',
    description: 'Code and docs are written at the same time by two ghosts, then reviewed together.',
    nodes: [
      box('start', 'start', 40, 200, { task: 'Describe the change here' }),
      agentBox('plan', 280, 200, 'Planner', 'Planner', 'Write a short plan, split into a code part and a docs part. Do not change files.'),
      agentBox('code', 540, 90, 'Coder', 'Coder', 'Do the code part of the plan.'),
      agentBox('docs', 540, 310, 'Docs', 'Docs', 'Do the docs part of the plan: README and comments that changed meaning.'),
      agentBox('review', 800, 200, 'Reviewer', 'Reviewer', 'Check that code and docs match each other and the plan. Do not edit files.'),
      box('end', 'end', 1060, 200),
    ],
    edges: [...chain('start', 'plan'), { from: 'plan', to: 'code' }, { from: 'plan', to: 'docs' }, { from: 'code', to: 'review' }, { from: 'docs', to: 'review' }, ...chain('review', 'end')],
  },
  {
    id: 'tpl-research', name: 'Research: scout → write brief',
    description: 'One ghost researches the question, another turns it into a short brief.',
    nodes: [
      box('start', 'start', 40, 160, { task: 'What should we find out?' }),
      agentBox('scout', 300, 160, 'Scout', 'Researcher', 'Research the question: the codebase and, if useful, the web. Collect facts with sources.'),
      agentBox('write', 560, 160, 'Writer', 'Docs', 'Turn the findings into a brief of at most 10 bullet points, with sources. Save it as docs/brief.md.'),
      box('end', 'end', 820, 160),
    ],
    edges: chain('start', 'scout', 'write', 'end'),
  },
  {
    // Phases 1-6 of blender_insta's minecraft-short skill. Stops at the vast.ai gate: the user rents
    // the box, then render, sound pass and delivery follow the skill's phases 7-9.
    id: 'tpl-blender-insta', name: 'Blender short: idea → preview → render plan',
    description: 'Run in the blender_insta folder. Idea and rounds, real assets, video.json, preview sheet, render package, vast.ai pick. Ends before anything is rented.',
    nodes: [
      box('start', 'start', 40, 220, { task: 'Video idea, e.g. "Tools vs Netherite Shield": pickaxe → shovel → hoe → final: mace smash' }),
      agentBox('idea', 260, 220, 'Showrunner', 'Planner', `${BI}Phase 1 (idea and format). Read vault/Home.md, vault/User Rules & Tricks.md, vault/Mistakes Log.md, docs/TRACKER.md and .claude/skills/minecraft-short/SKILL.md first. Turn the idea into the round list: an indestructible thing vs escalating attacks, final round breaks it. 30-35 s: hook 0-1.5 s (4x slow-mo payoff + question title), title card 1.5-3 s, rounds of 4.5-5 s with 3 events each, final round with push-in and real 4x slow-mo, ~3 s aftermath, 2 s end card. Pick the next free projects/NN_name. Write the plan (title 3 lines, hook 2, end 3, payoff, each round: title, item, style, attack, power) to projects/NN_name/PLAN.md. Do not build anything yet.`),
      agentBox('assets', 500, 120, 'Asset Hunter', 'Researcher', `${BI}Phase 2 (real assets). For every round in PLAN.md find the real asset it needs: TACZ gun (guns + length in metres), MB-3D item model, Better Combat animation, vanilla particle sprite in shared/mc_client, and the exact sound events in shared/sounds/minecraft/sounds.json or shared/sounds/tacz. Fetch a missing vanilla sound with python3 shared/sounds/fetch.py <event>. Append an "Assets" table (round, asset, path, licence) to PLAN.md. Flag any TACZ gun: CC BY-NC-ND, video cannot be monetized. Never invent an asset when a real one exists.`),
      agentBox('voice', 500, 330, 'Voice Writer', 'Docs', `${BI}Phase 8 prep. Write the ElevenLabs voice-over paragraph for this video into projects/NN_name/voiceover.md: hook question, then the weapon name for each round, "NETHERITE... DESTROYED!" (or the payoff), "Comment what we try next!". Spell numbers out. Add <break time="X.Xs" /> tags (max 3 s) sized to the round gaps. Note the settings: Multilingual v2, Stability 30-35%, Similarity 80%, Style 45%, Speaker Boost on. Do not call any paid API.`),
      agentBox('config', 740, 220, 'Engine Builder', 'Coder', `${BI}Phase 3 (configure, engine v2). Copy a video.json from projects 05-08 into projects/NN_name and fill it from PLAN.md: text (title, hook, end, payoff), stage, tacz guns with len, rounds[] (title, sub '', item, size, grip, tilt, hold, style, attack, power, len, at, final on the payoff round). Then run python3 shared/engine/setup_project.py projects/NN_name. Fix errors at the root. Report what was built.`),
      agentBox('preview', 980, 220, 'Preview Checker', 'Tester', `${BI}Phase 4 (preview, the user's gate). Never render the video locally. If ssh home-server works, run the preview there (Blender in ~/.local/bin, project in ~/blender_insta), else locally with low settings only: cd projects/NN_name && python3 scripts/preview_edit.py (REUSE=1 for title-only changes). Copy the sheet to projects/output/NN_<name>_preview.jpg. Check one tile per second: titles from video.json, Minecraft font flat white with soft shadow, real items in hand, final slow-mo present. List what looks wrong. The user must approve the sheet before the final render.`),
      agentBox('package', 1220, 220, 'Packager', 'Coder', `${BI}Phase 5 (package). cd projects/NN_name && python3 make_package.py to build release/<name>.zip. Test the clean unzip with python3 render_all.py --norender only (no render on this PC). Report the zip path, size and md5sum.`),
      agentBox('vast', 1460, 220, 'Render Planner', 'Researcher', `${BI}Phase 6 (pick the vast.ai box, the money gate). Do not rent anything. From the frame count in events.json, estimate hours and dollars for the render (rendering is CPU-bound: ~2.5 s/frame on a 5090 with 24+ full desktop cores, SLOTS=3). Write the offer checklist for the user: 24+ whole cores, DLPerf near normal (5090 ~199, 4090 ~97-125), reliability >= 97%, 32 GB disk, nvidia-smi 0% at boot, credit = estimate + 20%. Give the exact phase 7 commands (scp zip + vast_go.sh, bash vast_go.sh, render_batch.sh --status) and remind: destroy the instance after download. Update the project's row in docs/TRACKER.md and append today's vault/Log entry.`),
      box('end', 'end', 1700, 220),
    ],
    edges: [...chain('start', 'idea'), { from: 'idea', to: 'assets' }, { from: 'idea', to: 'voice' },
      ...chain('assets', 'config', 'preview', 'package', 'vast', 'end'), { from: 'voice', to: 'end' }],
  },
  {
    // The pipeline the Block Lab shorts were really made with: image-model reference sheet -> Blender
    // build -> 240p Colab preview -> the user's OK -> full Colab render -> delivery. A lead runs the loop
    // (an arrow loop is not allowed), so bad previews go back to the Auditor or the Ref Artist.
    id: 'tpl-video-gen', name: 'Blender video gen: ref sheet → 240p preview → full render',
    description: 'Run in the blender_insta folder. A lead drives a ref-sheet artist, a Blender builder, a Colab 240p preview, your OK in game, then a full render with a watcher. A bad preview goes back for an audit or a new ref sheet.',
    nodes: [
      box('start', 'start', 40, 300, { task: 'Video idea, e.g. "Tools vs Netherite Shield". Vault notes (vault/Home.md) and the minecraft-short skill are the brain.' }),
      box('lead', 'agent', 280, 300, { name: 'Director', job: 'Planner', model: '', agentId: '', lead: true, instructions: `${BI}You run the video from the Obsidian vault in this folder. First have Ref Artist read the vault and make the reference sheet. Then have Blender Builder build the scene from that sheet. Then have Colab Preview render a 240p preview on Google Colab. Then have Review Gate show the preview to the user and ask for the OK. The answer decides: "Render full" means assign Render Watcher; "Fix it" means assign Auditor to list what is wrong, then send those fixes to Blender Builder and run the preview again; "New reference sheet" means assign Ref Artist for a new sheet, then Blender Builder again. Never start the full render without the user's "Render full". At most 3 preview rounds, then stop and report what is blocking. Finish when Render Watcher reports the final MP4 downloaded and the Colab session stopped.` }),
      agentBox('ref', 580, 20, 'Ref Artist', 'Researcher', `${BI}Read vault/Home.md, vault/User Rules & Tricks.md, vault/Mistakes Log.md and docs/TRACKER.md, then the vault note for the video idea. Make the reference sheet with the image model gpt-image-2.5-sunburst (quality high) through projects/course_vibecoders/01_free_hosting/tools/mf_image.py: one sheet with the hero, the props and the look, front and side, plus the background. Send a reference image of at most 768 px and under 1 MB (big uploads drop the connection). Save sheets to projects/NN_name/art/ref_v1.png, ref_v2.png and so on. Never use an old sheet again after the user asks for a new one. Report the paths and what the sheet shows. Costs about $0.065 per image: say how many you made.`),
      agentBox('blender', 580, 140, 'Blender Builder', 'Coder', `${BI}Build the scene in Blender from the newest reference sheet in projects/NN_name/art/, using the Blender MCP. Use the real Minecraft assets from shared/ (models, particles, textures, sounds). Follow the minecraft-short skill for the config (video.json), run python3 shared/engine/setup_project.py projects/NN_name, and keep the project self-contained. Do a one-frame look test first and compare it to the sheet. Never render the video on this PC (MX450): only stills with --pct 30 --samples 16. Never kill the user's Blender. Report what you built and which frames differ from the sheet.`),
      agentBox('colab', 580, 260, 'Colab Preview', 'Tester', `${BI}Make the 240p preview on Google Colab with the colab CLI (~/.local/bin/colab, --auth=oauth2), never on this PC. Zip the bundle (projects/NN_name plus shared/ pieces it needs, shared/sounds/minecraft too). Upload it, then run colab exec -s <session> --timeout 14400 -f driver.py: the driver installs Blender, unzips, renders at 240p (426x240 vertical-safe) and encodes an MP4 with a contact sheet of one frame per second. Time one light and one heavy frame first: 240p is not much cheaper than full when the scene sync is the cost. Keep the exec busy so the runtime is not idle-killed, set a timeout on every job, download the MP4 and sheet to projects/output/ as soon as they exist, and stop the session when you are done. Report the paths, the time and the compute units used.`),
      agentBox('gate', 580, 380, 'Review Gate', 'Reviewer', `${BI}You are the user's gate. Give the user the preview paths (the 240p MP4 and the contact sheet in projects/output/), and say in two lines what you see. Then ask the user with ask_user: question "Preview OK?", options ["Render full", "Fix it", "New reference sheet"]. If they pick Fix it, ask what is wrong. Return their answer word for word. Do not decide for them.`),
      agentBox('audit', 580, 500, 'Auditor', 'Reviewer', `${BI}Audit the preview against the reference sheet and vault/User Rules & Tricks.md and vault/Mistakes Log.md. Run the glitch pass: duplicates, jumps, pop-ins, camera speed, hero colour, titles in the Minecraft font, numbers on screen true, real assets only. Do not edit files. Return a numbered fix list for Blender Builder, each with the frame or second, or say it is good.`),
      agentBox('watch', 580, 620, 'Render Watcher', 'Tester', `${BI}Only after the user's "Render full". Start the full render on Google Colab (G4 GPU, ~10 units/h) with the colab CLI, resumable (use_overwrite = False), OIDN denoise on the GPU, the number of slots you timed on a few frames. Then watch it: check progress every few minutes, and treat the session as gone only after several failed checks in a row. Download each finished piece as it finishes, then colab stop -s <session> (always). Back up the final MP4 off this PC the same day if the user gave a place. Update the project's row in docs/TRACKER.md and append today's vault/Log entry. Report the MP4 path, the time and the units used.`),
      box('end', 'end', 880, 300),
    ],
    edges: [...chain('start', 'lead'), ...['ref', 'blender', 'colab', 'gate', 'audit', 'watch'].map((to) => ({ from: 'lead', to })), { from: 'lead', to: 'end' }],
  },
];

// ---------------------------------------------------------------- lead delegation

const MAX_ROUNDS = 6;
const MAX_ASSIGNS = 4;

/** The last JSON object in a reply (fenced or bare) that passes `ok`, or null. */
function lastJson(text, ok) {
  const t = String(text ?? '');
  const fenced = [...t.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]);
  const bare = t.slice(t.lastIndexOf('{'));
  for (const c of [...fenced.reverse(), bare]) {
    try {
      const o = JSON.parse(c.trim());
      if (o && typeof o === 'object' && ok(o)) return o;
    } catch {
      // not this candidate
    }
  }
  return null;
}

export const parseLeadReply = (text) => lastJson(text, (o) => typeof o.done === 'string' || Array.isArray(o.assign));
/** A teammate asking another teammate: {"ask":[{"to","text"}]}. */
export const parseAsks = (text) => lastJson(text, (o) => Array.isArray(o.ask))?.ask ?? [];

const MAX_ASKS = 3;
/** A teammate using the shared database: {"data":{"op":"query"|"execute","sql":"...","params":[]}}. */
/** A teammate calling a bridge tool: {"tool":"<name>","args":{...}}. */
export const parseTool = (text) => lastJson(text, (o) => typeof o.tool === 'string');
export const parseData = (text) => lastJson(text, (o) => o.data && typeof o.data === 'object')?.data ?? null;

// ---------------------------------------------------------------- store + runner

export function createWorkflows({ root, agents, broadcast = () => {}, log = console, history = null, worktrees = null }) {
  const wtPaths = new Map(); // run id -> worktree folder its ghosts work in
  const cwdFor = (run) => (wtPaths.has(run.id) ? { cwd: wtPaths.get(run.id) } : {});
  const file = root ? join(resolve(root), '.haunted-crew', 'workflows.json') : null;
  let data = { workflows: [], agents: [] };
  if (file) {
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      data = { workflows: Array.isArray(saved.workflows) ? saved.workflows : [], agents: Array.isArray(saved.agents) ? saved.agents : [] };
    } catch (err) {
      if (err.code !== 'ENOENT') log.warn?.('[workflows] cannot read', file, err.message);
    }
  }
  const store = createRunStore({ root: root || undefined });
  const runs = store.load(); // newest first; runs that were live at shutdown come back as 'interrupted'
  const mailbox = createMailbox({ root: root || undefined });
  const memory = createMemory({ root: root || undefined });
  const sharedData = createSharedData({ root: root || undefined });

  function this_saveAgent(a) {
    const agent = cleanAgent(a);
    const i = data.agents.findIndex((x) => x.id === agent.id);
    if (i >= 0) data.agents[i] = agent;
    else data.agents.push(agent);
    save();
    return agent;
  }

  function save() {
    if (!file) return;
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file + '.tmp', JSON.stringify(data, null, 2));
    renameSync(file + '.tmp', file);
  }

  const publicRun = (r) => ({ ...r, steps: Object.fromEntries(Object.entries(r.steps).map(([k, v]) => [k, { ...v }])) });
  // shortcut: saves the whole run store on every step change, upgrade to a debounce if runs get big
  const changed = (r) => {
    try { store.save(publicRun(r)); } catch (err) { log.warn?.('[workflows] cannot save run:', err.message); }
    broadcast({ type: 'workflow_run', run: publicRun(r) });
  };

  function promptFor(wf, node, task, inputs) {
    const custom = node.data.agentId ? data.agents.find((a) => a.id === node.data.agentId) : null;
    const instructions = [custom?.instructions, node.data.instructions].filter(Boolean).join('\n\n');
    const earlier = inputs.filter((i) => i.text).map((i) => `## ${i.name}\n${i.text}`).join('\n\n');
    return [
      `You are "${node.data.name}", one step of the workflow "${wf.name}" (a team of AI agents shown as ghosts in Minecraft).`,
      instructions && `Your instructions:\n${instructions}`,
      `The task:\n${task || '(no task given)'}`,
      earlier && `Results from the steps before you:\n${earlier}`,
      'Do your part only. End with a short summary of what you did and found: it is handed to the next step.',
    ].filter(Boolean).join('\n\n').slice(0, 16_000);
  }

  /** A lead box and the agent boxes it points at: the lead hands them subtasks at run time. */
  function teamOf(wf, lead) {
    return wf.edges.filter((e) => e.from === lead.id).map((e) => wf.nodes.find((n) => n.id === e.to)).filter((n) => n?.type === 'agent');
  }

  async function lead(run, wf, node, task, inputs, changed, leadGhost) {
    const team = teamOf(wf, node);
    const ghosts = new Map([[node.id, leadGhost.session]]); // box id -> ghost session
    const member = (name) => team.find((m) => m.data.name.toLowerCase() === String(name).trim().toLowerCase());
    const ask = async (m, prompt) => {
      if (m === node) return agents.run(leadGhost.session, prompt); // the lead's own step is tracked by the caller
      const s = run.steps[m.id];
      s.status = 'running'; s.startedAt = Date.now(); delete s.endedAt; changed(run);
      try {
        if (!ghosts.has(m.id)) {
          const custom = m.data.agentId ? data.agents.find((a) => a.id === m.data.agentId) : null;
          const g = await agents.create(m.data.name, m.data.model || custom?.model || undefined, cwdFor(run));
          ghosts.set(m.id, g.session); s.ghost = g.session; s.model = g.model;
        }
        const text = await agents.run(ghosts.get(m.id), prompt);
        Object.assign(s, { status: 'done', endedAt: Date.now(), output: text.slice(0, 4000) });
        return text;
      } catch (err) {
        Object.assign(s, { status: 'failed', endedAt: Date.now(), error: String(err.message).slice(0, 200) });
        return `(failed: ${err.message})`;
      } finally {
        changed(run);
      }
    };
    // A teammate may message another teammate (OpenBot-style send_message). The recipient gets the
    // message with a fixed reply format and cannot ask anyone itself (nesting lock), so chains stay short.
    const runTool = (me, name, args, members) => {
      try {
        switch (name) {
          case 'list_agents': return JSON.stringify(members.map((t) => ({ name: t.data.name, job: t.data.job })));
          case 'forget_memory': return JSON.stringify({ ok: memory.forget(me, String(args.id)) });
          case 'search_memories': return JSON.stringify(memory.search(me, String(args.query ?? ''), { limit: 5 }));
          case 'list_tables': return JSON.stringify(sharedData.tables());
          case 'delete_table': return JSON.stringify(sharedData.deleteTable(me, String(args.name)));
          case 'history_search': return JSON.stringify(history ? history.search(String(args.query ?? ''), { limit: 5 }) : []).slice(0, 3000);
          case 'history_read': return JSON.stringify(history?.read(String(args.id)) ?? null).slice(0, 3000);
          case 'create_agent': return JSON.stringify(this_saveAgent({ name: args.name, job: args.job, instructions: args.instructions, source: 'prompt' }));
          default: return `unknown tool "${name}". Tools: list_agents, forget_memory, search_memories, list_tables, delete_table, history_search, history_read, create_agent.`;
        }
      } catch (err) { return `error: ${err.message}`; }
    };
    const converse = async (m, prompt) => {
      const me = m.data.name;
      for (let i = 0; i < MAX_ASKS; i++) {
        const reply = await ask(m, prompt);
        for (const e of extractMemories(reply)) {
          try { memory.remember(me, e.text, e.tags); } catch { /* bad memory line: ignore */ }
        }
        const asks = parseAsks(reply).slice(0, MAX_ASSIGNS);
        const op = parseData(reply);
        const tool = parseTool(reply);
        const q = typeof agents.askUser === 'function' ? lastJson(reply, (o) => o.ask_user && typeof o.ask_user === 'object')?.ask_user : null;
        if ((!asks.length && !op && !q && !tool) || run.status !== 'running') return reply;
        const parts = await Promise.all(asks.map(async (a) => {
          const to = member(a?.to);
          if (!to || to === m) return `## ${a?.to}\nNo such teammate. Teammates: ${team.filter((t) => t !== m).map((t) => t.data.name).join(', ')}.`;
          let sent;
          try { sent = mailbox.send({ from: me, to: [to.data.name], text: String(a.text ?? '').slice(0, MAX_TEXT) || '(empty)' }); } catch (err) { return `## ${a.to}\nNot sent: ${err.message}`; }
          const out = await ask(to, mailbox.wrapper(sent.deliveries[0].id) + '\nDo not ask anyone else.');
          mailbox.markRead(sent.deliveries[0].id);
          try { mailbox.send({ from: to.data.name, to: [me], text: out.slice(0, MAX_TEXT) || '(empty)', replyTo: sent.id, expectsReply: false }); } catch { /* reply too long or empty: still returned below */ }
          return `## ${to.data.name} (reply to ${sent.id})\n${out}`;
        }));
        if (op) {
          let res;
          try {
            res = op.op === 'execute' ? sharedData.execute(me, String(op.sql), op.params ?? []) : sharedData.query(me, String(op.sql), op.params ?? []);
          } catch (err) { res = { error: err.message }; }
          parts.push(`## shared database (${op.op === 'execute' ? 'execute' : 'query'})\n${JSON.stringify(res).slice(0, 3000)}`);
        }
        if (tool) parts.push(`## tool ${tool.tool}\n${runTool(me, tool.tool, tool.args ?? {}, team)}`);
        if (q) {
          const answer = await agents.askUser(ghosts.get(m.id), String(q.question ?? 'Question'), q.options).catch(() => null);
          parts.push(`## the user answered\n${answer ?? '(no answer; decide yourself)'}`);
        }
        prompt = `Replies:\n\n${parts.join('\n\n')}\n\nContinue your assignment, then give your final result.`.slice(0, 16_000);
      }
      return ask(m, `${prompt}\n\nNo more messages allowed. Give your final result now.`);
    };

    const roster = team.map((m) => {
      const c = m.data.agentId ? data.agents.find((a) => a.id === m.data.agentId) : null;
      const what = [m.data.job, c?.description || m.data.instructions].filter(Boolean).join(': ').slice(0, 200);
      return `- ${m.data.name} (${what})`;
    }).join('\n');
    const head = promptFor(wf, node, task, inputs);
    const protocol = [
      `You are the LEAD of a team. Your teammates:\n${roster || '(none: do the work yourself)'}`,
      'You do not do the teammates\' jobs. Split the task, assign subtasks, read their results, then fix gaps or finish.',
      'End EVERY reply with exactly one JSON block, and nothing after it:',
      '```json\n{"assign":[{"to":"<teammate name>","task":"<what to do, with every detail they need>"}]}\n```',
      `to hand out work (at most ${MAX_ASSIGNS} at once, they run in parallel), or`,
      '```json\n{"done":"<final answer for the user>"}\n```',
      'when the task is finished. Teammates cannot see each other; put what they need in the task.',
    ].join('\n');
    let prompt = `${head}\n\n${protocol}`;
    let final = '';
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      const reply = await ask(node, prompt);
      const move = parseLeadReply(reply);
      if (!move) {
        if (round === MAX_ROUNDS) { final = reply; break; }
        prompt = 'Your last reply had no valid JSON block. Reply again, ending with {"assign":[...]} or {"done":"..."} in a ```json block.';
        continue;
      }
      if (typeof move.done === 'string') { final = move.done; break; }
      if (run.status !== 'running') throw new Error('stopped');
      const jobs = move.assign.slice(0, MAX_ASSIGNS);
      const results = await Promise.all(jobs.map(async (j) => {
        const m = member(j?.to);
        if (!m) return `## ${j?.to}\nNo such teammate. Teammates: ${team.map((t) => t.data.name).join(', ')}.`;
        const custom = m.data.agentId ? data.agents.find((a) => a.id === m.data.agentId) : null;
        const ins = [custom?.instructions, m.data.instructions].filter(Boolean).join('\n\n');
        const out = await converse(m, [
          `You are "${m.data.name}", a teammate of the lead "${node.data.name}" in the workflow "${wf.name}".`,
          ins && `Your instructions:\n${ins}`,
          memory.prelude(m.data.name, String(j.task ?? '')),
          `Overall task:\n${task || '(none)'}`,
          `Your assignment:\n${String(j.task ?? '').slice(0, MAX_TEXT)}`,
          'Do only this assignment. To get help from another teammate, end your reply with a ```json block {"ask":[{"to":"<teammate>","text":"<request with every detail>"}]} and wait for the answer.',
          'If your tools include a "crew" server (send_message, query_data, remember, ask_user...), call those tools directly and ignore the JSON blocks below. Otherwise: tools (end your reply with ```json {"tool":"<name>","args":{...}}): list_agents, forget_memory {id}, search_memories {query}, list_tables, delete_table {name}, history_search {query}, history_read {id}, create_agent {name,job,instructions}. To ask the human a question, end your reply with ```json {"ask_user":{"question":"...","options":["A","B"]}} and wait. To remember something for next time, put a line `REMEMBER: [tag1,tag2] fact` in your reply. Shared database (tables you create are yours; others cannot drop them): end your reply with a ```json block {"data":{"op":"query"|"execute","sql":"...","params":[]}} and wait for the answer. Put big data in the database, not in messages. Your final result is three lines:\nStatus: done | partial | blocked\nResult: <concrete outcome>\nEvidence: <file, test, command, or none>',
        ].filter(Boolean).join('\n\n').slice(0, 16_000));
        return `## ${m.data.name}\n${out}`;
      }));
      prompt = `Results from your teammates:\n\n${results.join('\n\n')}\n\nDecide: assign more work, or finish. End with the JSON block.`.slice(0, 16_000);
      if (round === MAX_ROUNDS) final = results.join('\n\n');
    }
    return final;
  }

  async function execute(run, wf, task) {
    if (worktrees) {
      try {
        wtPaths.set(run.id, (await worktrees.create(run.id)).path); // agents work on their own branch until you approve the merge
      } catch (err) {
        log.warn?.('[workflows] no worktree, agents work in the project:', err.message);
      }
    }
    const byId = new Map(wf.nodes.map((n) => [n.id, n]));
    // Boxes a lead points at are run by the lead, not by the arrows.
    const managed = new Map();
    for (const n of wf.nodes) if (n.type === 'agent' && n.data.lead) for (const m of teamOf(wf, n)) managed.set(m.id, n.id);
    const promises = new Map();
    const step = (id) => {
      if (promises.has(id)) return promises.get(id);
      const p = (async () => {
        const ups = wf.edges.filter((e) => e.to === id).map((e) => e.from);
        if (managed.has(id)) { // finished with its lead; its steps were filled in during the lead's run
          await step(managed.get(id));
          const s = run.steps[id];
          if (s.status === 'waiting') s.status = 'done';
          return { name: byId.get(id).data.name, type: 'agent', text: '' };
        }
        const inputs = await Promise.all(ups.map(step));
        if (run.status !== 'running') throw new Error('stopped');
        const node = byId.get(id);
        const s = run.steps[id];
        s.status = 'running';
        s.startedAt = Date.now();
        changed(run);
        let text = '';
        if (node.type === 'start') text = task;
        else if (node.type === 'end') text = inputs.map((i) => i.text).filter(Boolean).join('\n\n');
        else {
          const custom = node.data.agentId ? data.agents.find((a) => a.id === node.data.agentId) : null;
          const ghost = await agents.create(node.data.name, node.data.model || custom?.model || undefined, cwdFor(run));
          s.ghost = ghost.session;
          s.model = ghost.model;
          changed(run);
          text = node.data.lead
            ? await lead(run, wf, node, task, inputs.filter((i) => i.type !== 'start'), changed, ghost)
            : await agents.run(ghost.session, promptFor(wf, node, task, inputs.filter((i) => i.type !== 'start')));
        }
        s.status = 'done';
        s.endedAt = Date.now();
        s.output = text.slice(0, 4000);
        changed(run);
        return { name: node.type === 'agent' ? node.data.name : node.type, type: node.type, text };
      })().catch((err) => {
        const s = run.steps[id];
        if (s.status !== 'done') Object.assign(s, { status: 'failed', endedAt: Date.now(), error: String(err.message).slice(0, 200) });
        throw err;
      });
      promises.set(id, p);
      return p;
    };
    let outcome;
    try {
      const ends = wf.nodes.filter((n) => !wf.edges.some((e) => e.from === n.id));
      const results = await Promise.all(ends.map((n) => step(n.id)));
      run.output = results.map((r) => r.text).filter(Boolean).join('\n\n').slice(0, 8000);
      outcome = 'done';
    } catch (err) {
      outcome = run.status === 'stopped' ? 'stopped' : 'failed';
      run.error = String(err.message).slice(0, 200);
    }
    run.endedAt = Date.now();
    await proposeMerge(run, wf.name); // before the final status, so a finished run already shows its merge
    run.status = outcome;
    changed(run);
  }

  // The run's work sits on a branch. If it changed anything, it waits for approval in the game or dashboard.
  async function proposeMerge(run, name) {
    if (!wtPaths.has(run.id)) return;
    try {
      const sum = await worktrees.finish(run.id, `Haunted Crew: ${name}`.slice(0, 100));
      if (sum) run.merge = { ...sum, status: 'pending' };
      else { await worktrees.discard(run.id); wtPaths.delete(run.id); }
    } catch (err) {
      run.merge = { status: 'failed', error: String(err.message).slice(0, 200) };
    }
  }

  const pendingRun = (runId) => {
    const run = runs.find((r) => r.id === runId);
    if (!run?.merge || !['pending', 'conflict'].includes(run.merge.status)) throw new AgentError(404, 'no merge waiting for approval on that run');
    return run;
  };

  // A fresh ghost works in the run's worktree to fix a conflict or apply review feedback, then it is proposed again.
  async function revise(run, prompt, label) {
    const base = run.merge.base;
    run.merge = { ...run.merge, status: 'revising' };
    changed(run);
    try {
      const g = await agents.create(label, undefined, cwdFor(run));
      await agents.run(g.session, prompt.replace('<base>', base));
      const sum = await worktrees.finish(run.id, `Haunted Crew: ${label}`);
      run.merge = sum ? { ...sum, status: 'pending', note: `${label} finished: review again` } : { ...run.merge, status: 'conflict', note: `${label} changed nothing` };
    } catch (err) {
      run.merge = { ...run.merge, status: 'conflict', note: `${label} failed: ${String(err.message).slice(0, 120)}` };
    }
    changed(run);
  }

  /** SKILL.md files in the project (.kiro/skills, skills, .claude/skills), so the game can offer them. */
  function skills() {
    if (!root) return [];
    const out = [];
    for (const dir of ['.kiro/skills', 'skills', '.claude/skills']) {
      const base = join(resolve(root), dir);
      if (!existsSync(base)) continue;
      for (const name of readdirSync(base).slice(0, 50)) {
        const f = join(base, name, 'SKILL.md');
        try {
          if (!statSync(f).isFile() || statSync(f).size > 64 * 1024) continue;
          const parsed = parseSkill(readFileSync(f, 'utf8'));
          out.push({ path: `${dir}/${name}/SKILL.md`, name: parsed.name || name, description: parsed.description, text: readFileSync(f, 'utf8').slice(0, MAX_TEXT) });
        } catch {
          // not a skill folder
        }
        if (out.length >= 30) return out;
      }
    }
    return out;
  }

  return {
    skills,
    stores: { mailbox, memory, sharedData },
    list: () => ({ workflows: data.workflows, agents: data.agents, templates: TEMPLATES, runs: runs.map(publicRun) }),

    saveWorkflow(w) {
      const wf = cleanWorkflow(w);
      const i = data.workflows.findIndex((x) => x.id === wf.id);
      if (i >= 0) data.workflows[i] = wf;
      else data.workflows.push(wf);
      save();
      return wf;
    },

    deleteWorkflow(id) {
      data.workflows = data.workflows.filter((w) => w.id !== id);
      save();
      return { ok: true };
    },

    saveAgent: (a) => this_saveAgent(a),

    deleteAgent(id) {
      data.agents = data.agents.filter((a) => a.id !== id);
      save();
      return { ok: true };
    },

    /** Starts a run of a saved workflow (or a template, by its id). Returns at once. */
    run(id, task) {
      if (!agents) throw new AgentError(503, 'agent runner disabled');
      const wf = data.workflows.find((w) => w.id === id) ?? TEMPLATES.find((t) => t.id === id);
      if (!wf) throw new AgentError(404, 'no such workflow');
      if (!wf.nodes.some((n) => n.type === 'agent')) throw new AgentError(400, 'add at least one agent box');
      if (runs.filter((r) => r.status === 'running').length >= 5) throw new AgentError(429, 'five workflows are already running');
      const startTask = typeof task === 'string' && task.trim() ? task.slice(0, MAX_TEXT) : (wf.nodes.find((n) => n.type === 'start')?.data.task ?? '');
      const run = {
        id: randomUUID(), workflowId: wf.id, name: wf.name, status: 'running', startedAt: Date.now(), task: startTask,
        steps: Object.fromEntries(wf.nodes.map((n) => [n.id, { status: 'waiting' }])),
      };
      runs.unshift(run);
      runs.length = Math.min(runs.length, MAX_RUNS);
      changed(run);
      execute(run, wf, startTask);
      return publicRun(run);
    },

    stop(runId) {
      const run = runs.find((r) => r.id === runId);
      if (!run) throw new AgentError(404, 'no such run');
      if (run.status === 'running') run.status = 'stopped'; // steps already working finish; no new steps start
      changed(run);
      return publicRun(run);
    },

    /** Runs whose work waits for approval. */
    merges: () => runs.filter((r) => r.merge && ['pending', 'conflict', 'revising'].includes(r.merge.status)).map((r) => ({ runId: r.id, name: r.name, ...r.merge })),

    async mergeDiff(runId) {
      pendingRun(runId);
      return (await worktrees.diff(runId)).slice(0, 200_000);
    },

    /** option: "Merge" | "Reject" | "Request changes" (with text). */
    async answerMerge(runId, option, text) {
      if (!worktrees) throw new AgentError(503, 'worktrees are off (start the bridge with --worktrees)');
      const run = pendingRun(runId);
      if (option === 'Reject') {
        await worktrees.discard(runId);
        wtPaths.delete(runId);
        run.merge = { ...run.merge, status: 'rejected' };
        changed(run);
        return { status: 'rejected' };
      }
      if (option === 'Request changes') {
        const note = String(text ?? '').trim().slice(0, 2000);
        if (!note) throw new AgentError(400, 'say what should change');
        revise(run, `Review feedback on the work in this folder:\n${note}\n\nMake the changes in this folder. Do not push.`, 'Reviser');
        return { status: 'revising' };
      }
      if (option !== 'Merge') throw new AgentError(400, 'option must be Merge, Reject or Request changes');
      try {
        const done = await worktrees.merge(runId, `Haunted Crew: ${run.name}`);
        wtPaths.delete(runId);
        run.merge = { ...run.merge, status: 'merged', sha: done.sha };
        changed(run);
        return { status: 'merged', sha: done.sha };
      } catch (err) {
        if (!(err instanceof MergeError)) throw err;
        if (err.code === 'conflict') {
          // Parallel work touched the same lines: the worktree merges the base into its branch and fixes it.
          revise(run, `Your branch conflicts with <base> in: ${err.files.join(', ')}.\nIn this folder run: git merge <base>\nResolve every conflict (keep both sides' intent), then git add and git commit. Do not push.`, 'Resolver');
          return { status: 'revising', reason: err.message };
        }
        throw new AgentError(409, err.message);
      }
    },

    getRun: (runId) => {
      const r = runs.find((x) => x.id === runId);
      return r ? publicRun(r) : null;
    },
  };
}
