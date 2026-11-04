// Ghost status is decided here once, so the mod and the dashboard always agree.
// working = blue, waiting = yellow (needs the user), error = red, idle = grey.
const STATUS_BY_KIND = {
  session_start: 'idle',
  prompt: 'working',
  tool_start: 'working',
  task_start: 'working',
  file_create: 'working',
  file_save: 'working',
  file_delete: 'working',
  task_end: 'working',
  stop: 'waiting',
  permission: 'waiting',
  permission_resolved: 'working',
  error: 'error',
};

export function createState({ historySize = 500, sessionTtlMs = 60 * 60_000, maxSessions = 80 } = {}) {
  const history = [];
  const sessions = new Map();

  function apply(event) {
    // Drafts (a reply or thinking streaming in) only update the session; they'd flood the history.
    if (event.kind !== 'draft') {
      history.push(event);
      if (history.length > historySize) history.splice(0, history.length - historySize);
    }

    if (event.kind === 'session_end') {
      sessions.delete(event.session);
      return null;
    }

    let s = sessions.get(event.session);
    if (!s) {
      if (sessions.size >= maxSessions) evictOldest();
      s = { session: event.session, startedAt: event.ts, status: 'idle', events: 0 };
      sessions.set(event.session, s);
    }
    if (event.kind === 'draft') {
      s.draft = event.text;
      s.thinking = event.thinking;
      return { ...s };
    }
    if (['message', 'thought', 'stop', 'error', 'prompt', 'tool_start'].includes(event.kind)) {
      s.draft = undefined;
      s.thinking = undefined;
    }
    s.events++;
    s.lastTs = event.ts;
    s.lastKind = event.kind;
    if (event.model) s.model = event.model;
    if (event.agent) s.agent = event.agent;
    if (event.console) s.console = true;
    if (event.kind === 'permission') s.permission = event.request;
    else if (['permission_resolved', 'stop', 'error', 'session_start'].includes(event.kind)) s.permission = undefined;
    if (event.kind === 'tool_start') {
      s.tool = event.tool;
      s.category = event.category;
    }
    if (event.file) s.file = event.file;
    if (event.kind === 'task_start') s.task = event.task;
    if (event.kind === 'task_end' && s.task === event.task) s.task = undefined;

    if (event.kind === 'tool_end') s.status = event.ok === false ? 'error' : 'working';
    else s.status = STATUS_BY_KIND[event.kind] ?? s.status;
    return { ...s };
  }

  function evictOldest() {
    let oldest;
    for (const s of sessions.values()) if (!oldest || s.lastTs < oldest.lastTs) oldest = s;
    if (oldest) sessions.delete(oldest.session);
  }

  function sweep(now = Date.now()) {
    for (const [id, s] of sessions) if (now - s.lastTs > sessionTtlMs) sessions.delete(id);
  }

  return {
    apply,
    sweep,
    snapshot: () => ({ sessions: [...sessions.values()].map((s) => ({ ...s })), history: history.slice() }),
  };
}
