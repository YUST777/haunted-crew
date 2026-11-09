// Export/import of the crew's saved state: <root>/.haunted-crew/** and <root>/.kiro/skills/**/SKILL.md.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';

const MAX_FILES = 5000;
const MAX_BYTES = 20 * 1024 * 1024;
const SECRET_KEY = /(secret|token|password|api[_-]?key)/i;
const DB_FILE = /\.(db|sqlite3?)(-wal|-shm|-journal)?$/i;
const SKIP_STATE = /^tokens.*\.json$/i; // credential files never leave the machine

// Strips secrets from parsed JSON: matching string/object values and any non-null `secret` become null.
function redact(v) {
  if (Array.isArray(v)) return v.map(redact);
  if (!v || typeof v !== 'object') return v;
  const o = {};
  for (const [k, x] of Object.entries(v)) {
    const hit = (SECRET_KEY.test(k) && (typeof x === 'string' || (x !== null && typeof x === 'object'))) || (k === 'secret' && x !== null);
    o[k] = hit ? null : redact(x);
  }
  return o;
}

// Returns the sanitized text, or null when the file must be dropped entirely.
function sanitize(rel, text) {
  if (rel.endsWith('.json')) {
    try {
      return JSON.stringify(redact(JSON.parse(text)), null, 2);
    } catch {
      return null; // unparseable: cannot prove it is secret-free
    }
  }
  if (rel.endsWith('.jsonl')) {
    const lines = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        lines.push(JSON.stringify(redact(JSON.parse(line))));
      } catch {
        // corrupt line dropped
      }
    }
    return lines.map((l) => `${l}\n`).join('');
  }
  return text;
}

function walk(dir, keep, out = []) {
  if (!existsSync(dir)) return out;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) walk(p, keep, out);
    else if (ent.isFile() && keep(ent.name)) out.push(p);
  }
  return out;
}

function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, file);
}

// Import paths must sit under .haunted-crew/ or be a .kiro/skills/<...>/SKILL.md file.
function safeTarget(root, rel) {
  if (typeof rel !== 'string' || !rel || rel.includes('\0') || rel.includes('\\')) throw new Error(`bad path: ${rel}`);
  if (posix.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) throw new Error(`absolute path rejected: ${rel}`);
  const parts = rel.split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..')) throw new Error(`path traversal rejected: ${rel}`);
  const ok = parts[0] === '.haunted-crew'
    ? parts.length >= 2
    : parts[0] === '.kiro' && parts[1] === 'skills' && parts.length >= 3 && parts.at(-1) === 'SKILL.md';
  if (!ok) throw new Error(`path outside allowed dirs: ${rel}`);
  const target = resolve(root, ...parts);
  if (!target.startsWith(resolve(root) + sep)) throw new Error(`path escapes root: ${rel}`);
  return target;
}

export function createBackup({ root }) {
  if (typeof root !== 'string' || !root) throw new TypeError('root must be a path');
  const base = resolve(root);

  function exportBundle() {
    const paths = [
      ...walk(join(base, '.haunted-crew'), (n) => !SKIP_STATE.test(n) && !n.endsWith('.tmp')),
      ...walk(join(base, '.kiro', 'skills'), (n) => n === 'SKILL.md'),
    ];
    if (paths.length > MAX_FILES) throw new RangeError(`too many files: ${paths.length} > ${MAX_FILES}`);
    const files = {};
    const binary = {};
    let total = 0;
    for (const abs of paths) {
      total += statSync(abs).size;
      if (total > MAX_BYTES) throw new RangeError('backup exceeds 20 MB');
      const rel = relative(base, abs).split(sep).join('/');
      const buf = readFileSync(abs);
      if (DB_FILE.test(rel) || buf.includes(0)) {
        binary[rel] = buf.toString('base64');
        continue;
      }
      const text = sanitize(rel, buf.toString('utf8'));
      if (text !== null) files[rel] = text;
    }
    return { version: 1, createdAt: new Date().toISOString(), files, binary };
  }

  function importBundle(bundle, { overwrite = false } = {}) {
    if (!bundle || bundle.version !== 1 || !bundle.files || typeof bundle.files !== 'object') {
      throw new TypeError('not a version 1 backup bundle');
    }
    const entries = [];
    for (const [rel, text] of Object.entries(bundle.files)) {
      if (typeof text !== 'string') throw new TypeError(`file content must be text: ${rel}`);
      entries.push([rel, text]);
    }
    for (const [rel, b64] of Object.entries(bundle.binary ?? {})) {
      if (typeof b64 !== 'string') throw new TypeError(`binary content must be base64: ${rel}`);
      entries.push([rel, Buffer.from(b64, 'base64')]);
    }
    const size = entries.reduce((n, [, d]) => n + Buffer.byteLength(d), 0);
    if (size > MAX_BYTES) throw new RangeError('backup exceeds 20 MB');
    // Validate every path before writing anything.
    const plan = entries.map(([rel, data]) => ({ rel, data, target: safeTarget(base, rel) }));
    const written = [];
    const skipped = [];
    for (const { rel, data, target } of plan) {
      if (existsSync(target) && !overwrite) {
        skipped.push(rel);
        continue;
      }
      mkdirSync(dirname(target), { recursive: true });
      writeAtomic(target, data);
      written.push(rel);
    }
    return { written, skipped };
  }

  return { export: exportBundle, import: importBundle };
}
