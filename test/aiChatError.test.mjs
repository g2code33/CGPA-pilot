// ─────────────────────────────────────────────────────────────────────────
// aiChat — SMART failure diagnosis (the "but my internet is on!" fix):
//
//   When the browser REJECTS the chat request, the old code unconditionally
//   told the student "you appear to be offline" — even when the internet
//   was fine and the AI service itself had failed (e.g. the Worker's SSE
//   response was missing CORS headers, a network drop, a 5xx reset).
//
//   Now the client PROVES which it is by probing the public status endpoint:
//     • probe answers (any HTTP status) → connection fine → 'service-error'
//     • probe also fails                → genuinely offline → 'offline'
//   Either outcome is reported (fire-and-forget, technical-only) to
//   POST /api/ai/report so the admin error log shows student-side failures
//   that never reach the Worker.
// ─────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyWorkerFailure, streamAiMessage } from '../src/services/aiChat.ts';

const STATUS_DOC = {
  format: 'cgpa-ai-status',
  enabled: true,
  ready: true,
  label: 'Test AI',
  notice: '',
  providers: [],
  direct: null,
  defaultProviderId: null,
  version: 1,
  updatedAt: null,
};

/** Fake fetch: dispatches on URL regex; `throw` rejects like a browser TypeError. */
function fakeFetch(handlers) {
  const calls = [];
  const f = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, opts });
    for (const h of handlers) {
      if (h.match.test(u)) {
        if (h.throw) throw new TypeError('Failed to fetch');
        return new Response(h.body ?? '', { status: h.status ?? 200, headers: { 'content-type': 'application/json' } });
      }
    }
    return new Response('not found', { status: 404, headers: { 'content-type': 'application/json' } });
  };
  return { f, calls };
}

test('classifyWorkerFailure: worker REACHABLE → service-error (never a false "offline") + reported to admin', async () => {
  const { f, calls } = fakeFetch([
    { match: /\/api\/ai\/status/, status: 200, body: JSON.stringify(STATUS_DOC) },
    { match: /\/api\/ai\/report/, status: 200, body: '{"ok":true}' },
  ]);
  const real = globalThis.fetch;
  globalThis.fetch = f;
  try {
    const res = await classifyWorkerFailure('Failed to fetch');
    assert.equal(res.ok, false);
    assert.equal(res.code, 'service-error');
    // The student is told the truth: internet fine, service-side problem.
    assert.match(res.message, /internet connection is fine/i);
    assert.match(res.message, /administrator/i);
    // The technical event was reported for the admin error log.
    const report = calls.find((c) => c.url.includes('/api/ai/report'));
    assert.ok(report, 'a client error report must be fired');
    const body = JSON.parse(report.opts.body);
    assert.equal(body.code, 'service-error');
    assert.match(body.detail, /Failed to fetch/);
  } finally {
    globalThis.fetch = real;
  }
});

test('classifyWorkerFailure: worker UNREACHABLE → true offline (and a failed report never breaks it)', async () => {
  const { f } = fakeFetch([
    { match: /\/api\/ai\/status/, throw: true },
    { match: /\/api\/ai\/report/, throw: true }, // the report path is down too — must not throw
  ]);
  const real = globalThis.fetch;
  globalThis.fetch = f;
  try {
    const res = await classifyWorkerFailure('Failed to fetch');
    assert.equal(res.ok, false);
    assert.equal(res.code, 'offline');
    assert.match(res.message, /offline/i);
  } finally {
    globalThis.fetch = real;
  }
});

test('streamAiMessage: a rejected chat request is CLASSIFIED (probe decides), not blindly "offline"', async () => {
  // The chat POST dies in the browser; the status probe succeeds → the
  // student gets "service-error", not a false offline.
  const { f } = fakeFetch([
    { match: /\/api\/ai\/chat/, throw: true },
    { match: /\/api\/ai\/status/, status: 200, body: JSON.stringify(STATUS_DOC) },
    { match: /\/api\/ai\/report/, status: 200, body: '{"ok":true}' },
  ]);
  const real = globalThis.fetch;
  globalThis.fetch = f;
  try {
    const res = await streamAiMessage(
      { status: STATUS_DOC, messages: [{ role: 'user', content: 'hi' }], context: null },
      { onDelta() {} }
    );
    assert.equal(res.ok, false);
    assert.equal(res.code, 'service-error');
  } finally {
    globalThis.fetch = real;
  }
});

test('streamAiMessage: aborted by the user still returns interrupted (never classified)', async () => {
  const { f } = fakeFetch([
    { match: /\/api\/ai\/chat/, throw: true },
    { match: /\/api\/ai\/status/, status: 200, body: JSON.stringify(STATUS_DOC) },
  ]);
  const real = globalThis.fetch;
  globalThis.fetch = f;
  const ctrl = new AbortController();
  ctrl.abort();
  try {
    const res = await streamAiMessage(
      { status: STATUS_DOC, messages: [{ role: 'user', content: 'hi' }], context: null },
      { onDelta() {}, signal: ctrl.signal }
    );
    assert.equal(res.ok, false);
    assert.equal(res.code, 'interrupted');
  } finally {
    globalThis.fetch = real;
  }
});
