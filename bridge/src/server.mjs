import { readFileSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { bearerToken, createFailLimiter, roleFor } from './auth.mjs';
import { EventError, normalize } from './normalize.mjs';
import { createState } from './state.mjs';
import { AgentError, createAgentManager } from './agents.mjs';
import { createKiro } from './kiro.mjs';
import { createPairing } from './pairing.mjs';
import { createBrowser } from './browser.mjs';
import { createEdits } from './edits.mjs';
import { createWorkflows } from './workflows.mjs';
import { createHistory } from './history.mjs';
import { createTools } from './tools.mjs';
import { createRoutines } from './routines.mjs';
import { createChannels } from './channels.mjs';
import { createSkillStore } from './skillstore.mjs';
import { createBackup } from './backup.mjs';

const DASHBOARD = readFileSync(new URL('./dashboard.html', import.meta.url));
const CODE_PAGE = readFileSync(new URL('./code.html', import.meta.url));
const WORKFLOW_PAGE = readFileSync(new URL('./workflows.html', import.meta.url));
const VENDOR = {
  '/workflows/drawflow.min.js': ['text/javascript; charset=utf-8', readFileSync(new URL('./vendor/drawflow.min.js', import.meta.url))],
  '/workflows/drawflow.min.css': ['text/css; charset=utf-8', readFileSync(new URL('./vendor/drawflow.min.css', import.meta.url))],
};
const MAX_BODY = 1024 * 1024;
const KEYS = new Set(['Backspace', 'Enter', 'Tab', 'Escape', 'Delete', 'Home', 'End', 'PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space',
  'Control+a', 'Control+x', 'Control+z', 'Control+y', 'Shift+Tab', 'Shift+ArrowLeft', 'Shift+ArrowRight', 'Shift+Home', 'Shift+End']);
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' }; // PostToolUse can carry large tool output; we drop it after parsing.

function send(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const tooLarge = () => Object.assign(new Error('body too large'), { status: 413 });
    if (Number(req.headers['content-length']) > MAX_BODY) return reject(tooLarge());
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        // Stop buffering but keep draining so the client still receives the 413 (requestTimeout caps this).
        req.removeAllListeners('data');
        req.resume();
        reject(tooLarge());
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const LIVE_RELOAD = '<script>(()=>{let m;setInterval(async()=>{try{const r=await fetch(location.pathname+"?hc_mtime",{cache:"no-store"});const t=(await r.json()).mtime;if(m&&t!==m)location.reload();m=t}catch{}},700)})()</script>';

export function createBridge({ tokens, log = console, heartbeatMs = 30_000, agentOptions = null, kiroOptions = {}, previewRoot = agentOptions?.cwd ?? null, browserOptions = {}, worktrees = null, ...stateOpts }) {
  if (!tokens?.ingest || !tokens?.view) throw new Error('ingest and view tokens are required');
  let boundUrl = null; // http://127.0.0.1:<port>, set when listening; agents reach their crew tools there
  const state = createState(stateOpts);
  const agents = agentOptions ? createAgentManager({ ...agentOptions, emit: publish, log, mcpUrl: () => boundUrl }) : null;
  const kiro = createKiro({ ...kiroOptions, log });
  const pairing = createPairing();
  const browser = createBrowser({ ...browserOptions, log });
  const edits = createEdits({ root: previewRoot });
  const history = createHistory({ root: previewRoot || undefined });
  const workflows = createWorkflows({ root: previewRoot, agents, broadcast: (m) => broadcast(m), log, history, worktrees });
  const tools = agents ? createTools({ agents, ...workflows.stores, history }) : null;
  const channels = createChannels({ root: previewRoot || undefined });
  const skillStore = previewRoot ? createSkillStore({ root: previewRoot }) : null;
  const backup = previewRoot ? createBackup({ root: previewRoot }) : null;
  const routines = createRoutines({ root: previewRoot || undefined, start: (id, task) => workflows.run(id, task) });
  if (agents) routines.begin();
  // Screen frames go only to clients that asked for them (the Minecraft server), not to dashboards.
  browser.events.on('frame', (f) => {
    const data = JSON.stringify({ type: 'frame', ...f });
    for (const ws of wss.clients) if (ws.frames && ws.readyState === ws.OPEN) ws.send(data);
  });
  const limiter = createFailLimiter();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 });

  const remote = (req) => req.socket.remoteAddress ?? 'unknown';

  // Returns the role, or writes the error response and returns null.
  function authorize(req, token) {
    const ip = remote(req);
    if (limiter.blocked(ip)) return { error: 429 };
    const role = roleFor(token, tokens);
    if (!role) {
      limiter.fail(ip);
      return { error: 401 };
    }
    return { role };
  }

  function broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const ws of wss.clients) if (ws.readyState === ws.OPEN) ws.send(data);
  }

  function publish(event) {
    const session = state.apply(event);
    try {
      history.record(event);
    } catch (err) {
      log.error?.('[bridge] history:', err.message);
    }
    try {
      edits.observe(event, session);
    } catch (err) {
      log.error?.('[bridge] code view:', err.message);
    }
    broadcast({ type: 'event', event, session });
  }

  async function readJson(req) {
    try {
      return JSON.parse(await readBody(req));
    } catch (err) {
      throw new AgentError(err.status ?? 400, err.status ? err.message : 'invalid JSON');
    }
  }

  // /api/workflows, /api/crew-agents: list (view token); save, delete, run, stop (command token).
  async function handleWorkflows(req, res, url) {
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent); // ['api', 'workflows', ...]
    const auth = authorize(req, bearerToken(req));
    if (auth.error) return send(res, auth.error, { error: 'unauthorized' });
    if (req.method === 'GET' && parts[1] === 'workflows' && parts.length === 2) return send(res, 200, { ...workflows.list(), canEdit: auth.role === 'command' });
    if (req.method === 'GET' && parts[1] === 'skills' && parts.length === 2) return send(res, 200, { skills: workflows.skills() });
    if (req.method === 'GET' && parts[1] === 'workflows' && parts[2] === 'runs' && parts[3]) {
      const run = workflows.getRun(parts[3]);
      return run ? send(res, 200, run) : send(res, 404, { error: 'no such run' });
    }
    // Merge approvals: list and diff with the view token, answer with the command token.
    if (parts[1] === 'merges') {
      if (req.method === 'GET' && parts.length === 2) return send(res, 200, { enabled: Boolean(worktrees), merges: workflows.merges() });
      try {
        if (req.method === 'GET' && parts[3] === 'diff') return send(res, 200, { diff: await workflows.mergeDiff(parts[2]) });
        if (req.method === 'POST' && parts[3] === 'answer') {
          if (auth.role !== 'command') return send(res, 403, { error: 'command token required' });
          const body = await readJson(req);
          return send(res, 200, await workflows.answerMerge(parts[2], String(body.option), body.text));
        }
      } catch (err) {
        return send(res, err.status ?? 400, { error: err.message });
      }
    }
    const q = url.searchParams;
    if (req.method === 'GET' && parts[1] === 'history' && parts[2] === 'search') return send(res, 200, { results: history.search(q.get('q') ?? '', { agent: q.get('agent') || undefined, limit: Math.min(Number(q.get('limit')) || 10, 50) }) });
    if (req.method === 'GET' && parts[1] === 'history' && parts[2] === 'read') {
      const r = history.read(q.get('id') ?? '');
      return r ? send(res, 200, r) : send(res, 404, { error: 'no such event' });
    }
    if (req.method === 'GET' && parts[1] === 'history' && parts[2] === 'sessions') return send(res, 200, { sessions: history.sessions({ agent: q.get('agent') || undefined }) });
    if (auth.role !== 'command') return send(res, 403, { error: 'command token required' });
    try {
      if (parts[1] === 'channels') {
        const c = parts[2], act = parts[3];
        if (req.method === 'GET' && parts.length === 2) return send(res, 200, { channels: channels.list() });
        if (req.method === 'POST' && parts.length === 2) { const b = await readJson(req); return send(res, 201, channels.create(b)); }
        if (req.method === 'GET' && parts.length === 3) return send(res, 200, channels.get(c));
        if (req.method === 'DELETE' && parts.length === 3) return send(res, 200, channels.remove(c) ?? { ok: true });
        if (req.method === 'POST' && parts.length === 4) {
          const b = await readJson(req);
          const out = {
            post: () => channels.post(c, b.from, b.text), assign: () => channels.assign(c, b.from, b), result: () => channels.result(c, b.agent, b.taskId, b.text),
            reply: () => channels.reply(c, b.from, b.taskId, b.text), answer: () => channels.answer(c, b.taskId, b.text), transfer: () => channels.transfer(c, b.from, b.newLead),
            remember: () => channels.remember(c, b.from, b.text),
          }[act];
          if (out) return send(res, 200, out());
        }
      }
      if (parts[1] === 'skills' && req.method !== 'GET') {
        if (!skillStore) return send(res, 503, { error: 'no workspace' });
        if (req.method === 'POST' && parts.length === 2) return send(res, 201, skillStore.create(await readJson(req)));
        if (req.method === 'PUT' && parts.length === 3) return send(res, 200, skillStore.revise(parts[2], await readJson(req)));
        if (req.method === 'DELETE' && parts.length === 3) return send(res, 200, skillStore.remove(parts[2]) ?? { ok: true });
      }
      if (parts[1] === 'backup') {
        if (!backup) return send(res, 503, { error: 'no workspace' });
        if (req.method === 'GET' && parts[2] === 'export') return send(res, 200, backup.export());
        if (req.method === 'POST' && parts[2] === 'import') { const b = await readJson(req); return send(res, 200, backup.import(b.bundle, { overwrite: b.overwrite === true })); }
      }
      if (parts[1] === 'routines') {
        if (req.method === 'GET' && parts.length === 2) return send(res, 200, { routines: routines.list() });
        if (req.method === 'POST' && parts.length === 2) {
          const b = await readJson(req);
          return send(res, 201, b.webhook ? routines.createWebhook(b) : routines.create(b));
        }
        if (req.method === 'DELETE' && parts.length === 3) return send(res, 200, routines.remove(parts[2]) ?? { ok: true });
        if (req.method === 'POST' && parts.length === 4 && parts[3] === 'enabled') return send(res, 200, routines.setEnabled(parts[2], Boolean((await readJson(req)).enabled)) ?? { ok: true });
      }
      if (parts[1] === 'workflows') {
        if (req.method === 'PUT' && parts.length === 2) return send(res, 200, workflows.saveWorkflow(await readJson(req)));
        if (req.method === 'DELETE' && parts.length === 3) return send(res, 200, workflows.deleteWorkflow(parts[2]));
        if (req.method === 'POST' && parts.length === 4 && parts[3] === 'run') return send(res, 202, workflows.run(parts[2], (await readJson(req)).task));
        if (req.method === 'POST' && parts.length === 5 && parts[2] === 'runs' && parts[4] === 'stop') return send(res, 200, workflows.stop(parts[3]));
      }
      if (parts[1] === 'crew-agents') {
        if (req.method === 'PUT' && parts.length === 2) return send(res, 200, workflows.saveAgent(await readJson(req)));
        if (req.method === 'DELETE' && parts.length === 3) return send(res, 200, workflows.deleteAgent(parts[2]));
      }
    } catch (err) {
      if (err instanceof AgentError) return send(res, err.status, { error: err.message });
      if (['routines', 'channels', 'skills', 'backup'].includes(parts[1])) return send(res, 400, { error: err.message });
      throw err;
    }
    return send(res, 404, { error: 'not found' });
  }

  // /tools, /tools/call: the crew's MCP server (bin/crew-mcp.mjs) calls these with its agent's session token.
  async function handleTools(req, res, url) {
    const ip = remote(req);
    if (limiter.blocked(ip)) return send(res, 429, { error: 'too many attempts' });
    const caller = agents.byToolToken(bearerToken(req) ?? '');
    if (!caller) {
      limiter.fail(ip);
      return send(res, 401, { error: 'unknown agent token' });
    }
    if (req.method === 'GET' && url.pathname === '/tools') return send(res, 200, { tools: tools.list() });
    if (req.method !== 'POST' || url.pathname !== '/tools/call') return send(res, 404, { error: 'not found' });
    try {
      const body = await readJson(req);
      return send(res, 200, { text: await tools.call(caller, String(body.tool), body.args) });
    } catch (err) {
      return send(res, err.status ?? 400, { error: err.message });
    }
  }

  // POST /hooks/<id>: webhook routines. No bearer token: the HMAC signature (x-hub-signature-256) is the credential.
  async function handleHook(req, res, url) {
    const ip = remote(req);
    if (limiter.blocked(ip)) return send(res, 429, { error: 'too many attempts' });
    const id = decodeURIComponent(url.pathname.split('/')[2] ?? '');
    try {
      const body = await readBody(req);
      routines.trigger(id, body, req.headers['x-hub-signature-256']);
      return send(res, 202, { ok: true });
    } catch (err) {
      if (/signature|no such webhook/.test(err.message)) limiter.fail(ip);
      const status = err.status ?? (/too many/.test(err.message) ? 429 : /signature/.test(err.message) ? 401 : /no such|disabled/.test(err.message) ? 404 : 400);
      return send(res, status, { error: err.message });
    }
  }

  // /agents routes: list (view), create / prompt / answer permission (command token only).
  async function handleAgents(req, res, url) {
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const auth = authorize(req, bearerToken(req));
    if (auth.error) return send(res, auth.error, { error: 'unauthorized' });
    if (req.method === 'GET' && parts.length === 1) {
      return send(res, 200, { enabled: Boolean(agents), agents: agents ? agents.list() : [], models: agents?.models() ?? null, defaultModel: agents?.defaultModel ?? null });
    }
    if (auth.role !== 'command') return send(res, 403, { error: 'command token required' });
    if (!agents) return send(res, 503, { error: 'agent runner disabled: start the bridge with HAUNTED_CREW_WORKSPACE=/path/to/project' });
    try {
      if (req.method === 'POST' && parts.length === 1) {
        const body = await readJson(req);
        return send(res, 201, await agents.create(body.name, body.model));
      }
      if (req.method === 'POST' && parts.length === 3 && parts[2] === 'prompt') {
        const body = await readJson(req);
        return send(res, 202, agents.prompt(parts[1], body.text));
      }
      if (req.method === 'POST' && parts.length === 3 && parts[2] === 'model') return send(res, 200, await agents.setModel(parts[1], (await readJson(req)).model));
      if (req.method === 'POST' && parts.length === 3 && parts[2] === 'dismiss') return send(res, 200, agents.dismiss(parts[1]));
      if (req.method === 'POST' && parts.length === 3 && parts[2] === 'interrupt') return send(res, 200, agents.interrupt(parts[1]));
      if (req.method === 'POST' && parts.length === 3 && (parts[2] === 'pause' || parts[2] === 'resume')) return send(res, 200, agents.setPaused(parts[1], parts[2] === 'pause'));
      if (req.method === 'POST' && parts.length === 3 && parts[2] === 'permission') {
        const body = await readJson(req);
        return send(res, 200, agents.resolvePermission(body.requestId, body.optionId ?? null));
      }
    } catch (err) {
      if (err instanceof AgentError) return send(res, err.status, { error: err.message });
      throw err;
    }
    return send(res, 404, { error: 'not found' });
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://bridge');

    if (req.method === 'GET' && url.pathname === '/healthz') return send(res, 200, { ok: true });

    // The dashboard page is public; it needs the view token (kept in the URL fragment) to show anything.
    const page = url.pathname === '/' || url.pathname === '/dashboard' ? DASHBOARD : url.pathname === '/code' ? CODE_PAGE : url.pathname === '/workflows' ? WORKFLOW_PAGE : null;
    if (req.method === 'GET' && VENDOR[url.pathname]) {
      res.writeHead(200, { 'content-type': VENDOR[url.pathname][0], 'cache-control': 'max-age=3600', 'x-content-type-options': 'nosniff' });
      return res.end(VENDOR[url.pathname][1]);
    }
    if (req.method === 'GET' && page) {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
        'content-security-policy': "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:",
      });
      return res.end(page);
    }

    if (url.pathname === '/event') {
      if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
      const auth = authorize(req, bearerToken(req));
      if (auth.error) return send(res, auth.error, { error: auth.error === 429 ? 'too many attempts' : 'unauthorized' });
      if (auth.role !== 'ingest') return send(res, 403, { error: 'view token cannot post events' });

      let raw;
      try {
        raw = JSON.parse(await readBody(req));
      } catch (err) {
        if (err.status === 413) res.setHeader('connection', 'close');
        return send(res, err.status ?? 400, { error: err.status ? err.message : 'invalid JSON' });
      }
      let event;
      try {
        event = normalize(raw, { trigger: req.headers['x-kiro-trigger'] });
      } catch (err) {
        if (err instanceof EventError) return send(res, 400, { error: err.message });
        throw err;
      }
      publish(event);
      return send(res, 202, { id: event.id });
    }

    if (url.pathname === '/agents' || url.pathname.startsWith('/agents/')) return handleAgents(req, res, url);
    if (tools && (url.pathname === '/tools' || url.pathname === '/tools/call')) return handleTools(req, res, url);
    if (req.method === 'POST' && url.pathname.startsWith('/hooks/')) return handleHook(req, res, url);
    if (url.pathname.startsWith('/api/')) return handleWorkflows(req, res, url);

    // Pairing: a one-time code (shown by the launcher) buys the view + command tokens.
    if (req.method === 'POST' && url.pathname === '/pair') {
      const ip = remote(req);
      if (limiter.blocked(ip)) return send(res, 429, { error: 'too many attempts' });
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        return send(res, 400, { error: 'invalid JSON' });
      }
      if (!pairing.redeem(body?.code)) {
        limiter.fail(ip);
        return send(res, 401, { error: 'wrong or expired pairing code' });
      }
      if (!tokens.command) return send(res, 500, { error: 'bridge has no command token' });
      return send(res, 200, { view: tokens.view, command: tokens.command });
    }

    // Project preview for the big screen: serves the workspace read-only. Needs the view token once
    // (?token=), then a cookie scoped to /preview so the page's own assets load.
    if (req.method === 'GET' && (url.pathname === '/preview' || url.pathname.startsWith('/preview/'))) {
      const cookie = /(?:^|;\s*)hc_preview=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
      const auth = authorize(req, url.searchParams.get('token') ?? cookie ?? bearerToken(req));
      if (auth.error) return send(res, auth.error, { error: 'unauthorized' });
      if (!previewRoot) return send(res, 404, { error: 'no project folder' });
      const root = resolve(previewRoot);
      let file = resolve(root, '.' + decodeURIComponent(url.pathname.slice('/preview'.length) || '/'));
      if (file !== root && !file.startsWith(root + sep)) return send(res, 403, { error: 'outside the project' });
      try {
        if (statSync(file).isDirectory()) file = resolve(file, 'index.html');
        if (url.searchParams.has('hc_mtime')) return send(res, 200, { mtime: statSync(file).mtimeMs }); // the live-reload poll below
        let body = readFileSync(file);
        // Pages shown on the big screen reload themselves when the file changes, so you watch the crew build them.
        if (extname(file).toLowerCase() === '.html') body = Buffer.concat([body, Buffer.from(LIVE_RELOAD)]);
        const headers = { 'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
        if (url.searchParams.get('token')) headers['set-cookie'] = `hc_preview=${encodeURIComponent(url.searchParams.get('token'))}; Path=/preview; HttpOnly; SameSite=Strict`;
        res.writeHead(200, headers);
        return res.end(body);
      } catch {
        return send(res, 404, { error: 'not found' });
      }
    }

    // Shared screen browser (headless Chrome). Command token only: it can open any page.
    if (url.pathname.startsWith('/browser/')) {
      const auth = authorize(req, bearerToken(req));
      if (auth.error) return send(res, auth.error, { error: 'unauthorized' });
      if (req.method === 'GET' && url.pathname === '/browser/status') return send(res, 200, { available: browser.available(), frame: Boolean(browser.lastFrame()) });
      if (auth.role !== 'command') return send(res, 403, { error: 'command token required' });
      if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
      if (!browser.available()) return send(res, 503, { error: 'Chrome not found on the bridge PC (set CHROME_PATH)' });
      let body = {};
      try {
        body = JSON.parse((await readBody(req)) || '{}');
      } catch {
        return send(res, 400, { error: 'invalid JSON' });
      }
      const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
      try {
        switch (url.pathname) {
          case '/browser/open': {
            let target = String(body.url ?? '');
            if (target === 'preview') target = `http://127.0.0.1:${server.address().port}/preview/?token=${encodeURIComponent(tokens.view)}`;
            if (target === 'code') target = `http://127.0.0.1:${server.address().port}/code#token=${encodeURIComponent(tokens.view)}`;
            if (!/^https?:\/\//i.test(target)) return send(res, 400, { error: 'url must start with http:// or https://' });
            return send(res, 200, await browser.open(target));
          }
          case '/browser/click': {
            if (process.env.HAUNTED_CREW_DEBUG) log.log?.('[browser] click', body.x, body.y);
            const x = num(body.x), y = num(body.y);
            if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) return send(res, 400, { error: 'x and y must be 0..1' });
            return send(res, 200, await browser.click(x, y));
          }
          case '/browser/scroll': {
            const dy = num(body.dy);
            if (!(Math.abs(dy) <= 5000)) return send(res, 400, { error: 'dy out of range' });
            return send(res, 200, await browser.scroll(dy));
          }
          case '/browser/type': {
            if (process.env.HAUNTED_CREW_DEBUG) log.log?.('[browser] type', JSON.stringify(body.text), body.submit);
            if (typeof body.text !== 'string' || body.text.length > 500) return send(res, 400, { error: 'text must be up to 500 characters' });
            return send(res, 200, await browser.type(body.text, body.submit !== false));
          }
          case '/browser/back':
            return send(res, 200, await browser.back());
          case '/browser/forward':
            return send(res, 200, await browser.forward());
          case '/browser/reload':
            return send(res, 200, await browser.reload());
          case '/browser/key': {
            if (!KEYS.has(body.key)) return send(res, 400, { error: 'unsupported key' });
            return send(res, 200, await browser.key(body.key));
          }
          case '/browser/stop':
            await browser.stop();
            return send(res, 200, { ok: true });
          default:
            return send(res, 404, { error: 'not found' });
        }
      } catch (err) {
        return send(res, 502, { error: `browser: ${String(err.message).slice(0, 160)}` });
      }
    }

    if (url.pathname === '/kiro/status' && req.method === 'GET') {
      const auth = authorize(req, bearerToken(req));
      if (auth.error) return send(res, auth.error, { error: 'unauthorized' });
      return send(res, 200, await kiro.status());
    }

    if (url.pathname === '/kiro/usage' && req.method === 'GET') {
      const auth = authorize(req, bearerToken(req));
      if (auth.error) return send(res, auth.error, { error: 'unauthorized' });
      if (auth.role !== 'command') return send(res, 403, { error: 'command token required' });
      return send(res, 200, await kiro.usage());
    }

    if (url.pathname === '/kiro/login' && req.method === 'POST') {
      const auth = authorize(req, bearerToken(req));
      if (auth.error) return send(res, auth.error, { error: 'unauthorized' });
      if (auth.role !== 'command') return send(res, 403, { error: 'command token required' });
      return send(res, 200, await kiro.startLogin());
    }

    if (req.method === 'GET' && url.pathname === '/code/state') {
      const auth = authorize(req, bearerToken(req) ?? url.searchParams.get('token'));
      if (auth.error) return send(res, auth.error, { error: 'unauthorized' });
      return send(res, 200, { edits: edits.recent(), sessions: state.snapshot().sessions });
    }

    if (req.method === 'GET' && url.pathname === '/state') {
      const auth = authorize(req, bearerToken(req) ?? url.searchParams.get('token'));
      if (auth.error) return send(res, auth.error, { error: 'unauthorized' });
      return send(res, 200, state.snapshot());
    }

    return send(res, 404, { error: 'not found' });
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      log.error('[bridge] request failed:', err);
      if (!res.headersSent) send(res, 500, { error: 'internal error' });
      else res.destroy();
    });
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;

  // WebSocket clients (mod, dashboard) authenticate with `Authorization: Bearer` or,
  // for browsers that cannot set headers, `?token=` with the read-only view token.
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://bridge');
    if (url.pathname !== '/stream') {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      return;
    }
    const auth = authorize(req, bearerToken(req) ?? url.searchParams.get('token'));
    if (auth.error) {
      const line = auth.error === 429 ? '429 Too Many Requests' : '401 Unauthorized';
      socket.end(`HTTP/1.1 ${line}\r\nConnection: close\r\n\r\n`);
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.isAlive = true;
      ws.frames = url.searchParams.get('frames') === '1';
      const f = browser.lastFrame();
      if (ws.frames && f) setTimeout(() => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ type: 'frame', ...f })), 50);
      ws.on('pong', () => (ws.isAlive = true));
      ws.on('message', () => {}); // stream is server -> client only
      ws.on('error', (err) => log.warn('[bridge] ws error:', err.message));
      ws.send(JSON.stringify({ type: 'hello', role: auth.role, ...state.snapshot() }));
    });
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
    state.sweep();
    limiter.sweep();
  }, heartbeatMs);
  heartbeat.unref();

  return {
    server,
    state,
    pairingCode: () => pairing.create(),
    kiroStatus: () => kiro.status(),
    warmUpAgents: () => agents?.warmUp(),
    listen(port, host) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          const addr = server.address();
          boundUrl = `http://${host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host}:${addr.port}`;
          resolve(addr);
        });
      });
    },
    close() {
      clearInterval(heartbeat);
      routines.end();
      agents?.close();
      kiro.close();
      browser.stop();
      for (const ws of wss.clients) ws.close(1001, 'server shutting down');
      wss.close();
      return new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      });
    },
  };
}
