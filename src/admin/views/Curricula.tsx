import { useState } from 'react';
import { useAdmin } from '../adminStore';
import { confirmThen } from '../confirm';
import {
  findProgramme,
  createCurriculum,
  duplicateCurriculum,
  transitionCurriculum,
  deleteCurriculum,
  reviewCurriculum,
  canPublish,
  curriculumStats,
  suggestVersionName,
} from '../adminConfigService';
import { writeCachedConfig } from '../../services/configCache';
import type { CurriculumVersion } from '../../config/types';

const STATUS_STYLE: Record<CurriculumVersion['status'], string> = {
  draft: 'bg-slate-100 text-slate-600 ring-slate-300',
  review: 'bg-amber-100 text-amber-800 ring-amber-300',
  published: 'bg-emerald-100 text-emerald-800 ring-emerald-300',
  archived: 'bg-slate-200 text-slate-500 ring-slate-300',
};

export function Curricula({ onOpen }: { onOpen: (id: string) => void }) {
  const { catalog, apply } = useAdmin();
  const [showCreate, setShowCreate] = useState<string | null>(null);
  const [form, setForm] = useState({
    versionName: '',
    effectiveAcademicYear: '',
    effectiveDate: new Date().toISOString().slice(0, 10),
  });
  const [notice, setNotice] = useState<string | null>(null);

  function flash(msg: string) {
    setNotice(msg);
    setTimeout(() => setNotice(null), 4500);
  }

  function publish(id: string) {
    const version = catalog.curricula.find((c) => c.id === id);
    if (!version) return;
    const issues = reviewCurriculum(version);
    if (issues.some((i) => i.severity === 'error')) {
      flash('Cannot publish — open Review to fix the blocking errors first.');
      onOpen(id);
      return;
    }
    if (!canPublish(version)) return;
    confirmThen(
      'Publish this curriculum? Students will receive it offline. Publishing archives the previous published version of this programme. Published versions remain editable.',
      () => {
        const result = transitionCurriculum(catalog, id, 'published');
        if (!result.ok) {
          flash(`⛔ ${result.reason ?? 'Publish blocked by validation.'}`);
          return;
        }
        apply(() => result.catalog);
        // Push the newly published configuration into this device's student
        // cache so the student app picks it up offline (config-only; never
        // contains student data).
        writeCachedConfig({
          universities: result.catalog.universities,
          curricula: result.catalog.curricula,
          cachedAt: new Date().toISOString(),
          schemaVersion: 1,
        });
        flash('✅ Published — students on this device now receive this curriculum.');
      }
    );
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-black text-slate-900">Curriculum versions</h1>
        <p className="text-xs text-slate-500">
          Workflow: <strong>Draft → Review → Published → Archived</strong>. Only
          published versions reach students. Published versions remain editable; only archived versions are fully locked.
        </p>
      </header>

      {notice && (
        <div className="rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white">
          {notice}
        </div>
      )}

      {catalog.curricula.map((c) => {
        const found = findProgramme(catalog, c.programmeId);
        const issues = reviewCurriculum(c);
        const errors = issues.filter((i) => i.severity === 'error').length;
        const warnings = issues.filter((i) => i.severity === 'warning').length;
        const locked = c.status === 'archived';
        const stats = curriculumStats(c);

        return (
          <section key={c.id} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <div className="flex flex-wrap items-center gap-2">
              <div>
                <h2 className="text-sm font-bold text-slate-900">{c.versionName}</h2>
                <p className="text-[11px] text-slate-500">
                  {found?.university.shortName} · {found?.school.name} ·{' '}
                  {found?.programme.shortName}
                </p>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <span
                  className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ring-1 ${STATUS_STYLE[c.status]}`}
                >
                  {c.status}
                </span>
              </div>
            </div>

            <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-500">
              <span>📅 {c.effectiveAcademicYear || 'year not set'}</span>
              <span>🗓 effective {c.effectiveDate}</span>
              <span>📚 {c.levels.length} levels</span>
              <span>📖 {stats.totalActiveCourses} active courses</span>
              <span className="font-bold text-brand-700">🎓 {stats.totalCredits} credits</span>
              {(errors > 0 || warnings > 0) && (
                <span className={errors > 0 ? 'font-bold text-red-600' : 'text-amber-600'}>
                  {errors > 0 ? `⛔ ${errors} error${errors === 1 ? '' : 's'}` : ''}
                  {errors > 0 && warnings > 0 ? ' · ' : ''}
                  {warnings > 0 ? `⚠️ ${warnings} warning${warnings === 1 ? '' : 's'}` : ''}
                </span>
              )}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <button className="btn-ghost" onClick={() => onOpen(c.id)}>
                {locked ? '👁 View' : '✏️ Edit / Review'}
              </button>

              {c.status === 'draft' && (
                <button
                  className="btn-ghost"
                  onClick={() =>
                    confirmThen('Submit this version for review?', () =>
                      apply((x) => transitionCurriculum(x, c.id, 'review').catalog)
                    )
                  }
                >
                  📨 Submit for review
                </button>
              )}

              {c.status === 'review' && (
                <>
                  <button
                    className="btn-ghost"
                    onClick={() =>
                      confirmThen('Return to draft?', () =>
                        apply((x) => transitionCurriculum(x, c.id, 'draft').catalog)
                      )
                    }
                  >
                    ↩️ Back to draft
                  </button>
                  <button className="btn-primary" onClick={() => publish(c.id)}>
                    ✅ Publish
                  </button>
                </>
              )}

              {c.status === 'published' && (
                <button
                  className="btn-ghost"
                  onClick={() =>
                    confirmThen(
                      'Archive this published curriculum? Students will fall back to the newest remaining published version.',
                      () => apply((x) => transitionCurriculum(x, c.id, 'archived').catalog)
                    )
                  }
                >
                  📦 Archive
                </button>
              )}

              {c.status === 'archived' && (
                <button
                  className="btn-ghost"
                  onClick={() =>
                    confirmThen('Restore this archived version to draft for editing?', () =>
                      apply((x) => transitionCurriculum(x, c.id, 'draft').catalog)
                    )
                  }
                >
                  ↩️ Restore to draft
                </button>
              )}

              <button
                className="btn-ghost"
                onClick={() =>
                  confirmThen('Duplicate this version into a new editable draft?', () =>
                    apply((x) => duplicateCurriculum(x, c.id).catalog)
                  )
                }
              >
                ⧉ Duplicate
              </button>

              {c.status !== 'published' && (
                <button
                  className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-100"
                  onClick={() =>
                    confirmThen(
                      c.status === 'archived'
                        ? 'Delete this archived version? It moves to the Recycle bin and can be restored later.'
                        : 'Delete this version? It moves to the Recycle bin and can be restored later.',
                      () => {
                        const res = deleteCurriculum(catalog, c.id);
                        if (!res.ok) {
                          alert(res.reason);
                        } else {
                          apply(() => res.catalog);
                        }
                      }
                    )
                  }
                >
                  🗑 Delete
                </button>
              )}
              {c.status === 'published' && (
                <span
                  className="self-center text-[10px] font-bold text-slate-400"
                  title="Published curriculum is locked and protected from deletion"
                >
                  🔒 locked
                </span>
              )}
            </div>
          </section>
        );
      })}

      {/* Create new version */}
      {showCreate ? (
        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h2 className="mb-3 text-sm font-bold">New curriculum version</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
            <select
              className="input sm:col-span-2"
              value={showCreate ?? ''}
              onChange={(e) => {
                setShowCreate(e.target.value);
                setForm((f) => ({ ...f, versionName: suggestVersionName(catalog, e.target.value) }));
              }}
            >
              {catalog.universities.flatMap((u) =>
                u.schools.flatMap((s) =>
                  s.programmes.map((p) => (
                    <option key={p.id} value={p.id}>
                      {u.shortName} · {s.name} · {p.shortName}
                    </option>
                  ))
                )
              )}
            </select>
            <input
              className="input"
              placeholder="Version name e.g. 2025/2026"
              value={form.versionName}
              onChange={(e) => setForm({ ...form, versionName: e.target.value })}
            />
            <input
              className="input"
              placeholder="Academic year"
              value={form.effectiveAcademicYear}
              onChange={(e) => setForm({ ...form, effectiveAcademicYear: e.target.value })}
            />
          </div>
          <div className="mt-3 flex gap-2">
            <button
              className="btn-primary"
              disabled={!form.versionName}
              onClick={() => {
                apply((c) => createCurriculum(c, showCreate!, form));
                setShowCreate(null);
                setForm({ versionName: '', effectiveAcademicYear: '', effectiveDate: new Date().toISOString().slice(0, 10) });
              }}
            >
              Create (empty level scaffold)
            </button>
            <button className="btn-ghost" onClick={() => setShowCreate(null)}>
              Cancel
            </button>
          </div>
        </section>
      ) : (
        <button
          className="w-full rounded-2xl border-2 border-dashed border-slate-300 py-3 text-sm font-bold text-slate-500 hover:border-brand-400 hover:text-brand-600"
          onClick={() => {
            const first = catalog.universities[0]?.schools[0]?.programmes[0];
            setShowCreate(first?.id ?? null);
            if (first) setForm((f) => ({ ...f, versionName: suggestVersionName(catalog, first.id) }));
          }}
        >
          ＋ Create curriculum version
        </button>
      )}
    </div>
  );
}
