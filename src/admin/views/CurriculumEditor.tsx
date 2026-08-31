import { useAdmin } from '../adminStore';
import { confirmThen } from '../confirm';
import type { CurriculumVersion } from '../../config/types';
import {
  addLevel,
  addSemester,
  addCourse,
  updateCourse,
  removeCourse,
  updateCurriculum,
  reviewCurriculum,
  transitionCurriculum,
} from '../adminConfigService';

export function CurriculumEditor({
  curriculumId,
  onBack,
}: {
  curriculumId: string;
  onBack: () => void;
}) {
  const { catalog, apply } = useAdmin();
  const version = catalog.curricula.find((c) => c.id === curriculumId);

  if (!version) {
    return (
      <div className="space-y-3">
        <button className="btn-ghost" onClick={onBack}>← Back to curricula</button>
        <p className="text-sm text-slate-500">Curriculum not found.</p>
      </div>
    );
  }

  const locked = version.status === 'published' || version.status === 'archived';
  const issues = reviewCurriculum(version);
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const totalActiveCredits = version.levels.reduce(
    (sum, l) =>
      sum +
      l.semesters.reduce(
        (s2, sem) =>
          s2 +
          sem.courses
            .filter((c) => c.status === 'active')
            .reduce((s3, c) => s3 + (c.creditHours || 0), 0),
        0
      ),
    0
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-ghost" onClick={onBack}>
          ← Back
        </button>
        <span
          className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ring-1 ${
            version.status === 'published'
              ? 'bg-emerald-100 text-emerald-800 ring-emerald-300'
              : version.status === 'review'
                ? 'bg-amber-100 text-amber-800 ring-amber-300'
                : version.status === 'archived'
                  ? 'bg-slate-200 text-slate-500 ring-slate-300'
                  : 'bg-slate-100 text-slate-600 ring-slate-300'
          }`}
        >
          {version.status}
        </span>
      </div>

      <header className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <label className="block">
            <span className="label">Version name</span>
            <input
              className="input"
              disabled={locked}
              value={version.versionName}
              onChange={(e) =>
                apply((c) => updateCurriculum(c, version.id, { versionName: e.target.value }))
              }
            />
          </label>
          <label className="block">
            <span className="label">Academic year</span>
            <input
              className="input"
              disabled={locked}
              placeholder="e.g. 2025/2026"
              value={version.effectiveAcademicYear === '—' ? '' : version.effectiveAcademicYear}
              onChange={(e) =>
                apply((c) =>
                  updateCurriculum(c, version.id, { effectiveAcademicYear: e.target.value })
                )
              }
            />
          </label>
          <label className="block">
            <span className="label">Effective date</span>
            <input
              type="date"
              className="input"
              disabled={locked}
              value={version.effectiveDate}
              onChange={(e) =>
                apply((c) => updateCurriculum(c, version.id, { effectiveDate: e.target.value }))
              }
            />
          </label>
        </div>
        {locked && (
          <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-500 ring-1 ring-slate-100">
            🔒 This version is {version.status} and cannot be edited. Use{' '}
            <strong>Duplicate</strong> from the curricula list to create an editable
            draft.
          </p>
        )}
      </header>

      {/* Review panel */}
      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h2 className="text-sm font-bold text-slate-800">
          📋 Review · {errors.length} error{errors.length === 1 ? '' : 's'} ·{' '}
          {warnings.length} warning{warnings.length === 1 ? '' : 's'}
        </h2>
        <div className="mt-2 space-y-1.5">
          {issues.length === 0 && (
            <p className="text-xs font-semibold text-emerald-700">
              ✅ Looks publish-ready.
            </p>
          )}
          {errors.map((i, n) => (
            <p key={`e${n}`} className="text-xs font-semibold text-red-600">
              ⛔ {i.message}
            </p>
          ))}
          {warnings.map((i, n) => (
            <p key={`w${n}`} className="text-xs text-amber-700">
              ⚠️ {i.message}
            </p>
          ))}
        </div>

        {!locked && (
          <div className="mt-3 flex flex-wrap gap-2">
            {version.status === 'draft' && (
              <button
                className="btn-ghost"
                onClick={() =>
                  confirmThen('Submit for review?', () =>
                    apply((c) => transitionCurriculum(c, version.id, 'review').catalog)
                  )
                }
              >
                📨 Submit for review
              </button>
            )}
            {version.status === 'review' && (
              <>
                <button
                  className="btn-primary"
                  disabled={errors.length > 0}
                  onClick={() =>
                    confirmThen(
                      errors.length === 0
                        ? 'Publish? Students receive it offline.'
                        : 'There are blocking errors.',
                      () =>
                        apply((c) =>
                          transitionCurriculum(c, version.id, 'published').catalog
                        )
                    )
                  }
                >
                  ✅ Publish
                </button>
                <button
                  className="btn-ghost"
                  onClick={() =>
                    apply((c) => transitionCurriculum(c, version.id, 'draft').catalog)
                  }
                >
                  ↩️ Back to draft
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Academic structure */}
      {version.levels.map((level) => (
        <section
          key={level.index}
          className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200"
        >
          <h3 className="text-sm font-black text-slate-900">{level.label}</h3>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {level.semesters.map((sem) => (
              <div key={sem.index} className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">
                    {sem.label}
                  </h4>
                  <span className="text-[10px] font-bold text-slate-400">
                    {sem.courses.reduce(
                      (s, c) => s + (c.status === 'active' ? c.creditHours : 0),
                      0
                    )}{' '}
                    cr
                  </span>
                </div>

                <div className="space-y-2">
                  {sem.courses.map((course) => (
                    <div
                      key={course.id}
                      className={`rounded-lg p-2 ring-1 ${
                        course.status === 'active'
                          ? 'bg-white ring-slate-200'
                          : 'bg-slate-100 ring-slate-200 opacity-70'
                      }`}
                    >
                      <div className="grid grid-cols-12 items-center gap-1.5">
                        <input
                          className="input col-span-3 px-2 py-1.5 font-mono text-xs"
                          placeholder="Code"
                          disabled={locked}
                          value={course.code}
                          onChange={(e) =>
                            apply((c) =>
                              updateCourse(c, version.id, level.index, sem.index, course.id, {
                                code: e.target.value.toUpperCase(),
                              })
                            )
                          }
                        />
                        <input
                          className="input col-span-6 px-2 py-1.5 text-xs"
                          placeholder="Course name"
                          disabled={locked}
                          value={course.name}
                          onChange={(e) =>
                            apply((c) =>
                              updateCourse(c, version.id, level.index, sem.index, course.id, {
                                name: e.target.value,
                              })
                            )
                          }
                        />
                        <input
                          type="number"
                          min={1}
                          max={12}
                          className="input col-span-2 px-1 py-1.5 text-center text-xs"
                          disabled={locked}
                          value={course.creditHours}
                          onChange={(e) =>
                            apply((c) =>
                              updateCourse(c, version.id, level.index, sem.index, course.id, {
                                creditHours: Math.max(1, Number(e.target.value) || 1),
                              })
                            )
                          }
                        />
                        {!locked && (
                          <button
                            className="col-span-1 text-right text-red-400 hover:text-red-600"
                            onClick={() =>
                              confirmThen('Remove this course?', () =>
                                apply((c) =>
                                  removeCourse(c, version.id, level.index, sem.index, course.id)
                                )
                              )
                            }
                          >
                            ✕
                          </button>
                        )}
                      </div>
                      {!locked && (
                        <div className="mt-1.5 flex items-center justify-between">
                          <label className="flex items-center gap-1 text-[10px] font-bold text-slate-500">
                            <input
                              type="checkbox"
                              checked={course.core}
                              onChange={(e) =>
                                apply((c) =>
                                  updateCourse(
                                    c,
                                    version.id,
                                    level.index,
                                    sem.index,
                                    course.id,
                                    { core: e.target.checked }
                                  )
                                )
                              }
                            />
                            Core
                          </label>
                          <button
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${
                              course.status === 'active'
                                ? 'bg-emerald-100 text-emerald-700 ring-emerald-300'
                                : 'bg-slate-200 text-slate-500 ring-slate-300'
                            }`}
                            onClick={() =>
                              apply((c) =>
                                updateCourse(c, version.id, level.index, sem.index, course.id, {
                                  status: course.status === 'active' ? 'inactive' : 'active',
                                })
                              )
                            }
                          >
                            {course.status === 'active' ? 'Active' : 'Inactive'}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}

                  {!locked && (
                    <button
                      className="w-full rounded-lg border border-dashed border-slate-300 py-1.5 text-[11px] font-bold text-slate-500 hover:border-brand-400 hover:text-brand-600"
                      onClick={() =>
                        apply((c) => addCourse(c, version.id, level.index, sem.index))
                      }
                    >
                      ＋ Add course
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {!locked && (
            <div className="mt-3 flex flex-wrap gap-2">
              {level.semesters.length < 3 && (
                <button
                  className="text-[11px] font-bold text-brand-600 hover:underline"
                  onClick={() =>
                    apply((c) => addSemester(c, version.id, level.index))
                  }
                >
                  ＋ Add semester to {level.label}
                </button>
              )}
            </div>
          )}
        </section>
      ))}

      {!locked && (
        <button
          className="w-full rounded-2xl border-2 border-dashed border-slate-300 py-3 text-sm font-bold text-slate-500 hover:border-brand-400 hover:text-brand-600"
          onClick={() => apply((c) => addLevel(c, version.id))}
        >
          ＋ Add level
        </button>
      )}

      <p className="rounded-xl bg-slate-50 px-3 py-2 text-center text-[11px] text-slate-500 ring-1 ring-slate-100">
        Total active credit hours across the curriculum:{' '}
        <strong>{totalActiveCredits}</strong> · Inactive courses are kept for
        records but excluded from student totals.
      </p>
    </div>
  );
}
