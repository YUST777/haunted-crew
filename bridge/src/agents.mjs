import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { AcpConnection } from './acp.mjs';
import { clean, safePath } from './normalize.mjs';

// Runs Kiro agents started from the Minecraft console through `kiro-cli acp` and turns their
// ACP updates into bridge events, so they animate like hook-reported agents. Unlike hook events,
// these carry short text (your prompt, the agent's reply, permission questions): they are the console.
//
// Speed: kiro-cli answers prompts from many sessions in parallel, but creates sessions one at a
// time (~4-5 s each, it starts the user's MCP servers). So agents are spread over a small pool of
// kiro-cli processes, and each process keeps one spare session ready: summoning is near-instant.

const KIND_TO_CATEGORY = {
  read: 'read', search: 'read', edit: 'write', delete: 'write', move: 'write',
  execute: 'shell', fetch: 'web', think: 'other', other: 'other',
};
const MAX_REPLY = 1500;
const MAX_THOUGHT = 1200;
const DRAFT_MS = 250;
const NAME_RE = /^[\w .-]{1,40}$/;
const MODEL_RE = /^[\w.:-]{1,64}$/;
export const MAX_AGENTS = 70;
// Cheap (0.06x credits) and fast: a good default for a crew of many ghosts.
/**
 * Agents never push with the user's credentials: network git protocols are off and every push URL is
 * rewritten to a dead one (AgentCraft's sandbox). Local git (status, diff, commit, branch) still works.
 * Set HAUNTED_CREW_ALLOW_GIT_NETWORK=1 to let agents fetch and push.
 */
export function agentEnv(env = process.env) {
  if (env.HAUNTED_CREW_ALLOW_GIT_NETWORK === '1') return env;
  const start = Math.max(0, Number(env.GIT_CONFIG_COUNT) || 0); // keep the user's own GIT_CONFIG_* entries
  const off = 'haunted-crew-signing-disabled';
  const pairs = [
    ['protocol.allow', 'never'],
    ['url.haunted-crew-push-blocked:///.pushInsteadOf', ''],
    ['commit.gpgsign', 'false'], ['tag.gpgsign', 'false'],
    ['gpg.program', off], ['gpg.ssh.program', off], ['gpg.x509.program', off],
  ];
  const out = { ...env, GIT_ALLOW_PROTOCOL: 'haunted-crew-none', GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_CONFIG_COUNT: String(start + pairs.length) };
  pairs.forEach(([k, v], i) => { out[`GIT_CONFIG_KEY_${start + i}`] = k; out[`GIT_CONFIG_VALUE_${start + i}`] = v; });
  return out;
}

import { crewBriefing } from './briefing.mjs';

export const DEFAULT_MODEL = 'claude-haiku-5.5';

export class AgentError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Agent replies keep their line breaks (markdown); other control characters go.
const replyText = (s, max = MAX_REPLY) => {
  const t = s.replace(/\r/g, '').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
};

// AgentMessageChunk -> agent_message_chunk (Kiro CLI v2 notification names vs the ACP spec).
const snake = (s) => String(s ?? '').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

// sessionTimeoutMs is generous: kiro-cli starts the user's MCP servers before answering session/new.
export function createAgentManager({
  command, args = ['acp'], cwd, emit, log = console, permissionTimeoutMs = 10 * 60_000, initTimeoutMs = 30_000, sessionTimeoutMs = 120_000,
  processes = Number(process.env.HAUNTED_CREW_AGENT_PROCS) || 4, maxAgents = MAX_AGENTS, model = process.env.HAUNTED_CREW_MODEL || DEFAULT_MODEL,
  // Crew tools over MCP: a function returning the bridge URL once it is listening (or null); off with HAUNTED_CREW_MCP=0.
  mcpUrl = null,
}) {
  const crewMcp = fileURLToPath(new URL('../bin/crew-mcp.mjs', import.meta.url));
  const tokens = new Map(); // tool token -> session id (set once the agent is named)
  const defaultModel = model;
  // Sessions start on the default model, so only other picks need a session/set_model round trip
  // (which queues behind any session/new in that process).
  const procArgs = args.includes('--model') || !MODEL_RE.test(defaultModel) ? args : [...args, '--model', defaultModel];
  const workers = Array.from({ length: Math.max(1, processes) }, () => ({ conn: null, ready: null, spare: null, sessions: 0, lastError: '' }));
  const agents = new Map(); // sessionId -> { name, model, worker, busy, queue, reply, thought, permission, tools, draftTimer }
  const permissions = new Map(); // requestId -> { rpcId, worker, session, timer, options }
  let models = null; // [{ id, name, description }] as kiro-cli reports them
  let creating = 0;

  const event = (session, kind, extra = {}) => {
    const a = agents.get(session);
    if (kind === 'message' && a?.said && extra.text) a.said.push(extra.text);
    emit({ id: randomUUID(), ts: Date.now(), kind, session, agent: a?.name, console: true, ...extra });
  };

  function connect(w) {
    if (w.ready) return w.ready;
    const conn = new AcpConnection({ command, args: procArgs, cwd, env: agentEnv() });
    w.conn = conn;
    conn.on('update', onUpdate);
    conn.on('permission', (p) => onPermission(w, p));
    conn.on('stderr', (line) => {
      if (line.trim()) w.lastError = line.trim();
      log.warn?.('[agents]', line);
    });
    conn.on('exit', (code) => {
      if (w.conn !== conn) return;
      log.warn?.(`[agents] kiro-cli exited (${code}); its console agents ended`);
      for (const [session, a] of agents) {
        if (a.worker !== w) continue;
        event(session, 'session_end');
        for (const q of a.queue) q.done?.reject(new AgentError(502, 'kiro-cli exited'));
        clearTimeout(a.draftTimer);
        agents.delete(session);
        for (const [t, id] of tokens) if (id === session) tokens.delete(t);
      }
      for (const [id, p] of permissions) {
        if (p.worker !== w) continue;
        clearTimeout(p.timer);
        permissions.delete(id);
      }
      Object.assign(w, { conn: null, ready: null, spare: null, sessions: 0 });
    });
    w.ready = conn
      .request('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } }, initTimeoutMs)
      .catch((err) => {
        conn.close();
        Object.assign(w, { conn: null, ready: null, spare: null });
        const why = w.lastError.replace(/^error:\s*/i, '') || `${err.message}. Is it installed and logged in (kiro-cli login)?`;
        throw new AgentError(502, `Kiro: ${clean(why, 160)}`);
      });
    return w.ready;
  }

  async function newSession(w, sessionCwd = cwd) {
    await connect(w);
    let res;
    let mcpToken = null;
    try {
      const url = process.env.HAUNTED_CREW_MCP === '0' ? null : mcpUrl?.();
      mcpToken = url ? randomUUID() : null;
      const mcpServers = url ? [{ name: 'crew', command: process.execPath, args: [crewMcp], env: [{ name: 'HC_BRIDGE_URL', value: url }, { name: 'HC_TOKEN', value: mcpToken }] }] : [];
      res = await w.conn.request('session/new', { cwd: sessionCwd, mcpServers }, sessionTimeoutMs);
    } catch (err) {
      // Typically "authentication required" when kiro-cli is signed out.
      throw new AgentError(502, `Kiro could not start an agent: ${clean(err.message, 160)}`);
    }
    if (typeof res?.sessionId !== 'string') throw new AgentError(502, 'kiro-cli returned no session id');
    const list = res.models?.availableModels;
    if (Array.isArray(list) && !models) {
      models = list.slice(0, 40).map((m) => ({ id: clean(m.modelId, 64), name: clean(m.name, 64), description: clean(m.description, 120) })).filter((m) => m.id);
    }
    return { session: res.sessionId, model: clean(res.models?.currentModelId, 64) ?? null, worker: w, token: mcpToken };
  }

  // Keep one ready session per process, as long as the crew has room for it.
  function refill(w) {
    if (w.spare || agents.size + creating >= maxAgents) return;
    const spare = newSession(w).catch((err) => {
      log.warn?.('[agents] could not prepare a spare session:', err.message);
      return null;
    });
    w.spare = spare;
    spare.then((s) => {
      if (!s && w.spare === spare) w.spare = null;
    });
  }

  function onUpdate({ sessionId, update }) {
    const a = agents.get(sessionId);
    if (!a || !update) return;
    const type = snake(update.sessionUpdate ?? update.type);
    if (type === 'tool_call') {
      flushThought(sessionId, a);
      // Text the agent said before this tool call is its own chat bubble ("let me read math.js").
      if (a.reply.trim()) {
        event(sessionId, 'message', { text: replyText(a.reply) });
        a.reply = '';
      }
      if (update.toolCallId) a.tools.set(update.toolCallId, update.title);
      event(sessionId, 'tool_start', {
        tool: clean(update.title, 64),
        category: KIND_TO_CATEGORY[update.kind] ?? 'other',
        file: safePath(update.locations?.[0]?.path, a.cwd ?? cwd),
      });
    } else if (type === 'tool_call_update' && (update.status === 'completed' || update.status === 'failed')) {
      // Updates usually omit the title; reuse the one from the matching tool_call.
      const title = update.title ?? a.tools.get(update.toolCallId);
      a.tools.delete(update.toolCallId);
      event(sessionId, 'tool_end', { tool: clean(title, 64), ok: update.status === 'completed' });
    } else if (type === 'agent_message_chunk') {
      flushThought(sessionId, a);
      const text = update.content?.text;
      if (typeof text === 'string' && a.reply.length < MAX_REPLY * 2) {
        a.reply += text;
        draft(sessionId, a);
      }
    } else if (type === 'agent_thought_chunk') {
      const text = update.content?.text;
      if (typeof text === 'string' && a.thought.length < MAX_THOUGHT * 2) {
        a.thought += text;
        draft(sessionId, a);
      }
    }
  }

  // Streams the reply / thinking so far (throttled); the console shows it as a live bubble.
  function draft(sessionId, a) {
    if (a.draftTimer) return;
    a.draftTimer = setTimeout(() => {
      a.draftTimer = null;
      if (!agents.has(sessionId)) return;
      const text = a.reply.trim() ? replyText(a.reply) : undefined;
      const thinking = a.thought.trim() ? replyText(a.thought, MAX_THOUGHT) : undefined;
      if (text || thinking) event(sessionId, 'draft', { text, thinking });
    }, DRAFT_MS);
  }

  // Finished thinking becomes a feed line, shown inside the "Thought for Ns" block.
  function flushThought(sessionId, a) {
    if (!a.thought.trim()) return;
    event(sessionId, 'thought', { text: replyText(a.thought, MAX_THOUGHT) });
    a.thought = '';
  }

  function onPermission(w, { id, sessionId, toolCall, options }) {
    const a = agents.get(sessionId);
    if (!a) return w.conn?.respond(id, { outcome: { outcome: 'cancelled' } });
    const requestId = randomUUID();
    const opts = (Array.isArray(options) ? options : []).slice(0, 4).map((o) => ({
      id: clean(o.optionId, 64), name: clean(o.name, 40), kind: clean(o.kind, 20),
    }));
    const timer = setTimeout(() => resolvePermission(requestId, null, 'timed out'), permissionTimeoutMs);
    timer.unref?.();
    permissions.set(requestId, { rpcId: id, worker: w, session: sessionId, timer, options: opts });
    a.permission = requestId;
    event(sessionId, 'permission', { request: { id: requestId, title: clean(toolCall?.title, 120) ?? 'Run a tool', options: opts } });
  }

  function resolvePermission(requestId, optionId, why) {
    const p = permissions.get(requestId);
    if (!p) throw new AgentError(404, 'no such permission request');
    if (optionId !== null && !p.options.some((o) => o.id === optionId)) throw new AgentError(400, 'unknown option');
    permissions.delete(requestId);
    clearTimeout(p.timer);
    if (p.resolve) p.resolve(optionId === null ? null : p.options.find((o) => o.id === optionId)?.name ?? null);
    else p.worker.conn?.respond(p.rpcId, optionId === null ? { outcome: { outcome: 'cancelled' } } : { outcome: { outcome: 'selected', optionId } });
    const a = agents.get(p.session);
    if (a) a.permission = undefined;
    const chosen = p.options.find((o) => o.id === optionId);
    const rejected = optionId === null || /reject|deny/i.test(`${chosen?.kind ?? ''} ${chosen?.id ?? ''}`);
    event(p.session, 'permission_resolved', { text: optionId === null ? (why ?? 'denied') : rejected ? 'rejected' : 'approved' });
  }

  async function runQueue(session) {
    const a = agents.get(session);
    if (!a || a.busy || a.paused) return;
    const item = a.queue.shift();
    if (item === undefined) return;
    const { text, done } = item;
    a.busy = true;
    a.reply = '';
    a.thought = '';
    a.said = []; // every reply bubble of this turn: a workflow step's output
    event(session, 'prompt', { text: clean(text, 300) });
    try {
      // First turn only: tell the agent what it is and what the app can do (ACP has no system prompt).
      let sent = text;
      if (!a.briefed) {
        a.briefed = true;
        const crewTools = process.env.HAUNTED_CREW_MCP !== '0' && Boolean(mcpUrl?.());
        sent = `${crewBriefing({ name: a.name, projectDir: a.cwd || cwd, worktree: Boolean(a.cwd), crewTools })}\n\n---\nUser request:\n${text}`;
      }
      const result = await a.worker.conn.request('session/prompt', { sessionId: session, prompt: [{ type: 'text', text: sent }] });
      clearTimeout(a.draftTimer);
      a.draftTimer = null;
      flushThought(session, a);
      if (a.reply.trim()) event(session, 'message', { text: replyText(a.reply) });
      a.reply = '';
      event(session, 'stop', { text: clean(result?.stopReason, 20) });
      done?.resolve(a.said.join('\n\n'));
    } catch (err) {
      event(session, 'error', { text: clean(err.message, 200) });
      done?.reject(new AgentError(502, clean(err.message, 200)));
    } finally {
      a.busy = false;
      if (agents.has(session)) runQueue(session);
    }
  }

  return {
    defaultModel,

    /** Starts every kiro-cli process and prepares a spare session in each, so summons are instant. */
    warmUp() {
      for (const w of workers) refill(w);
    },

    /** opts.cwd: start the agent in another folder (a git worktree); such sessions skip the spare pool. */
    async create(name, wanted, opts = {}) {
      if (typeof name !== 'string' || !NAME_RE.test(name.trim())) throw new AgentError(400, 'name must be 1-40 letters, digits, spaces, . - _');
      const modelId = wanted == null || wanted === '' ? defaultModel : String(wanted);
      if (!MODEL_RE.test(modelId)) throw new AgentError(400, 'bad model id');
      if (models && !models.some((m) => m.id === modelId)) throw new AgentError(400, `Kiro has no model "${clean(modelId, 64)}"`);
      if (agents.size + creating >= maxAgents) throw new AgentError(429, `the crew is full (${maxAgents} ghosts)`);
      // The process with the fewest agents; ties go to one with a spare session ready.
      const w = workers.reduce((best, x) => (x.sessions < best.sessions || (x.sessions === best.sessions && x.spare && !best.spare) ? x : best));
      w.sessions++;
      creating++;
      let s;
      try {
        const spare = opts.cwd ? null : w.spare; // a worktree session needs its own cwd, so it leaves the spare alone
        if (!opts.cwd) w.spare = null;
        s = (spare && (await spare)) || (await newSession(w, opts.cwd));
        // The model list arrives with the first session: check again, and keep the session for later.
        if (models && !models.some((m) => m.id === modelId)) {
          if (!w.spare && !opts.cwd) w.spare = Promise.resolve(s);
          throw new AgentError(400, `Kiro has no model "${clean(modelId, 64)}"`);
        }
        if (s.model !== modelId) {
          await w.conn.request('session/set_model', { sessionId: s.session, modelId }, sessionTimeoutMs).catch((err) => {
            if (!w.spare && !opts.cwd) w.spare = Promise.resolve(s); // still a good session: keep it for the next summon
            throw new AgentError(502, `Kiro could not switch to ${clean(modelId, 64)}: ${clean(err.message, 120)}`);
          });
        }
      } catch (err) {
        w.sessions--;
        throw err;
      } finally {
        creating--;
      }
      agents.set(s.session, {
        name: name.trim(), model: modelId, cwd: opts.cwd, worker: w, busy: false, queue: [], reply: '', thought: '', permission: undefined, tools: new Map(), draftTimer: null,
      });
      if (s.token) tokens.set(s.token, s.session);
      event(s.session, 'session_start', { model: modelId });
      refill(w);
      return { session: s.session, name: name.trim(), model: modelId };
    },

    prompt(session, text) {
      const a = agents.get(session);
      if (!a) throw new AgentError(404, 'not a console agent (hook-reported agents are watch-only)');
      if (typeof text !== 'string' || !text.trim() || text.length > 4000) throw new AgentError(400, 'text must be 1-4000 characters');
      if (a.queue.length >= 10) throw new AgentError(429, 'agent queue is full');
      a.queue.push({ text: text.trim() });
      runQueue(session);
      return { queued: a.queue.length + (a.busy ? 1 : 0) };
    },

    /** Prompts and waits for the turn to end; resolves with everything the agent replied. */
    run(session, text) {
      const a = agents.get(session);
      if (!a) return Promise.reject(new AgentError(404, 'no such agent'));
      return new Promise((resolve, reject) => {
        a.queue.push({ text: String(text).slice(0, 16_000), done: { resolve, reject } });
        runQueue(session);
      });
    },

    /** Stops the running turn (ACP session/cancel) and drops everything queued behind it. */
    interrupt(session) {
      const a = agents.get(session);
      if (!a) throw new AgentError(404, 'no such agent');
      const dropped = a.queue.splice(0);
      for (const q of dropped) q.done?.reject(new AgentError(409, 'interrupted'));
      a.paused = false;
      if (a.busy) a.worker.conn?.notify('session/cancel', { sessionId: session });
      return { cancelled: a.busy, dropped: dropped.length };
    },

    /** Dismiss a console ghost: stops its turn, denies its open permission, and removes it from the crew. */
    dismiss(session) {
      const a = agents.get(session);
      if (!a) throw new AgentError(404, 'no such agent');
      for (const q of a.queue.splice(0)) q.done?.reject(new AgentError(409, 'dismissed'));
      if (a.permission && permissions.has(a.permission)) resolvePermission(a.permission, null, 'ghost dismissed');
      if (a.busy) a.worker.conn?.notify('session/cancel', { sessionId: session });
      clearTimeout(a.draftTimer);
      event(session, 'session_end');
      agents.delete(session);
      a.worker.sessions = Math.max(0, a.worker.sessions - 1);
      for (const [t, id] of tokens) if (id === session) tokens.delete(t);
      return { dismissed: true };
    },

    /** Pause lets the running turn finish but starts nothing new; resume continues the queue. */
    setPaused(session, paused) {
      const a = agents.get(session);
      if (!a) throw new AgentError(404, 'no such agent');
      a.paused = Boolean(paused);
      if (!a.paused) runQueue(session);
      return { paused: a.paused, queued: a.queue.length };
    },

    /** The agent asks the human a question (OpenBot ask_user): shows as a card with the options as buttons. Resolves with the chosen option's text, or null on timeout. */
    askUser(session, question, options) {
      const a = agents.get(session);
      if (!a) return Promise.reject(new AgentError(404, 'no such agent'));
      const opts = (Array.isArray(options) && options.length ? options : ['Yes', 'No']).slice(0, 4).map((o, i) => ({ id: `ans${i}`, name: clean(String(o), 40), kind: 'allow_once' }));
      return new Promise((resolve) => {
        const requestId = randomUUID();
        const timer = setTimeout(() => resolvePermission(requestId, null, 'no answer'), permissionTimeoutMs);
        timer.unref?.();
        permissions.set(requestId, { rpcId: null, worker: a.worker, session, timer, options: opts, resolve });
        a.permission = requestId;
        event(session, 'permission', { request: { id: requestId, title: clean(question, 120) ?? 'Question', options: opts } });
      });
    },

    /** Switches an idle ghost to another Kiro model (ACP session/set_model). */
    async setModel(session, modelId) {
      const a = agents.get(session);
      if (!a) throw new AgentError(404, 'no such agent');
      if (typeof modelId !== 'string' || !MODEL_RE.test(modelId)) throw new AgentError(400, 'bad model id');
      if (models && !models.some((m) => m.id === modelId)) throw new AgentError(400, `Kiro has no model "${clean(modelId, 64)}"`);
      if (a.busy || a.queue.length) throw new AgentError(409, 'wait until the ghost is idle');
      await a.worker.conn.request('session/set_model', { sessionId: session, modelId }, sessionTimeoutMs)
        .catch((err) => { throw new AgentError(502, `Kiro could not switch to ${clean(modelId, 64)}: ${clean(err.message, 120)}`); });
      a.model = modelId;
      event(session, 'model', { model: modelId });
      return { model: modelId };
    },

    /** The agent that owns a crew-tools token, as { name, session }, or null. */
    byToolToken(token) {
      const session = tokens.get(token);
      const a = session && agents.get(session);
      return a ? { name: a.name, session } : null;
    },

    resolvePermission(requestId, optionId) {
      resolvePermission(requestId, optionId ?? null);
      return { ok: true };
    },

    list() {
      return [...agents].map(([session, a]) => ({ session, name: a.name, model: a.model, busy: a.busy, paused: Boolean(a.paused), queued: a.queue.length, permission: a.permission }));
    },

    models: () => models,

    close() {
      for (const w of workers) w.conn?.close();
    },
  };
}
