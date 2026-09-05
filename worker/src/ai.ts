// ─────────────────────────────────────────────────────────────────────────
// worker/src/ai.ts — the AI assistant engine (runs on the Worker).
//
//   • parses + validates the admin AI settings (D1 single row)
//   • rate-limits /api/ai/chat per client IP (sliding 1-hour window)
//   • picks a provider (requested → default → first enabled)
//   • ROTATES across the provider's key pool: round-robin, skipping keys
//     that recently failed (401/403/429), so a handful of free keys can
//     serve many students
//   • calls OpenAI-compatible and Anthropic endpoints
//
// Direct-mode providers (local setups like Ollama / LM Studio) are handled
// by the STUDENT CLIENT (the Worker cannot reach the student's machine):
// the public /api/ai/status carries their endpoint + key in `direct`, and
// /api/ai/chat answers with the `use-direct` routing hint instead.
//
// The student's in-memory tool data (sent as `context`) is formatted into a
// compact block and included in the system prompt when the admin allows it.
// Keys never leave the Worker (except authenticated admin GET).
// ─────────────────────────────────────────────────────────────────────────

import type { AiKey, AiProvider, AiSettings } from '../../src/admin/aiSettings';
import {
  defaultAiSettings,
  publicAiStatus,
  validateAiSettings,
  type AiChatMessage,
  type AiPublicStatus,
  type AiStudentContext,
  type AiValidation,
} from '../../src/admin/aiSettings';

export type ParsedAi =
  | { status: 'absent' }
  | { status: 'unreadable' }
  | { status: 'ok'; settings: AiSettings; valid: AiValidation };

export function parseAiSettings(rawJson: string | null | undefined): ParsedAi {
  if (!rawJson) return { status: 'absent' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return { status: 'unreadable' };
  }
  const valid = validateAiSettings(parsed);
  return { status: 'ok', settings: valid.normalized, valid };
}

/** The settings to use for serving: parsed document or a safe empty default. */
export function aiSettingsForServing(parsed: ParsedAi): AiSettings {
  return parsed.status === 'ok' ? parsed.settings : defaultAiSettings();
}

/** Mask a key for display: keep first 4 + last 4 (or "••••" when short). */
export function maskKey(value: string): string {
  const v = value.trim();
  if (v.length <= 8) return '••••';
  return `${v.slice(0, 4)}••••${v.slice(-4)}`;
}

/** Public status for students (labels + direct config only, never keys). */
export function aiPublicStatus(parsed: ParsedAi): AiPublicStatus {
  return publicAiStatus(aiSettingsForServing(parsed));
}

// ── Per-provider key rotation + failure cooldowns (per-isolate memory) ────

const keyIndex = new Map<string, number>();
const keyFailAt = new Map<string, number>();
const KEY_COOLDOWN_MS = 5 * 60 * 1000;

function pickKey(provider: AiProvider, now = Date.now()): AiKey | null {
  if (!provider.keys.length) return null;
  const n = provider.keys.length;
  const start = keyIndex.get(provider.id) ?? 0;
  for (let i = 0; i < n; i++) {
    const k = provider.keys[(start + i) % n];
    const fail = keyFailAt.get(k.id) ?? 0;
    if (now - fail > KEY_COOLDOWN_MS) return k;
  }
  // All cooling down → use the least-recently-failed key.
  let best = provider.keys[0];
  let bestFail = -1;
  for (const k of provider.keys) {
    const f = keyFailAt.get(k.id) ?? 0;
    if (f > bestFail) {
      bestFail = f;
      best = k;
    }
  }
  return best;
}

function advanceKey(provider: AiProvider): void {
  const n = provider.keys.length;
  if (n > 1) keyIndex.set(provider.id, ((keyIndex.get(provider.id) ?? 0) + 1) % n);
}

function markKeyFailed(providerId: string, keyId: string): void {
  keyFailAt.set(`${providerId}/${keyId}`, Date.now());
}

// ── Rate limiting (sliding 1-hour window per client IP) ───────────────────

const ipWindow = new Map<string, number[]>();
const RATE_WINDOW_MS = 60 * 60 * 1000;

export function rateLimitAllow(
  ip: string,
  limit: number,
  now = Date.now()
): { ok: boolean; retryAfterSec: number; count: number } {
  if (ipWindow.size > 5000) ipWindow.clear(); // bounded memory
  const arr = (ipWindow.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  const count = arr.length;
  if (count >= limit) {
    const oldest = arr[0];
    const retryAfterSec = Math.max(1, Math.ceil((oldest + RATE_WINDOW_MS - now) / 1000));
    ipWindow.set(ip, arr);
    return { ok: false, retryAfterSec, count };
  }
  arr.push(now);
  ipWindow.set(ip, arr);
  return { ok: true, retryAfterSec: 0, count: count + 1 };
}

export function __resetAiRuntime(): void {
  keyIndex.clear();
  keyFailAt.clear();
  ipWindow.clear();
}

// ── Student context formatting ────────────────────────────────────────────

/** Compact, deterministic text block the model can rely on. */
export function formatAiContext(ctx: AiStudentContext): string {
  if (!ctx.hasAnyData) {
    return 'STUDENT CONTEXT: (empty — the student has not filled in any tool yet; they should start with “My results”. Answer their question generally and tell them which tool to fill so you can use their real numbers.)';
  }
  const lines: string[] = [];
  if (ctx.institution) {
    const bits = [ctx.institution.university, ctx.institution.school, ctx.institution.programme].filter(Boolean);
    if (bits.length) lines.push(`INSTITUTION: ${bits.join(' › ')}`);
  }
  lines.push(
    `MODE: ${ctx.mode ?? 'current'}${ctx.levelIndex ? ` · LEVEL ${ctx.levelIndex} (Level ${ctx.levelIndex * 100})` : ''}${ctx.semesterIndex ? ` · semester ${ctx.semesterIndex}` : ''}`
  );
  if (ctx.confirmedCgpa != null) {
    lines.push(
      `CONFIRMED CGPA: ${ctx.confirmedCgpa.toFixed(2)}${ctx.gradedCredits ? ` over ${ctx.gradedCredits} graded credits` : ''}${ctx.classification ? ` · classification: ${ctx.classification}` : ''}`
    );
  }
  if (Array.isArray(ctx.semesters) && ctx.semesters.length) {
    lines.push('SEMESTERS:');
    for (const s of ctx.semesters) {
      const bits = [s.label, s.gpa != null ? `GPA ${s.gpa.toFixed(2)}` : 'GPA —', `${s.credits} credits`];
      if (s.pending) bits.push('results not released yet');
      lines.push(`- ${bits.join(', ')}`);
      for (const c of s.courses ?? []) {
        if (c.pending) lines.push(`  · ${c.code}: pending (${c.credits}cr)`);
      }
    }
  }
  if (ctx.pendingCredits) lines.push(`PENDING CREDITS (awaiting release): ${ctx.pendingCredits}`);
  if (ctx.targetCgpa != null) lines.push(`TARGET CGPA: ${ctx.targetCgpa.toFixed(2)}`);
  if (ctx.plannedNextCredits) lines.push(`PLANNED NEXT-SEMESTER CREDITS: ${ctx.plannedNextCredits}`);
  return `STUDENT CONTEXT (live data from the student's tools):\n${lines.join('\n')}`;
}

// ── Chat execution ────────────────────────────────────────────────────────

export interface AiChatInput {
  settings: AiSettings;
  /** The provider the client wants (falls back to default → first enabled). */
  providerId?: string | null;
  messages: unknown;
  context?: AiStudentContext | null;
  fetchImpl?: typeof fetch;
  now?: number;
}

export type AiChatResult =
  | { ok: true; text: string; provider: string; model: string; keyLabel: string; ms: number }
  | {
      ok: false;
      // 'use-direct' is a routing hint (not a user-facing error): the client
      // must call the local provider itself with the status.direct config.
      code:
        | 'ai-unavailable'
        | 'no-provider'
        | 'no-keys'
        | 'rate-limited'
        | 'bad-request'
        | 'provider-error'
        | 'use-direct';
      message: string;
      retryAfterSec?: number;
    };

const AI_TIMEOUT_MS = 90_000;

function sanitizeMessages(messages: unknown): AiChatMessage[] | null {
  if (!Array.isArray(messages) || messages.length === 0) return null;
  const out: AiChatMessage[] = [];
  for (const m of messages) {
    if (!m || typeof m !== 'object') return null;
    const role = (m as { role?: unknown }).role;
    const content = (m as { content?: unknown }).content;
    if (role !== 'user' && role !== 'assistant') return null;
    if (typeof content !== 'string' || !content.trim()) return null;
    out.push({ role, content: content.slice(0, 8000) });
  }
  return out.slice(-20);
}

function buildSystemPrompt(s: AiSettings, context: AiChatInput['context']): string {
  let prompt = s.systemPrompt;
  if (s.sendContext && context) {
    prompt = `${prompt}\n\n${formatAiContext(context)}`;
  }
  return prompt;
}

export async function runAiChat(input: AiChatInput, ip: string): Promise<AiChatResult> {
  const s = input.settings;
  if (!s || !s.enabled) {
    return { ok: false, code: 'ai-unavailable', message: 'The AI assistant is currently turned off.' };
  }

  const messages = sanitizeMessages(input.messages);
  if (!messages) {
    return { ok: false, code: 'bad-request', message: 'Provide a non-empty messages array of { role: user|assistant, content: string }.' };
  }

  const rl = rateLimitAllow(ip, s.maxMessagesPerHour, input.now ?? Date.now());
  if (!rl.ok) {
    return {
      ok: false,
      code: 'rate-limited',
      message: `Hourly limit reached (${s.maxMessagesPerHour} messages). Try again later.`,
      retryAfterSec: rl.retryAfterSec,
    };
  }

  const enabledProviders = s.providers.filter((p) => p.enabled);
  if (!enabledProviders.length) {
    return {
      ok: false,
      code: 'no-provider',
      message: 'No AI provider is enabled yet — your administrator is still setting it up.',
    };
  }
  const requested = input.providerId ? enabledProviders.find((p) => p.id === input.providerId) : undefined;
  const provider =
    requested ??
    (s.defaultProviderId ? enabledProviders.find((p) => p.id === s.defaultProviderId) : undefined) ??
    enabledProviders[0];

  if (provider.mode === 'direct') {
    return { ok: false, code: 'use-direct', message: 'use-direct' };
  }
  if (!provider.keys.length) {
    return { ok: false, code: 'no-keys', message: `No API keys are configured for ${provider.label} yet.` };
  }

  const system = buildSystemPrompt(s, input.context);
  const f = input.fetchImpl ?? fetch;
  let lastError = 'The AI provider did not respond.';

  // Try keys in rotation order; a failing key cools down for 5 minutes and
  // the next key is used — so one dead key never blocks the pool.
  for (let attempt = 0; attempt < provider.keys.length; attempt++) {
    const key = pickKey(provider, input.now ?? Date.now());
    if (!key) break;
    const res = await callProvider(f, provider, key, system, messages, s.maxTokens, s.temperature);
    if (res.ok) {
      return { ok: true, text: res.text, provider: provider.label, model: provider.model, keyLabel: key.label || key.id, ms: res.ms };
    }
    lastError = res.error;
    if (res.retryable) {
      markKeyFailed(provider.id, key.id);
      advanceKey(provider);
      continue;
    }
    break;
  }

  return { ok: false, code: 'provider-error', message: friendlyProviderError(lastError) };
}

function friendlyProviderError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes('401') || m.includes('unauthorized') || m.includes('invalid api key') || m.includes('invalid_api_key')) {
    return 'The AI provider rejected the API key. An administrator should test/refresh the keys in AI Settings.';
  }
  if (m.includes('402') || m.includes('quota') || m.includes('insufficient') || m.includes('billing')) {
    return 'The AI provider quota/credits are exhausted. An administrator should add more keys in AI Settings.';
  }
  if (m.includes('429') || m.includes('rate limit') || m.includes('too many')) {
    return 'The AI provider is rate-limited right now. Please wait a moment and try again.';
  }
  if (m.includes('timeout') || m.includes('aborted') || m.includes('timed out') || m.includes('network') || m.includes('fetch failed')) {
    return 'Could not reach the AI provider (network/timeout). Check your connection and try again.';
  }
  if (m.includes('404')) {
    return 'The AI provider endpoint or model was not found. Check the base URL and model in AI Settings.';
  }
  return `The AI provider returned an error: ${msg.slice(0, 200)}`;
}

interface CallParams {
  maxTokens: number;
  temperature: number;
}

async function callProvider(
  f: typeof fetch,
  provider: AiProvider,
  key: AiKey,
  system: string,
  messages: AiChatMessage[],
  maxTokens: number,
  temperature: number
): Promise<{ ok: true; text: string; ms: number } | { ok: false; error: string; retryable: boolean }> {
  const t0 = Date.now();
  const params: CallParams = { maxTokens, temperature };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS);
  try {
    if (provider.type === 'anthropic') {
      const res = await f(`${provider.baseUrl.replace(/\/+$/, '')}/v1/messages`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': key.value,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: provider.model,
          max_tokens: params.maxTokens,
          temperature: params.temperature,
          system,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const text = await res.text();
      if (!res.ok) {
        return {
          ok: false,
          error: `HTTP ${res.status}: ${text.slice(0, 300)}`,
          retryable: res.status === 401 || res.status === 403 || res.status === 429,
        };
      }
      const doc = JSON.parse(text) as { content?: { type: string; text?: string }[] };
      const out = (doc.content ?? [])
        .filter((c) => c.type === 'text')
        .map((c) => c.text ?? '')
        .join('\n')
        .trim();
      if (!out) return { ok: false, error: 'The provider returned an empty answer.', retryable: false };
      return { ok: true, text: out, ms: Date.now() - t0 };
    }

    // OpenAI-compatible (NVIDIA NIM, Gemini, Groq, Cerebras, Mistral,
    // OpenRouter, OpenAI, Ollama, LM Studio, vLLM, …).
    const res = await f(`${provider.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key.value}` },
      body: JSON.stringify({
        model: provider.model,
        temperature: params.temperature,
        max_tokens: params.maxTokens,
        messages: [{ role: 'system', content: system }, ...messages],
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        error: `HTTP ${res.status}: ${text.slice(0, 300)}`,
        retryable: res.status === 401 || res.status === 403 || res.status === 429,
      };
    }
    const doc = JSON.parse(text) as { choices?: { message?: { content?: string } }[] };
    const out = (doc.choices?.[0]?.message?.content ?? '').trim();
    if (!out) return { ok: false, error: 'The provider returned an empty answer.', retryable: false };
    return { ok: true, text: out, ms: Date.now() - t0 };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg, retryable: /aborted|timeout|timed out/i.test(msg) };
  } finally {
    clearTimeout(timer);
  }
}

// ── Test endpoint (admin “Test this key”) ─────────────────────────────────

export async function testAiKey(
  f: typeof fetch,
  provider: AiProvider,
  key: AiKey,
  system: string
): Promise<{ ok: boolean; message: string; detail?: string; model?: string; ms?: number }> {
  const res = await callProvider(f, provider, key, system, [{ role: 'user', content: 'Reply with the single word: ready' }], 24, 0);
  if (res.ok) {
    return { ok: true, message: `Connected — “${res.text.slice(0, 60)}”`, model: provider.model, ms: res.ms };
  }
  // `detail` carries the provider's RAW error (HTTP status + body) so the
  // admin can see exactly what the provider said — the friendly `message`
  // is a guess, the detail is the evidence.
  return { ok: false, message: friendlyProviderError(res.error), detail: res.error.slice(0, 240) };
}

export { publicAiStatus };
