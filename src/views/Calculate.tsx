import { useState } from 'react';
import { useDerived } from '../state/derived';
import { Card, SectionTitle, Badge, Note } from '../components/ui';
import { bandForScore, effectiveGrade, gradePointsForCourse } from '../services/gradingService';
import { fmt2 } from '../util/format';
import type { CourseEntry } from '../state/studentState';

export function Calculate() {
  const d = useDerived();
  const { state, dispatch, record, maxPoints } = d;

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle
          icon="🧮"
          title="Calculate"
          subtitle="Everything is computed on this device. Nothing you type leaves the app or is stored."
        />

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => dispatch({ type: 'setMode', mode: 'history' })}
            className={`rounded-xl px-3 py-2.5 text-xs font-bold transition ring-1 ${
              state.mode === 'history'
                ? 'bg-brand-600 text-white ring-brand-600'
                : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'
            }`}
          >
            📚 GPA History Mode
            <span className="mt-0.5 block text-[10px] font-semibold opacity-80">
              Enter each semester GPA
            </span>
          </button>
          <button
            onClick={() => dispatch({ type: 'setMode', mode: 'current' })}
            className={`rounded-xl px-3 py-2.5 text-xs font-bold transition ring-1 ${
              state.mode === 'current'
                ? 'bg-brand-600 text-white ring-brand-600'
                : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'
            }`}
          >
            📍 Current CGPA Mode
            <span className="mt-0.5 block text-[10px] font-semibold opacity-80">
              Start from your current level &amp; CGPA
            </span>
          </button>
        </div>
      </Card>

      {state.mode === 'current' ? (
        <CurrentMode />
      ) : (
        <>
          {d.semesters.map(({ semester, configuredCredits, effectiveCredits, term }) => (
            <Card key={semester.id}>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <input
                  className="input max-w-[220px] font-bold"
                  value={semester.label}
                  onChange={(e) =>
                    dispatch({
                      type: 'renameSemester',
                      semesterId: semester.id,
                      label: e.target.value,
                    })
                  }
                />
                <div className="ml-auto flex items-center gap-2">
                  <Badge
                    tone={
                      term.gpa === null
                        ? 'gray'
                        : term.gpa >= 3.6
                          ? 'gold'
                          : term.gpa >= 3.0
                            ? 'green'
                            : term.gpa >= 2.5
                              ? 'teal'
                              : 'blue'
                    }
                  >
                    GPA {fmt2(term.gpa)}
                  </Badge>
                  {state.semesters.length > 1 && (
                    <button
                      onClick={() =>
                        dispatch({ type: 'removeSemester', semesterId: semester.id })
                      }
                      className="rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-bold text-red-600 hover:bg-red-100"
                      title="Remove semester"
                    >
                      🗑
                    </button>
                  )}
                </div>
              </div>

              {/* Semester GPA + credits — the core credit-weighted input */}
              <div className="grid grid-cols-2 gap-3 rounded-xl bg-brand-50/60 p-3 ring-1 ring-brand-100">
                <label className="block">
                  <span className="label">Semester GPA</span>
                  <input
                    type="number"
                    min={0}
                    max={maxPoints}
                    step={0.01}
                    className="input text-center text-lg font-black"
                    placeholder="e.g. 3.42"
                    value={semester.gpa ?? ''}
                    onChange={(e) =>
                      dispatch({
                        type: 'setSemesterGpa',
                        semesterId: semester.id,
                        gpa: e.target.value === '' ? null : Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label className="block">
                  <span className="label">
                    Semester credits{' '}
                    {configuredCredits > 0 && (
                      <span className="font-normal normal-case text-emerald-600">
                        (curriculum: {configuredCredits})
                      </span>
                    )}
                  </span>
                  <input
                    type="number"
                    min={0}
                    className="input text-center text-lg font-black"
                    placeholder={configuredCredits > 0 ? String(configuredCredits) : 'e.g. 18'}
                    value={semester.creditHoursOverride ?? ''}
                    onChange={(e) =>
                      dispatch({
                        type: 'setSemesterCredits',
                        semesterId: semester.id,
                        creditHours:
                          e.target.value === '' ? null : Number(e.target.value),
                      })
                    }
                  />
                </label>
              </div>
              <p className="mt-2 text-[11px] text-slate-500">
                Quality points = GPA × {effectiveCredits || 'credits'}. Semester GPAs
                are <strong>credit-weighted</strong>, never simply averaged.
                {term.source === 'courses' && (
                  <> Course details below are being used for this semester.</>
                )}
              </p>

              {/* Optional course-level detail */}
              <CourseDetail semesterId={semester.id} courses={semester.courses} />
            </Card>
          ))}

          <button
            onClick={() => dispatch({ type: 'addSemester' })}
            className="w-full rounded-2xl border-2 border-dashed border-slate-300 py-3 text-sm font-bold text-slate-500 transition hover:border-brand-400 hover:text-brand-600"
          >
            ＋ Add next semester
          </button>
        </>
      )}

      <Card className="bg-slate-900 text-white ring-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
              Cumulative Grade Point Average
            </p>
            <p className="text-4xl font-black tabular-nums">{fmt2(record.cgpa)}</p>
          </div>
          <div className="text-right text-xs text-slate-300">
            <p>{record.creditHours} graded credits</p>
            <p>{fmt2(record.points)} quality points</p>
            {record.pendingCount > 0 && (
              <p className="text-amber-300">
                ⏳ {record.pendingCount} pending · {record.pendingCreditHours} cr
              </p>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

function CurrentMode() {
  const d = useDerived();
  const { state, dispatch, progress, curriculumPublished } = d;
  const b = state.baseline;

  const levels =
    d.slots.length > 0
      ? Array.from(new Set(d.slots.map((s) => s.levelIndex))).sort((a, z) => a - z)
      : [1, 2, 3, 4, 5, 6];

  const creditsKnown = progress.hasCreditData && progress.completedCredits > 0;

  return (
    <Card>
      <SectionTitle
        icon="📍"
        title="Your current standing"
        subtitle="Tell us your current level and CGPA — the configured curriculum supplies the credit structure."
      />

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="label">Current academic level</span>
          <select
            className="input"
            value={b.levelIndex}
            onChange={(e) =>
              dispatch({
                type: 'setBaseline',
                patch: { levelIndex: Number(e.target.value) },
              })
            }
          >
            {levels.map((lv) => (
              <option key={lv} value={lv}>
                Level {lv * 100}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Last completed semester</span>
          <select
            className="input"
            value={b.semesterIndex}
            onChange={(e) =>
              dispatch({
                type: 'setBaseline',
                patch: { semesterIndex: Number(e.target.value) },
              })
            }
          >
            <option value={1}>Semester 1</option>
            <option value={2}>Semester 2</option>
          </select>
        </label>
        <label className="block">
          <span className="label">Current CGPA</span>
          <input
            type="number"
            min={0}
            max={d.maxPoints}
            step={0.01}
            className="input text-center text-lg font-black"
            placeholder="e.g. 3.42"
            value={b.cgpa ?? ''}
            onChange={(e) =>
              dispatch({
                type: 'setBaseline',
                patch: { cgpa: e.target.value === '' ? null : Number(e.target.value) },
              })
            }
          />
        </label>
        <div className="block">
          <span className="label">Credits completed</span>
          {creditsKnown ? (
            <div className="rounded-xl bg-emerald-50 px-3 py-2 text-center text-lg font-black text-emerald-700 ring-1 ring-emerald-200">
              {progress.completedCredits}
              <span className="block text-[10px] font-semibold text-emerald-600">
                from {d.university.shortName} curriculum
              </span>
            </div>
          ) : (
            <input
              type="number"
              min={0}
              className="input text-center text-lg font-black"
              placeholder="e.g. 64"
              value={b.creditHours || ''}
              onChange={(e) =>
                dispatch({
                  type: 'setBaseline',
                  patch: { creditHours: Number(e.target.value) || 0 },
                })
              }
            />
          )}
        </div>
      </div>

      {creditsKnown && (
        <div className="mt-3 grid grid-cols-2 gap-2 text-center text-xs">
          <div className="rounded-xl bg-slate-50 p-2 ring-1 ring-slate-100">
            <p className="font-black text-slate-800">{progress.completedCredits}</p>
            <p className="text-slate-500">credits completed</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-2 ring-1 ring-slate-100">
            <p className="font-black text-brand-700">{progress.remainingCredits}</p>
            <p className="text-slate-500">credits remaining</p>
          </div>
        </div>
      )}

      <Note>
        {curriculumPublished
          ? 'Remaining credits and the academic structure are read from the configured published curriculum.'
          : 'The curriculum has not been published yet — enter your total credits manually. Individual course grades are never required or inferred.'}
      </Note>
    </Card>
  );
}

function CourseDetail({
  semesterId,
  courses,
}: {
  semesterId: string;
  courses: CourseEntry[];
}) {
  const { dispatch, grading } = useDerived();
  const [open, setOpen] = useState(false);

  if (courses.length === 0 && !open) {
    return (
      <button
        className="mt-2 text-[11px] font-bold text-slate-400 hover:text-brand-600"
        onClick={() => {
          dispatch({ type: 'addCourse', semesterId });
          setOpen(true);
        }}
      >
        ▸ Optional: enter individual courses
      </button>
    );
  }

  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      <button
        className="mb-2 text-[11px] font-bold text-slate-500 hover:text-brand-600"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? '▾ Hide course detail' : '▸ Course detail (advanced)'}
      </button>
      {open && (
        <div className="space-y-2">
          {courses.map((course) => (
            <CourseRow key={course.id} semesterId={semesterId} course={course} grading={grading} />
          ))}
          <button
            onClick={() => dispatch({ type: 'addCourse', semesterId })}
            className="w-full rounded-lg border border-dashed border-slate-300 py-1.5 text-[11px] font-bold text-slate-500 hover:border-brand-400 hover:text-brand-600"
          >
            ＋ Add course
          </button>
        </div>
      )}
    </div>
  );
}

function CourseRow({
  semesterId,
  course,
  grading,
}: {
  semesterId: string;
  course: CourseEntry;
  grading: ReturnType<typeof useDerived>['grading'];
}) {
  const { dispatch } = useDerived();
  const grade = effectiveGrade(course, grading);
  const points = gradePointsForCourse(course, grading);
  const band =
    course.score !== null && !Number.isNaN(course.score)
      ? bandForScore(course.score, grading)
      : null;
  const update = (patch: Partial<CourseEntry>) =>
    dispatch({ type: 'updateCourse', semesterId, courseId: course.id, patch });

  return (
    <div
      className={`rounded-xl border p-2.5 ${
        course.pending ? 'border-amber-300 bg-amber-50/60' : 'border-slate-200 bg-slate-50/60'
      }`}
    >
      <div className="grid grid-cols-12 items-end gap-2">
        <div className="col-span-7 sm:col-span-4">
          <input
            className="input"
            placeholder="Course name (optional)"
            value={course.name}
            onChange={(e) => update({ name: e.target.value })}
          />
        </div>
        <div className="col-span-5 sm:col-span-2">
          <input
            className="input"
            placeholder="Code"
            value={course.code}
            onChange={(e) => update({ code: e.target.value })}
          />
        </div>
        <div className="col-span-4 sm:col-span-1">
          <input
            type="number"
            min={1}
            max={12}
            className="input text-center"
            value={course.creditHours}
            onChange={(e) =>
              update({ creditHours: Math.max(1, Number(e.target.value) || 1) })
            }
          />
        </div>
        <div className="col-span-4 sm:col-span-2">
          <input
            type="number"
            min={0}
            max={100}
            disabled={course.pending}
            className="input text-center font-bold disabled:opacity-40"
            placeholder="Score"
            value={course.score ?? ''}
            onChange={(e) =>
              update({
                score: e.target.value === '' ? null : Number(e.target.value),
                grade: null,
              })
            }
          />
        </div>
        <div className="col-span-4 sm:col-span-1">
          <div
            className={`flex h-[38px] items-center justify-center rounded-xl text-sm font-black ${
              !grade
                ? 'bg-slate-200 text-slate-400'
                : band?.points === 0 ||
                    (course.grade &&
                      grading.bands.find((b) => b.grade === course.grade)?.points === 0)
                  ? 'bg-red-100 text-red-700'
                  : 'bg-brand-100 text-brand-700'
            }`}
          >
            {grade ?? '—'}
          </div>
        </div>
        <div className="col-span-12 flex items-center justify-end gap-2 sm:col-span-2">
          <span className="text-xs font-bold text-slate-500">
            {points !== null && !course.pending ? `${fmt2(points)} pts` : ''}
          </span>
          <button
            onClick={() =>
              update({
                pending: !course.pending,
                score: !course.pending ? null : course.score,
                grade: !course.pending ? null : course.grade,
              })
            }
            className={`rounded-lg px-2 py-1 text-[10px] font-bold ring-1 ${
              course.pending
                ? 'bg-amber-500 text-white ring-amber-500'
                : 'bg-white text-slate-500 ring-slate-300 hover:bg-amber-50 hover:text-amber-700'
            }`}
          >
            ⏳
          </button>
          <button
            onClick={() => dispatch({ type: 'removeCourse', semesterId, courseId: course.id })}
            className="text-sm text-red-400 hover:text-red-600"
          >
            ✕
          </button>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {grading.bands.map((b) => (
          <button
            key={b.grade}
            disabled={course.pending}
            onClick={() => update({ grade: course.grade === b.grade ? null : b.grade, score: null })}
            className={`rounded-md px-2 py-0.5 text-[11px] font-bold ring-1 transition disabled:opacity-40 ${
              course.grade === b.grade
                ? 'bg-brand-600 text-white ring-brand-600'
                : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-100'
            }`}
            title={`${b.points} pts`}
          >
            {b.grade}
          </button>
        ))}
      </div>
    </div>
  );
}
