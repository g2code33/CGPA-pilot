import { useDerived } from '../state/derived';
import { Card, SectionTitle, Badge, Note } from '../components/ui';
import { bandForScore, courseGrade, coursePoints } from '../engine/grades';
import { fmt2 } from '../engine/format';
import type { CourseEntry } from '../engine/types';

export function Calculate() {
  const d = useDerived();
  const { state, dispatch, scale, record } = d;

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle
          icon="🧮"
          title="Calculate"
          subtitle="Everything is computed on this device. Nothing you type leaves the app or is stored."
        />

        {/* Mode switch */}
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
              Enter results semester by semester
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
              Start from your CGPA &amp; total credits
            </span>
          </button>
        </div>
      </Card>

      {state.mode === 'current' ? (
        <Card>
          <SectionTitle
            icon="📍"
            title="Your current standing"
            subtitle="From your transcript: overall CGPA and total credits earned so far."
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-bold uppercase text-slate-500">
                Current CGPA
              </label>
              <input
                type="number"
                min={0}
                max={4}
                step={0.01}
                className="input text-center text-lg font-black"
                placeholder="e.g. 3.42"
                value={state.baseline.cgpa ?? ''}
                onChange={(e) =>
                  dispatch({
                    type: 'setBaseline',
                    patch: {
                      cgpa: e.target.value === '' ? null : Number(e.target.value),
                    },
                  })
                }
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase text-slate-500">
                Total credits earned
              </label>
              <input
                type="number"
                min={0}
                className="input text-center text-lg font-black"
                placeholder="e.g. 64"
                value={state.baseline.credits || ''}
                onChange={(e) =>
                  dispatch({
                    type: 'setBaseline',
                    patch: { credits: Number(e.target.value) || 0 },
                  })
                }
              />
            </div>
          </div>
          <Note>
            Only the two numbers above are needed for projections. No course
            grades, names or transcript details are requested — and none are
            saved.
          </Note>
        </Card>
      ) : (
        <>
          {d.semesters.map(({ semester, totals }, idx) => (
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
                  <Badge tone={totals.cgpa === null ? 'gray' : totals.cgpa >= 3.6 ? 'gold' : totals.cgpa >= 3.0 ? 'green' : totals.cgpa >= 2.5 ? 'teal' : 'blue'}>
                    GPA {fmt2(totals.cgpa)}
                  </Badge>
                  <button
                    onClick={() => dispatch({ type: 'removeSemester', semesterId: semester.id })}
                    className="rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-bold text-red-600 hover:bg-red-100"
                    title="Remove semester"
                  >
                    🗑
                  </button>
                </div>
              </div>

              {/* Table head (desktop) */}
              <div className="mb-1 hidden grid-cols-12 gap-2 px-1 text-[10px] font-bold uppercase tracking-wide text-slate-400 sm:grid">
                <span className="col-span-4">Course</span>
                <span className="col-span-2">Code</span>
                <span className="col-span-1 text-center">Credits</span>
                <span className="col-span-2 text-center">Score</span>
                <span className="col-span-1 text-center">Grade</span>
                <span className="col-span-2 text-right">Points / Status</span>
              </div>

              <div className="space-y-2">
                {semester.courses.map((course) => (
                  <CourseRow
                    key={course.id}
                    semesterId={semester.id}
                    course={course}
                  />
                ))}
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <button
                  onClick={() => dispatch({ type: 'addCourse', semesterId: semester.id })}
                  className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200"
                >
                  ＋ Add course
                </button>
                <p className="text-[11px] text-slate-500">
                  {totals.credits} graded cr · {fmt2(totals.points)} pts
                  {totals.pendingCount > 0 &&
                    ` · ⏳ ${totals.pendingCount} pending (${totals.pendingCredits} cr)`}
                </p>
              </div>
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

      {/* Live CGPA read-out */}
      <Card className="bg-slate-900 text-white ring-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
              Cumulative Grade Point Average
            </p>
            <p className="text-4xl font-black tabular-nums">{fmt2(record.cgpa)}</p>
          </div>
          <div className="text-right text-xs text-slate-300">
            <p>{record.credits} graded credits</p>
            <p>{fmt2(record.points)} grade points</p>
            {record.pendingCount > 0 && (
              <p className="text-amber-300">
                ⏳ {record.pendingCount} pending · {record.pendingCredits} cr
              </p>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

function CourseRow({
  semesterId,
  course,
}: {
  semesterId: string;
  course: CourseEntry;
}) {
  const { dispatch, scale } = useDerived();

  const grade = courseGrade(course, scale);
  const points = coursePoints(course, scale);
  const band =
    course.score !== null && !Number.isNaN(course.score)
      ? bandForScore(course.score, scale)
      : null;

  const update = (patch: Partial<CourseEntry>) =>
    dispatch({ type: 'updateCourse', semesterId, courseId: course.id, patch });

  return (
    <div
      className={`rounded-xl border p-2.5 transition ${
        course.pending
          ? 'border-amber-300 bg-amber-50/60'
          : 'border-slate-200 bg-slate-50/60'
      }`}
    >
      <div className="grid grid-cols-12 items-end gap-2">
        <div className="col-span-7 sm:col-span-4">
          <label className="mb-0.5 block text-[10px] font-bold uppercase text-slate-400 sm:hidden">
            Course
          </label>
          <input
            className="input"
            placeholder="Course name (optional)"
            value={course.name}
            onChange={(e) => update({ name: e.target.value })}
          />
        </div>
        <div className="col-span-5 sm:col-span-2">
          <label className="mb-0.5 block text-[10px] font-bold uppercase text-slate-400 sm:hidden">
            Code
          </label>
          <input
            className="input"
            placeholder="Code"
            value={course.code}
            onChange={(e) => update({ code: e.target.value })}
          />
        </div>
        <div className="col-span-4 sm:col-span-1">
          <label className="mb-0.5 block text-[10px] font-bold uppercase text-slate-400 sm:hidden">
            Cr
          </label>
          <input
            type="number"
            min={1}
            max={12}
            className="input text-center"
            value={course.credits}
            onChange={(e) => update({ credits: Math.max(1, Number(e.target.value) || 1) })}
          />
        </div>
        <div className="col-span-4 sm:col-span-2">
          <label className="mb-0.5 block text-[10px] font-bold uppercase text-slate-400 sm:hidden">
            Score
          </label>
          <input
            type="number"
            min={0}
            max={100}
            disabled={course.pending}
            className="input text-center font-bold disabled:opacity-40"
            placeholder="—"
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
                : band?.points === 0 || (course.grade && scale.bands.find((b) => b.grade === course.grade)?.points === 0)
                  ? 'bg-red-100 text-red-700'
                  : 'bg-brand-100 text-brand-700'
            }`}
            title={band ? band.interpretation : ''}
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
            className={`rounded-lg px-2 py-1 text-[10px] font-bold ring-1 transition ${
              course.pending
                ? 'bg-amber-500 text-white ring-amber-500'
                : 'bg-white text-slate-500 ring-slate-300 hover:bg-amber-50 hover:text-amber-700'
            }`}
            title="Result not yet released"
          >
            ⏳ {course.pending ? 'Pending' : 'Pending?'}
          </button>
          <button
            onClick={() => dispatch({ type: 'removeCourse', semesterId, courseId: course.id })}
            className="text-sm text-red-400 hover:text-red-600"
            title="Remove course"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Grade quick-pick */}
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {scale.bands.map((b) => (
          <button
            key={b.grade}
            disabled={course.pending}
            onClick={() =>
              update({
                grade: course.grade === b.grade ? null : b.grade,
                score: null,
              })
            }
            className={`rounded-md px-2 py-0.5 text-[11px] font-bold ring-1 transition disabled:opacity-40 ${
              course.grade === b.grade
                ? 'bg-brand-600 text-white ring-brand-600'
                : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-100'
            }`}
            title={`${b.points} pts — ${b.interpretation ?? ''}`}
          >
            {b.grade}
          </button>
        ))}
      </div>
    </div>
  );
}
