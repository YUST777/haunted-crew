import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const OUTPUT_CAP = 4000;
const DEFAULT_MAX = 50;
const LIVE_STEP = new Set(['running', 'waiting']);

const clone = (value) => structuredClone(value);

// Durable workflow runs. With no root the store is memory only.
// Runs are read and marked on construction: a store created after a restart
// sees every run that was live when the previous bridge stopped as interrupted.
export function createRunStore({ root, max = DEFAULT_MAX } = {}) {
  const cap = Number.isInteger(max) && max > 0 ? max : DEFAULT_MAX;
  const file = root ? join(root, '.haunted-crew', 'runs.json') : null;
  let runs = [];

  function persist() {
    if (!file) return;
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(runs, null, 2));
    renameSync(tmp, file);
  }

  function readDisk() {
    if (!file) return [];
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      return [];
    }
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((r) => r && typeof r === 'object' && r.id != null);
  }

  function markInterrupted(list) {
    const now = Date.now();
    let changed = false;
    for (const run of list) {
      if (run.status === 'running') {
        run.status = 'interrupted';
        run.error = 'bridge restarted';
        run.endedAt = now;
        changed = true;
      }
      if (!Array.isArray(run.steps)) continue;
      for (const step of run.steps) {
        if (step && LIVE_STEP.has(step.status)) {
          step.status = 'interrupted';
          step.endedAt = now;
          changed = true;
        }
      }
    }
    return changed;
  }

  runs = readDisk().slice(0, cap);
  if (markInterrupted(runs)) persist();

  return {
    save(run) {
      if (!run || run.id == null) throw new Error('run.id is required');
      const copy = clone(run);
      if (Array.isArray(copy.steps)) {
        for (const step of copy.steps) {
          if (step && typeof step.output === 'string' && step.output.length > OUTPUT_CAP) {
            step.output = step.output.slice(0, OUTPUT_CAP);
          }
        }
      }
      const i = runs.findIndex((r) => r.id === copy.id);
      if (i >= 0) runs[i] = copy;
      else runs.unshift(copy);
      runs = runs.slice(0, cap);
      persist();
    },

    load() {
      return runs.map(clone);
    },

    get(id) {
      const run = runs.find((r) => r.id === id);
      return run ? clone(run) : undefined;
    },

    remove(id) {
      const before = runs.length;
      runs = runs.filter((r) => r.id !== id);
      if (runs.length === before) return false;
      persist();
      return true;
    },
  };
}
