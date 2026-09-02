import { useState } from 'react';
import { useAdmin } from '../adminStore';
import { confirmThen } from '../confirm';
import {
  addLevel,
  addSemester,
  addCourse,
  bulkAddCourses,
  parseBulkCourses,
  reorderCourse,
  duplicateCourse,
  updateCourse,
  removeCourse,
  updateSemester,
  updateCurriculum,
  reviewCurriculum,
  transitionCurriculum,
  curriculumStats,
  type BulkRow,
} from '../adminConfigService';
import { JsonPasteImport } from './JsonPasteImport';
import { writeCachedConfig } from '../../services/configCache';

export function CurriculumEditor({
  curriculumId,
  onBack,
  onPreview,
}: {
  curriculumId: string;
  onBack: () => void;
  onPreview: (id: string) => void;
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

  const locked = version.status === 'archived';
  const issues = reviewCurriculum(version);
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const stats = curriculumStats(version);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-ghost" onClick={onBack}>← Back</button>
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
        <button className="btn-ghost ml-auto" onClick={() => onPreview(version.id)}>
          👁 Curriculum preview
        </button>
      </div>

      {!locked && (
        <JsonPasteImport curriculumId={version.id} locked={locked} mode="whole" />
      )}

      {/* Programme totals */}
      <header className="rounded-2xl bg-slate-900 p-4 text-white shadow-sm">
        <h1 className="text-base font-black">{version.versionName}</h1>
        <p className="text-xs text-slate-300">
          {version.effectiveAcademicYear || 'year not set'} · effective {version.effectiveDate}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Total dark label="Programme credits" value={stats.totalCredits} />
          <Total dark label="Courses" value={stats.totalCourses} />
          <Total dark label="Active courses" value={stats.totalActiveCourses} />
          <Total dark label="Levels" value={stats.levels.length} />
        </div>
      </header>

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
              placeholder="e.g. 2026/27"
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
            <strong>Duplicate</strong> from the curricula list to create an editable draft.
          </p>
        )}
      </header>

      {/* Review panel */}
      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h2 className="text-sm font-bold text-slate-800">
          📋 Review · {errors.length} error{errors.length === 1 ? '' : 's'} ·{' '}
          {warnings.length} warning{warnings.length === 1 ? '' : 's'}
        </h2>
        <div className="mt-2 max-h-40 space-y-1.5 overflow-y-auto">
          {issues.length === 0 && (
            <p className="text-xs font-semibold text-emerald-700">✅ Looks publish-ready.</p>
          )}
          {errors.map((i, n) => (
            <p key={`e${n}`} className="text-xs font-semibold text-red-600">⛔ {i.message}</p>
          ))}
          {warnings.map((i, n) => (
            <p key={`w${n}`} className="text-xs text-amber-700">⚠️ {i.message}</p>
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
            {(version.status === 'review' || version.status === 'published') && (
              <>
                <button
                  className="btn-primary"
                  disabled={errors.length > 0}
                  onClick={() =>
                    confirmThen(version.status === 'published' ? 'Commit these changes? Students receive the updated version.' : 'Publish? Students receive it offline.', () => {
                      const result = transitionCurriculum(catalog, version.id, 'published');
                      if (result.ok) {
                        apply(() => result.catalog);
                        // Commit new published config to student offline cache so
                        // the student app picks it up immediately.
                        writeCachedConfig({
                          universities: result.catalog.universities,
                          curricula: result.catalog.curricula,
                          cachedAt: new Date().toISOString(),
                          schemaVersion: 1,
                        });
                      }
                    })
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

      {/* Levels */}
      {version.levels.map((level) => {
        const levelStat = stats.levels.find((l) => l.index === level.index);
        return (
          <section key={level.index} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-black text-slate-900">{level.label}</h3>
              <div className="ml-auto flex items-center gap-3 text-[11px] font-bold text-slate-500">
                <span>📚 {levelStat?.courses ?? 0} courses</span>
                <span className="text-brand-700">🎓 {levelStat?.credits ?? 0} credits</span>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {level.semesters.map((sem) => {
                const semStat = levelStat?.semesters.find((s) => s.index === sem.index);
                return (
                  <SemesterCard
                    key={sem.index}
                    versionId={version.id}
                    levelIndex={level.index}
                    levelLabel={level.label}
                    semesterIndex={sem.index}
                    semesterLabel={sem.label}
                    locked={locked}
                    courses={sem.courses}
                    courseCount={semStat?.courses ?? 0}
                    credits={semStat?.credits ?? 0}
                    apply={apply}
                  />
                );
              })}
            </div>

            {!locked && level.semesters.length < 3 && (
              <div className="mt-3">
                <button
                  className="text-[11px] font-bold text-brand-600 hover:underline"
                  onClick={() => apply((c) => addSemester(c, version.id, level.index))}
                >
                  ＋ Add semester to {level.label}
                </button>
              </div>
            )}
          </section>
        );
      })}

      {!locked && (
        <button
          className="w-full rounded-2xl border-2 border-dashed border-slate-300 py-3 text-sm font-bold text-slate-500 hover:border-brand-400 hover:text-brand-600"
          onClick={() => apply((c) => addLevel(c, version.id))}
        >
          ＋ Add level
        </button>
      )}
    </div>
  );
}

function Total({ label, value, dark }: { label: string; value: number; dark?: boolean }) {
  return (
    <div className={`rounded-xl px-3 py-2 text-center ${dark ? 'bg-white/10' : 'bg-slate-100'}`}>
      <p className={`text-xl font-black tabular-nums ${dark ? 'text-white' : 'text-slate-900'}`}>
        {value}
      </p>
      <p className={`text-[9px] font-bold uppercase tracking-wide ${dark ? 'text-slate-300' : 'text-slate-400'}`}>
        {label}
      </p>
    </div>
  );
}

function SemesterCard({
  versionId,
  levelIndex,
  levelLabel,
  semesterIndex,
  semesterLabel,
  locked,
  courses,
  courseCount,
  credits,
  apply,
}: {
  versionId: string;
  levelIndex: number;
  levelLabel: string;
  semesterIndex: number;
  semesterLabel: string;
  locked: boolean;
  courses: import('../../config/types').CurriculumCourse[];
  courseCount: number;
  credits: number;
  apply: ReturnType<typeof useAdmin>['apply'];
}) {
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [parsed, setParsed] = useState<BulkRow[] | null>(null);

  const parsedValid = parsed?.filter((r) => r.valid).length ?? 0;
  const parsedInvalid = parsed?.filter((r) => !r.valid).length ?? 0;

  return (
    <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100">
      <div className="mb-2 flex items-center justify-between">
        {!locked ? (
          <input
            className="input w-auto max-w-xs text-xs font-bold uppercase tracking-wide text-slate-500"
            value={semesterLabel}
            onChange={(e) =>
              apply((c) =>
                updateSemester(c, versionId, levelIndex, semesterIndex, {
                  label: e.target.value,
                })
              )
            }
          />
        ) : (
          <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">
            {semesterLabel}
          </h4>
        )}
        <span className="text-[10px] font-bold text-slate-400">
          {courseCount} courses · <span className="text-brand-700">{credits} cr</span>
        </span>
      </div>

      <div className="space-y-2">
        {courses.map((course, idx) => (
          <div
            key={course.id}
            className={`rounded-lg p-2 ring-1 ${
              course.status === 'active'
                ? 'bg-white ring-slate-200'
                : 'bg-slate-100 opacity-70 ring-slate-200'
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
                    updateCourse(c, versionId, levelIndex, semesterIndex, course.id, {
                      code: e.target.value.toUpperCase(),
                    })
                  )
                }
              />
              <input
                className="input col-span-4 px-2 py-1.5 text-xs"
                placeholder="Course name"
                disabled={locked}
                value={course.name}
                onChange={(e) =>
                  apply((c) =>
                    updateCourse(c, versionId, levelIndex, semesterIndex, course.id, {
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
                    updateCourse(c, versionId, levelIndex, semesterIndex, course.id, {
                      creditHours: Math.max(1, Number(e.target.value) || 1),
                    })
                  )
                }
              />
              {!locked && (
                <div className="col-span-3 flex items-center justify-end gap-0.5">
                  <IconBtn
                    title="Move up"
                    disabled={idx === 0}
                    onClick={() =>
                      apply((c) => reorderCourse(c, versionId, levelIndex, semesterIndex, course.id, 'up'))
                    }
                  >
                    ↑
                  </IconBtn>
                  <IconBtn
                    title="Move down"
                    disabled={idx === courses.length - 1}
                    onClick={() =>
                      apply((c) => reorderCourse(c, versionId, levelIndex, semesterIndex, course.id, 'down'))
                    }
                  >
                    ↓
                  </IconBtn>
                  <IconBtn
                    title="Duplicate course"
                    onClick={() =>
                      apply((c) => duplicateCourse(c, versionId, levelIndex, semesterIndex, course.id))
                    }
                  >
                    ⧉
                  </IconBtn>
                  <IconBtn
                    title="Remove course"
                    danger
                    onClick={() =>
                      confirmThen(`Remove ${course.code || 'this course'}?`, () =>
                        apply((c) => removeCourse(c, versionId, levelIndex, semesterIndex, course.id))
                      )
                    }
                  >
                    ✕
                  </IconBtn>
                </div>
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
                        updateCourse(c, versionId, levelIndex, semesterIndex, course.id, {
                          core: e.target.checked,
                        })
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
                      updateCourse(c, versionId, levelIndex, semesterIndex, course.id, {
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
          <>
            <button
              className="w-full rounded-lg border border-dashed border-slate-300 py-1.5 text-[11px] font-bold text-slate-500 hover:border-brand-400 hover:text-brand-600"
              onClick={() => apply((c) => addCourse(c, versionId, levelIndex, semesterIndex))}
            >
              ＋ Add course
            </button>
            <button
              className="w-full text-center text-[10px] font-bold text-slate-400 hover:text-brand-600"
              onClick={() => setBulkOpen((v) => !v)}
            >
              {bulkOpen ? '▾ Hide bulk entry' : '▸ Bulk course entry'}
            </button>

            {bulkOpen && (
              <div className="rounded-lg bg-white p-2 ring-1 ring-slate-200">
                <p className="mb-1 text-[10px] font-semibold text-slate-500">
                  Paste one course per line — <code>CODE, Name, Credits</code> (tab or
                  commas). Example: <code>PHA 111, Intro to Pharmacy, 3</code>
                </p>
                <textarea
                  className="input h-24 font-mono text-xs"
                  placeholder={'PHA 111\tIntro to Pharmacy\t3\nPHA 113\tAnatomy & Physiology\t4'}
                  value={bulkText}
                  onChange={(e) => {
                    setBulkText(e.target.value);
                    setParsed(parseBulkCourses(e.target.value));
                  }}
                />
                {parsed && parsed.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {parsed.map((r, i) => (
                      <div
                        key={i}
                        className={`flex items-center justify-between rounded px-2 py-1 text-[11px] ${
                          r.valid ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'
                        }`}
                      >
                        <span className="font-mono font-bold">{r.code || '(no code)'}</span>
                        <span className="flex-1 truncate px-2">{r.name || '(no name)'}</span>
                        <span className="font-bold">{r.creditHours || '—'} cr</span>
                      </div>
                    ))}
                    <p className="text-[10px] text-slate-500">
                      {parsedValid} ready · {parsedInvalid} need fixing
                    </p>
                  </div>
                )}
                <div className="mt-2 flex gap-2">
                  <button
                    className="btn-primary flex-1 py-1.5 text-xs"
                    disabled={parsedValid === 0}
                    onClick={() => {
                      if (!parsed) return;
                      apply((c) =>
                        bulkAddCourses(
                          c,
                          versionId,
                          levelIndex,
                          semesterIndex,
                          parsed.filter((r) => r.valid)
                        )
                      );
                      setBulkText('');
                      setParsed(null);
                      setBulkOpen(false);
                    }}
                  >
                    Add {parsedValid} course{parsedValid === 1 ? '' : 's'}
                  </button>
                  <button
                    className="btn-ghost py-1.5 text-xs"
                    onClick={() => {
                      setBulkOpen(false);
                      setBulkText('');
                      setParsed(null);
                    }}
                  >
                    Close
                  </button>
                </div>
              </div>
            )}
          </>
        )}
        {/* Import removed — use the JSON paste at the top of the editor */}
      </div>
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  title,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-7 w-7 items-center justify-center rounded-md text-xs font-bold transition disabled:opacity-20 ${
        danger
          ? 'text-red-400 hover:bg-red-50 hover:text-red-600'
          : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'
      }`}
    >
      {children}
    </button>
  );
}
