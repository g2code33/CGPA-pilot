// ─────────────────────────────────────────────────────────────────────────
// Tests for the SVG curve helpers behind the Flight Path graph.
// ─────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import { smoothPath, smoothAreaPath } from '../src/util/curve.ts';

test('smoothPath: degenerate inputs', () => {
  assert.equal(smoothPath([]), '');
  assert.equal(smoothPath([{ x: 1, y: 2 }]), 'M 1.0 2.0');
  const two = smoothPath([{ x: 0, y: 0 }, { x: 10, y: 5 }]);
  assert.equal(two, 'M 0.0 0.0 L 10.0 5.0');
});

test('smoothPath: starts at first point, ends at last, uses cubic curves', () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 10, y: 20 },
    { x: 20, y: 5 },
    { x: 30, y: 15 },
  ];
  const d = smoothPath(pts);
  assert.ok(d.startsWith('M 0.0 0.0'), 'starts at first point');
  assert.ok(d.endsWith('30.0 15.0'), 'ends at last point');
  assert.ok(d.includes(' C '), 'uses cubic Bézier segments');
});

test('smoothPath: collinear points stay exactly on the line', () => {
  const d = smoothPath([
    { x: 0, y: 0 },
    { x: 10, y: 10 },
    { x: 20, y: 20 },
  ]);
  // Every (x, y) pair in the path must satisfy y === x (± rounding).
  const pairs = d.match(/-?\d+\.?\d* (?:C |L |M )?-?\d+\.?\d*/g) ?? [];
  const nums = pairs
    .join(' ')
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  assert.ok(nums.length >= 6, 'path has coordinates');
  for (let i = 0; i + 1 < nums.length; i += 2) {
    assert.ok(
      Math.abs(nums[i] - nums[i + 1]) < 0.15,
      `point (${nums[i]}, ${nums[i + 1]}) lies on y = x`
    );
  }
});

test('smoothAreaPath: closes down to the baseline', () => {
  const d = smoothAreaPath([{ x: 0, y: 0 }, { x: 10, y: 10 }], 100);
  assert.ok(d.endsWith('L 10.0 100.0 L 0.0 100.0 Z'), 'drops to baseline and closes');
  assert.equal(smoothAreaPath([{ x: 0, y: 0 }], 100), '', 'needs ≥ 2 points');
});
