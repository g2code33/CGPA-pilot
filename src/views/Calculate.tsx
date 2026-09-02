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
    <div className="space-y-3 sm:space-y-4">
      <Card>
        <SectionTitle
          icon="🧮"
          title=""
          subtitle={<span className="text-red-600">Everything is computed on this device. Nothing you type leaves the app or is stored.</span>} className="text-red-600"
        />

        <div className="flex gap-2">
          <button
            onClick={() => window.history.back()}
            className="rounded-xl bg-slate-200 px-4 py-2.5 text-xs font-black text-slate-700 ring-1 ring-slate-300 hover:bg-slate-300 transition"
          >◀ Back</button>
          <button
            onClick={() => dispatch({ type: 'setInputMode', inputMode: state.inputMode === 'quick' ? 'history' : 'quick' })}
            className="rounded-lg bg-brand-600 px-2 py-1.5 text-[10px] font-black text-white shadow-sm hover:bg-brand-700 transition"
          >
            {state.inputMode === 'quick' ? '📚 Switch to CGPA History' : '⚡ Switch to Quick Mode'}
          </button>
        </div>
      </Card>

      {state.inputMode === 'planning' ? (
        <Mode />
      ) : state.inputMode === 'quick' ? (
        <CurrentMode quick />
      ) : (
        <>
          <Card>
            <SectionTitle icon="📚" title="History" subtitle="First tell your current standing. Then enter your confirmed CGPA per completed level." />
            <div className="rounded-xl bg-brand-50/60 p-3 ring-1 ring-brand-100 mb-2">
        <p className="text-[9px] sm:text-[10px] font-black uppercase tracking-wide text-brand-600 mb-2">Status</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => dispatch({ type: 'setBaseline', patch: { justEntered: false, pendingCreditHours: 0 } })} className="flex-1 rounded-lg px-2 py-2 text-[9px] sm:text-[10px] font-black bg-emerald-600 text-white hover:bg-emerald-700 transition shadow-sm">✅ Released</button>
          <button type="button" onClick={() => dispatch({ type: 'setBaseline', patch: { justEntered: false, pendingCreditHours: 18 } })} className="flex-1 rounded-lg px-2 py-2 text-[9px] sm:text-[10px] font-black bg-amber-500 text-white hover:bg-amber-600 transition shadow-sm">⏳ Pending</button>
          <button type="button" onClick={() => dispatch({ type: 'setBaseline', patch: { justEntered: !state.baseline.justEntered, pendingCreditHours: state.baseline.justEntered ? 0 : 0 } })} className="flex-1 rounded-lg px-2 py-2 text-[9px] sm:text-[10px] font-black bg-brand-600 text-white hover:bg-brand-700 transition shadow-sm">{state.baseline.justEntered ? '✓ NEW' : '🆕 NEW'}</button>
        </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="block rounded-xl bg-white p-3 ring-1 ring-brand-200 shadow-sm">
                  <span className="label text-[9px] sm:text-[10px] font-black uppercase tracking-wide">Current level</span>
                  <select className="input w-full" value={state.baseline.levelIndex} onChange={(e) => dispatch({ type: 'setBaseline', patch: { levelIndex: Number(e.target.value), semesterIndex: 1 } })}>
                    {[1,2,3,4,5,6].map((lv) => (<option key={lv} value={lv}>Level {lv*100}</option>))}
                  </select>
                </label>
                <label className="block rounded-xl bg-white p-3 ring-1 ring-brand-200 shadow-sm">
                  <span className="label text-[9px] sm:text-[10px] font-black uppercase tracking-wide">Current semester</span>
                  <select className="input w-full" value={state.baseline.semesterIndex} onChange={(e) => dispatch({ type: 'setBaseline', patch: { semesterIndex: Number(e.target.value) } })}>
                    <option value={1}>First</option><option value={2}>Second</option>
                  </select>
                </label>
                <label className="block rounded-xl bg-white p-3 ring-1 ring-brand-200 shadow-sm">
                  <span className="label text-[9px] sm:text-[10px] font-black uppercase tracking-wide">Status</span>
                  <div className="flex gap-2 mt-1.5">
                    <button type="button" disabled={!!state.baseline.justEntered} onClick={() => dispatch({ type: 'setBaseline', patch: { justEntered: false, pendingCreditHours: 0 } })} className={`flex-1 rounded-lg px-2 py-1.5 text-[9px] sm:text-[10px] font-black transition shadow-sm ${state.baseline.justEntered ? 'opacity-30 cursor-not-allowed bg-slate-200 text-slate-400' : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}>✅ Released</button>
                    <button type="button" disabled={!!state.baseline.justEntered} onClick={() => dispatch({ type: 'setBaseline', patch: { justEntered: false, pendingCreditHours: 18 } })} className={`flex-1 rounded-lg px-2 py-1.5 text-[9px] sm:text-[10px] font-black transition shadow-sm ${state.baseline.justEntered ? 'opacity-30 cursor-not-allowed bg-slate-200 text-slate-400' : 'bg-amber-500 text-white hover:bg-amber-600'}`}>⏳ Pending</button>
                    <button type="button" onClick={() => dispatch({ type: 'setBaseline', patch: { justEntered: !state.baseline.justEntered, pendingCreditHours: state.baseline.justEntered ? 0 : 0 } })} className={`flex-1 rounded-lg px-2 py-1.5 text-[9px] sm:text-[10px] font-black transition shadow-sm ring-1 ring-brand-200 ${state.baseline.justEntered ? 'bg-brand-300 text-brand-800 hover:bg-brand-400' : 'bg-brand-600 text-white hover:bg-brand-700'}`}>{state.baseline.justEntered ? '✓ NEW' : '🆕 NEW'}</button>
                  </div>
                </label>
              </div>
            </div>
            <div className="space-y-2">
              <span className="label text-[9px] sm:text-[10px] font-black uppercase tracking-wide">Enter confirmed CGPA per completed level</span>
              {(d.slots.length > 0 ? Array.from(new Set(d.slots.map((s) => s.levelIndex))).sort((a, z) => (a as number) - (z as number)).filter((lv) => lv <= state.baseline.levelIndex) : [1, 2, 3, 4, 5, 6].filter((lv) => lv <= state.baseline.levelIndex)).map((lv: number) => (
                <label key={lv} className="block rounded-xl bg-white p-3 ring-1 ring-slate-200 shadow-sm">
                  <span className="label">Level {lv * 100} CGPA</span>
                  <input type="number" min={0} max={d.maxPoints} step={0.01} className="input text-center text-lg font-black" placeholder={`0.00–${d.maxPoints.toFixed(2)}`} value={state.semesters.find((s) => s.levelIndex === lv)?.gpa ?? ''} onChange={(e) => { const val = e.target.value === '' ? null : Number(e.target.value); const existing = state.semesters.find((s) => s.levelIndex === lv); if (existing) { dispatch({ type: 'setSemesterGpa', semesterId: existing.id, gpa: val }); } else { dispatch({ type: 'addSemester' } as never); } }} />
                </label>
              ))}
            </div>
          </Card>
        </>      )}

      {d.pending.pendingCreditHours > 0 && (
        <PendingProjectionPanel pending={d.pending} target={state.targetCgpa} />
      )}

      <Card className="bg-slate-900 text-white ring-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[9px] sm:text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
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
          quick ? 'current level + current CGPA to begin' : 'enter each level CGPA for advance planning'
        }
      />

      <div className="rounded-xl bg-brand-50/60 p-3 ring-1 ring-brand-100 mb-2">
        <p className="text-[9px] sm:text-[10px] font-black uppercase tracking-wide text-brand-600 mb-2">Status</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => dispatch({ type: 'setBaseline', patch: { justEntered: false, pendingCreditHours: 0 } })} className="flex-1 rounded-lg px-2 py-2 text-[9px] sm:text-[10px] font-black bg-emerald-600 text-white hover:bg-emerald-700 transition shadow-sm">✅ Released</button>
          <button type="button" onClick={() => dispatch({ type: 'setBaseline', patch: { justEntered: false, pendingCreditHours: 18 } })} className="flex-1 rounded-lg px-2 py-2 text-[9px] sm:text-[10px] font-black bg-amber-500 text-white hover:bg-amber-600 transition shadow-sm">⏳ Pending</button>
          <button type="button" onClick={() => dispatch({ type: 'setBaseline', patch: { justEntered: !state.baseline.justEntered, pendingCreditHours: state.baseline.justEntered ? 0 : 0 } })} className="flex-1 rounded-lg px-2 py-2 text-[9px] sm:text-[10px] font-black bg-brand-600 text-white hover:bg-brand-700 transition shadow-sm">{state.baseline.justEntered ? '✓ NEW' : '🆕 NEW'}</button>
        </div>
        <p className="text-xs sm:text-sm font-black text-brand-800">Current standing</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 mt-2">
          <label className="block rounded-xl bg-white p-3 ring-1 ring-brand-200 shadow-sm">
            <span className="label text-[9px] sm:text-[10px] font-black uppercase tracking-wide">Current level</span>
            <select
              className="input w-full"
              value={b.levelIndex}
              onChange={(e) => {
                const lv = Number(e.target.value);
                dispatch({ type: 'setBaseline', patch: { levelIndex: lv, semesterIndex: 1 } });
              }}
            >
              {levels.map((lv) => (<option key={lv} value={lv}>Level {lv * 100}</option>))}
            </select>
          </label>
          <label className="block rounded-xl bg-white p-3 ring-1 ring-brand-200 shadow-sm">
            <span className="label text-[9px] sm:text-[10px] font-black uppercase tracking-wide">Semester</span>
            <select className="input w-full" value={b.semesterIndex} onChange={(e) => dispatch({ type: 'setBaseline', patch: { semesterIndex: Number(e.target.value) } })}>
              <option value={1}>First</option><option value={2}>Second</option>
            </select>
          </label>
        </div>
      </div>

      <div className={`grid ${quick ? 'grid-cols-1' : 'grid-cols-2'} gap-3`}>
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
          <button type="button" onClick={() => setShowAdvanced(!showAdvanced)} className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-black text-white shadow hover:bg-brand-700 transition">Advanced</button>
          {cgpaError && (
            <span className="mt-1 block text-center text-[9px] sm:text-[10px] font-semibold text-red-600">
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
            <p className="font-black text-brand-700">{b.justEntered ? progress.remainingCredits + (d.curriculum ? (d.slots.find((s) => s.levelIndex === b.levelIndex && s.semesterIndex === b.semesterIndex)?.credits ?? 0) : 0) : progress.remainingCredits}</p>
            <p className="text-slate-500">credits remaining</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-2 ring-1 ring-slate-100">
            <p className="font-black text-slate-800">{b.justEntered ? progress.remainingSlots.length + 1 : progress.remainingSlots.length}</p>
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
          <p className="text-xs font-black text-brand-800">⏳ Pending Results — select courses that are pending from the curriculum</p>
          <label className="block">
            <span className="label text-[9px] font-black uppercase tracking-wide">Pending result credits</span>
            <input
              type="number"
              min={0}
              className="input text-center text-lg font-black"
              placeholder="e.g. 18"
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
            <span className="mt-1 block text-[9px] text-slate-400">
              The administrator has set up the curriculum. Select how many credits have pending results.
            </span>
          </label>
        </div>
      )}
    </Card>
  );
}




function Mode() {
  const d = useDerived();
  const { state, dispatch, grading, classification, progress, record } = d;
  const [futureGpa, setFutureGpa] = useState<number>(4.0);
  const target = state.targetCgpa ?? 3.6;
  const remainingCredits = progress.hasCreditData && state.mode === 'current' ? progress.remainingCredits : Math.max(0, d.totalProgrammeCredits - record.creditHours);
  const futureError = validateGpa(futureGpa, grading);
  const futureValid = !futureError && remainingCredits > 0 && record.cgpa !== null;
  const projectedFinal = futureValid ? (record.points + futureGpa * remainingCredits) / (record.creditHours + remainingCredits) : null;
  const required = futureValid ? (target * (record.creditHours + remainingCredits) - record.points) / remainingCredits : null;
  const maxFinal = record.cgpa !== null && remainingCredits > 0 ? (record.points + d.maxPoints * remainingCredits) / (record.creditHours + remainingCredits) : null;
  return (
    <>
      <Card>
        <SectionTitle icon="🗺️" title=" mode" subtitle="Where are you, where do you want to finish, and what future GPA gets you there?" />
        <label className="block">
          <span className="label">Current CGPA</span>
          <input type="number" min={0} max={d.maxPoints} step={0.01} className={`input text-center text-lg font-black ${validateGpa(state.baseline.cgpa, grading) ? 'ring-2 ring-red-300' : ''}`} placeholder={`0.00–${d.maxPoints.toFixed(2)}`} value={state.baseline.cgpa ?? ''} onChange={(e) => dispatch({ type: 'setBaseline', patch: { cgpa: e.target.value === '' ? null : Number(e.target.value) } })} />
        </label>
        <div className="mt-3"><span className="label">Target classification</span><div className="flex flex-wrap gap-2">{classification.bands.filter((b) => b.minCgpa > 0).map((b) => (<button key={b.id} onClick={() => dispatch({ type: 'setTarget', target: b.minCgpa })} className={`rounded-full px-3 py-1.5 text-[11px] font-bold ring-1 transition ${target >= b.minCgpa && target <= b.maxCgpa ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'}`}>{b.label.split('(')[0].trim()} ({b.minCgpa.toFixed(1)})</button>))}</div></div>
        <label className="mt-3 block"><span className="label">Future GPA scenario</span><div className="flex items-center gap-3"><input type="range" min={0} max={d.maxPoints} step={0.05} value={Math.min(futureGpa, d.maxPoints)} onChange={(e) => setFutureGpa(Number(e.target.value))} className="flex-1 accent-brand-600" /><span className="w-16 rounded-xl bg-brand-600 py-2 text-center text-lg font-black text-white">{futureGpa.toFixed(2)}</span></div></label>
      </Card>
      <Card className={required !== null && required <= d.maxPoints + 1e-9 ? 'bg-emerald-50 ring-emerald-200' : 'bg-red-50 ring-red-200'}>
        <p className="text-sm font-bold text-slate-800">{required !== null && required <= 0 ? `You'll clear ${fmt2(target)} even with 0.00.` : required !== null && required <= d.maxPoints + 1e-9 ? `Reachable — average ${fmt2(required)} over ${remainingCredits} remaining credits.` : `Not reachable — best possible is ${fmt2(maxFinal)}.`}</p>
      </Card>
    </>
  );
}
