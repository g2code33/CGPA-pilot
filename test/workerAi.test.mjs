// ─────────────────────────────────────────────────────────────────────────
// worker — AI assistant + drafts:
//
//   AI settings:  absent → status disabled · save (validated) → version 1
//                 invalid settings → 400 + issues, nothing stored
//   Public status: labels + flags, NEVER worker-mode keys; direct mode
//                 intentionally carries endpoint+key in `direct`
//   Chat:         disabled → 404 · valid → provider text (mocked fetch)
//                 key rotation: first key 401 → second key succeeds
//                 rate limit: N/hour → 429 + retryAfterSec
//                 context: full per-semester course tables in the system prompt
//   Streaming:    SSE meta event + raw provider deltas · failure before the
//                 first token → SSE error frame + admin error-log row
//   Admin tools:  error log (list newest-first / clear / 401) + diagnostics
//   Drafts:       save → list → fetch → delete (text ids, newest first)
// ─────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { __resetAi } from '../worker/src/index.ts';
import { createD1Stub } from './helpers/d1Stub.mjs';
import { makeValidCatalog } from './helpers/fixtures.mjs';

const TOKEN = 'test-admin-token';
const BASE = 'https://cfg.example.test';

function env() {
  return { CONFIG_DB: createD1Stub(), ADMIN_TOKEN: TOKEN, ASSETS: undefined };
}

function req(path, { method = 'GET', token, body } = {}) {
  const headers = { accept: 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return new Request(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function j(res) {
  return res.json();
}

function aiSettingsDoc(over = {}) {
  return {
    format: 'cgpa-pilot-ai-settings',
    version: 0,
    enabled: true,
    label: 'Test AI',
    notice: 'notice',
    systemPrompt: 'You are a test assistant.',
    temperature: 0.4,
    maxTokens: 100,
    maxMessagesPerHour: 100,
    sendContext: true,
    defaultProviderId: 'prov-1',
    providers: [
      {
        id: 'prov-1',
        preset: 'nvidia',
        label: 'NVIDIA NIM (free)',
        type: 'openai-compatible',
        mode: 'worker',
        baseUrl: 'https://integrate.api.nvidia.com/v1',
        model: 'meta/llama-3.3-70b-instruct',
        keys: [
          { id: 'key-1', label: 'k1', value: 'nvapi-11112222' },
          { id: 'key-2', label: 'k2', value: 'nvapi-33334444' },
        ],
        enabled: true,
      },
    ],
    updatedAt: null,
    ...over,
  };
}

/** OpenAI-compatible streaming mock provider (SSE out). */
function mockStreamProvider(script) {
  const calls = [];
  const enc = new TextEncoder();
  const f = async (url, opts) => {
    const u = String(url);
    calls.push({ url: u, headers: opts?.headers, body: JSON.parse(opts?.body ?? '{}') });
    const next = script(calls.length - 1);
    if (next.errorStatus) {
      return new Response(JSON.stringify({ error: { message: next.errorMessage ?? 'err' } }), {
        status: next.errorStatus,
        headers: { 'content-type': 'application/json' },
      });
    }
    const body = new ReadableStream({
      start(controller) {
        for (const frame of next.frames ?? []) controller.enqueue(enc.encode(frame));
        controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  return { f, calls };
}

/** OpenAI-compatible mock provider. */
function mockProvider(responses) {
  const calls = [];
  const f = async (url, opts) => {
    const u = String(url);
    calls.push({ url: u, headers: opts?.headers, body: JSON.parse(opts?.body ?? '{}') });
    const next = responses[calls.length - 1] ?? responses[responses.length - 1];
    if (next.errorStatus) {
      return new Response(JSON.stringify({ error: { message: next.errorMessage ?? 'err' } }), {
        status: next.errorStatus,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: next.text ?? 'ok' } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { f, calls };
}

test('public AI status is disabled (and 503-safe) when nothing is stored', async () => {
  const res = await worker.fetch(req('/api/ai/status'), env());
  assert.equal(res.status, 200);
  const doc = await j(res);
  assert.equal(doc.format, 'cgpa-pilot-ai-status');
  assert.equal(doc.enabled, false);
  assert.equal(doc.ready, false);
});

test('admin can save AI settings (validated) and read them back', async () => {
  const e = env();
  // save without auth → 401
  let res = await worker.fetch(req('/api/admin/ai', { method: 'POST', body: aiSettingsDoc() }), e);
  assert.equal(res.status, 401);

  res = await worker.fetch(req('/api/admin/ai', { method: 'POST', token: TOKEN, body: aiSettingsDoc() }), e);
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  let doc = await j(res);
  assert.equal(doc.ok, true);
  assert.equal(doc.version, 1);

  res = await worker.fetch(req('/api/admin/ai', { method: 'GET', token: TOKEN }), e);
  doc = await j(res);
  assert.equal(doc.format, 'cgpa-pilot-ai-settings-admin');
  assert.equal(doc.hasStored, true);
  assert.equal(doc.settings.providers[0].keys.length, 2);
  assert.equal(doc.settings.providers[0].keys[0].value, 'nvapi-11112222'); // keys only to authenticated admin

  // second save bumps the version
  res = await worker.fetch(req('/api/admin/ai', { method: 'POST', token: TOKEN, body: aiSettingsDoc() }), e);
  doc = await j(res);
  assert.equal(doc.version, 2);
});

test('invalid AI settings are rejected with issues and nothing is stored', async () => {
  const e = env();
  const res = await worker.fetch(
    req('/api/admin/ai', {
      method: 'POST',
      token: TOKEN,
      body: { ...aiSettingsDoc(), providers: 'nope' },
    }),
    e
  );
  assert.equal(res.status, 400);
  const doc = await j(res);
  assert.equal(doc.error, 'validation');
  assert.ok(Array.isArray(doc.issues) && doc.issues.length > 0);
});

test('public status exposes labels + direct config but never worker keys', async () => {
  const e = env();
  await worker.fetch(req('/api/admin/ai', { method: 'POST', token: TOKEN, body: aiSettingsDoc() }), e);
  let res = await worker.fetch(req('/api/ai/status'), e);
  let doc = await j(res);
  assert.equal(doc.enabled, true);
  assert.equal(doc.ready, true);
  assert.equal(doc.label, 'Test AI');
  assert.equal(doc.direct, null);
  // The raw key must NOT appear anywhere in the public document.
  assert.ok(!JSON.stringify(doc).includes('nvapi-11112222'));

  // direct mode → endpoint + key ARE in the public status (client calls locally)
  const directDoc = aiSettingsDoc();
  directDoc.providers[0].mode = 'direct';
  directDoc.providers[0].baseUrl = 'http://localhost:11434/v1';
  directDoc.providers[0].model = 'llama3.1';
  directDoc.providers[0].keys = [{ id: 'key-l', label: 'local', value: 'ollama' }];
  await worker.fetch(req('/api/admin/ai', { method: 'POST', token: TOKEN, body: directDoc }), e);
  res = await worker.fetch(req('/api/ai/status'), e);
  doc = await j(res);
  assert.equal(doc.direct.baseUrl, 'http://localhost:11434/v1');
  assert.equal(doc.direct.key, 'ollama');
});

test('chat is 404 (ai-unavailable) while the feature is disabled', async () => {
  const e = env();
  const doc = aiSettingsDoc();
  doc.enabled = false;
  await worker.fetch(req('/api/admin/ai', { method: 'POST', token: TOKEN, body: doc }), e);
  const res = await worker.fetch(
    req('/api/ai/chat', { method: 'POST', body: { messages: [{ role: 'user', content: 'hi' }] } }),
    e
  );
  assert.equal(res.status, 404);
  const out = await j(res);
  assert.equal(out.error, 'ai-unavailable');
});

test('chat: no provider configured → no-provider', async () => {
  const e = env();
  const doc = aiSettingsDoc();
  doc.providers = [];
  const save = await worker.fetch(req('/api/admin/ai', { method: 'POST', token: TOKEN, body: doc }), e);
  assert.equal(save.status, 200, JSON.stringify(await save.clone().json()));
  const res = await worker.fetch(
    req('/api/ai/chat', { method: 'POST', body: { messages: [{ role: 'user', content: 'hi' }] } }),
    e
  );
  assert.equal(res.status, 502);
  const out = await j(res);
  assert.equal(out.error, 'no-provider');
});

test('chat: worker proxy returns the provider answer (mocked fetch)', async () => {
  const e = env();
  await worker.fetch(req('/api/admin/ai', { method: 'POST', token: TOKEN, body: aiSettingsDoc() }), e);
  const { f, calls } = mockProvider([{ text: 'Your CGPA is 3.42.' }]);
  const realFetch = globalThis.fetch;
  globalThis.fetch = f;
  try {
    const res = await worker.fetch(
      req('/api/ai/chat', {
        method: 'POST',
        body: {
          messages: [{ role: 'user', content: 'What is my CGPA?' }],
          context: { hasAnyData: true, confirmedCgpa: 3.42, mode: 'current' },
        },
      }),
      e
    );
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
    const out = await j(res);
    assert.equal(out.ok, true);
    assert.equal(out.text, 'Your CGPA is 3.42.');
    assert.equal(out.model, 'meta/llama-3.3-70b-instruct');
    // The system prompt carried the student context.
    const sys = calls[0].body.messages[0];
    assert.equal(sys.role, 'system');
    assert.match(sys.content, /CONFIRMED CGPA: 3\.42/);
    assert.equal(calls[0].headers.authorization, 'Bearer nvapi-11112222');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('chat: system prompt carries full per-semester course tables (rich context)', async () => {
  const e = env();
  await worker.fetch(req('/api/admin/ai', { method: 'POST', token: TOKEN, body: aiSettingsDoc() }), e);
  const { f, calls } = mockProvider([{ text: 'ok' }]);
  const realFetch = globalThis.fetch;
  globalThis.fetch = f;
  try {
    const res = await worker.fetch(
      req('/api/ai/chat', {
        method: 'POST',
        body: {
          messages: [{ role: 'user', content: 'Which course dragged my GPA down?' }],
          context: {
            hasAnyData: true,
            mode: 'history',
            institution: { university: 'KNUST', school: 'Engineering', programme: 'CSE' },
            confirmedCgpa: 3.21,
            gradedCredits: 96,
            classification: 'Second Class Upper',
            semesters: [
              {
                label: 'Semester 1',
                gpa: 3.5,
                credits: 24,
                pending: false,
                courses: [
                  { code: 'MATH151', grade: 'A', credits: 4, pending: false },
                  { code: 'CSE101', grade: 'B', credits: 3, pending: false },
                ],
              },
              {
                label: 'Semester 2',
                gpa: 2.9,
                credits: 20,
                pending: true,
                courses: [{ code: 'CSE202', grade: null, credits: 4, pending: true }],
              },
            ],
            targetCgpa: 3.6,
          },
        },
      }),
      e
    );
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
    const sys = calls[0].body.messages[0];
    assert.equal(sys.role, 'system');
    // Institution + confirmed numbers
    assert.match(sys.content, /INSTITUTION: KNUST/);
    assert.match(sys.content, /CONFIRMED CGPA: 3\.21/);
    // Per-semester course TABLE (Markdown) with each course code present.
    assert.match(sys.content, /Course \| Credits \| Grade \| Status/);
    assert.match(sys.content, /\| MATH151 \| 4 \| A \| graded \|/);
    assert.match(sys.content, /\| CSE101 \| 3 \| B \| graded \|/);
    assert.match(sys.content, /\| CSE202 \| 4 \| — \| pending \|/);
    assert.match(sys.content, /TARGET CGPA: 3\.60/);
    // It tells the model it may reproduce the tables.
    assert.match(sys.content, /Markdown tables are rendered for the student/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('chat: first key 401 → the pool ROTATES to the second key', async () => {
  const e = env();
  __resetAi();
  await worker.fetch(req('/api/admin/ai', { method: 'POST', token: TOKEN, body: aiSettingsDoc() }), e);
  const { f, calls } = mockProvider([
    { errorStatus: 401, errorMessage: 'invalid api key' },
    { text: 'recovered' },
  ]);
  const realFetch = globalThis.fetch;
  globalThis.fetch = f;
  try {
    const res = await worker.fetch(
      req('/api/ai/chat', { method: 'POST', body: { messages: [{ role: 'user', content: 'hi' }] } }),
      e
    );
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
    const out = await j(res);
    assert.equal(out.ok, true);
    assert.equal(out.text, 'recovered');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].headers.authorization, 'Bearer nvapi-11112222');
    assert.equal(calls[1].headers.authorization, 'Bearer nvapi-33334444');
  } finally {
    globalThis.fetch = realFetch;
    __resetAi();
  }
});

test('chat: all keys failing → provider-error (no infinite loop)', async () => {
  const e = env();
  __resetAi();
  await worker.fetch(req('/api/admin/ai', { method: 'POST', token: TOKEN, body: aiSettingsDoc() }), e);
  const { f, calls } = mockProvider([{ errorStatus: 401, errorMessage: 'invalid api key' }]);
  const realFetch = globalThis.fetch;
  globalThis.fetch = f;
  try {
    const res = await worker.fetch(
      req('/api/ai/chat', { method: 'POST', body: { messages: [{ role: 'user', content: 'hi' }] } }),
      e
    );
    assert.equal(res.status, 502);
    const out = await j(res);
    assert.equal(out.error, 'provider-error');
    assert.match(out.message, /key/i);
    assert.equal(calls.length, 2); // tried both keys, stopped
  } finally {
    globalThis.fetch = realFetch;
    __resetAi();
  }
});

test('chat: hourly rate limit → 429 with retryAfterSec', async () => {
  const e = env();
  __resetAi();
  const doc = aiSettingsDoc();
  doc.maxMessagesPerHour = 2;
  await worker.fetch(req('/api/admin/ai', { method: 'POST', token: TOKEN, body: doc }), e);
  const { f } = mockProvider([{ text: 'ok' }]);
  const realFetch = globalThis.fetch;
  globalThis.fetch = f;
  try {
    const chat = () =>
      worker.fetch(req('/api/ai/chat', { method: 'POST', body: { messages: [{ role: 'user', content: 'hi' }] } }), e);
    assert.equal((await chat()).status, 200);
    assert.equal((await chat()).status, 200);
    const third = await chat();
    assert.equal(third.status, 429);
    const out = await j(third);
    assert.equal(out.error, 'rate-limited');
    assert.ok(out.retryAfterSec > 0);
  } finally {
    globalThis.fetch = realFetch;
    __resetAi();
  }
});

test('test endpoint: works with a provider/key NOT yet saved (the on-screen edit)', async () => {
  const e = env();
  // Nothing saved yet — only the admin's unsaved on-screen state.
  const provider = {
    id: 'prov-local',
    preset: 'nvidia',
    label: 'NVIDIA NIM (free)',
    type: 'openai-compatible',
    mode: 'worker',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    model: 'meta/llama-3.3-70b-instruct',
    keys: [{ id: 'key-new', label: 'new key', value: 'nvapi-99990000' }],
    enabled: true,
  };
  const { f, calls } = mockProvider([{ text: 'ready' }]);
  const realFetch = globalThis.fetch;
  globalThis.fetch = f;
  try {
    const res = await worker.fetch(
      req('/api/admin/ai/test', {
        method: 'POST',
        token: TOKEN,
        body: { provider, keyValue: 'nvapi-99990000' },
      }),
      e
    );
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
    const out = await j(res);
    assert.equal(out.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].headers.authorization, 'Bearer nvapi-99990000');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('test endpoint: direct/local endpoints cannot be tested from the server', async () => {
  const e = env();
  const provider = {
    id: 'prov-ollama',
    preset: 'ollama-local',
    label: 'Ollama (local)',
    type: 'openai-compatible',
    mode: 'direct',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.1',
    keys: [{ id: 'k', label: 'local', value: 'ollama' }],
    enabled: true,
  };
  const res = await worker.fetch(
    req('/api/admin/ai/test', { method: 'POST', token: TOKEN, body: { provider, keyValue: 'ollama' } }),
    e
  );
  assert.equal(res.status, 200);
  const out = await j(res);
  assert.equal(out.ok, false);
  assert.match(out.message, /STUDENT device/i);
});

test('test endpoint: invalid provider shape → 400 (no fetch attempt)', async () => {
  const e = env();
  const { f, calls } = mockProvider([{ text: 'ready' }]);
  const realFetch = globalThis.fetch;
  globalThis.fetch = f;
  try {
    const res = await worker.fetch(
      req('/api/admin/ai/test', {
        method: 'POST',
        token: TOKEN,
        body: { provider: { id: 'x', baseUrl: 'not-a-url' }, keyValue: 'abc' },
      }),
      e
    );
    assert.equal(res.status, 400);
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('test endpoint: legacy saved provider/key ids still work', async () => {
  const e = env();
  await worker.fetch(req('/api/admin/ai', { method: 'POST', token: TOKEN, body: aiSettingsDoc() }), e);
  const { f, calls } = mockProvider([{ text: 'ready' }]);
  const realFetch = globalThis.fetch;
  globalThis.fetch = f;
  try {
    const res = await worker.fetch(
      req('/api/admin/ai/test', { method: 'POST', token: TOKEN, body: { providerId: 'prov-1', keyId: 'key-2' } }),
      e
    );
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
    assert.equal(calls[0].headers.authorization, 'Bearer nvapi-33334444');
  } finally {
    globalThis.fetch = realFetch;
    __resetAi();
  }
});

test('chat: invalid messages → 400 bad-request', async () => {
  const e = env();
  await worker.fetch(req('/api/admin/ai', { method: 'POST', token: TOKEN, body: aiSettingsDoc() }), e);
  const res = await worker.fetch(
    req('/api/ai/chat', { method: 'POST', body: { messages: [{ role: 'robot', content: 'hi' }] } }),
    e
  );
  assert.equal(res.status, 400);
  const out = await j(res);
  assert.equal(out.error, 'bad-request');
});

test('drafts: save → list → fetch → delete', async () => {
  const e = env();
  const cat = makeValidCatalog();

  // unauthorized
  let res = await worker.fetch(req('/api/admin/drafts', { method: 'POST', body: { id: 'd1', name: 'X', catalog: cat } }), e);
  assert.equal(res.status, 401);

  // save
  res = await worker.fetch(
    req('/api/admin/drafts', { method: 'POST', token: TOKEN, body: { id: 'd1', name: 'Big revamp', note: 'wip', catalog: cat } }),
    e
  );
  assert.equal(res.status, 201, JSON.stringify(await res.clone().json()));
  let doc = await j(res);
  assert.equal(doc.ok, true);
  assert.equal(doc.id, 'd1');

  // list (metadata only)
  res = await worker.fetch(req('/api/admin/drafts', { method: 'GET', token: TOKEN }), e);
  doc = await j(res);
  assert.equal(doc.format, 'cgpa-pilot-admin-drafts');
  assert.equal(doc.drafts.length, 1);
  assert.equal(doc.drafts[0].name, 'Big revamp');
  assert.equal(doc.drafts[0].catalog, undefined);

  // fetch full
  res = await worker.fetch(req('/api/admin/drafts/d1', { method: 'GET', token: TOKEN }), e);
  doc = await j(res);
  assert.equal(doc.format, 'cgpa-pilot-admin-draft');
  assert.ok(Array.isArray(doc.catalog.universities));

  // invalid catalog rejected
  res = await worker.fetch(
    req('/api/admin/drafts', { method: 'POST', token: TOKEN, body: { id: 'bad', name: 'X', catalog: { nope: true } } }),
    e
  );
  assert.equal(res.status, 400);

  // delete
  res = await worker.fetch(req('/api/admin/drafts/d1', { method: 'DELETE', token: TOKEN }), e);
  assert.equal(res.status, 200);
  res = await worker.fetch(req('/api/admin/drafts/d1', { method: 'GET', token: TOKEN }), e);
  assert.equal(res.status, 404);
});

test('test endpoint: rejected key → 200 with ok:false + the provider raw error (detail)', async () => {
  const e = env();
  __resetAi();
  const provider = {
    id: 'prov-test',
    preset: 'nvidia-nim',
    label: 'NVIDIA NIM (free)',
    type: 'openai-compatible',
    mode: 'worker',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    model: 'meta/llama-3.3-70b-instruct',
    keys: [],
    enabled: true,
  };
  const { f } = mockProvider([{ errorStatus: 401, errorMessage: 'Invalid API key provided' }]);
  const realFetch = globalThis.fetch;
  globalThis.fetch = f;
  try {
    const res = await worker.fetch(
      req('/api/admin/ai/test', {
        method: 'POST',
        token: TOKEN,
        body: { provider, keyValue: 'nvapi-12345678' },
      }),
      e
    );
    // A failed KEY TEST is a normal, successful HTTP response — the result
    // is in the body. No more 502 noise in the admin console.
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
    const out = await j(res);
    assert.equal(out.ok, false);
    assert.match(out.message, /rejected the API key/i);
    // The provider's RAW error is surfaced for diagnosis.
    assert.match(out.detail ?? '', /HTTP 401/);
    assert.match(out.detail ?? '', /Invalid API key provided/);
  } finally {
    globalThis.fetch = realFetch;
    __resetAi();
  }
});

// ── Streaming (SSE) ─────────────────────────────────────────────────────────

test('stream: returns SSE with meta event + provider deltas', async () => {
  const e = env();
  __resetAi();
  await worker.fetch(req('/api/admin/ai', { method: 'POST', token: TOKEN, body: aiSettingsDoc() }), e);
  const { f } = mockStreamProvider(() => ({
    frames: [
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" there"}}]}\n\n',
      'data: [DONE]\n\n',
    ],
  }));
  const realFetch = globalThis.fetch;
  globalThis.fetch = f;
  try {
    const res = await worker.fetch(
      req('/api/ai/chat', {
        method: 'POST',
        body: { messages: [{ role: 'user', content: 'hi' }], stream: true },
      }),
      e
    );
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);
    const text = await res.text();
    // First event is our meta frame.
    assert.match(text, /event: meta/);
    assert.match(text, /"format":"cgpa-ai-stream-meta"/);
    assert.match(text, /"streamFormat":"openai"/);
    // Then the provider's raw deltas pass through.
    assert.match(text, /"content":"Hi"/);
    assert.match(text, /"content":" there"/);
    assert.match(text, /\[DONE\]/);
  } finally {
    globalThis.fetch = realFetch;
    __resetAi();
  }
});

test('stream: provider failure before first token → SSE error frame + logged for admin', async () => {
  const e = env();
  __resetAi();
  const doc = aiSettingsDoc();
  doc.providers[0].keys = [{ id: 'key-1', label: 'k1', value: 'nvapi-11112222' }]; // single key
  await worker.fetch(req('/api/admin/ai', { method: 'POST', token: TOKEN, body: doc }), e);
  const { f } = mockStreamProvider(() => ({ errorStatus: 401, errorMessage: 'invalid api key' }));
  const realFetch = globalThis.fetch;
  globalThis.fetch = f;
  try {
    const res = await worker.fetch(
      req('/api/ai/chat', { method: 'POST', body: { messages: [{ role: 'user', content: 'hi' }], stream: true } }),
      e
    );
    assert.equal(res.status, 502, JSON.stringify(await res.clone().text()));
    assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);
    const text = await res.text();
    // A friendly, non-raw message for the student …
    assert.match(text, /event: error/);
    assert.match(text, /"error":"provider-error"/);
    // … and the technical detail is recorded for the admin.
    const log = await worker.fetch(req('/api/admin/errors?limit=10', { token: TOKEN }), e);
    const ldoc = await j(log);
    assert.equal(ldoc.format, 'cgpa-pilot-admin-errors');
    assert.equal(ldoc.total, 1);
    assert.equal(ldoc.errors[0].kind, 'stream');
    assert.equal(ldoc.errors[0].code, 'provider-error');
    assert.equal(ldoc.errors[0].status, 401);
    assert.match(ldoc.errors[0].detail, /invalid api key/);
    assert.equal(ldoc.errors[0].provider, 'NVIDIA NIM (free)');
  } finally {
    globalThis.fetch = realFetch;
    __resetAi();
  }
});

test('admin errors: list (newest first) → clear empties it', async () => {
  const e = env();
  __resetAi();
  await worker.fetch(req('/api/admin/ai', { method: 'POST', token: TOKEN, body: aiSettingsDoc() }), e);
  const { f } = mockStreamProvider(() => ({ errorStatus: 401, errorMessage: 'boom' }));
  const realFetch = globalThis.fetch;
  globalThis.fetch = f;
  try {
    // two failures → two log rows
    for (let i = 0; i < 2; i++) {
      await worker.fetch(
        req('/api/ai/chat', { method: 'POST', body: { messages: [{ role: 'user', content: 'hi' }], stream: true } }),
        e
      );
    }
    let res = await worker.fetch(req('/api/admin/errors', { token: TOKEN }), e);
    let doc = await j(res);
    assert.equal(doc.total, 2);
    assert.equal(doc.errors.length, 2);
    assert.ok(doc.errors[0].id > doc.errors[1].id, 'newest first');

    // unauthorized → 401
    res = await worker.fetch(req('/api/admin/errors'), e);
    assert.equal(res.status, 401);

    // clear → empty
    res = await worker.fetch(req('/api/admin/errors/clear', { method: 'POST', token: TOKEN }), e);
    doc = await j(res);
    assert.equal(doc.ok, true);
    res = await worker.fetch(req('/api/admin/errors', { token: TOKEN }), e);
    doc = await j(res);
    assert.equal(doc.total, 0);
  } finally {
    globalThis.fetch = realFetch;
    __resetAi();
  }
});

test('admin diagnostics: reports worker/d1/tables/catalog/published/ai', async () => {
  const e = env();
  __resetAi();
  await worker.fetch(req('/api/admin/ai', { method: 'POST', token: TOKEN, body: aiSettingsDoc() }), e);
  let res = await worker.fetch(req('/api/admin/diagnostics'), e);
  assert.equal(res.status, 401); // unauthorized

  res = await worker.fetch(req('/api/admin/diagnostics', { token: TOKEN }), e);
  assert.equal(res.status, 200);
  const doc = await j(res);
  assert.equal(doc.format, 'cgpa-pilot-admin-diagnostics');
  assert.ok(doc.at);
  const ids = doc.checks.map((c) => c.id);
  for (const want of ['worker', 'd1', 'tables', 'catalog', 'published', 'ai']) {
    assert.ok(ids.includes(want), `missing check ${want}`);
  }
  const byId = Object.fromEntries(doc.checks.map((c) => [c.id, c]));
  assert.equal(byId.worker.ok, true);
  assert.equal(byId.d1.ok, true);
  assert.equal(byId.tables.ok, true);
  // No catalog / published config saved in this test env → those report not-ok.
  assert.equal(byId.catalog.ok, false);
  assert.equal(byId.published.ok, false);
  // AI is enabled + has keys → ok.
  assert.equal(byId.ai.ok, true);
  __resetAi();
});
