import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AgentError } from './agents.mjs';

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
          agentId: ID_RE.test(d.agentId ?? '') ? d.agentId : '', instructions: str(d.instructions, MAX_TEXT) }
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
    id: 'tpl-blender-insta', name: 'blender_insta: Minecraft short (idea → preview → render plan)',
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
];

// ---------------------------------------------------------------- store + runner

export function createWorkflows({ root, agents, broadcast = () => {}, log = console }) {
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
  const runs = []; // newest first

  function save() {
    if (!file) return;
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file + '.tmp', JSON.stringify(data, null, 2));
    renameSync(file + '.tmp', file);
  }

  const publicRun = (r) => ({ ...r, steps: Object.fromEntries(Object.entries(r.steps).map(([k, v]) => [k, { ...v }])) });
  const changed = (r) => broadcast({ type: 'workflow_run', run: publicRun(r) });

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

  async function execute(run, wf, task) {
    const byId = new Map(wf.nodes.map((n) => [n.id, n]));
    const promises = new Map();
    const step = (id) => {
      if (promises.has(id)) return promises.get(id);
      const p = (async () => {
        const ups = wf.edges.filter((e) => e.to === id).map((e) => e.from);
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
          const ghost = await agents.create(node.data.name, node.data.model || custom?.model || undefined);
          s.ghost = ghost.session;
          s.model = ghost.model;
          changed(run);
          text = await agents.run(ghost.session, promptFor(wf, node, task, inputs.filter((i) => i.type !== 'start')));
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
    try {
      const ends = wf.nodes.filter((n) => !wf.edges.some((e) => e.from === n.id));
      const results = await Promise.all(ends.map((n) => step(n.id)));
      run.output = results.map((r) => r.text).filter(Boolean).join('\n\n').slice(0, 8000);
      run.status = 'done';
    } catch (err) {
      run.status = run.status === 'stopped' ? 'stopped' : 'failed';
      run.error = String(err.message).slice(0, 200);
    }
    run.endedAt = Date.now();
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

    saveAgent(a) {
      const agent = cleanAgent(a);
      const i = data.agents.findIndex((x) => x.id === agent.id);
      if (i >= 0) data.agents[i] = agent;
      else data.agents.push(agent);
      save();
      return agent;
    },

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

    getRun: (runId) => {
      const r = runs.find((x) => x.id === runId);
      return r ? publicRun(r) : null;
    },
  };
}
