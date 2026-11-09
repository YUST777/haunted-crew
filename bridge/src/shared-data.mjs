// Shared SQLite database for all agents on a crew (modelled on OpenBot's agent-data.db).
// node:sqlite has no authorizer, so every statement is checked by tokenizing the SQL first.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const MAX_SQL = 8000;
const MAX_PARAMS = 50;
const MAX_ROWS = 200;
const META = 'hc_meta';
const DML = new Set(['INSERT', 'UPDATE', 'DELETE']);
// Bare keywords that may never appear in a SELECT/WITH, so no write can hide inside a query.
const WRITE_WORDS = new Set(['INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'ALTER', 'REPLACE']);
const BANNED = new Set(['ATTACH', 'DETACH', 'PRAGMA', 'VACUUM', 'LOAD_EXTENSION']);

// ASCII-only lowercase: matches SQLite's identifier case rules exactly.
const key = (s) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());
const quoteIdent = (s) => `"${s.replace(/"/g, '""')}"`;

// Token kinds: word (bare), ident (quoted identifier), str (string literal), punct, other.
function tokenize(sql) {
  const toks = [];
  let i = 0;
  const readQuoted = (close, kind) => {
    let v = '';
    for (let j = i + 1; ; j++) {
      if (j >= sql.length) throw new Error('unterminated quote in SQL');
      if (sql[j] === close) {
        if (sql[j + 1] === close) { v += close; j++; continue; }
        toks.push({ t: kind, v });
        i = j + 1;
        return;
      }
      v += sql[j];
    }
  };
  while (i < sql.length) {
    const c = sql[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '-' && sql[i + 1] === '-') {
      const e = sql.indexOf('\n', i);
      i = e < 0 ? sql.length : e + 1;
      continue;
    }
    if (c === '/' && sql[i + 1] === '*') {
      const e = sql.indexOf('*/', i + 2);
      if (e < 0) throw new Error('unterminated comment in SQL');
      i = e + 2;
      continue;
    }
    if (c === "'") { readQuoted("'", 'str'); continue; }
    if (c === '"' || c === '`') { readQuoted(c, 'ident'); continue; }
    if (c === '[') {
      const e = sql.indexOf(']', i);
      if (e < 0) throw new Error('unterminated [identifier] in SQL');
      toks.push({ t: 'ident', v: sql.slice(i + 1, e) });
      i = e + 1;
      continue;
    }
    const w = /^[A-Za-z_\u0080-￿][A-Za-z0-9_$\u0080-￿]*/.exec(sql.slice(i, i + 200));
    if (w) { toks.push({ t: 'word', v: w[0] }); i += w[0].length; continue; }
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < sql.length && /[0-9A-Za-z_.]/.test(sql[j])) j++;
      toks.push({ t: 'other', v: sql.slice(i, j) });
      i = j;
      continue;
    }
    toks.push({ t: 'punct', v: c });
    i++;
  }
  return toks;
}

// Validates one statement and returns its tokens (without trailing semicolons).
function checkSql(sql, params) {
  if (typeof sql !== 'string' || !sql.trim()) throw new Error('sql must be a non-empty string');
  if (sql.length > MAX_SQL) throw new Error(`sql longer than ${MAX_SQL} chars`);
  if (sql.includes('\0')) throw new Error('NUL byte in SQL');
  if (!Array.isArray(params) || params.length > MAX_PARAMS) throw new Error(`params must be an array of at most ${MAX_PARAMS}`);
  const toks = tokenize(sql);
  const semi = toks.findIndex((t) => t.t === 'punct' && t.v === ';');
  if (semi >= 0 && toks.slice(semi).some((t) => !(t.t === 'punct' && t.v === ';'))) {
    throw new Error('one statement per call: found SQL after ";"');
  }
  const body = semi >= 0 ? toks.slice(0, semi) : toks;
  if (!body.length) throw new Error('empty statement');
  for (const t of toks) {
    if (t.t === 'word' && BANNED.has(t.v.toUpperCase())) throw new Error(`${t.v.toUpperCase()} is not allowed`);
    if (t.t === 'word' || t.t === 'ident' || t.t === 'str') {
      const k = key(t.v);
      if (k === META) throw new Error(`${META} is reserved`);
      if (k.startsWith('sqlite_')) throw new Error('sqlite_ internals are not allowed');
    }
  }
  return body;
}

const word = (t) => (t && t.t === 'word' ? t.v.toUpperCase() : null);
const isPunct = (t, c) => t && t.t === 'punct' && t.v === c;

// Name token of a DDL statement: a single identifier, no schema qualifier.
function nameAt(body, i) {
  const t = body[i];
  if (!t || !['word', 'ident', 'str'].includes(t.t)) throw new Error('expected a table name');
  if (isPunct(body[i + 1], '.')) throw new Error('schema-qualified names are not allowed in DDL');
  return t.v;
}

// Works out what a non-query statement does, so ownership can be checked before it runs.
function classify(body) {
  const first = word(body[0]);
  if (DML.has(first)) return { type: first };
  if (first === 'CREATE') {
    if (word(body[1]) === 'TABLE') {
      const i = word(body[2]) === 'IF' && word(body[3]) === 'NOT' && word(body[4]) === 'EXISTS' ? 5 : 2;
      return { type: 'CREATE_TABLE', name: nameAt(body, i) };
    }
    const j = word(body[1]) === 'UNIQUE' ? 2 : 1;
    if (word(body[j]) === 'INDEX') return { type: 'CREATE_INDEX' };
  }
  if (first === 'DROP' && word(body[1]) === 'TABLE') {
    const i = word(body[2]) === 'IF' && word(body[3]) === 'EXISTS' ? 4 : 2;
    return { type: 'DROP_TABLE', name: nameAt(body, i) };
  }
  if (first === 'ALTER' && word(body[1]) === 'TABLE') {
    const name = nameAt(body, 2);
    const renamed = word(body[3]) === 'RENAME' && word(body[4]) === 'TO' ? nameAt(body, 5) : null;
    return { type: 'ALTER_TABLE', name, renamed };
  }
  throw new Error('only INSERT, UPDATE, DELETE, CREATE TABLE/INDEX, DROP TABLE and ALTER TABLE are allowed');
}

export function createSharedData({ root } = {}) {
  let db;
  if (root === undefined) {
    db = new DatabaseSync(':memory:');
  } else {
    const dir = join(root, '.haunted-crew');
    mkdirSync(dir, { recursive: true });
    db = new DatabaseSync(join(dir, 'agent-data.db'));
  }
  db.exec(`CREATE TABLE IF NOT EXISTS ${META}(table_name TEXT PRIMARY KEY, owner TEXT NOT NULL)`);

  const ownerOf = (name) => {
    const row = db.prepare(`SELECT owner FROM ${META} WHERE table_name = ?`).get(key(name));
    return row ? row.owner : undefined;
  };
  const assertOwner = (agent, name, { needOwner }) => {
    const owner = ownerOf(name);
    if (owner === undefined) {
      if (needOwner) throw new Error(`table "${name}" has no owner and cannot be dropped`);
      return;
    }
    if (owner !== agent) throw new Error(`table "${name}" is owned by ${owner}`);
  };
  const inTx = (fn) => {
    db.exec('BEGIN');
    try {
      const out = fn();
      db.exec('COMMIT');
      return out;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
  const checkAgent = (agent) => {
    if (typeof agent !== 'string' || !agent) throw new Error('agent must be a non-empty string');
  };

  function query(agent, sql, params = []) {
    checkAgent(agent);
    const body = checkSql(sql, params);
    const first = word(body[0]);
    if (first !== 'SELECT' && first !== 'WITH') throw new Error('query only allows SELECT');
    // REPLACE( is the string function, so only a bare REPLACE statement counts.
    body.forEach((t, i) => {
      if (t.t === 'word' && WRITE_WORDS.has(t.v.toUpperCase()) && !isPunct(body[i + 1], '(')) {
        throw new Error(`${t.v.toUpperCase()} is not allowed in query`);
      }
    });
    // Belt and braces: whatever happens, the query leaves no writes behind.
    db.exec('SAVEPOINT q');
    try {
      const stmt = db.prepare(sql);
      stmt.setReturnArrays(true);
      const columns = stmt.columns().map((c) => c.name);
      const rows = [];
      let truncated = false;
      for (const row of stmt.iterate(...params)) {
        if (rows.length === MAX_ROWS) { truncated = true; break; }
        rows.push(row);
      }
      return { columns, rows, truncated };
    } finally {
      db.exec('ROLLBACK TO q');
      db.exec('RELEASE q');
    }
  }

  function execute(agent, sql, params = []) {
    checkAgent(agent);
    const body = checkSql(sql, params);
    const op = classify(body);
    if (op.type === 'DROP_TABLE') assertOwner(agent, op.name, { needOwner: true });
    if (op.type === 'ALTER_TABLE') assertOwner(agent, op.name, { needOwner: false });
    return inTx(() => {
      const r = db.prepare(sql).run(...params);
      if (op.type === 'CREATE_TABLE') {
        db.prepare(`INSERT OR IGNORE INTO ${META}(table_name, owner) VALUES (?, ?)`).run(key(op.name), agent);
      } else if (op.type === 'DROP_TABLE') {
        db.prepare(`DELETE FROM ${META} WHERE table_name = ?`).run(key(op.name));
      } else if (op.type === 'ALTER_TABLE' && op.renamed) {
        db.prepare(`UPDATE ${META} SET table_name = ? WHERE table_name = ?`).run(key(op.renamed), key(op.name));
      }
      return { changes: Number(r.changes) };
    });
  }

  function tables() {
    const owners = new Map(db.prepare(`SELECT table_name, owner FROM ${META}`).all().map((r) => [r.table_name, r.owner]));
    return db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all()
      .filter((r) => !key(r.name).startsWith('sqlite_') && key(r.name) !== META)
      .map((r) => ({
        name: r.name,
        owner: owners.get(key(r.name)) ?? null,
        columns: db.prepare(`PRAGMA table_info(${quoteIdent(r.name)})`).all().map((c) => ({ name: c.name, type: c.type })),
      }));
  }

  function deleteTable(agent, name) {
    return execute(agent, `DROP TABLE ${quoteIdent(name)}`);
  }

  return { query, execute, tables, deleteTable };
}
