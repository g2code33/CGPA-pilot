// ─────────────────────────────────────────────────────────────────────────
// AiMonitor — the admin's AI health section (its own nav item, like
// Curricula):
//
//   • Status strip — is the AI on / ready / which provider / settings
//     version / how many student errors in the last 24 h.
//   • Diagnostics — quick checks (worker, D1, tables, catalog, published
//     config, AI settings, the student view, every provider ENDPOINT and
//     24-h error activity) and a DEEP check that fires a real request with
//     each provider's key, so the admin sees "key works (234 ms)" or the
//     provider's exact rejection.
//   • Student error log — every AI failure students would have seen, with
//     the technical detail for the admin (no student content is stored).
//     Time filter (24 h / 7 days / all), auto-refresh, copy, clear.
// ─────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react';
import {
  clearAiErrors,
  getAiErrors,
  getAiSettings,
  getDiagnostics,
  type AiErrorEntry,
  type DiagnosticCheck,
} from '../adminApi';

type Toast = (m: string) => void;

function timeAgo(ts: string | number): string {
  const t = typeof ts === 'number' ? ts : Date.parse(ts);
  const diff = Date.now() - (Number.isFinite(t) ? t : Date.now());
  const s = Math.max(0, Math.floor(diff / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return new Date(t).toLocaleString();
}

const DAY_MS = 86_400_000;

export function AiMonitor({ toast }: { toast: Toast }) {
  // Status strip data (the stored AI settings — the source of truth).
  const [ai, setAi] = useState<{ enabled: boolean; label: string; version: number; updatedAt: string | null; providers: { label: string; model: string }[] } | null>(null);
  const [aiLoadFailed, setAiLoadFailed] = useState<string | null>(null);

  // Error log.
  const [errors, setErrors] = useState<AiErrorEntry[] | null>(null);
  const [errorsTotal, setErrorsTotal] = useState(0);
  const [errorFilter, setErrorFilter] = useState<'24h' | '7d' | 'all'>('24h');

  // Diagnostics.
  const [checks, setChecks] = useState<DiagnosticCheck[] | null>(null);
  const [checksAt, setChecksAt] = useState<string | null>(null);
  const [checksDeep, setChecksDeep] = useState(false);
  const [running, setRunning] = useState<'quick' | 'deep' | null>(null);

  const refreshStatus = useCallback(async () => {
    const r = await getAiSettings();
    if (r.ok && r.settings) {
      setAi({
        enabled: r.settings.enabled,
        label: r.settings.label,
        version: r.settings.version,
        updatedAt: r.settings.updatedAt,
        providers: r.settings.providers
          .filter((p) => p.enabled)
          .map((p) => ({ label: p.label, model: p.model })),
      });
      setAiLoadFailed(null);
    } else {
      setAiLoadFailed(r.message ?? 'Could not load the AI settings.');
    }
  }, []);

  const refreshErrors = useCallback(async () => {
    const r = await getAiErrors();
    if (r.ok) {
      setErrors(r.errors);
      setErrorsTotal(r.total);
    }
  }, []);

  // Load immediately, then keep the error log fresh (20 s) and the status
  // strip fresh (60 s) while this page is open.
  useEffect(() => {
    void refreshStatus();
    void refreshErrors();
    const t = window.setInterval(() => void refreshErrors(), 20_000);
    const t2 = window.setInterval(() => void refreshStatus(), 60_000);
    return () => {
      window.clearInterval(t);
      window.clearInterval(t2);
    };
  }, [refreshStatus, refreshErrors]);

  async function runDiagnostics(deep: boolean) {
    setRunning(deep ? 'deep' : 'quick');
    const r = await getDiagnostics(deep);
    setRunning(null);
    if (r.ok) {
      setChecks(r.checks);
      setChecksAt(r.at);
      setChecksDeep(r.deep);
      const bad = r.checks.filter((c) => !c.ok);
      toast(
        bad.length === 0
          ? '🩺 All systems healthy.'
          : `🩺 Diagnostics finished — ${bad.length} problem(s) found: ${bad.map((c) => c.label).join(', ')}.`
      );
    } else {
      toast(`⛔ ${r.message ?? 'Diagnostics failed.'}`);
    }
  }

  async function clearErrors() {
    if (!window.confirm('Clear the whole AI error log?')) return;
    const r = await clearAiErrors();
    if (r.ok) {
      toast('🧹 Error log cleared.');
      await refreshErrors();
    } else {
      toast(`⛔ ${r.message ?? 'Could not clear the log.'}`);
    }
  }

  function copyError(e: AiErrorEntry) {
    const text = [
      `${new Date(e.ts).toISOString()}`,
      `kind: ${e.kind}`,
      `status: ${e.status ?? 'n/a'}`,
      `provider: ${e.provider ?? 'n/a'}`,
      `model: ${e.model ?? 'n/a'}`,
      `key: ${e.keyLabel ?? 'n/a'}`,
      `detail: ${e.detail ?? 'n/a'}`,
    ].join('\n');
    void navigator.clipboard?.writeText(text).then(
      () => toast('📋 Error details copied.'),
      () => toast('⛔ Could not copy (clipboard blocked).')
    );
  }

  const visibleErrors =
    errors === null
      ? null
      : errors.filter((e) => {
          if (errorFilter === 'all') return true;
          const cutoff = errorFilter === '24h' ? DAY_MS : 7 * DAY_MS;
          return Date.now() - Date.parse(e.ts) <= cutoff;
        });

  const errors24h = (errors ?? []).filter((e) => Date.now() - Date.parse(e.ts) <= DAY_MS).length;
  const badChecks = (checks ?? []).filter((c) => !c.ok);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-black text-slate-900">🩺 AI Monitor</h1>
        <p className="text-[11px] font-semibold text-slate-500">
          One place to see the AI’s health: live status, powerful diagnostics and the technical log of every
          student error.
        </p>
      </div>

      {/* ── Status strip ─────────────────────────────────────────────── */}
      <div className="grid gap-2 rounded-2xl bg-white p-3 ring-1 ring-slate-200 sm:grid-cols-4">
        <div className="rounded-xl bg-slate-50 p-2.5">
          <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">AI assistant</p>
          {ai === null ? (
            <p className="text-[11px] font-bold text-slate-400">Loading…</p>
          ) : (
            <p className={`text-sm font-black ${ai.enabled ? 'text-emerald-600' : 'text-slate-500'}`}>
              {ai.enabled ? '🟢 ON' : '⚫ OFF'}
              <span className="ml-1 text-[11px] font-bold text-slate-500">· “{ai.label}”</span>
            </p>
          )}
        </div>
        <div className="rounded-xl bg-slate-50 p-2.5">
          <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Providers (enabled)</p>
          {ai === null ? (
            <p className="text-[11px] font-bold text-slate-400">Loading…</p>
          ) : ai.providers.length ? (
            <p className="truncate text-[11px] font-bold text-slate-700" title={ai.providers.map((p) => `${p.label} (${p.model})`).join(' · ')}>
              {ai.providers.map((p) => `${p.label} (${p.model})`).join(' · ')}
            </p>
          ) : (
            <p className="text-[11px] font-bold text-red-500">None enabled</p>
          )}
        </div>
        <div className="rounded-xl bg-slate-50 p-2.5">
          <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Settings</p>
          {ai === null ? (
            <p className="text-[11px] font-bold text-slate-400">Loading…</p>
          ) : (
            <p className="text-[11px] font-bold text-slate-700">
              v{ai.version}
              {ai.updatedAt ? ` · saved ${timeAgo(ai.updatedAt)}` : ''}
            </p>
          )}
        </div>
        <div className={`rounded-xl p-2.5 ${errors24h ? 'bg-red-50' : 'bg-emerald-50'}`}>
          <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Student errors · 24 h</p>
          <p className={`text-sm font-black ${errors24h ? 'text-red-600' : 'text-emerald-600'}`}>
            {errors === null ? '…' : errors24h}
          </p>
        </div>
      </div>
      {aiLoadFailed && (
        <div className="rounded-2xl bg-amber-50 p-3 text-[11px] font-bold text-amber-700 ring-1 ring-amber-200">
          ⚠️ {aiLoadFailed}
        </div>
      )}

      {/* ── Diagnostics ──────────────────────────────────────────────── */}
      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-black text-slate-800">System diagnostics</h2>
            <p className="text-[11px] font-semibold text-slate-500">
              Quick = no cost. Deep also sends a tiny real request with each provider’s key, so you see exactly
              which key works.
            </p>
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={() => void runDiagnostics(false)}
              disabled={running !== null}
              className="rounded-xl bg-slate-900 px-3 py-2 text-[11px] font-black text-white hover:bg-slate-700 disabled:opacity-60"
            >
              {running === 'quick' ? '… checking' : '▶ Quick check'}
            </button>
            <button
              onClick={() => void runDiagnostics(true)}
              disabled={running !== null}
              className="rounded-xl bg-brand-600 px-3 py-2 text-[11px] font-black text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {running === 'deep' ? '… testing keys' : '🔬 Deep check (tests keys)'}
            </button>
          </div>
        </div>
        {running === 'deep' && (
          <p className="mt-2 rounded-xl bg-brand-50 p-2 text-[11px] font-bold text-brand-700 ring-1 ring-brand-200">
            Testing each key with a real request — this takes a few seconds per provider and uses a few free
            tokens.
          </p>
        )}
        {checks === null ? (
          <p className="mt-3 rounded-xl bg-slate-50 p-3 text-center text-[11px] font-semibold text-slate-400 ring-1 ring-slate-200">
            Run a check to see the state of every section.
          </p>
        ) : (
          <>
            <div
              className={`mt-3 rounded-xl p-2.5 text-[12px] font-black ring-1 ${
                badChecks.length === 0
                  ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                  : 'bg-red-50 text-red-700 ring-red-200'
              }`}
            >
              {badChecks.length === 0
                ? '✅ All systems healthy'
                : `⛔ ${badChecks.length} problem(s) found: ${badChecks.map((c) => c.label).join(', ')}`}
            </div>
            <div className="mt-2 space-y-1.5">
              {checks.map((c) => (
                <div
                  key={c.id}
                  className={`flex items-start gap-2 rounded-xl p-2.5 ring-1 ${c.ok ? 'bg-emerald-50/60 ring-emerald-200' : 'bg-red-50 ring-red-200'}`}
                >
                  <span className="text-sm leading-none">{c.ok ? '✅' : '⛔'}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-black text-slate-800">
                      {c.label}
                      {c.ms != null && (
                        <span className="ml-1.5 rounded bg-slate-200/80 px-1 py-0.5 font-mono text-[9px] font-bold text-slate-500">
                          {c.ms} ms
                        </span>
                      )}
                    </p>
                    <p className={`break-words text-[11px] font-semibold ${c.ok ? 'text-slate-500' : 'text-red-600'}`}>{c.detail}</p>
                  </div>
                </div>
              ))}
            </div>
            {checksAt && (
              <p className="mt-1.5 text-center text-[10px] font-semibold text-slate-400">
                {checksDeep ? 'deep' : 'quick'} check · {timeAgo(checksAt)}
              </p>
            )}
          </>
        )}
      </section>

      {/* ── Student errors (technical log) ───────────────────────────── */}
      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-black text-slate-800">🚨 Student errors (AI)</h2>
            <p className="text-[11px] font-semibold text-slate-500">
              Every AI failure students would have hit — with the provider’s raw detail for you. Students only see
              a friendly note; no student content is ever stored. Refreshes every 20 s.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="flex overflow-hidden rounded-xl ring-1 ring-slate-200">
              {(['24h', '7d', 'all'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setErrorFilter(f)}
                  className={`px-2.5 py-1.5 text-[10px] font-black transition ${
                    errorFilter === f ? 'bg-slate-900 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  {f === '24h' ? '24 h' : f === '7d' ? '7 days' : 'All'}
                </button>
              ))}
            </div>
            <button
              onClick={() => void refreshErrors()}
              className="rounded-xl bg-white px-3 py-2 text-[11px] font-black text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
            >
              ↻ Refresh
            </button>
            <button
              onClick={() => void clearErrors()}
              disabled={errorsTotal === 0}
              className="rounded-xl bg-red-50 px-3 py-2 text-[11px] font-black text-red-600 ring-1 ring-red-200 hover:bg-red-100 disabled:opacity-40"
            >
              🧹 Clear log
            </button>
          </div>
        </div>
        {visibleErrors === null ? (
          <p className="mt-3 rounded-xl bg-slate-50 p-3 text-center text-[11px] font-semibold text-slate-400 ring-1 ring-slate-200">
            Loading error log…
          </p>
        ) : visibleErrors.length > 0 ? (
          <>
            <div className="mt-3 max-h-96 space-y-1.5 overflow-y-auto pr-1">
              {visibleErrors.map((e) => (
                <div key={e.id} className="rounded-xl bg-slate-50 p-2.5 ring-1 ring-slate-200">
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span
                      className={`rounded-full px-2 py-0.5 font-black ring-1 ${
                        e.status ? 'bg-red-50 text-red-700 ring-red-200' : 'bg-amber-50 text-amber-700 ring-amber-200'
                      }`}
                    >
                      {e.status ? `HTTP ${e.status}` : 'network / timeout'}
                    </span>
                    <span className="font-black text-slate-700">{e.provider ?? '—'}</span>
                    {e.model && <code className="font-mono text-[10px] text-slate-400">{e.model}</code>}
                    {e.keyLabel && (
                      <span className="rounded bg-slate-200 px-1.5 text-[10px] font-bold text-slate-600">key: {e.keyLabel}</span>
                    )}
                    <button
                      onClick={() => copyError(e)}
                      className="rounded bg-white px-1.5 py-0.5 text-[10px] font-black text-slate-500 ring-1 ring-slate-200 hover:bg-slate-100"
                      title="Copy technical details"
                    >
                      📋
                    </button>
                    <span className="ml-auto shrink-0 text-[10px] font-semibold text-slate-400" title={new Date(e.ts).toLocaleString()}>
                      {timeAgo(e.ts)}
                    </span>
                  </div>
                  {e.detail && (
                    <p className="mt-1.5 max-h-28 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-slate-900 p-2 font-mono text-[10px] leading-relaxed text-emerald-300">
                      {e.detail}
                    </p>
                  )}
                </div>
              ))}
            </div>
            {errorsTotal > (errors?.length ?? 0) && (
              <p className="mt-1 text-center text-[10px] font-semibold text-slate-400">
                showing the latest {errors?.length ?? 0} of {errorsTotal}
              </p>
            )}
          </>
        ) : (
          <p className="mt-3 rounded-xl bg-emerald-50 p-3 text-center text-[11px] font-bold text-emerald-700 ring-1 ring-emerald-200">
            {errors?.length ? `✅ No errors in the selected period (${errorFilter === '24h' ? 'last 24 h' : 'last 7 days'}).` : '✅ No student errors recorded — the AI is running clean.'}
          </p>
        )}
      </section>
    </div>
  );
}
