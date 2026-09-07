// ─────────────────────────────────────────────────────────────────────────
// Tests for location-specific icon slots (per-placement admin adjustments).
//
// Guarantees:
//  • The same base icon is used everywhere by default.
//  • A location-specific override wins only at that placement.
//  • Base + located ids resolve through the same stable catalogue.
// ─────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  effectiveSlotIcon,
  iconLocationsForSlot,
  slotFallback,
} from '../src/config/branding.ts';

test('base icon is the shared default across every location', () => {
  const appearance = {
    icons: {
      whatif: { emoji: '🔀' },
    },
  };
  // No location override → every placement uses the base icon.
  assert.equal(effectiveSlotIcon(appearance, 'whatif', 'tile')?.emoji, '🔀');
  assert.equal(effectiveSlotIcon(appearance, 'whatif', 'nav')?.emoji, '🔀');
  assert.equal(effectiveSlotIcon(appearance, 'whatif', 'header')?.emoji, '🔀');
  assert.equal(effectiveSlotIcon(appearance, 'whatif', 'quick')?.emoji, '🔀');
});

test('a location-specific override applies ONLY to that placement', () => {
  const appearance = {
    icons: {
      whatif: { emoji: '🔀' },
      'whatif.tile': { emoji: '🖥️' },
    },
  };
  assert.equal(effectiveSlotIcon(appearance, 'whatif', 'tile')?.emoji, '🖥️');
  assert.equal(effectiveSlotIcon(appearance, 'whatif', 'nav')?.emoji, '🔀');
  assert.equal(effectiveSlotIcon(appearance, 'whatif', 'header')?.emoji, '🔀');
});

test('a located id resolves its own override, not the base', () => {
  const appearance = {
    icons: {
      ai: { emoji: '🤖' },
      'ai.fab': { emoji: '🚀' },
    },
  };
  assert.equal(effectiveSlotIcon(appearance, 'ai.fab', null)?.emoji, '🚀');
  assert.equal(effectiveSlotIcon(appearance, 'ai', 'fab')?.emoji, '🚀');
  assert.equal(effectiveSlotIcon(appearance, 'ai', 'header')?.emoji, '🤖');
});

test('tool slots expose the placement catalogue', () => {
  assert.deepEqual(iconLocationsForSlot('whatif'), ['tile', 'nav', 'header', 'quick']);
  assert.deepEqual(iconLocationsForSlot('ai'), ['fab', 'header', 'info']);
  // Single-use icons (e.g. the plane) have no placements to split.
  assert.deepEqual(iconLocationsForSlot('plane'), []);
});

test('fallback emoji resolves through the base id', () => {
  assert.equal(slotFallback('whatif'), '🔀');
  assert.equal(slotFallback('whatif.header'), '🔀');
});
