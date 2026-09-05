// ─────────────────────────────────────────────────────────────────────────
// AiSettings — the admin's AI assistant configuration (server-side).
//
//   • Master switch + the student-facing label + privacy notice.
//   • The PROVIDER + KEY POOL: add any OpenAI-compatible or Anthropic
//     endpoint (NVIDIA NIM, Gemini, Groq, Cerebras, Mistral, OpenRouter,
//     OpenAI, local Ollama/LM Studio, …). Each provider holds a POOL of
//     keys — the Worker rotates across them (with failure cooldowns) so a
//     few free keys can serve many students efficiently.
//   • Regulation: hourly rate limit, context toggle, temperature, max tokens,
//     default provider, and a live “Test” per key so the admin verifies a key
//     before relying on it.
//
// Keys are stored ONLY on the Worker (never in the published student config)
// and shown masked here with a reveal toggle.
// ─────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AI_PRESETS,
  defaultAiSettings,
  validateAiSettings,
  type AiPresetId,
  type AiProvider,
  type AiSettings,
} from '../aiSettings';
import { getAiSettings, saveAiSettings, testAiKey } from '../adminApi';

type Toast = (m: string) => void;

function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

export function AiSettings({ toast, onNavigate }: { toast: Toast; onNavigate: (v: string) => void }) {
  const [settings, setSettings] = useState<AiSettings>(defaultAiSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [switchSaving, setSwitchSaving] = useState(false);
  const [hasStored, setHasStored] = useState(false);
  // Did we manage to load the stored settings from the server?
  const [loadFailed, setLoadFailed] = useState<string | null>(null);
  // What the server currently holds — the baseline for the “saved vX · time”
  // indicator and the “unsaved changes” dot.
  const [saved, setSaved] = useState<{ version: number; updatedAt: string | null } | null>(null);
  const savedRef = useRef<AiSettings | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const r = await getAiSettings();
      if (!live) return;
      if (r.ok && r.settings) {
        setSettings(r.settings);
        setHasStored(!!r.hasStored);
        savedRef.current = r.settings;
        setSaved({ version: r.settings.version, updatedAt: r.updatedAt ?? r.settings.updatedAt ?? null });
        setLoadFailed(null);
      } else {
        // Never silently show an empty form when the real settings exist on
        // the server but couldn't be read — that invites an accidental
        // overwrite.
        setLoadFailed(r.message ?? r.error ?? 'Could not load the stored AI settings.');
      }
      setLoading(false);
    })();
    return () => {
      live = false;
    };
  }, []);

  const issues = useMemo(() => (loading ? [] : validateAiSettings(settings).issues), [loading, settings]);
  const dirty = useMemo(
    () => savedRef.current !== null && JSON.stringify(settings) !== JSON.stringify(savedRef.current),
    [settings]
  );

  function patch(p: Partial<AiSettings>) {
    setSettings((s) => ({ ...s, ...p }));
  }

  function patchProvider(id: string, p: Partial<AiProvider>) {
    setSettings((s) => ({ ...s, providers: s.providers.map((pr) => (pr.id === id ? { ...pr, ...p } : pr)) }));
  }

  function addProvider(preset: AiPresetId = 'nvidia') {
    const def = AI_PRESETS.find((p) => p.id === preset) ?? AI_PRESETS[0];
    const id = newId('prov');
    setSettings((s) => ({
      ...s,
      defaultProviderId: s.defaultProviderId ?? id,
      providers: [
        ...s.providers,
        {
          id,
          preset: def.id,
          label: def.label,
          type: def.type,
          mode: def.local ? 'direct' : 'worker',
          baseUrl: def.baseUrl,
          model: def.defaultModel,
          keys: [],
          enabled: true,
        },
      ],
    }));
  }

  async function onSave() {
    const v = validateAiSettings(settings);
    if (!v.ok) {
      toast(`⛔ Fix AI settings first — ${v.issues[0]}`);
      return;
    }
    // Never overwrite the server's stored settings from a form we failed to
    // load — require an explicit "yes, I understand".
    if (loadFailed) {
      const okc = window.confirm(
        'The stored settings could NOT be loaded (see the red note above). Saving now will REPLACE whatever is on the server with exactly what is in this form.\n\nAre you sure you want to do that?'
      );
      if (!okc) return;
    }
    setSaving(true);
    const r = await saveAiSettings(v.normalized);
    setSaving(false);
    if (r.ok) {
      // The screen now shows EXACTLY what the server holds (the normalized
      // doc + fresh version), and the dirty-dot baseline matches it.
      const next: AiSettings = { ...v.normalized, version: r.version ?? v.normalized.version, updatedAt: r.updatedAt ?? null };
      savedRef.current = next;
      setSettings(next);
      setSaved({ version: next.version, updatedAt: next.updatedAt });
      setHasStored(true);
      toast(`✅ AI settings saved${r.version ? ` (v${r.version})` : ''}. They stay on the server and reappear after any refresh.`);
    } else {
      toast(`⛔ ${r.issues?.[0] ?? r.message ?? 'Save failed'}`);
    }
  }

  // The master switch saves ITSELF the moment you flip it — no “Save”
  // button needed, and students pick the change up within ~30 seconds.
  async function toggleEnabled(v: boolean) {
    if (loadFailed) {
      const okc = window.confirm(
        'The stored settings could NOT be loaded, so flipping this switch would REPLACE the stored settings with this (possibly empty) form.\n\nSign in again and reload first — continue anyway?'
      );
      if (!okc) return;
    }
    const next = { ...settings, enabled: v };
    setSettings(next);
    const sv = validateAiSettings(next);
    if (!sv.ok) {
      toast(`⛔ ${sv.issues[0]}`);
      setSettings((s) => ({ ...s, enabled: !v }));
      return;
    }
    setSwitchSaving(true);
    const r = await saveAiSettings(sv.normalized);
    setSwitchSaving(false);
    if (r.ok) {
      const next: AiSettings = { ...sv.normalized, version: r.version ?? sv.normalized.version, updatedAt: r.updatedAt ?? null };
      savedRef.current = next;
      setSettings(next);
      setSaved({ version: next.version, updatedAt: next.updatedAt });
      setHasStored(true);
      toast(v ? '🟢 AI switched ON for students (saved).' : '🔕 AI switched OFF for students (saved).');
    } else {
      toast(`⛔ ${r.issues?.[0] ?? r.message ?? 'Could not save the switch.'}`);
    }
  }

  if (loading) {
    return <div className="py-10 text-center text-xs font-semibold text-slate-400">Loading AI settings…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-lg font-black text-slate-900">
            🤖 AI Assistant
            {dirty && <span className="ml-2 align-middle text-[11px] font-black text-amber-600">● unsaved changes</span>}
          </h1>
          <p className="text-[11px] font-semibold text-slate-500">
            Everything below lives on the server — saved keys, the switch and the rules stay for every admin, on
            every login and after every refresh.
            {saved && (
              <span className="ml-1 font-black text-emerald-600">
                Saved v{saved.version}
                {saved.updatedAt ? ` · ${new Date(saved.updatedAt).toLocaleString()}` : ''}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={() => void onSave()}
          disabled={saving}
          className={`rounded-xl px-4 py-2.5 text-xs font-black text-white shadow-sm transition active:scale-[0.99] disabled:opacity-60 ${
            dirty ? 'bg-brand-600 hover:bg-brand-700 ring-2 ring-brand-300' : 'bg-slate-700 hover:bg-slate-600'
          }`}
        >
          {saving ? 'Saving…' : dirty ? '💾 Save AI settings' : '✅ Saved'}
        </button>
      </div>

      {issues.length > 0 && (
        <div className="rounded-2xl bg-amber-50 p-3 ring-1 ring-amber-200">
          <p className="text-[11px] font-black text-amber-700">⚠️ {issues.length} issue(s)</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] font-semibold text-amber-700">
            {issues.map((i, k) => (
              <li key={k}>{i}</li>
            ))}
          </ul>
        </div>
      )}

      {loadFailed && (
        <div className="rounded-2xl bg-red-50 p-3 ring-1 ring-red-200">
          <p className="text-[11px] font-black text-red-700">⛔ Couldn’t load the stored settings: {loadFailed}</p>
          <p className="mt-0.5 text-[11px] font-semibold text-red-600">
            The form below may be EMPTY even though your keys are safe on the server. Sign in again and reload
            before saving — otherwise you could overwrite what’s stored.
          </p>
        </div>
      )}

      {/* Master switch + identity */}
      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-black text-slate-800">
              Feature switch {switchSaving && <span className="font-bold text-brand-500">saving…</span>}
            </h2>
            <p className="text-[11px] font-semibold text-slate-500">
              Saves itself the moment you flip it — students pick it up within ~30 s.
            </p>
          </div>
          <Toggle on={settings.enabled} onChange={(v) => void toggleEnabled(v)} />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-[11px] font-black uppercase tracking-wide text-slate-400">Assistant name (shown to students)</span>
            <input value={settings.label} onChange={(e) => patch({ label: e.target.value })} className="mt-1 w-full rounded-xl border-0 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800 ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-400" />
          </label>
          <label className="block">
            <span className="text-[11px] font-black uppercase tracking-wide text-slate-400">Max messages / client / hour</span>
            <input
              type="number"
              min={1}
              max={500}
              value={settings.maxMessagesPerHour}
              onChange={(e) => patch({ maxMessagesPerHour: Number(e.target.value) })}
              className="mt-1 w-full rounded-xl border-0 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800 ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-400"
            />
          </label>
        </div>
        <label className="mt-3 block">
          <span className="text-[11px] font-black uppercase tracking-wide text-slate-400">Privacy notice (shown in the student AI screen)</span>
          <textarea
            value={settings.notice}
            onChange={(e) => patch({ notice: e.target.value })}
            rows={2}
            className="mt-1 w-full resize-y rounded-xl border-0 bg-slate-50 px-3 py-2 text-xs font-medium leading-relaxed text-slate-700 ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-400"
          />
        </label>
      </section>

      {/* Regulation */}
      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <h2 className="text-sm font-black text-slate-800">Regulation</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="text-[11px] font-black uppercase tracking-wide text-slate-400">Temperature (0–2)</span>
            <input
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={settings.temperature}
              onChange={(e) => patch({ temperature: Number(e.target.value) })}
              className="mt-1 w-full rounded-xl border-0 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800 ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-400"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-black uppercase tracking-wide text-slate-400">Max answer tokens (64–4096)</span>
            <input
              type="number"
              min={64}
              max={4096}
              step={16}
              value={settings.maxTokens}
              onChange={(e) => patch({ maxTokens: Number(e.target.value) })}
              className="mt-1 w-full rounded-xl border-0 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800 ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-400"
            />
          </label>
          <div className="flex items-end">
            <div className="flex w-full items-center justify-between rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
              <span className="text-[11px] font-black uppercase tracking-wide text-slate-400">Send student context</span>
              <Toggle on={settings.sendContext} onChange={(v) => patch({ sendContext: v })} />
            </div>
          </div>
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
          “Send student context” includes the student's live tool data (results, target, plan) with each question so the AI answers with their real numbers. Off = the AI only answers generally.
        </p>
      </section>

      {/* Persona */}
      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-black text-slate-800">Assistant persona (system prompt)</h2>
          <button
            onClick={() => patch({ systemPrompt: defaultAiSettings().systemPrompt })}
            className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-[11px] font-black text-slate-600 hover:bg-slate-200"
          >
            ↺ Reset to default
          </button>
        </div>
        <textarea
          value={settings.systemPrompt}
          onChange={(e) => patch({ systemPrompt: e.target.value })}
          rows={5}
          className="mt-2 w-full resize-y rounded-xl border-0 bg-slate-50 px-3 py-2 text-xs font-medium leading-relaxed text-slate-700 ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-400"
        />
      </section>

      {/* Providers + key pool */}
      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-black text-slate-800">Providers & key pool</h2>
            <p className="text-[11px] font-semibold text-slate-500">
              Add as many keys per provider as you have — the server rotates across them so free tiers serve many students.
            </p>
          </div>
          <select
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) addProvider(e.target.value as AiPresetId);
              e.target.value = '';
            }}
            className="rounded-xl bg-brand-600 px-3 py-2 text-xs font-black text-white shadow-sm"
          >
            <option value="" disabled>
              + Add provider…
            </option>
            {AI_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
                {p.freeTier ? ' (free)' : ''}
              </option>
            ))}
          </select>
        </div>

        {settings.providers.length === 0 ? (
          <div className="mt-3 rounded-xl bg-slate-50 p-6 text-center ring-1 ring-slate-200">
            <p className="text-sm font-black text-slate-600">No providers yet</p>
            <p className="mx-auto mt-1 max-w-xs text-[11px] leading-relaxed text-slate-500">
              Add a provider (NVIDIA NIM, Gemini, Groq, … or your own OpenAI-compatible endpoint) and at least one API key to make the AI live.
            </p>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            {settings.providers.map((p) => (
              <ProviderCard
                key={p.id}
                provider={p}
                isDefault={settings.defaultProviderId === p.id}
                onChange={(pp) => patchProvider(p.id, pp)}
                onRemove={() => {
                  if (!confirm(`Remove provider “${p.label}”?`)) return;
                  setSettings((s) => ({
                    ...s,
                    defaultProviderId: s.defaultProviderId === p.id ? null : s.defaultProviderId,
                    providers: s.providers.filter((x) => x.id !== p.id),
                  }));
                }}
                onSetDefault={() => patch({ defaultProviderId: p.id })}
                onTest={async (keyId, keyLabel) => {
                  const key = p.keys.find((k) => k.id === keyId);
                  if (!key) {
                    toast(`⛔ ${keyLabel}: that key no longer exists.`);
                    return;
                  }
                  // Test the provider + key exactly as they are on screen —
                  // no need to save first. On failure, show the provider's
                  // RAW error (detail) too — that is the evidence, the
                  // friendly message is just a translation of it.
                  const r = await testAiKey(p, key.value);
                  if (r.ok) toast(`✅ ${keyLabel}: ${r.message}`);
                  else {
                    const detail = r.detail ? ` · provider said: ${r.detail.slice(0, 160)}` : '';
                    toast(`⛔ ${keyLabel}: ${r.message}${detail}`);
                  }
                }}
              />
            ))}
          </div>
        )}
      </section>

      {/* Diagnostics + the student error log live in their own section now. */}
      <section className="rounded-2xl bg-brand-50 p-4 ring-1 ring-brand-200">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-black text-brand-900">🩺 AI Monitor</h2>
            <p className="text-[11px] font-semibold text-brand-800">
              Powerful diagnostics (with real key tests) and the full log of student errors now live in their own
              section — just like Curricula.
            </p>
          </div>
          <button
            onClick={() => onNavigate('aimonitor')}
            className="rounded-xl bg-brand-600 px-3 py-2 text-[11px] font-black text-white shadow-sm transition hover:bg-brand-700"
          >
            Open AI Monitor →
          </button>
        </div>
      </section>
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? 'bg-emerald-500' : 'bg-slate-300'}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  );
}

function ProviderCard({
  provider,
  isDefault,
  onChange,
  onRemove,
  onSetDefault,
  onTest,
}: {
  provider: AiProvider;
  isDefault: boolean;
  onChange: (p: Partial<AiProvider>) => void;
  onRemove: () => void;
  onSetDefault: () => void;
  onTest: (keyId: string, keyLabel: string) => Promise<void>;
}) {
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [newKey, setNewKey] = useState({ label: '', value: '' });
  const [testing, setTesting] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ label: '', value: '' });
  const preset = AI_PRESETS.find((p) => p.id === provider.preset);

  function startEdit(k: AiProvider['keys'][number]) {
    setEditing(k.id);
    setEditDraft({ label: k.label, value: k.value });
  }

  function saveKeyEdit(k: AiProvider['keys'][number]) {
    const value = editDraft.value.trim();
    if (!value) return;
    onChange({
      keys: provider.keys.map((x) => (x.id === k.id ? { ...x, label: editDraft.label.trim() || x.label, value } : x)),
    });
    setEditing(null);
  }

  function applyPreset(id: AiPresetId) {
    const def = AI_PRESETS.find((p) => p.id === id) ?? AI_PRESETS[0];
    onChange({
      preset: def.id,
      label: provider.label === (AI_PRESETS.find((p) => p.id === provider.preset)?.label ?? '') || provider.label === provider.preset ? def.label : provider.label,
      type: def.type,
      mode: def.local ? 'direct' : provider.mode === 'direct' ? 'direct' : 'worker',
      baseUrl: def.baseUrl || provider.baseUrl,
      model: def.defaultModel || provider.model,
    });
  }

  function addKey() {
    const value = newKey.value.trim();
    if (!value) return;
    onChange({
      keys: [...provider.keys, { id: newId('key'), label: newKey.label.trim() || `key-${provider.keys.length + 1}`, value }],
    });
    setNewKey({ label: '', value: '' });
  }

  return (
    <div className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ring-1 ${provider.enabled ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-slate-100 text-slate-400 ring-slate-200'}`}>
          {provider.enabled ? 'on' : 'off'}
        </span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-slate-500 ring-1 ring-slate-200">
          {provider.mode === 'direct' ? 'direct / local' : 'worker'}
        </span>
        {isDefault && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-brand-700 ring-1 ring-brand-200">default</span>}
        <button onClick={onSetDefault} disabled={isDefault} className="ml-auto rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-black text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-40">
          {isDefault ? 'Default' : 'Make default'}
        </button>
        <button onClick={onRemove} className="rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-black text-red-500 ring-1 ring-red-200 hover:bg-red-50">
          Remove
        </button>
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="text-[10px] font-black uppercase tracking-wide text-slate-400">Preset / type</span>
          <select value={provider.preset} onChange={(e) => applyPreset(e.target.value as AiPresetId)} className="mt-1 w-full rounded-xl border-0 bg-white px-3 py-2 text-xs font-semibold text-slate-800 ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-400">
            {AI_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-[10px] font-black uppercase tracking-wide text-slate-400">Label (for admins)</span>
          <input value={provider.label} onChange={(e) => onChange({ label: e.target.value })} className="mt-1 w-full rounded-xl border-0 bg-white px-3 py-2 text-xs font-semibold text-slate-800 ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-400" />
        </label>
        <label className="block">
          <span className="text-[10px] font-black uppercase tracking-wide text-slate-400">Base URL</span>
          <input
            value={provider.baseUrl}
            onChange={(e) => onChange({ baseUrl: e.target.value })}
            placeholder={preset?.baseUrl || 'https://…/v1'}
            className="mt-1 w-full rounded-xl border-0 bg-white px-3 py-2 font-mono text-[11px] font-semibold text-slate-700 ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-400"
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-black uppercase tracking-wide text-slate-400">Model</span>
          <input value={provider.model} onChange={(e) => onChange({ model: e.target.value })} placeholder={preset?.defaultModel || 'model-id'} className="mt-1 w-full rounded-xl border-0 bg-white px-3 py-2 font-mono text-[11px] font-semibold text-slate-700 ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-400" />
        </label>
      </div>

      <div className="mt-2 flex items-center justify-between rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
        <div>
          <p className="text-[11px] font-black text-slate-700">Enabled</p>
          <p className="text-[10px] font-semibold text-slate-400">Disabled providers are skipped by the student app.</p>
        </div>
        <Toggle on={provider.enabled} onChange={(v) => onChange({ enabled: v })} />
      </div>

      {/* Key pool */}
      <div className="mt-2">
        <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Key pool ({provider.keys.length})</p>
        <div className="mt-1 space-y-1.5">
          {provider.keys.map((k) =>
            editing === k.id ? (
              <div key={k.id} className="rounded-lg bg-brand-50 p-2 ring-1 ring-brand-300">
                <p className="text-[10px] font-black uppercase tracking-wide text-brand-600">Editing “{k.label || 'key'}”</p>
                <div className="mt-1 flex gap-1.5">
                  <input
                    value={editDraft.label}
                    onChange={(e) => setEditDraft((d) => ({ ...d, label: e.target.value }))}
                    placeholder="Label"
                    className="w-24 shrink-0 rounded-lg border-0 bg-white px-2 py-1.5 text-[11px] font-semibold text-slate-700 ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-400"
                  />
                  <input
                    value={editDraft.value}
                    onChange={(e) => setEditDraft((d) => ({ ...d, value: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveKeyEdit(k);
                    }}
                    placeholder="New API key value"
                    className="min-w-0 flex-1 rounded-lg border-0 bg-white px-2 py-1.5 font-mono text-[11px] font-semibold text-slate-700 ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-400"
                  />
                  <button onClick={() => saveKeyEdit(k)} disabled={!editDraft.value.trim()} className="shrink-0 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[11px] font-black text-white hover:bg-emerald-700 disabled:opacity-40" title="Save new key">
                    💾
                  </button>
                  <button onClick={() => setEditing(null)} className="shrink-0 rounded-lg px-1.5 py-1.5 text-[11px] font-black text-slate-400 hover:bg-white" title="Cancel">
                    ✕
                  </button>
                </div>
                <p className="mt-1 text-[10px] font-semibold text-slate-400">
                  Replace this key’s value (and label if you like) — then hit 💾 and Save AI settings.
                </p>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 rounded-lg bg-white px-2 py-1.5 ring-1 ring-slate-200">
                <span className="w-24 shrink-0 truncate text-[11px] font-black text-slate-600" title={k.label}>
                  {k.label || 'key'}
                </span>
                <code className="min-w-0 flex-1 truncate font-mono text-[11px] font-semibold text-slate-500">
                  {revealed[k.id] ? k.value : maskForDisplay(k.value)}
                </code>
                <button onClick={() => setRevealed((r) => ({ ...r, [k.id]: !r[k.id] }))} className="shrink-0 rounded px-1.5 py-1 text-[11px] font-black text-slate-400 hover:bg-slate-100" title="Show/hide key">
                  {revealed[k.id] ? '🙈' : '👁'}
                </button>
                <button onClick={() => startEdit(k)} className="shrink-0 rounded px-1.5 py-1 text-[11px] font-black text-slate-400 hover:bg-slate-100" title="Edit key (replace value / label)">
                  ✎
                </button>
              <button
                onClick={() => {
                  setTesting(k.id);
                  void onTest(k.id, k.label || 'key').finally(() => setTesting(null));
                }}
                disabled={testing === k.id}
                className="shrink-0 rounded bg-emerald-50 px-2 py-1 text-[10px] font-black text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100 disabled:opacity-50"
              >
                {testing === k.id ? '…' : 'Test'}
              </button>
                <button
                  onClick={() => onChange({ keys: provider.keys.filter((x) => x.id !== k.id) })}
                  className="shrink-0 rounded px-1.5 py-1 text-[11px] font-black text-red-400 hover:bg-red-50"
                  title="Remove key"
                >
                  ✕
                </button>
              </div>
            )
          )}
        </div>
        <div className="mt-1.5 flex gap-1.5">
          <input
            value={newKey.label}
            onChange={(e) => setNewKey((n) => ({ ...n, label: e.target.value }))}
            placeholder="Label (e.g. nim-2)"
            className="w-28 rounded-lg border-0 bg-white px-2 py-1.5 text-[11px] font-semibold text-slate-700 ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-400"
          />
          <input
            value={newKey.value}
            onChange={(e) => setNewKey((n) => ({ ...n, value: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addKey();
            }}
            placeholder="Paste API key"
            className="min-w-0 flex-1 rounded-lg border-0 bg-white px-2 py-1.5 font-mono text-[11px] font-semibold text-slate-700 ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-400"
          />
          <button onClick={addKey} disabled={!newKey.value.trim()} className="rounded-lg bg-slate-900 px-3 py-1.5 text-[11px] font-black text-white disabled:opacity-40">
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

function maskForDisplay(value: string): string {
  const v = value.trim();
  if (v.length <= 8) return '••••';
  return `${v.slice(0, 4)}••••${v.slice(-4)}`;
}
