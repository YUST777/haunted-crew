import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const TICK_MS = 30_000;
const TRIGGER_GAP_MS = 5_000;
const MAX_PAYLOAD = 2000;
const MAX_TASK = 4000;
const MAX_NAME = 60;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const EVERY = /^every (\d+)([mh])$/;
const DAILY = /^daily (\d{2}):(\d{2})$/;

// "every <N>m|h" or "daily HH:MM" (24h, local time). Anything else throws.
function parseSchedule(schedule) {
  if (typeof schedule !== 'string') throw new Error('schedule must be a string');
  const s = schedule.trim();
  let m = EVERY.exec(s);
  if (m) {
    const n = Number(m[1]);
    if (n < 1) throw new Error(`invalid schedule "${schedule}": interval must be at least 1`);
    return { kind: 'every', interval: n * (m[2] === 'h' ? HOUR : MINUTE) };
  }
  m = DAILY.exec(s);
  if (m) {
    const hour = Number(m[1]);
    const minute = Number(m[2]);
    if (hour > 23 || minute > 59) throw new Error(`invalid schedule "${schedule}": time must be 00:00-23:59`);
    return { kind: 'daily', hour, minute };
  }
  throw new Error(`invalid schedule "${schedule}": use "every <N>m", "every <N>h" or "daily HH:MM"`);
}

function nextDaily(hour, minute, from) {
  const d = new Date(from);
  d.setHours(hour, minute, 0, 0);
  if (d.getTime() <= from) d.setDate(d.getDate() + 1);
  return d.getTime();
}

const errorText = (err) => (err instanceof Error ? err.message : String(err));

// Scheduled routines and webhooks. Sync API; every mutation is saved atomically.
export function createRoutines({ root, start, now = Date.now, setTimer = setInterval, clearTimer = clearInterval } = {}) {
  if (typeof start !== 'function') throw new TypeError('start must be a function');
  const file = root ? join(root, '.haunted-crew', 'routines.json') : null;
  let routines = file && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).routines ?? [] : [];
  const lastTriggered = new Map();
  let timer = null;

  function save() {
    if (!file) return;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(`${file}.tmp`, JSON.stringify({ routines }, null, 2));
    renameSync(`${file}.tmp`, file);
  }

  const find = (id) => routines.find((r) => r.id === id);

  function newId() {
    let id;
    do id = `rt_${randomBytes(6).toString('hex')}`; while (find(id));
    return id;
  }

  // Secret is returned only on creation, never by list().
  const publicView = ({ secret, ...rest }) => ({ ...rest });

  function checkFields({ name, workflowId, task }) {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (trimmed.length < 1 || trimmed.length > MAX_NAME) throw new Error(`name must be 1-${MAX_NAME} characters`);
    if (typeof workflowId !== 'string' || !workflowId) throw new Error('workflowId is required');
    if (typeof task !== 'string' || task.length > MAX_TASK) throw new Error(`task must be a string of at most ${MAX_TASK} characters`);
    return trimmed;
  }

  // Starts the workflow; failures are recorded on the routine, never thrown.
  function launch(routine, task) {
    try {
      const result = start(routine.workflowId, task);
      routine.lastError = null;
      if (result && typeof result.then === 'function') {
        result.then(null, (err) => { routine.lastError = errorText(err); });
      }
    } catch (err) {
      routine.lastError = errorText(err);
    }
  }

  function create({ name, workflowId, task, schedule }) {
    const cleanName = checkFields({ name, workflowId, task });
    const parsed = parseSchedule(schedule);
    const t = now();
    const routine = {
      id: newId(),
      name: cleanName,
      workflowId,
      task,
      schedule: schedule.trim(),
      enabled: true,
      lastRun: null,
      lastError: null,
      nextRun: parsed.kind === 'every' ? t + parsed.interval : nextDaily(parsed.hour, parsed.minute, t),
      webhook: false,
    };
    routines.push(routine);
    save();
    return publicView(routine);
  }

  function createWebhook({ name, workflowId, task }) {
    const cleanName = checkFields({ name, workflowId, task });
    const routine = {
      id: newId(),
      name: cleanName,
      workflowId,
      task,
      schedule: null,
      enabled: true,
      lastRun: null,
      lastError: null,
      nextRun: null,
      webhook: true,
      secret: randomBytes(32).toString('base64url'),
    };
    routines.push(routine);
    save();
    return { ...routine, path: `/hooks/${routine.id}` };
  }

  function list() {
    return routines.map(publicView);
  }

  function remove(id) {
    const i = routines.findIndex((r) => r.id === id);
    if (i === -1) return false;
    routines.splice(i, 1);
    lastTriggered.delete(id);
    save();
    return true;
  }

  function setEnabled(id, enabled) {
    const routine = find(id);
    if (!routine) throw new Error('no such routine');
    routine.enabled = Boolean(enabled);
    // Re-enabling resumes from now, so a long-disabled routine does not fire a burst.
    if (routine.enabled && routine.schedule) {
      const parsed = parseSchedule(routine.schedule);
      const t = now();
      routine.nextRun = parsed.kind === 'every' ? t + parsed.interval : nextDaily(parsed.hour, parsed.minute, t);
    }
    save();
    return publicView(routine);
  }

  // Runs every due routine once. nextRun moves past now before start, so a slot never runs twice.
  function tick() {
    const t = now();
    let changed = false;
    for (const routine of routines) {
      if (!routine.enabled || routine.nextRun == null || routine.nextRun > t) continue;
      const parsed = parseSchedule(routine.schedule);
      if (parsed.kind === 'every') {
        routine.nextRun += (Math.floor((t - routine.nextRun) / parsed.interval) + 1) * parsed.interval;
      } else {
        routine.nextRun = nextDaily(parsed.hour, parsed.minute, t);
      }
      routine.lastRun = t;
      launch(routine, routine.task);
      changed = true;
    }
    if (changed) save();
  }

  function trigger(id, rawBody, signatureHeader) {
    const routine = find(id);
    if (!routine || !routine.webhook) throw new Error('no such webhook');
    if (!routine.enabled) throw new Error('webhook disabled');
    const body = String(rawBody ?? '');
    const expected = Buffer.from(`sha256=${createHmac('sha256', routine.secret).update(body).digest('hex')}`);
    const given = Buffer.from(typeof signatureHeader === 'string' ? signatureHeader : '');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new Error('bad signature');
    const t = now();
    const last = lastTriggered.get(id);
    if (last !== undefined && t - last < TRIGGER_GAP_MS) throw new Error('too many requests');
    lastTriggered.set(id, t);
    routine.lastRun = t;
    launch(routine, `${routine.task}\n\nWebhook payload:\n${body.slice(0, MAX_PAYLOAD)}`);
    save();
  }

  function begin() {
    if (timer) return;
    timer = setTimer(tick, TICK_MS);
    timer.unref?.();
  }

  function end() {
    if (!timer) return;
    clearTimer(timer);
    timer = null;
  }

  return { create, createWebhook, list, remove, setEnabled, tick, trigger, begin, end };
}
