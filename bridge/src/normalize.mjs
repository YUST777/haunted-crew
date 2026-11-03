import { basename, isAbsolute, relative } from 'node:path';
import { randomUUID } from 'node:crypto';

// Kiro trigger names (IDE 1.0 / CLI V3, plus legacy and Crew spellings) -> our event kind.
const TRIGGERS = {
  SessionStart: 'session_start', AgentSpawn: 'session_start', agentSpawn: 'session_start',
  SessionEnd: 'session_end',
  UserPromptSubmit: 'prompt', userPromptSubmit: 'prompt', promptSubmit: 'prompt',
  Stop: 'stop', stop: 'stop', agentStop: 'stop',
  PreToolUse: 'tool_start', preToolUse: 'tool_start',
  PostToolUse: 'tool_end', postToolUse: 'tool_end',
  PostFileCreate: 'file_create', fileCreated: 'file_create', FileCreated: 'file_create',
  PostFileSave: 'file_save', fileEdited: 'file_save', FileEdited: 'file_save',
  PostFileDelete: 'file_delete', fileDeleted: 'file_delete', FileDeleted: 'file_delete',
  PreTaskExec: 'task_start', PreTaskExecution: 'task_start', preTaskExecution: 'task_start',
  PostTaskExec: 'task_end', PostTaskExecution: 'task_end', postTaskExecution: 'task_end',
};

export const KINDS = new Set(Object.values(TRIGGERS));

const CATEGORY_RULES = [
  [/^mcp_/, 'mcp'],
  [/subagent/, 'subagent'],
  [/spec/, 'spec'],
  [/^web_|web_search|web_fetch/, 'web'],
  [/execute_(bash|pwsh|cmd)|shell/, 'shell'],
  [/write|str_replace|append|delete_file|create_file|edit/, 'write'],
  [/read|grep|glob|list|search|introspect|code/, 'read'],
];

export function toolCategory(tool, tags) {
  if (Array.isArray(tags)) {
    for (const c of ['write', 'shell', 'web', 'subagent', 'spec', 'read']) if (tags.includes(c)) return c;
    if (tags.includes('@mcp')) return 'mcp';
  }
  if (!tool) return undefined;
  const t = tool.toLowerCase();
  for (const [re, cat] of CATEGORY_RULES) if (re.test(t)) return cat;
  return 'other';
}

// Strip control chars and cap length: these strings end up on screens other players see.
export function clean(value, max = 120) {
  if (value === undefined || value === null) return undefined;
  const s = String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (!s) return undefined;
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

// Show paths relative to the project, never absolute (they leak usernames / folder layout).
export function safePath(p, cwd) {
  if (typeof p !== 'string' || !p) return undefined;
  if (!isAbsolute(p)) return clean(p.replace(/^\.\//, ''), 160);
  if (typeof cwd === 'string' && cwd) {
    const rel = relative(cwd, p);
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return clean(rel, 160);
  }
  return clean(basename(p), 160);
}

function pickPath(raw) {
  const input = raw.tool_input && typeof raw.tool_input === 'object' ? raw.tool_input : {};
  return raw.file_path ?? raw.filePath ?? raw.path ?? input.path ?? input.file_path ?? input.filePath;
}

function toolOk(raw) {
  const r = raw.tool_response;
  if (r && typeof r === 'object') {
    if (typeof r.success === 'boolean') return r.success;
    if (r.error || r.is_error === true || r.isError === true) return false;
    if (typeof r.exit_code === 'number') return r.exit_code === 0;
    if (typeof r.exitCode === 'number') return r.exitCode === 0;
  }
  return undefined;
}

export class EventError extends Error {}

// Raw Kiro hook payloads can contain prompts, file contents and command output.
// We keep only metadata needed for the visuals; nothing else leaves this function.
export function normalize(raw, { trigger, now = Date.now } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new EventError('event body must be a JSON object');
  }
  const name = trigger || raw.hook_event_name || raw.trigger;
  const kind = TRIGGERS[name];
  if (!kind) throw new EventError(`unknown trigger: ${clean(name, 40) ?? '(none)'}`);

  const session = clean(raw.session_id ?? raw.sessionId ?? raw.conversation_id, 64) ?? 'default';
  const event = { id: randomUUID(), ts: now(), kind, session };

  const agent = clean(raw.agent_name ?? raw.agentName ?? raw.agent, 40);
  if (agent) event.agent = agent;

  if (kind === 'tool_start' || kind === 'tool_end') {
    const tool = clean(raw.tool_name ?? raw.toolName ?? raw.tool?.name, 64);
    if (tool) event.tool = tool;
    event.category = toolCategory(tool, raw.tool_tags) ?? 'other';
    const ok = kind === 'tool_end' ? toolOk(raw) : undefined;
    if (ok !== undefined) event.ok = ok;
  }

  const file = safePath(pickPath(raw), raw.cwd);
  if (file && kind !== 'prompt' && kind !== 'stop') event.file = file;

  if (kind === 'task_start' || kind === 'task_end') {
    const task = raw.task && typeof raw.task === 'object' ? raw.task : {};
    const title = clean(task.title ?? task.name ?? raw.task_title ?? raw.task_name ?? raw.taskId ?? raw.task_id, 120);
    if (title) event.task = title;
  }

  return event;
}
