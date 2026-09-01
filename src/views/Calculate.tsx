import { useState } from 'react';
import { useDerived } from '../state/derived';
import { Card, SectionTitle, Badge, Note } from '../components/ui';
import { PendingProjectionPanel } from '../components/PendingProjection';
import {
  bandForScore,
  effectiveGrade,
  gradePointsForCourse,
  validateGpa,
} from '../services/gradingService';
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

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {(
            [
              { id: 'quick', icon: '⚡', title: 'Quick', hint: 'Current level + CGPA' },
              { id: 'history', icon: '📚', title: 'GPA History', hint: 'Enter each semester GPA' },
              { id: 'planning', icon: '🗺️', title: 'Planning', hint: 'Target + future GPA scenarios' },
            ] as const
          ).map((m) => (
            <button
              key={m.id}
              onClick={() => dispatch({ type: 'setInputMode', inputMode: m.id })}
              className={`rounded-xl px-3 py-2.5 text-left text-xs font-bold transition ring-1 ${
                state.inputMode === m.id
                  ? 'bg-brand-600 text-white ring-brand-600'
                  : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'
              }`}
            >
              <span className="text-sm">{m.icon}</span> {m.title}
              <span className={`mt-0.5 block text-[10px] font-semibold ${state.inputMode === m.id ? 'opacity-80' : 'text-slate-400'}`}>
                {m.hint}
              </span>
            </button>
          ))}
        </div>
      </Card>

      {state.inputMode === 'planning' ? (
        <PlanningMode />
      ) : state.inputMode === 'quick' ? (
        <CurrentMode quick />
      ) : (
        <>
          {d.semesters.map(({ semester, configuredCredits, effectiveCredits, term }) => {
            const isPending = semester.pending;
            return (
            <Card key={semester.id} className={isPending ? 'ring-2 ring-amber-300' : ''}>
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
                  {isPending ? (
                    <Badge tone="gold">⏳ Result Pending</Badge>
                  ) : term.gpa !== null ? (
                    <Badge
                      tone={
                        term.gpa >= 3.6
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
                  ) : (
                    <Badge tone="gray">Not entered</Badge>
                  )}
                  <button
                    onClick={() =>
                      dispatch({
                        type: 'setSemesterPending',
                        semesterId: semester.id,
                        pending: !isPending,
                      })
                    }
                    className={`rounded-lg px-2.5 py-1.5 text-xs font-bold ring-1 transition ${
                      isPending
                        ? 'bg-amber-500 text-white ring-amber-500'
                        : 'bg-white text-slate-500 ring-slate-300 hover:bg-amber-50 hover:text-amber-700'
                    }`}
                    title={isPending ? 'Mark results as released' : 'Results not yet available'}
                  >
                    {isPending ? '✓ Released' : '⏳ Pending'}
                  </button>
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

              {isPending ? (
                <div className="rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200">
                  <p className="text-sm font-bold text-amber-900">Result Pending</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-amber-800">
                    Results for this semester are not released yet. It is{' '}
                    <strong>excluded from your confirmed CGPA</strong>; its{' '}
                    <strong>{term.pendingCreditHours} known credits</strong>
                    {configuredCredits > 0 ? ' (from the curriculum)' : ''} are used
                    only in the best-/worst-case projections below. No grade is
                    assumed.
                  </p>
                </div>
              ) : (
                <>
                  {/* Semester GPA + credits — the core credit-weighted input */}
                  <div className="grid grid-cols-2 gap-3 rounded-xl bg-brand-50/60 p-3 ring-1 ring-brand-100">
                    <label className="block">
                      <span className="label">Semester GPA</span>
                      <input
                        type="number"
                        min={0}
                        max={maxPoints}
                        step={0.01}
                        className={`input text-center text-lg font-black ${
                          validateGpa(semester.gpa, d.grading)
                            ? 'ring-2 ring-red-300 focus:ring-red-400'
                            : ''
                        }`}
                        placeholder={`0.00–${maxPoints.toFixed(2)}`}
                        value={semester.gpa ?? ''}
                        onChange={(e) =>
                          dispatch({
                            type: 'setSemesterGpa',
                            semesterId: semester.id,
                            gpa: e.target.value === '' ? null : Number(e.target.value),
                          })
                        }
                      />
                      {validateGpa(semester.gpa, d.grading) && (
                        <span className="mt-1 block text-[10px] font-semibold text-red-600">
                          {validateGpa(semester.gpa, d.grading)}
                        </span>
                      )}
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
                </>
              )}
            </Card>
            );
          })}

          <button
            onClick={() => dispatch({ type: 'addSemester' })}
            disabled={d.slots.length > 0 && state.semesters.length >= d.slots.length}
            className="w-full rounded-2xl border-2 border-dashed border-slate-300 py-3 text-sm font-bold text-slate-500 transition hover:border-brand-400 hover:text-brand-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-slate-300 disabled:hover:text-slate-500"
          >
            {d.slots.length > 0 && state.semesters.length >= d.slots.length
              ? 'All semesters entered'
              : '＋ Add next completed semester'}
          </button>
          <Note>
            Only add the semesters you have actually completed — credit loads
            are taken from the {d.programme?.shortName ?? 'programme'}{' '}
            curriculum and weighted automatically.
          </Note>
        </>
      )}

      {d.pending.pendingCreditHours > 0 && (
        <PendingProjectionPanel pending={d.pending} target={state.targetCgpa} />
      )}

      <Card className="bg-slate-900 text-white ring-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
              Confirmed CGPA
            </p>
            <p className="text-4xl font-black tabular-nums">{fmt2(record.cgpa)}</p>
          </div>
          <div className="text-right text-xs text-slate-300">
            <p>{record.creditHours} graded credits</p>
            <p>{fmt2(record.points)} quality points</p>
            {record.pendingCount > 0 && (
              <p className="text-amber-300">
                ⏳ Result Pending · {d.pending.pendingCreditHours} cr excluded
              </p>
            )}
          </div>
        </div>
        {d.pending.pendingCreditHours > 0 && d.pending.bestCaseCgpa !== null && (
          <p className="mt-3 border-t border-white/10 pt-2 text-[11px] text-slate-300">
            Once released: projected CGPA{' '}
            <span className="font-bold text-red-300">
              {fmt2(d.pending.worstCaseCgpa)}
            </span>{' '}
            (worst) to{' '}
            <span className="font-bold text-emerald-300">
              {fmt2(d.pending.bestCaseCgpa)}
            </span>{' '}
            (best). <span className="text-slate-400">Projection — not a grade.</span>
          </p>
        )}
      </Card>
    </div>
  );
}

function CurrentMode({ quick = false }: { quick?: boolean }) {
  const d = useDerived();
  const { state, dispatch, progress, curriculumPublished, grading } = d;
  const b = state.baseline;

  const levels =
    d.slots.length > 0
      ? Array.from(new Set(d.slots.map((s) => s.levelIndex))).sort((a, z) => a - z)
      : [1, 2, 3, 4, 5, 6];

  const creditsKnown = progress.hasCreditData && progress.completedCredits > 0;
  const cgpaError = validateGpa(b.cgpa, grading);
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <Card>
      <SectionTitle
        icon="⚡"
        title={quick ? 'Quick mode' : 'Your current standing'}
        subtitle={
          quick
            ? 'Just your current level and current CGPA — the configured curriculum works out the rest.'
            : 'Tell us your current level and CGPA — the configured curriculum supplies the credit structure.'
        }
      />

      <div className={`grid ${quick ? 'grid-cols-1' : 'grid-cols-2'} gap-3`}>
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
          <span className="label">Current CGPA</span>
          <input
            type="number"
            min={0}
            max={d.maxPoints}
            step={0.01}
            className={`input text-center text-lg font-black ${
              cgpaError ? 'ring-2 ring-red-300 focus:ring-red-400' : ''
            }`}
            placeholder={`0.00–${d.maxPoints.toFixed(2)}`}
            value={b.cgpa ?? ''}
            onChange={(e) =>
              dispatch({
                type: 'setBaseline',
                patch: { cgpa: e.target.value === '' ? null : Number(e.target.value) },
              })
            }
          />
          {cgpaError && (
            <span className="mt-1 block text-center text-[10px] font-semibold text-red-600">
              {cgpaError}
            </span>
          )}
        </label>
      </div>

      {/* The curriculum fills in the academic trajectory automatically. */}
      {creditsKnown && (
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-xl bg-slate-50 p-2 ring-1 ring-slate-100">
            <p className="font-black text-slate-800">{progress.completedCredits}</p>
            <p className="text-slate-500">credits completed</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-2 ring-1 ring-slate-100">
            <p className="font-black text-brand-700">{progress.remainingCredits}</p>
            <p className="text-slate-500">credits remaining</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-2 ring-1 ring-slate-100">
            <p className="font-black text-slate-800">{progress.remainingSlots.length}</p>
            <p className="text-slate-500">semesters to go</p>
          </div>
        </div>
      )}

      {quick ? (
        <Note>
          {curriculumPublished
            ? `That's all we need — credit structure and trajectory come from the ${d.programme?.shortName ?? 'PharmD'} curriculum. Individual course grades are never required or inferred.`
            : 'The curriculum has not been published yet — your level and CGPA still work; the administrator supplies real credit structure.'}
          {' '}
          <button
            onClick={() => setShowAdvanced((v) => !v)}
            className="font-bold text-brand-600 underline"
          >
            {showAdvanced ? 'Hide' : 'Advanced'} options
          </button>
        </Note>
      ) : null}

      {/* Advanced details: last semester, manual credits, pending results. */}
      {(showAdvanced || !quick) && (
        <div className="mt-3 space-y-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100">
          <div className="grid grid-cols-2 gap-3">
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

          <label className="block">
            <span className="label">
              ⏳ Pending-result credits (results not yet released)
            </span>
            <input
              type="number"
              min={0}
              className="input text-center text-lg font-black"
              placeholder="0"
              value={b.pendingCreditHours || ''}
              onChange={(e) =>
                dispatch({
                  type: 'setBaseline',
                  patch: {
                    pendingCreditHours: Math.max(0, Number(e.target.value) || 0),
                  },
                })
              }
            />
            <span className="mt-1 block text-[10px] text-slate-400">
              Your CGPA above reflects released results only. Pending credits
              are excluded and used solely for projections.
            </span>
          </label>
        </div>
      )}
    </Card>
  );
}

/**
 * MODE C — Planning mode. Current CGPA, a target classification, and future
 * GPA scenarios. Reuses the current-CGPA baseline and the projection engine;
 * all inputs are temporary and stay on this device.
 */
function PlanningMode() {
  const d = useDerived();
  const { state, dispatch, grading, classification, progress, record } = d;
  const [futureGpa, setFutureGpa] = useState<number>(4.0);
  const target = state.targetCgpa ?? 3.6;

  const remainingCredits =
    progress.hasCreditData && state.mode === 'current'
      ? progress.remainingCredits
      : Math.max(0, d.totalProgrammeCredits - record.creditHours);

  const futureError = validateGpa(futureGpa, grading);
  const futureValid = !futureError && remainingCredits > 0 && record.cgpa !== null;

  const projectedFinal = futureValid
    ? (record.points + futureGpa * remainingCredits) /
      (record.creditHours + remainingCredits)
    : null;

  const required = futureValid
    ? (target * (record.creditHours + remainingCredits) - record.points) /
      remainingCredits
    : null;

  const maxFinal =
    record.cgpa !== null && remainingCredits > 0
      ? (record.points + d.maxPoints * remainingCredits) /
        (record.creditHours + remainingCredits)
      : null;

  return (
    <>
      <Card>
        <SectionTitle
          icon="🗺️"
          title="Planning mode"
          subtitle="Where are you, where do you want to finish, and what future GPA gets you there?"
        />

        <label className="block">
          <span className="label">Current CGPA</span>
          <input
            type="number"
            min={0}
            max={d.maxPoints}
            step={0.01}
            className={`input text-center text-lg font-black ${
              validateGpa(state.baseline.cgpa, grading)
                ? 'ring-2 ring-red-300'
                : ''
            }`}
            placeholder={`0.00–${d.maxPoints.toFixed(2)}`}
            value={state.baseline.cgpa ?? ''}
            onChange={(e) =>
              dispatch({
                type: 'setBaseline',
                patch: { cgpa: e.target.value === '' ? null : Number(e.target.value) },
              })
            }
          />
          {validateGpa(state.baseline.cgpa, grading) && (
            <span className="mt-1 block text-center text-[10px] font-semibold text-red-600">
              {validateGpa(state.baseline.cgpa, grading)}
            </span>
          )}
        </label>

        <div className="mt-3">
          <span className="label">Target classification</span>
          <div className="flex flex-wrap gap-2">
            {classification.bands
              .filter((b) => b.minCgpa > 0)
              .map((b) => (
                <button
                  key={b.id}
                  onClick={() => dispatch({ type: 'setTarget', target: b.minCgpa })}
                  className={`rounded-full px-3 py-1.5 text-[11px] font-bold ring-1 transition ${
                    target >= b.minCgpa && target <= b.maxCgpa
                      ? 'bg-brand-600 text-white ring-brand-600'
                      : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {b.label.split('(')[0].trim()} ({b.minCgpa.toFixed(1)})
                </button>
              ))}
          </div>
        </div>

        <label className="mt-3 block">
          <span className="label">Future GPA scenario (semesters ahead)</span>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={d.maxPoints}
              step={0.05}
              value={Math.min(futureGpa, d.maxPoints)}
              onChange={(e) => setFutureGpa(Number(e.target.value))}
              className="flex-1 accent-brand-600"
            />
            <span className="w-16 rounded-xl bg-brand-600 py-2 text-center text-lg font-black text-white">
              {futureGpa.toFixed(2)}
            </span>
          </div>
          {futureError && (
            <span className="mt-1 block text-[10px] font-semibold text-red-600">
              {futureError}
            </span>
          )}
        </label>
      </Card>

      {record.cgpa === null ? (
        <Note>Enter your current CGPA above to see your projected finish.</Note>
      ) : remainingCredits <= 0 ? (
        <Note>
          {d.curriculumPublished
            ? 'No future credits are configured beyond your current point. Publish more of the curriculum to see full scenarios.'
            : 'The programme curriculum has not been published yet, so the number of future credits is unknown. Scenarios become precise once the administrator publishes real courses. Your current CGPA is recorded above.'}
        </Note>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Card className="text-center">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Projected final CGPA
              </p>
              <p className="mt-1 text-3xl font-black text-brand-700">
                {fmt2(projectedFinal)}
              </p>
              <p className="text-[10px] text-slate-500">
                if you average {futureGpa.toFixed(2)} over {remainingCredits} remaining cr
              </p>
            </Card>
            <Card className="text-center">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Best possible finish
              </p>
              <p className="mt-1 text-3xl font-black text-emerald-600">
                {fmt2(maxFinal)}
              </p>
              <p className="text-[10px] text-slate-500">
                straight {d.maxPoints.toFixed(2)} from here
              </p>
            </Card>
          </div>

          <Card
            className={
              required !== null && required <= d.maxPoints + 1e-9
                ? 'bg-emerald-50 ring-emerald-200'
                : 'bg-red-50 ring-red-200'
            }
          >
            <p className="text-sm font-bold text-slate-800">
              {required !== null && required <= 0
                ? `✅ You'll clear ${fmt2(target)} even with a 0.00 average from here.`
                : required !== null && required <= d.maxPoints + 1e-9
                  ? `🟢 Reachable — average about ${fmt2(required)} over your remaining ${remainingCredits} credits to finish at ${fmt2(target)}.`
                  : `🔴 ${fmt2(target)} isn't reachable on remaining credits alone — best possible is ${fmt2(maxFinal)}.`}
            </p>
          </Card>
        </>
      )}
    </>
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
            className={`flex h-[38px] items-center justify-center rounded-xl px-1 text-[11px] font-black ${
              course.pending
                ? 'bg-amber-200 text-amber-800'
                : !grade
                  ? 'bg-slate-200 text-slate-400'
                  : band?.points === 0 ||
                      (course.grade &&
                        grading.bands.find((b) => b.grade === course.grade)?.points === 0)
                    ? 'bg-red-100 text-red-700'
                    : 'bg-brand-100 text-brand-700'
            }`}
            title={course.pending ? 'Result Pending — not a grade' : undefined}
          >
            {course.pending ? 'Pending' : grade ?? '—'}
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
            aria-label={course.pending ? `Mark ${course.code || 'course'} results as released` : `Mark ${course.code || 'course'} results as pending`}
            title={course.pending ? 'Mark results as released' : 'Results not yet available (pending)'}
          >
            ⏳
          </button>
          <button
            onClick={() => dispatch({ type: 'removeCourse', semesterId, courseId: course.id })}
            className="text-sm text-red-400 hover:text-red-600"
            aria-label={`Remove course ${course.code || ''}`.trim()}
            title="Remove course"
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
