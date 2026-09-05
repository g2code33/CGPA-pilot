// ─────────────────────────────────────────────────────────────────────────
// aiSettings — the admin-managed AI assistant configuration.
//
// PURE (no DOM, no storage, no network) so it is shared by:
//   • the admin console (the AI Settings view + its API client)
//   • the Cloudflare Worker (validates + stores the document, and runs the
//     key pool / provider calls for the student chat endpoint)
//
// SECURITY MODEL:
//   • The document (including API KEYS) lives ONLY on the Worker (D1 table
//     `ai_settings`). It is NEVER part of the published student config —
//     students can only ever read the PUBLIC /api/ai/status (labels + flags,
//     no keys) and POST /api/ai/chat.
//   • EXCEPTION: a provider can run in `direct` mode (local setups such as
//     Ollama / LM Studio that only the student's own machine can reach). In
//     direct mode the public status MUST include that provider's key so the
//     client can call the local endpoint itself — the admin chooses this
//     knowingly, and it applies to direct-mode providers only.
// ─────────────────────────────────────────────────────────────────────────

/** How the client reaches the provider. */
export type AiProviderMode =
  | 'worker' // Worker proxies the call; keys stay server-side (default)
  | 'direct'; // the client calls the provider itself (local endpoints)

export type AiProviderType = 'openai-compatible' | 'anthropic';

/** One API key inside a provider's pool. */
export interface AiKey {
  id: string;
  /** Admin label (e.g. "nim-key-1") — shown in the console, never to students. */
  label: string;
  /** The secret itself. Only ever returned to authenticated admin clients. */
  value: string;
}

export interface AiProvider {
  id: string;
  /** Preset id — drives the console's quick-pick (base URL + model hints). */
  preset: AiPresetId;
  /** Display label (e.g. "NVIDIA NIM (free)"). */
  label: string;
  type: AiProviderType;
  mode: AiProviderMode;
  /** OpenAI-compatible base URL (…/v1) or, for anthropic, the API root. */
  baseUrl: string;
  /** Model id sent to the provider (e.g. "meta/llama-3.3-70b-instruct"). */
  model: string;
  /** The key pool — the Worker rotates across these for many users. */
  keys: AiKey[];
  enabled: boolean;
}

/** The full AI configuration document (single row in D1 `ai_settings`). */
export interface AiSettings {
  format: 'cgpa-pilot-ai-settings';
  /** Bumped on every admin save (monotonic, informational). */
  version: number;
  /** Master switch: off = the AI section is hidden from students. */
  enabled: boolean;
  /** The assistant's display name in the student app. */
  label: string;
  /** Privacy notice shown in the student AI screen (empty = built-in text). */
  notice: string;
  /** Persona + instructions the admin can tune. */
  systemPrompt: string;
  /** Sampling temperature, 0–2. */
  temperature: number;
  /** Max tokens per answer, 64–4096. */
  maxTokens: number;
  /** Rate limit: max chat messages per client IP per hour (1–500). */
  maxMessagesPerHour: number;
  /** When true the student's in-memory tool data is included as context. */
  sendContext: boolean;
  /** Provider id used when the client does not pick one (null = first). */
  defaultProviderId: string | null;
  providers: AiProvider[];
  updatedAt: string | null;
}

export type AiPresetId =
  | 'nvidia'
  | 'google'
  | 'groq'
  | 'cerebras'
  | 'mistral'
  | 'openrouter'
  | 'openai'
  | 'anthropic'
  | 'ollama'
  | 'custom';

export interface AiPreset {
  id: AiPresetId;
  label: string;
  type: AiProviderType;
  /** Pre-filled base URL (always editable in the console). */
  baseUrl: string;
  /** A sensible free-tier (or common) model to start from (editable). */
  defaultModel: string;
  /** Shown in the console so the admin knows the cost profile. */
  freeTier: boolean;
  /** True for presets that only the student's own machine can host. */
  local?: boolean;
}

/**
 * Known providers — "accepts all AI set-ups": every preset is ultimately an
 * OpenAI-compatible (or Anthropic) endpoint, and `custom` covers anything
 * else (vLLM, LM Studio, Azure-compatible gateways, self-hosted, …).
 */
export const AI_PRESETS: AiPreset[] = [
  {
    id: 'nvidia',
    label: 'NVIDIA NIM (free)',
    type: 'openai-compatible',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    defaultModel: 'meta/llama-3.3-70b-instruct',
    freeTier: true,
  },
  {
    id: 'google',
    label: 'Google AI Studio · Gemini (free)',
    type: 'openai-compatible',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.0-flash',
    freeTier: true,
  },
  {
    id: 'groq',
    label: 'Groq (free)',
    type: 'openai-compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    freeTier: true,
  },
  {
    id: 'cerebras',
    label: 'Cerebras (free)',
    type: 'openai-compatible',
    baseUrl: 'https://api.cerebras.ai/v1',
    defaultModel: 'llama3.3-70b',
    freeTier: true,
  },
  {
    id: 'mistral',
    label: 'Mistral La Plateforme (free tier)',
    type: 'openai-compatible',
    baseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-small-latest',
    freeTier: true,
  },
  {
    id: 'openrouter',
    label: 'OpenRouter (has :free models)',
    type: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
    freeTier: true,
  },
  {
    id: 'openai',
    label: 'OpenAI',
    type: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    freeTier: false,
  },
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    type: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-3-5-haiku-latest',
    freeTier: false,
  },
  {
    id: 'ollama',
    label: 'Local · Ollama (free, on the student’s device)',
    type: 'openai-compatible',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'llama3.1',
    freeTier: true,
    local: true,
  },
  {
    id: 'custom',
    label: 'Custom (any OpenAI-compatible endpoint)',
    type: 'openai-compatible',
    baseUrl: '',
    defaultModel: '',
    freeTier: false,
  },
];

export function aiPreset(id: AiPresetId): AiPreset {
  return AI_PRESETS.find((p) => p.id === id) ?? AI_PRESETS[AI_PRESETS.length - 1];
}

export const DEFAULT_AI_SYSTEM_PROMPT =
  'You are the built-in assistant of CGPA Pilot, an offline-first academic ' +
  'planning app for university students. A student has asked you a question. ' +
  'Answer precisely, concisely (a few short paragraphs or a tight list), in ' +
  'plain language a student can act on. When a STUDENT CONTEXT block is ' +
  'provided it holds the student’s CURRENT live data from the app tools ' +
  '(results, semesters, target, planned credits) — use it to answer about ' +
  'their actual position, and prefer its numbers over anything else. Never ' +
  'invent grades or results that are not in the context. When the context is ' +
  'empty or missing, say what they should fill in (My results, Target, Next ' +
  'Semester) so you can answer with their real numbers. You are a planning ' +
  'aid, not an academic record or an official university source.';

export const DEFAULT_AI_LABEL = 'CGPA Pilot AI';

/** A fresh, safe configuration (feature off, no keys, sensible limits). */
export function defaultAiSettings(): AiSettings {
  return {
    format: 'cgpa-pilot-ai-settings',
    version: 0,
    enabled: false,
    label: DEFAULT_AI_LABEL,
    notice:
      'When you ask the AI a question, your current tool data (results, ' +
      'semesters, target) is sent to the AI provider configured by your ' +
      'administrator, only for that question. It is not stored by the app.',
    systemPrompt: DEFAULT_AI_SYSTEM_PROMPT,
    temperature: 0.4,
    maxTokens: 700,
    maxMessagesPerHour: 20,
    sendContext: true,
    defaultProviderId: null,
    providers: [],
    updatedAt: null,
  };
}

// ── Validation (shared: admin client pre-flight + Worker storage gate) ────

export interface AiValidation {
  ok: boolean;
  issues: string[];
  /** The document with safe defaults applied to missing fields. */
  normalized: AiSettings;
}

export function validateAiSettings(raw: unknown): AiValidation {
  const issues: string[] = [];
  const base = defaultAiSettings();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, issues: ['AI settings must be a JSON object.'], normalized: base };
  }
  const r = raw as Record<string, unknown>;
  const s: AiSettings = { ...base, ...sanitizeCore(r), providers: [] };

  if (r.version != null && (typeof r.version !== 'number' || !Number.isFinite(r.version))) {
    issues.push('version must be a number.');
  }
  s.version = typeof r.version === 'number' && Number.isFinite(r.version) ? Math.max(0, Math.floor(r.version)) : base.version;

  if (s.systemPrompt.length > 4000) issues.push('System prompt is too long (max 4000 characters).');
  if (s.label.length > 40) issues.push('AI label is too long (max 40 characters).');
  if (s.notice.length > 1000) issues.push('Privacy notice is too long (max 1000 characters).');
  if (r.providers != null && !Array.isArray(r.providers)) issues.push('providers must be an array.');

  const seenProviderIds = new Set<string>();
  for (const p of Array.isArray(r.providers) ? (r.providers as unknown[]) : []) {
    const prov = sanitizeProvider(p);
    if (!prov) continue;
    if (seenProviderIds.has(prov.id)) {
      issues.push(`Provider “${prov.label}” has a duplicate id.`);
      continue;
    }
    seenProviderIds.add(prov.id);
    s.providers.push(prov);
  }

  // Not a hard error: an enabled feature with no keys simply reports
  // “being set up” to students — but flag it so the admin notices.
  if (s.enabled && !s.providers.some((p) => p.enabled && (p.mode === 'direct' || p.keys.length > 0))) {
    issues.push('Warning: AI is enabled but has no usable provider/keys yet — students will see “being set up”.');
  }

  if (s.defaultProviderId && !s.providers.some((p) => p.id === s.defaultProviderId)) {
    // Auto-corrected (below), so this is a heads-up, not a hard error.
    issues.push('Warning: the default provider no longer exists — the first usable provider will be used instead.');
    s.defaultProviderId = null;
  }

  // ok = no HARD errors (warnings are savable — they only flag the admin).
  return { ok: !issues.some((i) => !i.startsWith('Warning:')), issues, normalized: s };
}

function sanitizeCore(r: Record<string, unknown>): Omit<AiSettings, 'providers'> {
  const base = defaultAiSettings();
  const num = (v: unknown, fallback: number, min: number, max: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
  const str = (v: unknown, fallback: string): string =>
    typeof v === 'string' ? v : fallback;
  return {
    format: 'cgpa-pilot-ai-settings',
    version: base.version,
    enabled: r.enabled === true,
    label: str(r.label, base.label).slice(0, 40) || base.label,
    notice: str(r.notice, base.notice).slice(0, 1000),
    systemPrompt: str(r.systemPrompt, base.systemPrompt).slice(0, 4000) || base.systemPrompt,
    temperature: num(r.temperature, base.temperature, 0, 2),
    maxTokens: num(r.maxTokens, base.maxTokens, 64, 4096),
    maxMessagesPerHour: num(r.maxMessagesPerHour, base.maxMessagesPerHour, 1, 500),
    sendContext: r.sendContext !== false,
    defaultProviderId: typeof r.defaultProviderId === 'string' ? r.defaultProviderId : null,
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : null,
  };
}

function sanitizeProvider(p: unknown): AiProvider | null {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const o = p as Record<string, unknown>;
  const preset = AI_PRESETS.some((x) => x.id === o.preset) ? (o.preset as AiPresetId) : 'custom';
  const presetDef = aiPreset(preset);
  const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim().slice(0, 40) : `prov-${Math.random().toString(36).slice(2, 8)}`;
  const baseUrl = typeof o.baseUrl === 'string' ? o.baseUrl.trim().replace(/\/+$/, '') : presetDef.baseUrl;
  if (baseUrl && !/^https?:\/\//i.test(baseUrl)) return null;
  const keys: AiKey[] = [];
  const seenKeys = new Set<string>();
  for (const k of Array.isArray(o.keys) ? (o.keys as unknown[]) : []) {
    if (!k || typeof k !== 'object') continue;
    const ko = k as Record<string, unknown>;
    const value = typeof ko.value === 'string' ? ko.value.trim() : '';
    if (!value || seenKeys.has(value)) continue;
    seenKeys.add(value);
    keys.push({
      id: typeof ko.id === 'string' && ko.id.trim() ? ko.id.trim().slice(0, 40) : `key-${Math.random().toString(36).slice(2, 8)}`,
      label: typeof ko.label === 'string' ? ko.label.slice(0, 40) : '',
      value,
    });
  }
  return {
    id,
    preset,
    label: (typeof o.label === 'string' && o.label.trim() ? o.label.trim() : presetDef.label).slice(0, 60),
    type: o.type === 'anthropic' ? 'anthropic' : 'openai-compatible',
    mode: o.mode === 'direct' ? 'direct' : 'worker',
    baseUrl,
    model: typeof o.model === 'string' ? o.model.trim().slice(0, 120) : presetDef.defaultModel,
    keys,
    enabled: o.enabled !== false,
  };
}

// ── Chat contract (shared by the student client + the Worker) ─────────────

export interface AiChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * The student's LIVE, in-memory tool data — formatted into the system prompt
 * by the Worker when the admin allows context. Only sent to the AI provider
 * when the student asks a question (nothing is stored or uploaded otherwise).
 */
export interface AiStudentContext {
  institution?: { university?: string; school?: string; programme?: string } | null;
  mode?: 'history' | 'current' | null;
  levelIndex?: number | null;
  semesterIndex?: number | null;
  confirmedCgpa?: number | null;
  gradedCredits?: number | null;
  classification?: string | null;
  semesters?: {
    label: string;
    gpa: number | null;
    credits: number;
    pending: boolean;
    courses?: { code: string; grade: string | null; credits: number; pending: boolean }[];
  }[];
  pendingCredits?: number | null;
  targetCgpa?: number | null;
  plannedNextCredits?: number | null;
  hasAnyData?: boolean;
}

/** Public view of the settings — what students may ever see. */
export interface AiPublicStatus {
  format: 'cgpa-pilot-ai-status';
  enabled: boolean;
  label: string;
  notice: string;
  /** true when at least one enabled provider has a key (worker) or direct config. */
  ready: boolean;
  /** Display labels of the enabled providers (never keys or urls for worker mode). */
  providers: { id: string; label: string; model: string; mode: AiProviderMode }[];
  /** For DIRECT-mode providers only (local endpoints): the client needs these. */
  direct?: { baseUrl: string; model: string; key: string; type: AiProviderType } | null;
  defaultProviderId: string | null;
  version: number;
  updatedAt: string | null;
}

export function publicAiStatus(s: AiSettings): AiPublicStatus {
  const enabledProviders = s.providers.filter((p) => p.enabled);
  const ready = enabledProviders.some((p) =>
    p.mode === 'direct' ? p.baseUrl.length > 0 && p.model.length > 0 : p.keys.length > 0
  );
  const directProv =
    s.enabled && ready
      ? enabledProviders.find((p) => p.mode === 'direct' && p.baseUrl && p.model) ?? null
      : null;
  return {
    format: 'cgpa-pilot-ai-status',
    enabled: s.enabled,
    label: s.label,
    notice: s.notice,
    ready,
    providers: enabledProviders.map((p) => ({ id: p.id, label: p.label, model: p.model, mode: p.mode })),
    direct: directProv
      ? {
          baseUrl: directProv.baseUrl,
          model: directProv.model,
          key: directProv.keys[0]?.value ?? '',
          type: directProv.type,
        }
      : null,
    defaultProviderId: s.defaultProviderId,
    version: s.version,
    updatedAt: s.updatedAt,
  };
}
