import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createSharedData } from '../src/shared-data.mjs';

const fresh = () => createSharedData({ root: mkdtempSync(join(tmpdir(), 'hc-data-')) });

test('create, insert, select; db file lives under .haunted-crew', () => {
  const root = mkdtempSync(join(tmpdir(), 'hc-data-'));
  const d = createSharedData({ root });
  assert.deepEqual(d.execute('ana', 'CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT)'), { changes: 0 });
  assert.deepEqual(d.execute('ana', 'INSERT INTO notes(body) VALUES (?), (?)', ['hi', 'yo']), { changes: 2 });
  const r = d.query('ana', 'SELECT id, body FROM notes ORDER BY id');
  assert.deepEqual(r, { columns: ['id', 'body'], rows: [[1, 'hi'], [2, 'yo']], truncated: false });
  assert.ok(existsSync(join(root, '.haunted-crew', 'agent-data.db')));
});

test('tables() reports owner and columns', () => {
  const d = fresh();
  d.execute('ana', 'CREATE TABLE t1(a INT, b TEXT)');
  assert.deepEqual(d.tables(), [{ name: 't1', owner: 'ana', columns: [{ name: 'a', type: 'INT' }, { name: 'b', type: 'TEXT' }] }]);
});

test('other agents may write shared tables', () => {
  const d = fresh();
  d.execute('ana', 'CREATE TABLE shared(x)');
  assert.equal(d.execute('bob', 'INSERT INTO shared VALUES (1)').changes, 1);
  assert.equal(d.execute('bob', 'UPDATE shared SET x = 2').changes, 1);
  assert.equal(d.execute('bob', 'DELETE FROM shared').changes, 1);
});

test('ownership: non-owner cannot DROP or ALTER', () => {
  const d = fresh();
  d.execute('ana', 'CREATE TABLE t(x)');
  assert.throws(() => d.execute('bob', 'DROP TABLE t'), { message: 'table "t" is owned by ana' });
  assert.throws(() => d.execute('bob', 'ALTER TABLE t ADD COLUMN y'), { message: 'table "t" is owned by ana' });
  assert.throws(() => d.execute('bob', 'ALTER TABLE t RENAME TO u'), { message: 'table "t" is owned by ana' });
  assert.throws(() => d.deleteTable('bob', 't'), { message: 'table "t" is owned by ana' });
  assert.equal(d.tables()[0].name, 't');
});

test('ownership: owner can ALTER, rename keeps ownership, and DROP', () => {
  const d = fresh();
  d.execute('ana', 'CREATE TABLE t(x)');
  d.execute('ana', 'ALTER TABLE t ADD COLUMN y');
  d.execute('ana', 'ALTER TABLE t RENAME TO u');
  assert.equal(d.tables()[0].owner, 'ana');
  assert.throws(() => d.execute('bob', 'DROP TABLE u'), { message: 'table "u" is owned by ana' });
  d.execute('ana', 'DROP TABLE IF EXISTS u');
  assert.deepEqual(d.tables(), []);
});

test('deleteTable by owner works and clears the owner row', () => {
  const d = fresh();
  d.execute('ana', 'CREATE TABLE gone(x)');
  d.deleteTable('ana', 'gone');
  assert.deepEqual(d.tables(), []);
  d.execute('bob', 'CREATE TABLE gone(x)'); // name is free again, bob owns it
  assert.equal(d.tables()[0].owner, 'bob');
});

test('tables with no owner row cannot be dropped', () => {
  const root = mkdtempSync(join(tmpdir(), 'hc-data-'));
  mkdirSync(join(root, '.haunted-crew'));
  const raw = new DatabaseSync(join(root, '.haunted-crew', 'agent-data.db'));
  raw.exec('CREATE TABLE orphan(x)'); // made outside the API, so no hc_meta row
  raw.close();
  const d = createSharedData({ root });
  assert.equal(d.tables()[0].owner, null);
  assert.throws(() => d.execute('ana', 'DROP TABLE orphan'), /has no owner and cannot be dropped/);
});

test('hc_meta tampering is blocked, however it is spelled', () => {
  const d = fresh();
  d.execute('ana', 'CREATE TABLE t(x)');
  const attacks = [
    'SELECT * FROM hc_meta',
    'SELECT owner FROM "hc_meta"',
    'SELECT owner FROM [hc_meta]',
    'SELECT owner FROM `HC_META`',
    'SELECT owner FROM HC_Meta',
    'SELECT owner FROM main.hc_meta',
    "SELECT owner FROM 'hc_meta'",
    'SELECT owner FROM hc_meta /* x */',
    'DELETE FROM hc_meta',
    'INSERT INTO hc_meta VALUES (\'t\', \'bob\')',
    'UPDATE hc_meta SET owner = \'bob\'',
    'DROP/**/TABLE hc_meta',
    'DROP TABLE "hc_meta"',
    'DROP -- sneaky\nTABLE hc_meta',
    'DROP\tTABLE\n[hc_meta]',
    'DROP TABLE IF EXISTS "Hc_Meta"',
    'ALTER TABLE hc_meta ADD COLUMN z',
    'ALTER TABLE t RENAME TO hc_meta',
    'CREATE INDEX i ON hc_meta(owner)',
    'CREATE TABLE x AS SELECT * FROM hc_meta',
  ];
  for (const sql of attacks) {
    assert.throws(() => (/^(SELECT|WITH)/i.test(sql) ? d.query('bob', sql) : d.execute('bob', sql)), /hc_meta is reserved|only|not allowed/, sql);
  }
  assert.equal(d.tables()[0].owner, 'ana');
});

test('ATTACH, DETACH, PRAGMA, VACUUM, load_extension and sqlite_ internals are blocked', () => {
  const d = fresh();
  for (const sql of [
    "ATTACH DATABASE '/tmp/x.db' AS evil",
    'DETACH DATABASE main',
    'PRAGMA writable_schema = 1',
    'VACUUM',
    "SELECT load_extension('/tmp/x.so')",
    'DELETE FROM sqlite_master',
    'DROP TABLE sqlite_sequence',
    'SELECT * FROM "sqlite_schema"',
  ]) {
    assert.throws(() => (/^SELECT/i.test(sql) ? d.query('bob', sql) : d.execute('bob', sql)), /not allowed|sqlite_|only/, sql);
  }
});

test('one statement per call', () => {
  const d = fresh();
  d.execute('ana', 'CREATE TABLE t(x)');
  assert.throws(() => d.execute('ana', 'INSERT INTO t VALUES (1); DROP TABLE t'), /one statement/);
  assert.throws(() => d.execute('ana', 'INSERT INTO t VALUES (1) -- ok\n; SELECT 1'), /one statement/);
  assert.throws(() => d.query('ana', 'SELECT 1; SELECT 2'), /one statement/);
  assert.equal(d.execute('ana', "INSERT INTO t VALUES ('a;b');").changes, 1); // ; inside quotes and trailing ; are fine
  assert.equal(d.query('ana', 'SELECT x FROM t').rows[0][0], 'a;b');
});

test('execute allows only the listed statement kinds', () => {
  const d = fresh();
  d.execute('ana', 'CREATE TABLE t(x)');
  for (const sql of ['SELECT 1', 'REPLACE INTO t VALUES (1)', 'CREATE TRIGGER tr AFTER INSERT ON t BEGIN SELECT 1; END', 'CREATE TEMP TABLE z(x)', 'EXPLAIN DELETE FROM t', 'DROP INDEX i', 'BEGIN']) {
    assert.throws(() => d.execute('ana', sql), /only INSERT|one statement/, sql);
  }
  d.execute('ana', 'CREATE INDEX ix ON t(x)');
  d.execute('ana', 'CREATE UNIQUE INDEX IF NOT EXISTS ux ON t(x)');
});

test('query rejects anything that is not a read', () => {
  const d = fresh();
  d.execute('ana', 'CREATE TABLE t(x)');
  d.execute('ana', 'INSERT INTO t VALUES (1)');
  for (const sql of ['DELETE FROM t', 'INSERT INTO t VALUES (2)', 'WITH c AS (SELECT 1) DELETE FROM t', 'WITH c AS (SELECT 1) INSERT INTO t SELECT * FROM c', 'UPDATE t SET x = 9', 'SELECT 1 FROM t; DELETE FROM t']) {
    assert.throws(() => d.query('ana', sql), /query only allows|not allowed|one statement/, sql);
  }
  assert.equal(d.query('ana', 'SELECT replace(\'a\', \'a\', \'b\') AS r').rows[0][0], 'b');
  assert.equal(d.query('ana', 'WITH c AS (SELECT x FROM t) SELECT count(*) FROM c').rows[0][0], 1);
});

test('query row cap: 200 rows, truncated flag set', () => {
  const d = fresh();
  d.execute('ana', 'CREATE TABLE n(i)');
  d.execute('ana', 'INSERT INTO n WITH RECURSIVE c(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM c WHERE i < 250) SELECT i FROM c');
  const r = d.query('ana', 'SELECT i FROM n ORDER BY i');
  assert.equal(r.rows.length, 200);
  assert.equal(r.truncated, true);
  assert.equal(d.query('ana', 'SELECT i FROM n WHERE i <= 5').truncated, false);
});

test('length and param caps', () => {
  const d = fresh();
  assert.throws(() => d.query('ana', 'SELECT ' + "'x'".repeat(2700)), /longer than 8000/);
  assert.throws(() => d.query('ana', 'SELECT ?', Array(51).fill(1)), /at most 50/);
  assert.equal(d.query('ana', 'SELECT ' + Array(50).fill('?').join(','), Array(50).fill(7)).rows[0].length, 50);
});
