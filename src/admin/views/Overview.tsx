import { useMemo, useRef, useState } from 'react';
import { useAdmin } from '../adminStore';
import { buildDistribution, isDistributionPayload } from '../adminConfigService';
import {
  exportAdminBackup,
  importAdminBackup,
  readAdminSyncMeta,
  readApiToken,
  writeApiToken,
} from '../adminStorage';
import { MIN_PASSCODE_LENGTH, preflightPublish } from '../adminApi';
import { writeCachedConfig } from '../../services/configCache';

export function Overview({
  onNavigate,
}: {
  onNavigate: (v: { name: 'universities' | 'curricula' }) => void;
}) {
  const { catalog, setCatalog, setPasscode, logout, backend, syncing, checkBackend, publish, pull } =
    useAdmin();
  const [toast, setToast] = useState<string | null>(null);
  const [curPass, setCurPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [passBusy, setPassBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const schools = catalog.universities.reduce((n, u) => n + u.schools.length, 0);
  const programmes = catalog.universities.reduce(
    (n, u) => n + u.schools.reduce((m, s) => m + s.programmes.length, 0),
    0
  );
  const counts = {
    draft: catalog.curricula.filter((c) => c.status === 'draft').length,
    review: catalog.curricula.filter((c) => c.status === 'review').length,
    published: catalog.curricula.filter((c) => c.status === 'published').length,
    archived: catalog.curricula.filter((c) => c.status === 'archived').length,
  };

  // Same validation the backend runs — publish is blocked client-side when
  // it would be rejected (and the issues are shown, so nothing accidental).
  const preflight = useMemo(() => preflightPublish(catalog), [catalog]);
  const syncMeta = readAdminSyncMeta();

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 6000);
  }

  async function doPublish(note?: string) {
    if (!preflight.ok) {
      flash(`⛔ Cannot publish — ${preflight.issues[0]}`);
      return;
    }
    const r = await publish(note);
    if (r.ok) {
      flash(
        `✅ Published — catalog v${r.adminVersion} / student config v${r.publishedVersion} is on the backend. Every device receives it on its next open (online).`
      );
    } else {
      flash(`⛔ ${r.error}${r.issues?.[0] ? ` — ${r.issues[0]}` : ''}`);
    }
  }

  async function doPull() {
    const r = await pull();
    if (r.ok && r.applied) {
      flash(`✅ Loaded the backend catalog (v${r.adminVersion}).`);
    } else {
      flash(`⛔ ${r.error ?? 'Pull failed.'}`);
    }
  }

  function saveToken(e: React.FormEvent) {
    e.preventDefault();
    writeApiToken(tokenInput.trim() === '' ? null : tokenInput);
    setTokenInput('');
    flash(tokenInput.trim() === '' ? 'API token cleared.' : 'API token saved.');
    void checkBackend();
  }

  function exportDistribution() {
    const payload = buildDistribution(catalog);
    if (payload.curricula.length === 0) {
      flash('No PUBLISHED curricula to export yet. Review and publish one first.');
      return;
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = payload.generatedAt.slice(0, 10);
    a.href = url;
    a.download = `cgpa-pilot-curriculum-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
    flash('Published configuration file downloaded (backup / import utility).');
  }

  function previewOnThisDevice() {
    const payload = buildDistribution(catalog);
    void writeCachedConfig(
      {
        universities: payload.universities,
        curricula: payload.curricula,
        appearance: payload.appearance,
        settings: payload.settings,
      },
      { version: null, source: 'local' }
    );
    flash(
      payload.curricula.length
        ? 'Preview stored — the student app on THIS device uses it from its next open (until the next backend sync).'
        : 'No published curriculum yet — the student app shows "awaiting published curriculum".'
    );
  }

  async function importFile(file: File) {
    try {
      const doc = JSON.parse(await file.text());
      if (!isDistributionPayload(doc)) {
        flash('That file is not a valid CGPA PILOT configuration document.');
        return;
      }
      if (!confirm('Import this configuration? It will replace the current admin catalog.')) return;
      setCatalog({
        universities: doc.universities,
        curricula: doc.curricula,
        appearance: doc.appearance,
        settings: doc.settings,
      });
      flash('Configuration imported (local). Use Save & Publish to make it permanent.');
    } catch {
      flash('Could not read that file.');
    }
  }

  async function savePass(e: React.FormEvent) {
    e.preventDefault();
    if (curPass.length === 0) {
      flash('Enter the current passcode first.');
      return;
    }
    if (newPass.length < MIN_PASSCODE_LENGTH) {
      flash(`The new passcode must be at least ${MIN_PASSCODE_LENGTH} characters.`);
      return;
    }
    setPassBusy(true);
    const r = await setPasscode(curPass, newPass);
    setPassBusy(false);
    if (r.ok) {
      setCurPass('');
      setNewPass('');
      flash('✅ Admin passcode updated — the new passcode now works on every device (the backend stores only a salted digest).');
    } else {
      flash(`⛔ ${r.message ?? 'Passcode change failed.'}`);
    }
  }

  const backendAhead =
    backend.state === 'connected' &&
    backend.adminVersion != null &&
    syncMeta.adminVersion != null &&
    backend.adminVersion > syncMeta.adminVersion;
  const migrationMode =
    backend.state === 'connected' &&
    backend.adminVersion == null &&
    catalog.universities.length > 0;

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-slate-900">Admin Dashboard</h1>
        </div>
        <button
          onClick={() => void doPublish()}
          disabled={syncing === 'publishing' || !preflight.ok}
          className={`shrink-0 rounded-xl px-4 py-2.5 text-sm font-black shadow-sm transition ${
            preflight.ok
              ? 'bg-brand-600 text-white hover:bg-brand-700 active:scale-[0.98] disabled:opacity-60'
              : 'cursor-not-allowed bg-slate-200 text-slate-400'
          }`}
          title={preflight.ok ? 'Save this catalog and publish it to the backend' : preflight.issues[0]}
        >
          {syncing === 'publishing' ? 'Publishing…' : '💾 Save & Publish'}
        </button>
      </header>

      {toast && (
        <div className="rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold leading-relaxed text-white">
          {toast}
        </div>
      )}

      {/* Autosave indicator */}
      <div className="flex items-center gap-2 text-[10px] font-semibold text-emerald-600">
        <span>● Autosaved on this device</span>
        <span className="text-slate-400">• {new Date().toLocaleTimeString()}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Universities" value={catalog.universities.length} />
        <Stat label="Departments" value={schools} />
        <Stat label="Programmes" value={programmes} />
        <Stat label="Curricula" value={catalog.curricula.length} />
      </div>

      {/* Student permissions — kept near the top so it's always easy to find */}
      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5">
        <h2 className="text-sm font-bold text-slate-800">Student permissions</h2>
        <label className="mt-2 flex cursor-pointer items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-200">
          <span className="text-xs font-bold text-slate-700">
            Students can edit their credits (completed / remaining)
          </span>
          <input
            type="checkbox"
            checked={!!catalog.settings?.allowCreditEditing}
            onChange={(e) => {
              setCatalog({
                ...catalog,
                settings: { ...(catalog.settings ?? {}), allowCreditEditing: e.target.checked || undefined },
              });
              flash(
                e.target.checked
                  ? 'Credit editing unlocked for students — remembered after Save & Publish.'
                  : 'Credits locked to the published curriculum again — remembered after Save & Publish.'
              );
            }}
            className="h-5 w-5 shrink-0 accent-brand-600"
          />
        </label>
        <p className="mt-1.5 text-[11px] text-slate-500">
          Off = every calculation uses the published curriculum’s credits only.
        </p>
      </div>

      {/* ── Publish / backend (the permanent store) ─────────────────────── */}
      <div className="rounded-2xl bg-gradient-to-r from-brand-700 to-indigo-800 p-4 text-white shadow-sm ring-1 ring-brand-300/30 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-black">💾 Save &amp; Publish — permanent for every user</h2>
          <button
            onClick={() => void checkBackend()}
            disabled={syncing !== 'idle'}
            className="rounded-lg bg-white/15 px-2.5 py-1 text-[11px] font-bold hover:bg-white/25 disabled:opacity-50"
          >
            {syncing === 'checking' ? 'Checking…' : '🔄 Refresh status'}
          </button>
        </div>

        {/* Connection state */}
        <div className="mt-3 rounded-xl bg-white/10 p-3 ring-1 ring-white/15">
          {backend.state === 'unknown' && syncing === 'checking' && (
            <p className="text-xs font-bold">Checking backend…</p>
          )}
          {backend.state === 'unknown' && syncing !== 'checking' && (
            <p className="text-xs font-bold">Backend status unknown.</p>
          )}
          {backend.state === 'connected' && (
            <div className="space-y-1 text-xs font-semibold">
              <p>
                🟢 Connected
                {backend.adminVersion != null && <> · admin catalog <strong>v{backend.adminVersion}</strong></>}
                {backend.publishedVersion != null && <> · student config <strong>v{backend.publishedVersion}</strong></>}
              </p>
              {backend.updatedAt && (
                <p className="text-[10px] font-medium text-brand-200">
                  Last published {new Date(backend.updatedAt).toLocaleString()}
                  {syncMeta.lastSyncAt && <> · this device last synced {new Date(syncMeta.lastSyncAt).toLocaleString()}</>}
                </p>
              )}
            </div>
          )}
          {backend.state === 'unreachable' && (
            <p className="text-xs font-bold text-amber-200">
              ⚠️ Backend unreachable — you are offline, or the configuration API is
              not deployed at this URL. Local autosave still works; publish when
              back online.
            </p>
          )}
          {backend.state === 'not-configured' && (
            <p className="text-xs font-bold text-amber-200">
              ⚠️ Backend not configured. {backend.message ?? ''} See docs/DEPLOYMENT.md
              (create the D1 database + set the admin token), then Refresh.
            </p>
          )}
          {backend.state === 'unauthorized' && (
            <div className="flex items-center justify-between gap-2 text-xs font-bold text-amber-200">
              <p>⚠️ Your admin session has expired (or the token was rejected). Sign in again.</p>
              <button
                onClick={() => {
                  if (confirm('Return to the sign-in screen? Your unsaved catalog stays on this device.')) logout();
                }}
                className="shrink-0 rounded-lg bg-white/15 px-2.5 py-1 text-[11px] font-bold hover:bg-white/25"
              >
                Sign in again
              </button>
            </div>
          )}
        </div>

        {/* First-time migration callout */}
        {migrationMode && (
          <div className="mt-3 rounded-xl bg-amber-400/20 p-3 text-xs font-semibold leading-relaxed text-amber-100 ring-1 ring-amber-300/40">
            ⚠️ First-time migration: the backend has no catalog yet, but THIS
            device holds your current data. Click <strong>Save &amp; Publish</strong>
            to upload it once — after that, the backend is the permanent source
            for all devices and students.
          </div>
        )}
        {backendAhead && (
          <div className="mt-3 rounded-xl bg-amber-400/20 p-3 text-xs font-semibold leading-relaxed text-amber-100 ring-1 ring-amber-300/40">
            The backend is ahead (v{backend.adminVersion} vs this device v{syncMeta.adminVersion}).{' '}
            <button onClick={() => void doPull()} className="underline">
              Pull to load it
            </button>{' '}
            — this replaces the catalog on this device.
          </div>
        )}
        {preflight.ok === false && preflight.issues.length > 0 && (
          <div className="mt-3 rounded-xl bg-red-500/25 p-3 text-xs font-semibold leading-relaxed text-red-100 ring-1 ring-red-400/40">
            ⛔ Publish is blocked ({preflight.issues.length} issue{preflight.issues.length === 1 ? '' : 's'}):
            <span className="mt-1 block font-medium text-red-100/90">
              {preflight.issues.slice(0, 3).join(' · ')}
              {preflight.issues.length > 3 ? ` · +${preflight.issues.length - 3} more` : ''}
            </span>
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => void doPublish()}
            disabled={syncing === 'publishing' || !preflight.ok}
            className="rounded-lg bg-white px-3 py-2 text-xs font-black text-brand-700 shadow-sm transition hover:bg-brand-50 disabled:opacity-50"
          >
            {syncing === 'publishing' ? 'Publishing…' : '💾 Save & Publish'}
          </button>
          <button
            onClick={() => void doPull()}
            disabled={syncing === 'pulling' || backend.state !== 'connected' || backend.adminVersion == null}
            className="rounded-lg bg-brand-500/30 px-3 py-2 text-xs font-bold text-white ring-1 ring-white/20 transition hover:bg-brand-500/50 disabled:opacity-50"
          >
            {syncing === 'pulling' ? 'Pulling…' : '📥 Pull from backend'}
          </button>
        </div>

        {/* Operator token — advanced (setup + automation only) */}
        <details className="mt-3 rounded-xl bg-white/10 p-3 ring-1 ring-white/15">
          <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-wide text-brand-200">
            Advanced — operator API token (first-time setup &amp; automation)
          </summary>
          <p className="mt-2 text-[11px] leading-relaxed text-brand-100">
            Day-to-day access uses your <strong>passcode</strong> (a server-signed
            session). This raw operator token is only needed for first-time
            passcode setup and scripted/automation access. It stays on THIS
            device.
          </p>
          <form onSubmit={saveToken} className="mt-2 flex flex-wrap items-end gap-2">
            <div className="min-w-[200px] flex-1">
              <input
                type="password"
                className="w-full rounded-lg border-0 bg-white/90 px-3 py-2 text-xs font-semibold text-slate-800 placeholder-slate-400 outline-none ring-1 ring-white/20 focus:ring-2"
                placeholder={readApiToken() ? '•••• (saved on this device)' : 'Paste the ADMIN_TOKEN secret'}
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
              />
            </div>
            <button
              type="submit"
              disabled={tokenInput.trim() === '' && !readApiToken()}
              className="rounded-lg bg-white/15 px-3 py-2 text-xs font-bold hover:bg-white/25 disabled:opacity-50"
            >
              {readApiToken() ? 'Clear / replace token' : 'Save token'}
            </button>
          </form>
        </details>
      </div>

      {/* Local device utilities (backup files — NOT the publishing workflow) */}
      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5">
        <h2 className="text-sm font-bold text-slate-800">Autosave &amp; local backups</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => {
              const backup = exportAdminBackup();
              const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `cgpa-pilot-admin-backup-${backup.exportedAt.slice(0, 10)}.json`;
              a.click();
              URL.revokeObjectURL(url);
              flash('Admin backup downloaded.');
            }}
            className="btn-ghost"
          >
            ⬇️ Download admin backup
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className="btn-ghost"
          >
            ⬆️ Upload admin backup
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importFile(f);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5">
        <h2 className="text-sm font-bold text-slate-800">Curriculum statuses</h2>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatusCard label="Draft" value={counts.draft} tone="bg-slate-100 text-slate-700" />
          <StatusCard label="Review" value={counts.review} tone="bg-amber-100 text-amber-800" />
          <StatusCard label="Published" value={counts.published} tone="bg-emerald-100 text-emerald-800" />
          <StatusCard label="Archived" value={counts.archived} tone="bg-slate-200 text-slate-600" />
        </div>
        <button
          onClick={() => onNavigate({ name: 'curricula' })}
          className="btn-ghost mt-4 w-full"
        >
          📚 Manage curricula
        </button>
      </div>

      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5">
        <h2 className="text-sm font-bold text-slate-800">Offline configuration files</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={exportDistribution} className="btn-primary">
            ⬇️ Download published configuration
          </button>
          <button onClick={previewOnThisDevice} className="btn-ghost">
            📲 Preview on this device
          </button>
          <button onClick={() => fileRef.current?.click()} className="btn-ghost">
            ⬆️ Import configuration file
          </button>
        </div>
      </div>

      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5">
        <h2 className="text-sm font-bold text-slate-800">Change admin passcode</h2>
        <form onSubmit={savePass} className="mt-3 flex flex-wrap items-end gap-2">
          <input
            type="password"
            className="input max-w-xs"
            placeholder="Current passcode"
            value={curPass}
            onChange={(e) => setCurPass(e.target.value)}
          />
          <input
            type="password"
            className="input max-w-xs"
            placeholder={`New passcode (min ${MIN_PASSCODE_LENGTH} characters)`}
            value={newPass}
            onChange={(e) => setNewPass(e.target.value)}
          />
          <button type="submit" className="btn-primary" disabled={passBusy}>
            {passBusy ? 'Updating…' : 'Update'}
          </button>
        </form>
      </div>

      <button
        onClick={() => onNavigate({ name: 'universities' })}
        className="w-full rounded-2xl border-2 border-dashed border-slate-300 py-3 text-sm font-bold text-slate-500 transition hover:border-slate-400"
      >
        🏛️ Manage universities, departments &amp; programmes
      </button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-white p-3 text-center shadow-sm ring-1 ring-slate-200">
      <p className="text-2xl font-black text-slate-900">{value}</p>
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
    </div>
  );
}

function StatusCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`rounded-xl px-3 py-2 text-center ${tone}`}>
      <p className="text-xl font-black">{value}</p>
      <p className="text-[10px] font-bold uppercase tracking-wide opacity-80">{label}</p>
    </div>
  );
}
