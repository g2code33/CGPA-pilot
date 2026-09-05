// ─────────────────────────────────────────────────────────────────────────
// Tests for the STUDENT PERMISSIONS registry (admin Permissions section).
//
// Covers: registry shape, defaults, write→read round-trips, sentence
// preservation when the idea-tips toggle flips, and the seed-catalog
// fallback (no settings published → every permission reports its default).
// ─────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import { STUDENT_PERMISSIONS, permissionOn } from '../src/permissions.ts';
import { ideaTipsEnabled } from '../src/infoTips.ts';

test('registry: every permission has id/label/hint and a sane default', () => {
  assert.ok(STUDENT_PERMISSIONS.length >= 5, 'expected the full permission set');
  const ids = new Set(STUDENT_PERMISSIONS.map((p) => p.id));
  assert.equal(ids.size, STUDENT_PERMISSIONS.length, 'ids must be unique');
  for (const p of STUDENT_PERMISSIONS) {
    assert.ok(p.id.trim(), 'id');
    assert.ok(p.label.trim(), `${p.id}: label`);
    assert.ok(p.hint.trim(), `${p.id}: hint`);
    assert.equal(typeof p.defaultOn, 'boolean', `${p.id}: defaultOn`);
  }
});

test('registry: defaults are exactly read(undefined)', () => {
  for (const p of STUDENT_PERMISSIONS) {
    assert.equal(p.read(undefined), p.defaultOn, p.id);
  }
});

test('registry: write→read round-trip in both directions', () => {
  for (const p of STUDENT_PERMISSIONS) {
    const on = p.write(undefined, true);
    assert.equal(p.read(on), true, `${p.id}: write(true)`);
    const off = p.write(undefined, false);
    assert.equal(p.read(off), false, `${p.id}: write(false)`);
    const again = p.write(off, true);
    assert.equal(p.read(again), true, `${p.id}: write(true) again`);
  }
});

test('idea-tips toggle preserves admin-edited sentences', () => {
  const p = STUDENT_PERMISSIONS.find((x) => x.id === 'ideaTips');
  assert.ok(p, 'ideaTips permission exists');
  const withTexts = { ideaTips: { enabled: false, texts: { 'target.target': 'X' } } };
  const next = p.write(withTexts, true);
  assert.equal(next.ideaTips.texts['target.target'], 'X', 'sentences survive the flip');
  assert.equal(ideaTipsEnabled(next), true);
});

test('seed catalog (no published settings): every permission reports its default', () => {
  for (const p of STUDENT_PERMISSIONS) {
    assert.equal(permissionOn(p.id), p.defaultOn, p.id);
  }
});
