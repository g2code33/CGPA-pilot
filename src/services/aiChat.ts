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
  | { ok: false; code: 'offline' | 'ai-unavailable' | 'no-provider' | 'no-keys' | 'rate-limited' | 'bad-request' | 'provider-error' | 'direct-error' | 'interrupted'; message: string; retryAfterSec?: number };

/** Streaming callbacks: tokens arrive via onDelta as they are generated. */
export interface AiStreamHandlers {
  onDelta: (chunk: string) => void;
  onMeta?: (meta: { streamFormat: 'openai' | 'anthropic'; provider: string; model: string }) => void;
  signal?: AbortSignal;
}

// ── Content parts (text + attached images) → provider wire formats ────────

function contentToOpenAi(m: AiChatMessage): { role: string; content: string | unknown[] } {
  if (typeof m.content === 'string') return { role: m.role, content: m.content };
  return {
    role: m.role,
    content: m.content.map((p) =>
      p.type === 'text' ? { type: 'text', text: p.text } : { type: 'image_url', image_url: { url: p.dataUrl } }
    ),
  };
}

function parseDataUrl(dataUrl: string): { mime: string; b64: string } | null {
  const m = dataUrl.match(/^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,(.*)$/is);
  return m ? { mime: m[1], b64: m[2] } : null;
}

function contentToAnthropic(m: AiChatMessage): { role: string; content: string | unknown[] } {
  if (typeof m.content === 'string') return { role: m.role, content: m.content };
  const hasImage = m.content.some((p) => p.type === 'image');
  if (!hasImage) return { role: m.role, content: m.content.map((p) => (p.type === 'text' ? p.text : '')).join('') };
  return {
    role: m.role,
    content: m.content.flatMap((p): unknown[] => {
      if (p.type === 'text') return [{ type: 'text', text: p.text }];
      const d = parseDataUrl(p.dataUrl);
      return d ? [{ type: 'image', source: { type: 'base64', media_type: d.mime, data: d.b64 } }] : [];
    }),
  };
}

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

// ── Streaming (tokens appear live → the answer feels fast) ────────────────

interface SseFrame {
  event: string;
  data: unknown;
}

function parseSseFrame(frame: string): SseFrame | null {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
  }
  if (!dataLines.length) return null;
  const raw = dataLines.join('\n');
  if (raw === '[DONE]') return { event, data: '[DONE]' };
  try {
    return { event, data: JSON.parse(raw) };
  } catch {
    return { event, data: null };
  }
}

/** Pull one SSE frame off the buffer (null when incomplete). */
function takeFrame(buf: { s: string }): SseFrame | null {
  const idx = buf.s.indexOf('\n\n');
  if (idx === -1) return null;
  const frame = parseSseFrame(buf.s.slice(0, idx));
  buf.s = buf.s.slice(idx + 2);
  return frame;
}

type AiSendError = Extract<AiSendResult, { ok: false }>;

function mapStreamError(code: string, message: string, retryAfterSec?: number): AiSendResult {
  // Students always get a calm, actionable message — never provider JSON.
  const known = ['ai-unavailable', 'no-provider', 'no-keys', 'rate-limited', 'bad-request'] as const;
  const isKnown = (known as readonly string[]).includes(code);
  const out: AiSendError = {
    ok: false,
    code: isKnown ? (code as AiSendError['code']) : 'provider-error',
    message: isKnown ? message : 'The AI service hit a snag. Please try again in a moment.',
  };
  if (retryAfterSec) out.retryAfterSec = retryAfterSec;
  return out;
}

/**
 * Send a chat turn STREAMING: onDelta fires with each token as it arrives.
 * Returns the final result (full text on success, a friendly error otherwise).
 */
export async function streamAiMessage(input: AiSendInput, h: AiStreamHandlers): Promise<AiSendResult> {
  const { status, messages, context } = input;
  if (!status || !status.enabled) {
    return { ok: false, code: 'ai-unavailable', message: 'The AI assistant is currently turned off.' };
  }
  if (h.signal?.aborted) return { ok: false, code: 'interrupted', message: 'Cancelled.' };

  const body = {
    messages,
    context: context ?? null,
    stream: true,
  };

  let res: Response;
  if (status.direct) {
    const direct = status.direct;
    try {
      const withContext = context?.hasAnyData ? `${input.directSystemPrompt ?? ''}\n\n${JSON.stringify(context)}` : input.directSystemPrompt ?? '';
      res =
        direct.type === 'anthropic'
          ? await fetch(`${direct.baseUrl.replace(/\/+$/, '')}/v1/messages`, {
              method: 'POST',
              cache: 'no-store',
              signal: h.signal,
              headers: { 'content-type': 'application/json', 'x-api-key': direct.key, 'anthropic-version': '2023-06-01' },
              body: JSON.stringify({ model: direct.model, max_tokens: 700, temperature: 0.4, stream: true, system: withContext, messages: messages.map(contentToAnthropic) }),
            })
          : await fetch(`${direct.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
              method: 'POST',
              cache: 'no-store',
              signal: h.signal,
              headers: { 'content-type': 'application/json', authorization: `Bearer ${direct.key}` },
              body: JSON.stringify({ model: direct.model, max_tokens: 700, temperature: 0.4, stream: true, messages: [{ role: 'system', content: withContext }, ...messages.map(contentToOpenAi)] }),
            });
    } catch {
      return h.signal?.aborted
        ? { ok: false, code: 'interrupted', message: 'Cancelled.' }
        : { ok: false, code: 'direct-error', message: `The local AI endpoint (${status.direct.baseUrl}) did not respond. Start it (e.g. “ollama serve”) and try again.` };
    }
  } else {
    try {
      res = await fetch(configApiUrl('/api/ai/chat'), {
        method: 'POST',
        cache: 'no-store',
        signal: h.signal,
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify(body),
      });
    } catch {
      return h.signal?.aborted
        ? { ok: false, code: 'interrupted', message: 'Cancelled.' }
        : { ok: false, code: 'offline', message: 'You appear to be offline — the AI needs a connection.' };
    }
  }

  // Non-2xx → an error frame (SSE) or a plain JSON error.
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    type WireError = { ok?: boolean; error?: string; message?: string; retryAfterSec?: number };
    let doc: WireError | null = null;
    for (const frame of text.split('\n\n')) {
      const p = parseSseFrame(frame);
      if (p && p.event === 'error' && p.data && typeof p.data === 'object') doc = p.data as WireError;
    }
    if (!doc) {
      try {
        doc = JSON.parse(text);
      } catch {
        doc = null;
      }
    }
    return mapStreamError(doc?.error ?? 'provider-error', doc?.message ?? `The AI request failed (HTTP ${res.status}).`, doc?.retryAfterSec);
  }

  // Consume the SSE stream.
  let streamFormat: 'openai' | 'anthropic' = 'openai';
  let interrupted: string | null = null;
  let full = '';
  const decoder = new TextDecoder();
  const buf = { s: '' };
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf.s += decoder.decode(value, { stream: true });
      for (;;) {
        const frame = takeFrame(buf);
        if (!frame) break;
        if (frame.event === 'meta' && frame.data && typeof frame.data === 'object' && (frame.data as { format?: string }).format === 'cgpa-ai-stream-meta') {
          const meta = frame.data as { streamFormat?: 'openai' | 'anthropic'; provider?: string; model?: string };
          if (meta.streamFormat) streamFormat = meta.streamFormat;
          h.onMeta?.({ streamFormat, provider: meta.provider ?? '', model: meta.model ?? '' });
          continue;
        }
        if (frame.event === 'error') {
          interrupted = (frame.data as { message?: string } | null)?.message ?? 'stream error';
          continue;
        }
        if (frame.data === '[DONE]') continue;
        let delta = '';
        if (streamFormat === 'openai') {
          delta = (frame.data as { choices?: { delta?: { content?: string } }[] } | null)?.choices?.[0]?.delta?.content ?? '';
        } else if (frame.data && typeof frame.data === 'object' && (frame.data as { type?: string }).type === 'content_block_delta') {
          delta = (frame.data as { delta?: { text?: string } }).delta?.text ?? '';
        }
        if (delta) {
          full += delta;
          h.onDelta(delta);
        }
      }
    }
  } catch {
    if (h.signal?.aborted) return { ok: false, code: 'interrupted', message: 'Cancelled.' };
    return { ok: false, code: 'provider-error', message: 'The answer was interrupted before it finished — please try again.' };
  }
  if (interrupted) {
    return {
      ok: false,
      code: 'provider-error',
      message: interrupted === 'stream-interrupted' ? 'The answer was interrupted before it finished — please try again.' : 'The AI stream failed — please try again.',
    };
  }
  if (!full.trim()) {
    return { ok: false, code: 'provider-error', message: 'The AI returned an empty answer — please try again.' };
  }
  return { ok: true, text: full };
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
        body: JSON.stringify({ model: direct.model, max_tokens: 700, temperature: 0.4, system: withContext, messages: messages.map(contentToAnthropic) }),
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
      body: JSON.stringify({ model: direct.model, max_tokens: 700, temperature: 0.4, messages: [{ role: 'system', content: withContext }, ...messages.map(contentToOpenAi)] }),
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
