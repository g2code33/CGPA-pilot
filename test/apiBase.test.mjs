// ─────────────────────────────────────────────────────────────────────────
// Tests for configApiBase — the production API base used by native clients.
// ─────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';

const api = await import('../src/config/apiBase.ts');

const PRODUCTION_API_BASE = 'https://cgpa-pilot.calcitoninpay.workers.dev';

test('native Capacitor apps use the production config API (no same-origin localhost /api)', () => {
  const prev = globalThis.window;
  globalThis.window = {
    location: { protocol: 'https:', hostname: 'localhost' },
    Capacitor: { isNativePlatform: () => true },
  };
  try {
    // Capacitor native would otherwise call /api on https://localhost which
    // does not host the Worker — it must use the published Worker origin.
    assert.equal(api.configApiBase(), PRODUCTION_API_BASE);
  } finally {
    globalThis.window = prev;
  }
});

test('Electron desktop also uses the production config API', () => {
  const prev = globalThis.window;
  globalThis.window = {
    location: { protocol: 'file:', hostname: '' },
    cgpaPilot: {},
  };
  try {
    assert.equal(api.configApiBase(), PRODUCTION_API_BASE);
  } finally {
    globalThis.window = prev;
  }
});

test('a plain web page keeps same-origin /api by default', () => {
  const prev = globalThis.window;
  globalThis.window = {
    location: { protocol: 'https:', hostname: 'example.com' },
  };
  try {
    assert.equal(api.configApiBase(), '');
  } finally {
    globalThis.window = prev;
  }
});
