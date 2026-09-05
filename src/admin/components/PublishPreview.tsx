// ─────────────────────────────────────────────────────────────────────────
// PublishPreview — the “see exactly what will change” gate before a publish.
//
// Compares the working catalog against the last PUBLISHED one (the local
// snapshot) and renders the structured diff: per entity (added / removed /
// changed), per field (old → new, with side-by-side images for logos), and
// per course (added / removed / modified). Nothing publishes until the admin
// presses “Publish these changes” HERE — accurate deployment by review.
// ─────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AdminCatalog } from '../adminStorage';
import { diffCatalogs, humanizePath, type CatalogDiffReport, type EntityDiff, type FieldChange } from '../catalogDiff';
import type { AppAppearance } from '../../config/types';
import { Wordmark } from '../../components/Wordmark';
import { LiveStudentPreview } from './LiveStudentPreview';

export interface PublishPreviewProps {
  open: boolean;
  working: AdminCatalog;
  /** The last published catalog (what students see today). */
  published: AdminCatalog | null;
  publishedVersion: number | null;
  onClose: () => void;
  onPublish: () => void;
  publishing: boolean;
  /** Shown instead of “publish” (e.g. when previewing a DRAFT). */
  publishLabel?: string;
}

type Section = 'universities' | 'curricula' | 'branding' | 'settings' | 'trash';

export function PublishPreview({ open, working, published, publishedVersion, onClose, onPublish, publishing, publishLabel }: PublishPreviewProps) {
  const report = useMemo<CatalogDiffReport>(() => diffCatalogs(published, working), [published, working]);
  const [section, setSection] = useState<Section | null>(null);
  // The default view is the REAL student site running the working catalog —
  // “a live seeing at the student end”. The field-level list stays available.
  const [tab, setTab] = useState<'live' | 'diff'>('live');

  if (!open) return null;

  if (tab === 'live') {
    return (
      <LiveStudentPreview
        working={working}
        report={report}
        onExit={onClose}
        onPublish={onPublish}
        publishing={publishing}
        canPublish={publishLabel === undefined ? !report.isEmpty : true}
        onShowDiff={() => setTab('diff')}
      />
    );
  }

  const counts: { id: Section; label: string; icon: string; n: number }[] = [
    { id: 'universities', label: 'Universities', icon: '🏛️', n: report.universities.length },
    { id: 'curricula', label: 'Curricula', icon: '📚', n: report.curricula.length },
    { id: 'branding', label: 'Branding', icon: '🎨', n: report.appearance.length },
    { id: 'settings', label: 'Settings', icon: '⚙️', n: report.settings.length },
    { id: 'trash', label: 'Recycle bin', icon: '🗑️', n: report.trash.before !== report.trash.after ? 1 : 0 },
  ];
  const active: Section | 'all' = section ?? (counts.find((c) => c.n > 0)?.id ?? 'all');

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-end justify-center bg-slate-900/60 p-0 backdrop-blur-sm sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="preview-title" onClick={onClose}>
      <div
        className="flex max-h-[94dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b border-slate-100 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="preview-title" className="text-base font-black text-slate-900">
                🔍 Preview changes
              </h2>
              <p className="mt-0.5 text-[11px] font-semibold leading-relaxed text-slate-500">
                {published
                  ? `Working catalog vs published v${publishedVersion ?? '?'} (what students see today)`
                  : 'Working catalog — nothing has been published from this backend yet'}
              </p>
            </div>
            <button onClick={onClose} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-sm font-black text-slate-500 hover:bg-slate-200" aria-label="Close preview">
              ✕
            </button>
          </div>

          {/* Tab switch: live student site ↔ change list */}
          <div className="mt-3 flex gap-1.5">
            <button
              onClick={() => setTab('live')}
              className="rounded-full bg-brand-600 px-3 py-1.5 text-[11px] font-black text-white shadow-sm"
            >
              📱 Live student site
            </button>
            <button
              onClick={() => setTab('diff')}
              className="rounded-full bg-slate-100 px-3 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-slate-200"
            >
              📋 Change list
            </button>
          </div>

          {/* Summary + section chips */}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className={`mr-1 rounded-full px-2.5 py-1 text-[11px] font-black ${report.isEmpty ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'}`}>
              {report.isEmpty ? '✓ No changes — matches published' : report.summary}
            </span>
            <Chip active={active === 'all'} onClick={() => setSection(null)} label={`All (${report.totalChanges})`} />
            {counts.map((c) => (
              <Chip key={c.id} active={active === c.id} onClick={() => setSection(c.id)} label={`${c.icon} ${c.label} (${c.n})`} />
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {report.isEmpty ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center">
              <span className="text-4xl">✅</span>
              <p className="text-sm font-black text-slate-700">Nothing to review</p>
              <p className="max-w-xs text-xs leading-relaxed text-slate-500">
                This catalog is identical to the published version. Publishing again would bump the version with no visible change.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {active === 'universities' || active === 'all' ? (
                report.universities.length ? (
                  <div>
                    <SectionTitle icon="🏛️" title={`Universities (${report.universities.length})`} />
                    {report.universities.map((e) => (
                      <EntityCard key={e.id} e={e} />
                    ))}
                  </div>
                ) : null
              ) : null}
              {active === 'curricula' || active === 'all' ? (
                report.curricula.length ? (
                  <div>
                    <SectionTitle icon="📚" title={`Curricula (${report.curricula.length})`} />
                    {report.curricula.map((e) => (
                      <EntityCard key={e.id} e={e} />
                    ))}
                  </div>
                ) : null
              ) : null}
              {active === 'branding' || active === 'all' ? (
                <BrandingSection before={published?.appearance} after={working.appearance} changes={report.appearance} />
              ) : null}
              {active === 'settings' || active === 'all' ? (
                report.settings.length ? (
                  <div>
                    <SectionTitle icon="⚙️" title={`Settings (${report.settings.length})`} />
                    <div className="space-y-1.5">
                      {report.settings.map((c, i) => (
                        <ChangeRow key={i} c={c} />
                      ))}
                    </div>
                  </div>
                ) : null
              ) : null}
              {active === 'trash' || active === 'all' ? (
                report.trash.before !== report.trash.after ? (
                  <div>
                    <SectionTitle icon="🗑️" title="Recycle bin" />
                    <p className="text-xs font-semibold text-slate-600">
                      {report.trash.before} → {report.trash.after} item(s) in the recycle bin.
                    </p>
                  </div>
                ) : null
              ) : null}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-col-reverse gap-2 border-t border-slate-100 px-5 py-4 sm:flex-row sm:justify-end">
          <button onClick={onClose} className="rounded-xl bg-slate-100 px-5 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-200">
            Close
          </button>
          <button
            onClick={onPublish}
            disabled={publishing || (publishLabel === undefined && report.isEmpty)}
            title={report.isEmpty && publishLabel === undefined ? 'Nothing changed — publishing would be a no-op version bump' : undefined}
            className="rounded-xl bg-brand-600 px-5 py-2.5 text-xs font-black text-white shadow-sm transition hover:bg-brand-700 active:scale-[0.99] disabled:opacity-50"
          >
            {publishing ? 'Publishing…' : publishLabel ?? (report.isEmpty ? 'Publish anyway (no changes)' : '🚀 Publish these changes')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function Chip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-2.5 py-1 text-[11px] font-bold transition ${
        active ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
      }`}
    >
      {label}
    </button>
  );
}

function SectionTitle({ icon, title }: { icon: string; title: string }) {
  return (
    <h3 className="mb-2 text-[11px] font-black uppercase tracking-[0.15em] text-slate-400">
      {icon} {title}
    </h3>
  );
}

const KIND_STYLES: Record<string, string> = {
  added: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  removed: 'bg-red-50 text-red-600 ring-red-200',
  changed: 'bg-amber-50 text-amber-700 ring-amber-200',
};

function EntityCard({ e }: { e: EntityDiff }) {
  return (
    <div className="mb-2 overflow-hidden rounded-2xl ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center gap-2 bg-slate-50 px-3 py-2">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ring-1 ${KIND_STYLES[e.kind]}`}>
          {e.kind}
        </span>
        <span className="text-xs font-black text-slate-800">{e.name}</span>
        {e.status && (
          <span className="ml-auto rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-slate-500 ring-1 ring-slate-200">
            status: {e.status.before} → {e.status.after}
          </span>
        )}
      </div>
      <div className="px-3 py-2">
        {e.kind === 'added' && <p className="text-[11px] font-semibold text-emerald-700">New — will appear for students after publishing.</p>}
        {e.kind === 'removed' && <p className="text-[11px] font-semibold text-red-600">Will be removed after publishing.</p>}
        {e.changes.length > 0 && (
          <div className="space-y-1">
            {e.changes.map((c, i) => (
              <ChangeRow key={i} c={c} />
            ))}
          </div>
        )}
        {e.courses && (e.courses.added.length > 0 || e.courses.removed.length > 0 || e.courses.changed.length > 0) && (
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <CourseCol title={`➕ Added (${e.courses.added.length})`} tone="emerald" courses={e.courses.added} />
            <CourseCol title={`➖ Removed (${e.courses.removed.length})`} tone="red" courses={e.courses.removed} />
            <div>
              <p className="mb-1 text-[10px] font-black uppercase tracking-wide text-amber-600">✏️ Modified ({e.courses.changed.length})</p>
              <div className="space-y-1">
                {e.courses.changed.slice(0, 30).map((cc) => (
                  <div key={cc.course.code} className="rounded-lg bg-amber-50/70 px-2 py-1.5 ring-1 ring-amber-100">
                    <p className="text-[11px] font-black text-slate-800">
                      {cc.course.code} <span className="font-semibold text-slate-500">· {cc.course.placement}</span>
                    </p>
                    {cc.changes.slice(0, 4).map((c, i) => (
                      <p key={i} className="truncate text-[10px] font-semibold text-slate-600">
                        {humanizePath(c.path.replace(/^course\./, ''))}: <span className="text-red-500 line-through">{formatValue(c.before, 40)}</span> → <span className="text-emerald-700">{formatValue(c.after, 40)}</span>
                      </p>
                    ))}
                    {cc.changes.length > 4 && <p className="text-[10px] font-semibold text-slate-400">+{cc.changes.length - 4} more…</p>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CourseCol({ title, tone, courses }: { title: string; tone: 'emerald' | 'red'; courses: { code: string; name: string; placement: string; creditHours: number }[] }) {
  if (!courses.length) return null;
  return (
    <div>
      <p className={`mb-1 text-[10px] font-black uppercase tracking-wide ${tone === 'emerald' ? 'text-emerald-600' : 'text-red-500'}`}>{title}</p>
      <div className="space-y-1">
        {courses.slice(0, 30).map((c) => (
          <div key={`${c.placement}-${c.code}`} className={`rounded-lg px-2 py-1.5 ring-1 ${tone === 'emerald' ? 'bg-emerald-50/70 ring-emerald-100' : 'bg-red-50/70 ring-red-100'}`}>
            <p className="text-[11px] font-black text-slate-800">
              {c.code} <span className="font-semibold text-slate-500">· {c.placement}</span>
            </p>
            <p className="truncate text-[10px] font-semibold text-slate-600">
              {c.name} · {c.creditHours}cr
            </p>
          </div>
        ))}
        {courses.length > 30 && <p className="text-[10px] font-semibold text-slate-400">+{courses.length - 30} more…</p>}
      </div>
    </div>
  );
}

/** Branding: side-by-side visual + changed field rows. */
function BrandingSection({ before, after, changes }: { before?: AppAppearance; after?: AppAppearance; changes: FieldChange[] }) {
  if (!changes.length) return null;
  const img = (u: string | undefined) =>
    u && typeof u === 'string' && u.startsWith('data:image/') ? (
      <img src={u} alt="" className="h-14 w-14 rounded-xl bg-slate-50 object-contain p-0.5 ring-1 ring-slate-200" />
    ) : (
      <span className="grid h-14 w-14 place-items-center rounded-xl bg-slate-100 text-lg text-slate-300 ring-1 ring-slate-200">—</span>
    );
  return (
    <div>
      <SectionTitle icon="🎨" title={`Branding (${changes.length})`} />
      <div className="mb-2 grid grid-cols-2 gap-2">
        <div className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200">
          <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Before (published)</p>
          <div className="mt-2 flex items-center gap-3">
            {img(before?.logo)}
            <div className="min-w-0">
              <Wordmark appearance={before} size={13} applyColor={false} className="truncate font-black text-slate-800" />
              {before?.tagline && <p className="truncate text-[10px] font-semibold text-slate-500">{before.tagline}</p>}
            </div>
          </div>
        </div>
        <div className="rounded-2xl bg-emerald-50/60 p-3 ring-1 ring-emerald-200">
          <p className="text-[10px] font-black uppercase tracking-wide text-emerald-600">After (this publish)</p>
          <div className="mt-2 flex items-center gap-3">
            {img(after?.logo)}
            <div className="min-w-0">
              <Wordmark appearance={after} size={13} applyColor={false} className="truncate font-black text-slate-800" />
              {after?.tagline && <p className="truncate text-[10px] font-semibold text-slate-500">{after.tagline}</p>}
            </div>
          </div>
        </div>
      </div>
      <div className="space-y-1">
        {changes.map((c, i) => (
          <ChangeRow key={i} c={c} />
        ))}
      </div>
    </div>
  );
}

export function ChangeRow({ c }: { c: FieldChange }) {
  const isImage = (v: unknown) => typeof v === 'string' && v.startsWith('data:image/');
  return (
    <div className="flex items-start gap-2 rounded-lg bg-slate-50/80 px-2.5 py-1.5 ring-1 ring-slate-100">
      <span
        className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide ring-1 ${KIND_STYLES[c.kind]}`}
      >
        {c.kind}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[10px] font-black uppercase tracking-wide text-slate-400">{humanizePath(c.path)}</p>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
          {isImage(c.before) ? (
            <img src={String(c.before)} alt="before" className="h-8 w-8 rounded-md bg-white object-contain ring-1 ring-slate-200" />
          ) : (
            <span className="break-words text-red-500 line-through decoration-red-300">{formatValue(c.before)}</span>
          )}
          <span className="text-slate-300">→</span>
          {isImage(c.after) ? (
            <img src={String(c.after)} alt="after" className="h-8 w-8 rounded-md bg-white object-contain ring-1 ring-emerald-200" />
          ) : (
            <span className="break-words text-emerald-700">{formatValue(c.after)}</span>
          )}
        </div>
      </div>
    </div>
  );
}

export function formatValue(v: unknown, maxLen = 90): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'ON' : 'OFF';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') {
    if (v.startsWith('data:image/')) return '🖼️ image';
    return v.length > maxLen ? `${v.slice(0, maxLen)}…` : v;
  }
  const s = JSON.stringify(v);
  return s.length > maxLen ? `${s.slice(0, maxLen)}…` : s;
}
