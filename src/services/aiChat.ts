// ─────────────────────────────────────────────────────────────────────────
// aiChat — the student app's client for the AI assistant.
//
//   • GET  /api/ai/status (public) — is the AI on? notice? direct endpoint?
//   • POST /api/ai/chat   (public, rate-limited) — Worker proxies the call,
//     keys stay server-side.
//   • DIRECT mode (local providers such as Ollama/LM Studio): the status
//     carries {baseUrl, model, key, type} and THIS module calls that local
//     endpoint itself (the Worker cannot reach the student's machine).
//
// Privacy: the student's tool data is included ONLY in the request the
// student sends when asking a question. Nothing is stored or uploaded
// otherwise (the smoke-test privacy guard applies to this module too:
// no persistent storage APIs here).
// ─────────────────────────────────────────────────────────────────────────

import { configApiUrl } from '../config/apiBase';
import type { AiChatMessage, AiPublicStatus, AiStudentContext } from '../admin/aiSettings';

export type AiSendResult =
  | { ok: true; text: string; provider?: string; model?: string; ms?: number }
  | { ok: false; code: 'offline' | 'ai-unavailable' | 'no-provider' | 'no-keys' | 'rate-limited' | 'bad-request' | 'provider-error' | 'direct-error'; message: string; retryAfterSec?: number };

// Shared, lightly-cached status (both the app shell — to show/hide the AI
// tile — and the AI screen read the same value, so they never disagree).
let statusCache: { at: number; value: AiPublicStatus | null } | null = null;
const STATUS_TTL_MS = 20_000;

/** Cached fetch of the public AI status (null = backend unreachable). */
export async function getAiStatusShared(force = false): Promise<AiPublicStatus | null> {
  if (!force && statusCache && Date.now() - statusCache.at < STATUS_TTL_MS) {
    return statusCache.value;
  }
  const v = await fetchAiStatus();
  statusCache = { at: Date.now(), value: v };
  return v;
}

/** Fetch the public AI status (null = backend unreachable / offline). */
export async function fetchAiStatus(): Promise<AiPublicStatus | null> {
  try {
    const res = await fetch(configApiUrl('/api/ai/status'), { method: 'GET', cache: 'no-store', headers: { accept: 'application/json' } });
    if (!res.ok) {
      if (res.status === 503) return { format: 'cgpa-pilot-ai-status', enabled: false, ready: false, label: '', notice: '', providers: [], direct: null, defaultProviderId: null, version: 0, updatedAt: null };
      return null;
    }
    const doc = (await res.json()) as AiPublicStatus;
    if (!doc || doc.format !== 'cgpa-pilot-ai-status') return null;
    return doc;
  } catch {
    return null;
  }
}

export interface AiSendInput {
  status: AiPublicStatus;
  messages: AiChatMessage[];
  context: AiStudentContext | null;
  /** Admin persona/system prompt travels server-side; the client only needs it for direct mode. */
  directSystemPrompt?: string;
}

const DIRECT_TIMEOUT_MS = 120_000;

/** Send a chat turn. Chooses the Worker proxy or a direct local endpoint. */
export async function sendAiMessage(input: AiSendInput): Promise<AiSendResult> {
  const { status, messages, context } = input;
  if (!status || !status.enabled) {
    return { ok: false, code: 'ai-unavailable', message: 'The AI assistant is currently turned off.' };
  }

  // DIRECT mode: call the local provider ourselves.
  if (status.direct) {
    try {
      const res = await directCall(status.direct, input.directSystemPrompt ?? '', messages, context);
      return { ok: true, text: res.text, provider: 'Local AI', model: status.direct.model, ms: res.ms };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        code: 'direct-error',
        message: /aborted|timeout|timed out|fetch|network/i.test(msg)
          ? `The local AI endpoint (${status.direct.baseUrl}) did not respond. Start it (e.g. “ollama serve”) and try again.`
          : `Local AI error: ${msg.slice(0, 200)}`,
      };
    }
  }

  // Worker-proxied mode.
  let res: Response;
  try {
    res = await fetch(configApiUrl('/api/ai/chat'), {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ messages, context: context ?? null }),
    });
  } catch {
    return { ok: false, code: 'offline', message: 'You appear to be offline — the AI needs a connection.' };
  }
  let doc: { ok?: boolean; text?: string; provider?: string; model?: string; ms?: number; error?: string; message?: string; retryAfterSec?: number } | null = null;
  try {
    doc = await res.json();
  } catch {
    doc = null;
  }
  if (res.ok && doc?.ok && typeof doc.text === 'string') {
    return { ok: true, text: doc.text, provider: doc.provider, model: doc.model, ms: doc.ms };
  }
  const known = ['ai-unavailable', 'no-provider', 'no-keys', 'rate-limited', 'bad-request', 'provider-error'] as const;
  type AiErrorCode = (typeof known)[number];
  const raw = doc?.error ?? 'offline';
  const code: AiErrorCode = (known as readonly string[]).includes(raw) ? (raw as AiErrorCode) : 'provider-error';
  return {
    ok: false,
    code,
    message: doc?.message ?? `Request failed (HTTP ${res.status}).`,
    retryAfterSec: doc?.retryAfterSec,
  };
}

async function directCall(
  direct: NonNullable<AiPublicStatus['direct']>,
  system: string,
  messages: AiChatMessage[],
  context: AiStudentContext | null
): Promise<{ text: string; ms: number }> {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DIRECT_TIMEOUT_MS);
  try {
    const withContext = context?.hasAnyData ? `${system}\n\n${JSON.stringify(context)}` : system;
    if (direct.type === 'anthropic') {
      const res = await fetch(`${direct.baseUrl.replace(/\/+$/, '')}/v1/messages`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'content-type': 'application/json', 'x-api-key': direct.key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: direct.model, max_tokens: 700, temperature: 0.4, system: withContext, messages }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const doc = (await res.json()) as { content?: { type: string; text?: string }[] };
      const text = (doc.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n').trim();
      if (!text) throw new Error('empty answer');
      return { text, ms: Date.now() - t0 };
    }
    const res = await fetch(`${direct.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${direct.key}` },
      body: JSON.stringify({ model: direct.model, max_tokens: 700, temperature: 0.4, messages: [{ role: 'system', content: withContext }, ...messages] }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const doc = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = (doc.choices?.[0]?.message?.content ?? '').trim();
    if (!text) throw new Error('empty answer');
    return { text, ms: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}
