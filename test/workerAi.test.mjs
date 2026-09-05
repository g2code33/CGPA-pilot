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
