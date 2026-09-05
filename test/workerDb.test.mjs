// ─────────────────────────────────────────────────────────────────────────
// worker db — ensureExtraTables (regression):
//
//   Production incident: D1's exec() fails on multi-line / multi-statement
//   scripts (workers-sdk #9133). The original table creation used exec()
//   with a two-statement script, so the ai_settings / admin_drafts tables
//   were NEVER created on the live database — every AI route 500'd, and the
//   old .catch() permanently cached the failed attempt.
//
//   These tests pin the fix:
//     1. tables are created via db.batch() with ONE statement per entry
//     2. success is cached (no repeated DDL)
//     3. a FAILED attempt is NOT cached — the next request retries
// ─────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureExtraTables } from '../worker/src/db.ts';

test('ensureExtraTables uses db.batch with a SINGLE statement per entry', async () => {
  const calls = [];
  const preparedSql = [];
  const fakeDb = {
    prepare(sql) {
      preparedSql.push(sql);
      return { sql, async run() { return { meta: {} }; }, async first() { return null; } };
    },
    async batch(stmts) {
      calls.push(stmts);
      return stmts.map(() => ({ meta: {} }));
    },
  };
  globalThis.__cgpaEnsureExtra = undefined;
  try {
    await ensureExtraTables(fakeDb);
    assert.equal(calls.length, 1, 'must create via batch()');
    assert.equal(calls[0].length, 3);
    assert.equal(preparedSql.length, 3);
    for (const sql of preparedSql) {
      const body = sql.trim().replace(/;\s*$/, '');
      assert.ok(!body.includes(';'), `each prepared statement must be single (D1 exec multi-statement bug): ${sql}`);
      assert.match(sql, /^CREATE TABLE IF NOT EXISTS /);
      assert.ok(!sql.includes('\n'), 'no multi-line scripts (D1 exec bug #9133)');
    }
    assert.match(preparedSql[0], /ai_settings/);
    assert.match(preparedSql[1], /admin_drafts/);
    assert.match(preparedSql[2], /ai_errors/);

    // Success is cached — no repeated DDL on the next request.
    await ensureExtraTables(fakeDb);
    assert.equal(calls.length, 1);
  } finally {
    globalThis.__cgpaEnsureExtra = undefined;
  }
});

test('ensureExtraTables does NOT cache a failed attempt — it retries next request', async () => {
  let fail = true;
  const fakeDb = {
    prepare(sql) {
      return { sql, async run() { return { meta: {} }; }, async first() { return null; } };
    },
    async batch(stmts) {
      if (fail) throw new Error('D1_EXEC_ERROR: incomplete input');
      return stmts.map(() => ({ meta: {} }));
    },
  };
  globalThis.__cgpaEnsureExtra = undefined;
  try {
    await assert.rejects(() => ensureExtraTables(fakeDb), /D1_EXEC_ERROR/);
    fail = false;
    await ensureExtraTables(fakeDb); // must attempt the DDL again
  } finally {
    globalThis.__cgpaEnsureExtra = undefined;
  }
});
