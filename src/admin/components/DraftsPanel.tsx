// ─────────────────────────────────────────────────────────────────────────
// DraftsPanel — the admin's named snapshots saved WITHOUT publishing.
//
// Drafts live on the backend (any admin device can restore them) and are
// mirrored locally so the list + restore keep working offline. From here the
// admin can Restore a draft into the working catalog, Preview it against the
// published version (the same diff viewer used before publishing), or delete
// it.
// ─────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AdminCatalog } from '../adminStorage';
import { readLocalDrafts, removeLocalDraft, type LocalDraft } from '../adminStorage';
import {
  deleteRemoteDraft,
  getRemoteDraft,
  listRemoteDrafts,
  type DraftMeta,
} from '../adminApi';

interface DraftsPanelProps {
  open: boolean;
  onClose: () => void;
  /** Load a catalog into the working catalog (replaces what's on screen). */
  onRestore: (catalog: AdminCatalog, name: string) => void;
  /** Open the publish preview for this draft's catalog. */
  onPreview: (catalog: AdminCatalog, name: string) => void;
  toast: (m: string) => void;
}

type Row = { meta: DraftMeta; local?: LocalDraft };

function timeAgo(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function DraftsPanel({ open, onClose, onRestore, onPreview, toast }: DraftsPanelProps) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(null);
    setError(null);
    const local = readLocalDrafts();
    const remote = await listRemoteDrafts();
    if (!remote.ok) {
      // Offline / not configured: show the local mirror and say so.
      setRows(local.map((d) => ({ meta: { id: d.id, name: d.name, note: d.note, createdAt: d.createdAt }, local: d })));
      setError(remote.error === 'not-configured' ? 'Backend not configured — showing drafts on THIS device only.' : 'Backend unreachable — showing drafts on THIS device only.');
      return;
    }
    // Merge: backend rows (authoritative) + local-only rows (offline saves).
    const remoteIds = new Set((remote.drafts ?? []).map((d) => d.id));
    const merged: Row[] = (remote.drafts ?? []).map((m) => ({ meta: m, local: local.find((l) => l.id === m.id) }));
    for (const l of local) {
      if (!remoteIds.has(l.id)) merged.push({ meta: { id: l.id, name: l.name, note: l.note, createdAt: l.createdAt }, local: l });
    }
    merged.sort((a, b) => b.meta.createdAt.localeCompare(a.meta.createdAt));
    setRows(merged);
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  if (!open) return null;

  async function loadCatalog(meta: DraftMeta, local?: LocalDraft): Promise<AdminCatalog | null> {
    if (local?.catalog) return local.catalog;
    const r = await getRemoteDraft(meta.id);
    if (!r.ok || !r.draft) {
      toast(`⛔ Could not load draft “${meta.name}”: ${r.message ?? r.error ?? 'failed'}`);
      return null;
    }
    return r.draft.catalog;
  }

  async function restore(meta: DraftMeta, local?: LocalDraft) {
    setBusy(meta.id);
    try {
      const catalog = await loadCatalog(meta, local);
      if (!catalog) return;
      onRestore(catalog, meta.name);
      onClose();
    } finally {
      setBusy(null);
    }
  }

  async function preview(meta: DraftMeta, local?: LocalDraft) {
    setBusy(meta.id);
    try {
      const catalog = await loadCatalog(meta, local);
      if (!catalog) return;
      onPreview(catalog, meta.name);
    } finally {
      setBusy(null);
    }
  }

  async function remove(meta: DraftMeta, local?: LocalDraft) {
    if (!confirm(`Delete the draft “${meta.name}”? This cannot be undone.`)) return;
    setBusy(meta.id);
    try {
      // Backend copy (when present) + the local mirror.
      const r = await deleteRemoteDraft(meta.id);
      if (!r.ok && r.error !== 'unreachable') {
        toast(`⛔ ${r.message ?? 'Delete failed'}`);
        return;
      }
      removeLocalDraft(meta.id);
      void local;
      void (await load());
    } finally {
      setBusy(null);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-end justify-center bg-slate-900/60 p-0 backdrop-blur-sm sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="drafts-title" onClick={onClose}>
      <div className="flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 id="drafts-title" className="text-base font-black text-slate-900">📥 Drafts</h2>
            <p className="mt-0.5 text-[11px] font-semibold text-slate-500">Saved snapshots — students never see these until you publish.</p>
          </div>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg bg-slate-100 text-sm font-black text-slate-500 hover:bg-slate-200" aria-label="Close drafts">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-700 ring-1 ring-amber-200">{error}</p>}
          {!rows ? (
            <p className="py-10 text-center text-xs font-semibold text-slate-400">Loading drafts…</p>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <span className="text-3xl">📭</span>
              <p className="text-sm font-black text-slate-700">No drafts yet</p>
              <p className="max-w-[240px] text-[11px] leading-relaxed text-slate-500">
                Use “Save Draft” (next to Save & Publish) to snapshot the current catalog without publishing — then restore or preview it any time.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {rows.map(({ meta, local }) => (
                <div key={meta.id} className="rounded-2xl p-3 ring-1 ring-slate-200">
                  <div className="flex items-center gap-2">
                    <span className="text-base">{local && !local.synced ? '💻' : '☁️'}</span>
                    <p className="min-w-0 flex-1 truncate text-xs font-black text-slate-800">{meta.name}</p>
                    <span className="shrink-0 text-[10px] font-bold text-slate-400">{timeAgo(meta.createdAt)}</span>
                  </div>
                  {meta.note && <p className="mt-1 truncate text-[11px] font-semibold text-slate-500">{meta.note}</p>}
                  {local && (
                    <p className="mt-1 text-[10px] font-bold text-slate-400">
                      {local.catalog.universities.length} universities · {local.catalog.curricula.length} curricula
                      {!local.synced && ' · on this device only'}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <button
                      onClick={() => void preview(meta, local)}
                      disabled={busy === meta.id}
                      title="Preview this draft against the published version"
                      className="rounded-lg bg-slate-100 px-3 py-1.5 text-[11px] font-black text-slate-700 transition hover:bg-slate-200 disabled:opacity-50"
                    >
                      🔍 Preview
                    </button>
                    <button
                      onClick={() => void restore(meta, local)}
                      disabled={busy === meta.id}
                      className="rounded-lg bg-brand-600 px-3 py-1.5 text-[11px] font-black text-white transition hover:bg-brand-700 disabled:opacity-50"
                    >
                      {busy === meta.id ? 'Working…' : '⤴ Restore'}
                    </button>
                    <button
                      onClick={() => void remove(meta, local)}
                      disabled={busy === meta.id}
                      className="rounded-lg bg-white px-3 py-1.5 text-[11px] font-black text-red-500 ring-1 ring-red-200 transition hover:bg-red-50 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
