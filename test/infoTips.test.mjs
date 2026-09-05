// ─────────────────────────────────────────────────────────────────────────
// Tests for the 💡 IDEA ICONS system (admin-controlled result-box hints).
//
// Covers the tip registry (every icon has a key/subject/sentence), the
// master switch, admin sentence overrides, per-icon hiding via empty
// strings, and legacy catalogs that predate the feature.
// ─────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IDEA_TIPS,
  IDEA_TIP_PAGES,
  ideaTipsEnabled,
  ideaTipText,
} from '../src/infoTips.ts';

const byKey = new Map(IDEA_TIPS.map((t) => [t.key, t]));

test('registry: every idea icon has a unique key, page, subject and sentence', () => {
  assert.ok(IDEA_TIPS.length >= 20, `expected a full set of tips, got ${IDEA_TIPS.length}`);
  assert.equal(new Set(IDEA_TIPS.map((t) => t.key)).size, IDEA_TIPS.length, 'keys must be unique');
  for (const t of IDEA_TIPS) {
    assert.ok(t.page.trim(), `${t.key}: page label`);
    assert.ok(t.subject.trim(), `${t.key}: subject`);
    assert.ok(t.text.trim().length > 0, `${t.key}: default sentence`);
  }
});

test('registry: pages are listed in first-appearance order', () => {
  assert.deepEqual(IDEA_TIP_PAGES, [...new Set(IDEA_TIPS.map((t) => t.page))]);
});

test('expected icons exist (Target / NextSemester / WhatIf / FlightPath / Milestones)', () => {
  for (const key of [
    'target.currentCgpa',
    'target.target',
    'target.whatYouNeed',
    'target.bestPossible',
    'target.creditsCompleted',
    'target.creditsRemaining',
    'next.confirmed',
    'next.semester',
    'next.after',
    'whatif.credits',
    'whatif.remaining',
    'flight.current',
    'flight.target',
    'flight.required',
    'flight.projected',
    'flight.assumeGpa',
    'flight.flyRequired',
    'milestones.projectedAfter',
    'milestones.requiredAfter',
    'milestones.bestAfter',
    'milestones.creditsAhead',
    'milestones.best',
    'milestones.target',
    'milestones.user',
  ]) {
    assert.ok(byKey.has(key), `missing tip key: ${key}`);
  }
});

test('default (legacy catalog, no settings): icons ON with built-in sentences', () => {
  assert.equal(ideaTipsEnabled(undefined), true);
  assert.equal(ideaTipsEnabled({}), true);
  assert.equal(ideaTipsEnabled({ ideaTips: {} }), true);
  for (const t of IDEA_TIPS) {
    assert.equal(ideaTipText(undefined, t.key), t.text);
  }
});

test('master switch off hides every idea icon, even with overrides', () => {
  const settings = { ideaTips: { enabled: false, texts: { 'target.target': 'x' } } };
  assert.equal(ideaTipsEnabled(settings), false);
  for (const t of IDEA_TIPS) {
    assert.equal(ideaTipText(settings, t.key), undefined, `${t.key} should be hidden`);
  }
});

test('admin override rewords the sentence; other icons keep defaults', () => {
  const settings = { ideaTips: { texts: { 'flight.current': 'Admin sentence.' } } };
  assert.equal(ideaTipText(settings, 'flight.current'), 'Admin sentence.');
  assert.equal(ideaTipText(settings, 'flight.target'), byKey.get('flight.target').text);
});

test('whitespace-only override hides just that icon', () => {
  const settings = { ideaTips: { texts: { 'next.after': '   ' } } };
  assert.equal(ideaTipText(settings, 'next.after'), undefined);
  assert.equal(ideaTipText(settings, 'next.confirmed'), byKey.get('next.confirmed').text);
});

test('explicit enabled:true behaves like the default', () => {
  const settings = { ideaTips: { enabled: true } };
  assert.equal(ideaTipsEnabled(settings), true);
  assert.equal(ideaTipText(settings, 'target.target'), byKey.get('target.target').text);
});

test('unknown key never renders (undefined)', () => {
  assert.equal(ideaTipText({ ideaTips: { texts: {} } }, 'nope'), undefined);
  assert.equal(ideaTipText(undefined, 'nope'), undefined);
});
