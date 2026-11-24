// ─────────────────────────────────────────────────────────────────────────
// The ONE endpoint rule shared by the Worker's chat + stream + Test paths,
// the admin diagnostics probe and the student client's direct-mode calls.
//
// Why this file exists: a wrong URL and a wrong key produced byte-identical
// symptoms in the admin console (an HTTP 404 that reads "the provider
// endpoint or model was not found"). The base URL is free-text, so the shape
// an admin pastes decides everything: `…/v1` for OpenAI-compatible, the API
// ROOT for Anthropic, sometimes a full endpoint URL. These tests pin the
// normalization for every shape, including all shipped presets.
// ─────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_PRESETS, aiChatEndpoint, aiModelsEndpoint, aiSettingsDrift, validateAiSettings } from '../src/admin/aiSettings.ts';

const ANTH = 'anthropic';
const OPENAI = 'openai-compatible';

test('openai-compatible bases: the version path the admin typed is kept, not doubled', () => {
  assert.equal(aiChatEndpoint('https://api.openai.com/v1', OPENAI), 'https://api.openai.com/v1/chat/completions');
  // trailing slash / surrounding spaces must not create `//chat`
  assert.equal(aiChatEndpoint('  https://api.openai.com/v1/  ', OPENAI), 'https://api.openai.com/v1/chat/completions');
  // a bare root is NOT silently rewritten to /v1 — guessing would break
  // gateways that legitimately serve at the root; the error detail names the
  // URL instead (see the Test-endpoint assertion in test/workerAi.test.mjs).
  assert.equal(aiChatEndpoint('https://gateway.internal', OPENAI), 'https://gateway.internal/chat/completions');
});

test('anthropic bases accept the root AND a /v1-suffixed paste (the old 404)', () => {
  const want = 'https://api.anthropic.com/v1/messages';
  assert.equal(aiChatEndpoint('https://api.anthropic.com', ANTH), want);
  assert.equal(aiChatEndpoint('https://api.anthropic.com/', ANTH), want);
  // The bug class: OpenAI-compatible docs train people to paste `…/v1`, and
  // appending `/v1/messages` on top of that produced /v1/v1/messages → 404.
  assert.equal(aiChatEndpoint('https://api.anthropic.com/v1', ANTH), want);
  assert.equal(aiChatEndpoint('https://api.anthropic.com/v1/', ANTH), want);
  // A full endpoint pasted into the base field must not double up either.
  assert.equal(aiChatEndpoint('https://api.anthropic.com/v1/messages', ANTH), want);
});

test('full endpoint URLs pasted into the base field collapse to one path', () => {
  assert.equal(
    aiChatEndpoint('https://api.openai.com/v1/chat/completions', OPENAI),
    'https://api.openai.com/v1/chat/completions'
  );
  assert.equal(
    aiChatEndpoint('http://localhost:1234/v1/chat/completions', OPENAI),
    'http://localhost:1234/v1/chat/completions'
  );
});

test('non-`/v1` version paths survive untouched (Gemini, OpenRouter, Ollama)', () => {
  assert.equal(
    aiChatEndpoint('https://generativelanguage.googleapis.com/v1beta/openai', OPENAI),
    'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'
  );
  assert.equal(
    aiChatEndpoint('https://openrouter.ai/api/v1', OPENAI),
    'https://openrouter.ai/api/v1/chat/completions'
  );
  assert.equal(aiChatEndpoint('http://localhost:11434/v1', OPENAI), 'http://localhost:11434/v1/chat/completions');
});

test('the diagnostics probe uses the same normalization as the chat call', () => {
  assert.equal(aiModelsEndpoint('https://api.anthropic.com/v1', ANTH), 'https://api.anthropic.com/v1/models');
  assert.equal(aiModelsEndpoint('https://api.anthropic.com', ANTH), 'https://api.anthropic.com/v1/models');
  assert.equal(aiModelsEndpoint('https://integrate.api.nvidia.com/v1', OPENAI), 'https://integrate.api.nvidia.com/v1/models');
  assert.equal(
    aiModelsEndpoint('https://integrate.api.nvidia.com/v1/chat/completions', OPENAI),
    'https://integrate.api.nvidia.com/v1/models'
  );
});

// Every preset must reach a real endpoint shape straight out of the box: no
// doubled slash, no duplicated suffix, no `/v1/v1`, and the protocol-correct
// path for its type. A preset that fails here ships a broken default.
test('every shipped preset builds a clean endpoint from its own default base URL', () => {
  for (const p of AI_PRESETS) {
    if (!p.baseUrl) continue; // `custom` starts empty on purpose
    const chat = aiChatEndpoint(p.baseUrl, p.type);
    const models = aiModelsEndpoint(p.baseUrl, p.type);
    for (const url of [chat, models]) {
      assert.ok(!/\/\//.test(url.slice(url.indexOf('://') + 3)), `${p.id}: doubled slash in ${url}`);
      assert.ok(!/\/v1\/v1\//.test(url), `${p.id}: doubled /v1 in ${url}`);
      assert.ok(!/chat\/completions\/chat|messages\/v1|models\/models/.test(url), `${p.id}: doubled suffix in ${url}`);
    }
    assert.equal(
      chat.endsWith(p.type === ANTH ? '/v1/messages' : '/chat/completions'),
      true,
      `${p.id}: unexpected chat path ${chat}`
    );
  }
});

// ── The truncated paste (what a narrow phone input actually holds) ─────────
// The user's Base URL field read `https://integrate.api.nvidia.com/v1/chat/…`
// — the model card's FULL call URL, truncated by the input. `/chat/completions`
// was known; the trailing `/chat` half of it was not, and it produced the same
// 404 as the doubled suffix.

test('a base URL truncated at /chat or /completions still resolves to one clean path', () => {
  const want = 'https://integrate.api.nvidia.com/v1/chat/completions';
  assert.equal(aiChatEndpoint('https://integrate.api.nvidia.com/v1/chat/', OPENAI), want);
  assert.equal(aiChatEndpoint('https://integrate.api.nvidia.com/v1/chat', OPENAI), want);
  assert.equal(aiChatEndpoint('https://integrate.api.nvidia.com/v1/chat/completions', OPENAI), want);
  assert.equal(aiChatEndpoint('https://integrate.api.nvidia.com/v1/completions', OPENAI), want);
  // …and the probe for the same provider agrees with the chat call.
  assert.equal(aiModelsEndpoint('https://integrate.api.nvidia.com/v1/chat/', OPENAI), 'https://integrate.api.nvidia.com/v1/models');
});

// ── The save/refresh contract: nothing may vanish silently ──────────────────

test('validate: duplicate key values inside one provider are REFUSED, not dropped', () => {
  const doc = {
    format: 'cgpa-pilot-ai-settings',
    enabled: true,
    providers: [
      {
        id: 'p1',
        preset: 'nvidia',
        label: 'NVIDIA NIM',
        type: 'openai-compatible',
        mode: 'worker',
        baseUrl: 'https://integrate.api.nvidia.com/v1',
        model: 'meta/llama-3.3-70b-instruct',
        keys: [
          { id: 'k1', label: '1st', value: 'nvapi-same' },
          { id: 'k2', label: '2nd', value: 'nvapi-same' }, // pasted twice
          { id: 'k3', label: '3rd', value: '   ' }, // blank
        ],
        enabled: true,
      },
    ],
  };
  const v = validateAiSettings(doc);
  assert.equal(v.ok, false, 'a save that would lose keys must not report success');
  assert.match(v.issues.join(' '), /2 of 3 key\(s\) were rejected/);
  assert.match(v.issues.join(' '), /cannot hold the same value/);
});

test('validate: a provider with a non-http base URL is named, not swallowed', () => {
  const v = validateAiSettings({
    format: 'cgpa-pilot-ai-settings',
    enabled: true,
    providers: [{ id: 'p1', label: 'Gateway', baseUrl: 'integrate.api.nvidia.com/v1', keys: [{ id: 'k', value: 'x' }], enabled: true }],
  });
  assert.equal(v.ok, false);
  assert.match(v.issues.join(' '), /Gateway.*must start with http/i);
});

test('drift: the post-save check names exactly what the server did not keep', () => {
  const sent = {
    format: 'cgpa-pilot-ai-settings',
    enabled: true,
    version: 7,
    updatedAt: null,
    label: '',
    notice: '',
    systemPrompt: '',
    temperature: 0.4,
    maxTokens: 700,
    maxMessagesPerHour: 20,
    sendContext: true,
    defaultProviderId: 'p1',
    providers: [
      {
        id: 'p1',
        preset: 'nvidia',
        label: 'NVIDIA NIM',
        type: 'openai-compatible',
        mode: 'worker',
        baseUrl: 'https://integrate.api.nvidia.com/v1',
        model: 'm1',
        keys: [
          { id: 'k1', label: '1st', value: 'a' },
          { id: 'k2', label: '2nd', value: 'b' },
        ],
        enabled: true,
      },
    ],
  };
  assert.deepEqual(aiSettingsDrift(sent, sent), [], 'identical documents never drift');

  const lostKey = structuredClone(sent);
  lostKey.providers[0].keys = [{ id: 'k1', label: '1st', value: 'a' }];
  assert.match(aiSettingsDrift(sent, lostKey).join(' '), /did not store 1 key\(s\): 2nd/);

  const changedValue = structuredClone(sent);
  changedValue.providers[0].keys[1].value = 'different';
  assert.match(aiSettingsDrift(sent, changedValue).join(' '), /did not update 1 key value\(s\)/);

  const droppedProvider = structuredClone(sent);
  droppedProvider.providers = [];
  assert.match(aiSettingsDrift(sent, droppedProvider).join(' '), /provider “NVIDIA NIM” was not stored at all/);

  const differentModel = structuredClone(sent);
  differentModel.providers[0].model = 'other-model';
  assert.match(aiSettingsDrift(sent, differentModel).join(' '), /kept a different model/);
});
