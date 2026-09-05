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

import { useEffect, useMemo, useState } from 'react';
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

export function AiSettings({ toast }: { toast: Toast }) {
  const [settings, setSettings] = useState<AiSettings>(defaultAiSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasStored, setHasStored] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const r = await getAiSettings();
      if (!live) return;
      if (r.ok && r.settings) {
        setSettings(r.settings);
        setHasStored(!!r.hasStored);
      }
      setLoading(false);
    })();
    return () => {
      live = false;
    };
  }, []);

  const issues = useMemo(() => (loading ? [] : validateAiSettings(settings).issues), [loading, settings]);

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
    setSaving(true);
    const r = await saveAiSettings(v.normalized);
    setSaving(false);
    if (r.ok) {
      setSettings((s) => ({ ...s, version: r.version ?? s.version, updatedAt: r.updatedAt ?? null }));
      setHasStored(true);
      toast(`✅ AI settings saved${r.version ? ` (v${r.version})` : ''}. Students pick it up within seconds.`);
    } else {
      toast(`⛔ ${r.issues?.[0] ?? r.message ?? 'Save failed'}`);
    }
  }

  if (loading) {
    return <div className="py-10 text-center text-xs font-semibold text-slate-400">Loading AI settings…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-black text-slate-900">🤖 AI Assistant</h1>
          <p className="text-[11px] font-semibold text-slate-500">
            Configure the providers, key pool and rules that power the student AI. Keys stay on the server.
          </p>
        </div>
        <button
          onClick={() => void onSave()}
          disabled={saving}
          className="rounded-xl bg-brand-600 px-4 py-2.5 text-xs font-black text-white shadow-sm transition hover:bg-brand-700 active:scale-[0.99] disabled:opacity-60"
        >
          {saving ? 'Saving…' : '💾 Save AI settings'}
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

      {/* Master switch + identity */}
      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-black text-slate-800">Feature switch</h2>
            <p className="text-[11px] font-semibold text-slate-500">Off = the AI section is hidden from every student.</p>
          </div>
          <Toggle on={settings.enabled} onChange={(v) => patch({ enabled: v })} />
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
                  // no need to save first.
                  const r = await testAiKey(p, key.value);
                  toast(r.ok ? `✅ ${keyLabel}: ${r.message}` : `⛔ ${keyLabel}: ${r.message}`);
                }}
              />
            ))}
          </div>
        )}
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
  const preset = AI_PRESETS.find((p) => p.id === provider.preset);

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
          {provider.keys.map((k) => (
            <div key={k.id} className="flex items-center gap-1.5 rounded-lg bg-white px-2 py-1.5 ring-1 ring-slate-200">
              <span className="w-24 shrink-0 truncate text-[11px] font-black text-slate-600" title={k.label}>
                {k.label || 'key'}
              </span>
              <code className="min-w-0 flex-1 truncate font-mono text-[11px] font-semibold text-slate-500">
                {revealed[k.id] ? k.value : maskForDisplay(k.value)}
              </code>
              <button onClick={() => setRevealed((r) => ({ ...r, [k.id]: !r[k.id] }))} className="shrink-0 rounded px-1.5 py-1 text-[11px] font-black text-slate-400 hover:bg-slate-100" title="Show/hide key">
                {revealed[k.id] ? '🙈' : '👁'}
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
          ))}
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
