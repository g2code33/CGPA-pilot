// ─────────────────────────────────────────────────────────────────────────
// Storage monitor (v1.0.20) — the three numbers the admin asked for:
//
//   1. Storage used by THIS app's images (the Worker's R2 bucket).
//   2. Remaining storage — the R2 free tier is 10 GB account-wide, so the
//      headroom is computed against the WHOLE account's R2 usage.
//   3. Storage used by the ENTIRE Cloudflare account (every R2 bucket of
//      every project), via an admin-supplied API token — "so I don't exceed
//      my entire Cloudflare limit."
//
// Plus: the one-click legacy migration that moves the stored catalog's
// base64 images into R2 (the catalog then keeps tiny asset:<key> refs).
// ─────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react';
import { useAdmin } from '../adminStore';
import type { AdminCatalog } from '../adminStorage';
import {
  getStorageReport,
  migrateCatalogToAssets,
  saveStorageCreds,
  clearStorageCreds,
  type StorageReport,
} from '../adminApi';
import { humanBytes } from '../catalogSize';
import { r2FallbackNote } from '../assetUpload';
import { accountIdLooksValid, credsProbeHint } from '../credsHint';
import { appConfirm } from '../../components/appDialog';

const FREE_TIER_BYTES = 10 * 1024 * 1024 * 1024; // R2 free tier: 10 GB (account-wide)

export function StorageMonitor() {
  const { catalog, apply } = useAdmin();
  const [report, setReport] = useState<StorageReport | null>(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    const r = await getStorageReport();
    if (r.ok) setReport(r);
    else setLoadError(r.message ?? `Could not load the storage report (${r.error}).`);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const bucket = report?.bucket;
  const account = report?.account;
  const used = account?.ok ? account.totalBytes : null;
  const remaining = used !== null ? Math.max(0, FREE_TIER_BYTES - used) : null;
  const usedPct = used !== null ? Math.min(100, (used / FREE_TIER_BYTES) * 100) : null;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-black text-slate-900">Storage</h1>
        <button
          onClick={() => void load()}
          className="ml-auto rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-200"
        >
          ↻ Refresh
        </button>
      </header>

      {loading && <p className="rounded-xl bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-500 ring-1 ring-slate-200">Loading storage report…</p>}
      {loadError && !loading && (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-xs font-semibold text-red-700 ring-1 ring-red-200">{loadError}</p>
      )}

      {/* ── 1 + 2: this app's bucket + free-tier headroom ─────────────── */}
      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5">
        <h2 className="text-sm font-black text-slate-800">This app's images (R2)</h2>
        {!bucket?.configured ? (
          <R2SetupGuide />
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs font-semibold text-slate-600">
            <span>
              🖼️ Images stored: <strong className="text-slate-900">{humanBytes(bucket.usage?.payloadBytes ?? 0)}</strong>
            </span>
            <span>
              Objects: <strong className="text-slate-900">{bucket.usage?.objectCount ?? 0}</strong>
            </span>
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-black text-emerald-700 ring-1 ring-emerald-200">
              ✓ R2 active — new uploads keep the catalog small
            </span>
          </div>
        )}

        <div className="mt-4 border-t border-slate-100 pt-4">
          <p className="text-[11px] font-black uppercase tracking-wide text-slate-400">R2 free-tier headroom (whole account)</p>
          {remaining === null ? (
            <p className="mt-1.5 text-xs font-semibold text-slate-500">
              Add your Cloudflare account credentials below to see the full 10 GB free-tier picture.
            </p>
          ) : (
            <div className="mt-2">
              <div className="flex items-baseline justify-between text-xs font-semibold text-slate-600">
                <span>
                  Used: <strong className="text-slate-900">{humanBytes(used!)}</strong> of 10 GB
                </span>
                <span>
                  Remaining: <strong className={remaining < FREE_TIER_BYTES / 10 ? 'text-red-600' : 'text-emerald-700'}>{humanBytes(remaining)}</strong>
                </span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200">
                <div
                  className={`h-full rounded-full ${usedPct! > 90 ? 'bg-red-500' : usedPct! > 70 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                  style={{ width: `${Math.max(1.5, usedPct!)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── 3: the entire Cloudflare account ──────────────────────────── */}
      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5">
        <h2 className="text-sm font-black text-slate-800">Entire Cloudflare account (all R2 buckets)</h2>
        <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
          Your R2 free tier is shared by <strong>every project</strong> on the account — this list shows each
          bucket so you never exceed the whole-account limit.
        </p>

        {account === null && (
          <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2.5 text-[11px] font-semibold text-slate-500 ring-1 ring-slate-200">
            No account credentials saved yet — add them below (a read-only “Read all resources” API token + your
            32-hex Account ID).
          </p>
        )}
        {account && !account.ok && (
          <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200">
            ⚠️ Could not read account usage: {account.message}
          </p>
        )}
        {account?.ok && (
          <div className="mt-3 space-y-2">
            {account.buckets.length === 0 && (
              <p className="text-xs font-semibold text-slate-500">No R2 buckets found on the account.</p>
            )}
            {account.buckets.map((b) => (
              <BucketBar key={b.name} name={b.name} bytes={b.bytes} objects={b.objects} max={Math.max(FREE_TIER_BYTES / 10, ...account.buckets.map((x) => x.bytes))} />
            ))}
            <p className="pt-1 text-[11px] font-black text-slate-700">
              Total: {humanBytes(account.totalBytes)} · {account.buckets.length} bucket{account.buckets.length === 1 ? '' : 's'}
            </p>
          </div>
        )}

        <CredsForm hasCreds={report?.hasCreds ?? false} onSaved={() => void load()} />
      </section>

      {/* ── Legacy migration ──────────────────────────────────────────── */}
      <MigrationCard
        disabled={!bucket?.configured}
        catalog={catalog}
        apply={apply}
      />

      {!bucket?.configured && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-[11px] font-semibold leading-relaxed text-amber-800 ring-1 ring-amber-200">
          ⚠️ {r2FallbackNote()} Until then, images still work — they are stored inside the catalog, and the
          Catalog size banner keeps you under the ~2 MB publish limit.
        </p>
      )}
    </div>
  );
}

function BucketBar({ name, bytes, objects, max }: { name: string; bytes: number; objects: number; max: number }) {
  const pct = max > 0 ? Math.max(1.5, (bytes / max) * 100) : 1.5;
  return (
    <div>
      <div className="flex items-baseline justify-between text-[11px] font-semibold text-slate-600">
        <span className="truncate font-black text-slate-800">{name}</span>
        <span className="shrink-0 tabular-nums">
          {humanBytes(bytes)} · {objects} object{objects === 1 ? '' : 's'}
        </span>
      </div>
      <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200">
        <div className="h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** The one-time 3-step R2 setup, shown until the Worker's bucket is bound. */
function R2SetupGuide() {
  return (
    <ol className="mt-3 space-y-2 rounded-xl bg-sky-50 p-3 text-[11px] font-semibold leading-relaxed text-sky-900 ring-1 ring-sky-200">
      <li>
        <strong>1 · Create the bucket:</strong> Cloudflare dashboard → <strong>R2 object storage</strong> → Create
        bucket → name it <code className="rounded bg-white px-1 ring-1 ring-sky-200">cgpa-pilot-assets</code> (region
        does not matter — R2 has zero egress fees).
      </li>
      <li>
        <strong>2 · Bind it to the Worker:</strong> Workers &amp; Pages → <strong>cgpa-pilot</strong> → Settings →
        Variables and Secrets → <strong>Bindings</strong> → “Add R2 bucket” → name <code className="rounded bg-white px-1 ring-1 ring-sky-200">R2_ASSETS</code>,
        pick <code className="rounded bg-white px-1 ring-1 ring-sky-200">cgpa-pilot-assets</code>.
      </li>
      <li>
        <strong>3 · Deploy</strong> the Worker (any deploy — e.g. save + redeploy from the code tab). Come back here
        and hit ↻ Refresh.
      </li>
    </ol>
  );
}

/** Save / clear the Cloudflare API token + account id (validated before stored). */
function CredsForm({ hasCreds, onSaved }: { hasCreds: boolean; onSaved: () => void }) {
  const [open, setOpen] = useState(!hasCreds);
  const [token, setToken] = useState('');
  const [accountId, setAccountId] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; hint?: string } | null>(null);

  const idLooksOff = accountId.trim() !== '' && !accountIdLooksValid(accountId);

  async function doSave() {
    setBusy(true);
    setMsg(null);
    const r = await saveStorageCreds(token.trim(), accountId.trim());
    setBusy(false);
    if (r.ok) {
      setMsg({ ok: true, text: '✓ Credentials saved and verified — account usage is now visible.' });
      setToken('');
      setAccountId('');
      setOpen(false);
      onSaved();
    } else if (r.error === 'creds-invalid') {
      setMsg({
        ok: false,
        text: `✗ Cloudflare rejected the credentials: ${r.message ?? 'check the token and account id.'}`,
        hint: credsProbeHint(r.message ?? ''),
      });
    } else {
      setMsg({ ok: false, text: `✗ ${r.message ?? 'Could not save credentials.'}` });
    }
  }

  async function doClear() {
    if (!(await appConfirm('Remove the saved Cloudflare credentials?'))) return;
    setBusy(true);
    const r = await clearStorageCreds();
    setBusy(false);
    if (r.ok) {
      setMsg(null);
      onSaved();
    } else {
      setMsg({ ok: false, text: r.message ?? 'Could not clear credentials.' });
    }
  }

  return (
    <div className="mt-4 border-t border-slate-100 pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-[11px] font-bold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-200"
      >
        {hasCreds ? '✎ Edit account credentials' : '＋ Add account credentials'}
      </button>
      {msg && (
        <div className="mt-2 space-y-1.5">
          <p className={`text-[11px] font-bold ${msg.ok ? 'text-emerald-700' : 'text-red-600'}`}>{msg.text}</p>
          {msg.hint && (
            <p className="rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] font-semibold leading-relaxed text-amber-800 ring-1 ring-amber-200">
              {msg.hint}
            </p>
          )}
        </div>
      )}
      {open && (
        <div className="mt-2 space-y-2 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
          <label className="block text-[10px] font-black uppercase tracking-wide text-slate-400">
            Cloudflare API token
            <input
              type="password"
              className="input mt-1 w-full text-xs"
              placeholder="•••• (a “Read all resources” token — read-only)"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="off"
            />
          </label>
          <label className="block text-[10px] font-black uppercase tracking-wide text-slate-400">
            Account ID
            <input
              className="input mt-1 w-full text-xs"
              placeholder="32-hex-character id (Account Home page, top-right)"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            />
          </label>
          {idLooksOff && (
            <p className="text-[10px] font-bold leading-relaxed text-amber-700">
              ⚠️ That doesn’t look like an Account ID (32 hex characters). If it starts with “cfk_”, it’s an API key,
              not an Account ID — the ID is on the Account Home page.
            </p>
          )}
          <p className="text-[10px] leading-relaxed text-slate-500">
            Create the token in the dashboard: <strong>My Profile → API Tokens → Create token → template “Read all
            resources”</strong> (a.k.a. “Admin Read”) — it is read-only and can’t change anything. ⚠️ Don’t use R2’s
            “Object Read Only” token (from R2 → Manage R2 API Tokens): those only work with the S3 API, not this
            usage view. It is verified before being stored, and only the Worker (D1) ever sees it — never the
            student config.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void doSave()}
              disabled={busy || !token.trim() || !accountId.trim()}
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-[11px] font-black text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {busy ? 'Verifying…' : 'Verify & save'}
            </button>
            {hasCreds && (
              <button
                type="button"
                onClick={() => void doClear()}
                disabled={busy}
                className="rounded-lg bg-slate-100 px-3 py-1.5 text-[11px] font-bold text-slate-600 ring-1 ring-slate-200 hover:bg-red-50 hover:text-red-600"
              >
                Remove
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * One-click legacy migration: moves THIS device's working catalog base64
 * images into R2. The server returns the SAME catalog (unsaved edits
 * preserved) with image values swapped for tiny asset:<key> refs, which is
 * loaded back into the working catalog — then Save & Publish makes it
 * permanent. Re-running is a free no-op (content-addressed dedup).
 */
function MigrationCard({
  disabled,
  catalog,
  apply,
}: {
  disabled: boolean;
  catalog: ReturnType<typeof useAdmin>['catalog'];
  apply: ReturnType<typeof useAdmin>['apply'];
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    moved: number;
    bytesMoved: number;
    before: number;
    after: number;
  } | null>(null);
  const [error, setError] = useState('');

  async function runMigration() {
    setBusy(true);
    setError('');
    setResult(null);
    const r = await migrateCatalogToAssets(catalog);
    setBusy(false);
    if (!r.ok || !r.catalog) {
      setError(r.message ?? `Migration failed (${r.error ?? 'unknown'}).`);
      return;
    }
    const stats = {
      moved: r.moved ?? 0,
      bytesMoved: r.bytesMoved ?? 0,
      before: r.catalogBytes ?? 0,
      after: r.slimmedBytes ?? 0,
    };
    if (stats.moved === 0) {
      setResult(stats);
      return;
    }
    apply(() => r.catalog as AdminCatalog);
    setResult(stats);
  }

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5">
      <h2 className="text-sm font-black text-slate-800">Move existing images to R2</h2>
      <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
        Images you already uploaded are still embedded as base64 (the old way). One click moves them into the
        bucket; the catalog keeps tiny references instead and publishes smaller. Your unsaved edits are kept.
      </p>
      <button
        type="button"
        onClick={() => void runMigration()}
        disabled={busy || disabled}
        title={disabled ? 'Set up R2 first (steps above)' : 'Move the catalog images into R2'}
        className="mt-3 rounded-xl bg-brand-600 px-4 py-2.5 text-xs font-black text-white shadow-sm transition hover:bg-brand-700 active:scale-[0.99] disabled:opacity-50"
      >
        {busy ? '⏳ Moving images…' : '⤴ Move catalog images to R2'}
      </button>
      {error && (
        <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700 ring-1 ring-red-200">{error}</p>
      )}
      {result && (
        <div className="mt-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-[11px] font-semibold leading-relaxed text-emerald-800 ring-1 ring-emerald-200">
          {result.moved === 0 ? (
            <>✓ Nothing to move — every image is already an R2 reference.</>
          ) : (
            <>
              ✓ Moved <strong>{result.moved}</strong> image{result.moved === 1 ? '' : 's'} ({humanBytes(result.bytesMoved)})
              {' '}into R2. Catalog: <strong>{humanBytes(result.before)} → {humanBytes(result.after)}</strong>. It is now
              in your working catalog — press <strong>Save &amp; Publish</strong> to make it permanent.
            </>
          )}
        </div>
      )}
    </section>
  );
}
