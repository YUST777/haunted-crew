import { randomUUID } from 'node:crypto';
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
}) {
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
    const conn = new AcpConnection({ command, args: procArgs, cwd });
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

  async function newSession(w) {
    await connect(w);
    let res;
    try {
      res = await w.conn.request('session/new', { cwd, mcpServers: [] }, sessionTimeoutMs);
    } catch (err) {
      // Typically "authentication required" when kiro-cli is signed out.
      throw new AgentError(502, `Kiro could not start an agent: ${clean(err.message, 160)}`);
    }
    if (typeof res?.sessionId !== 'string') throw new AgentError(502, 'kiro-cli returned no session id');
    const list = res.models?.availableModels;
    if (Array.isArray(list) && !models) {
      models = list.slice(0, 40).map((m) => ({ id: clean(m.modelId, 64), name: clean(m.name, 64), description: clean(m.description, 120) })).filter((m) => m.id);
    }
    return { session: res.sessionId, model: clean(res.models?.currentModelId, 64) ?? null, worker: w };
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
        file: safePath(update.locations?.[0]?.path, cwd),
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
    p.worker.conn?.respond(p.rpcId, optionId === null ? { outcome: { outcome: 'cancelled' } } : { outcome: { outcome: 'selected', optionId } });
    const a = agents.get(p.session);
    if (a) a.permission = undefined;
    const chosen = p.options.find((o) => o.id === optionId);
    const rejected = optionId === null || /reject|deny/i.test(`${chosen?.kind ?? ''} ${chosen?.id ?? ''}`);
    event(p.session, 'permission_resolved', { text: optionId === null ? (why ?? 'denied') : rejected ? 'rejected' : 'approved' });
  }

  async function runQueue(session) {
    const a = agents.get(session);
    if (!a || a.busy) return;
    const item = a.queue.shift();
    if (item === undefined) return;
    const { text, done } = item;
    a.busy = true;
    a.reply = '';
    a.thought = '';
    a.said = []; // every reply bubble of this turn: a workflow step's output
    event(session, 'prompt', { text: clean(text, 300) });
    try {
      const result = await a.worker.conn.request('session/prompt', { sessionId: session, prompt: [{ type: 'text', text }] });
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

    async create(name, wanted) {
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
        const spare = w.spare;
        w.spare = null;
        s = (spare && (await spare)) || (await newSession(w));
        // The model list arrives with the first session: check again, and keep the session for later.
        if (models && !models.some((m) => m.id === modelId)) {
          if (!w.spare) w.spare = Promise.resolve(s);
          throw new AgentError(400, `Kiro has no model "${clean(modelId, 64)}"`);
        }
        if (s.model !== modelId) {
          await w.conn.request('session/set_model', { sessionId: s.session, modelId }, sessionTimeoutMs).catch((err) => {
            if (!w.spare) w.spare = Promise.resolve(s); // still a good session: keep it for the next summon
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
        name: name.trim(), model: modelId, worker: w, busy: false, queue: [], reply: '', thought: '', permission: undefined, tools: new Map(), draftTimer: null,
      });
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

    resolvePermission(requestId, optionId) {
      resolvePermission(requestId, optionId ?? null);
      return { ok: true };
    },

    list() {
      return [...agents].map(([session, a]) => ({ session, name: a.name, model: a.model, busy: a.busy, queued: a.queue.length, permission: a.permission }));
    },

    models: () => models,

    close() {
      for (const w of workers) w.conn?.close();
    },
  };
}
