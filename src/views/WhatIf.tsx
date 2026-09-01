import { useMemo, useState } from 'react';
import { useDerived } from '../state/derived';
import { Card, SectionTitle, Note } from '../components/ui';
import {
  collectPending,
  runWhatIf,
  futureScenario,
  scenarioPresets,
  type FutureScenario,
} from '../services/scenarioService';
import { analyzeTarget } from '../services/targetService';
import { progressThrough } from '../services/structureService';
import type { CourseEntry } from '../state/studentState';
import { fmt2, clamp } from '../util/format';

const VERDICT_TONE: Record<string, string> = {
  'meets-target': 'text-emerald-700',
  reachable: 'text-emerald-700',
  'very-demanding': 'text-amber-600',
  'extremely-demanding': 'text-orange-600',
  impossible: 'text-red-600',
  unknown: 'text-slate-400',
};

/**
 * What-If simulator — a fully local scratchpad. Future-GPA scenarios and
 * assumed grades live in component state only; the confirmed record is never
 * mutated, nothing is saved or sent, and no individual course grades are
 * inferred (an aggregate GPA only).
 */
export function WhatIf() {
  const d = useDerived();
  const { record, grading, classification, state, progress } = d;
  const target = state.targetCgpa ?? 3.6;

  // ── Future credit context (curriculum-driven when available) ──────────
  const nextCreditsDefault = useMemo(() => {
    if (state.mode === 'current') return progress.remainingSlots[0]?.credits || 18;
    const last = state.semesters[state.semesters.length - 1];
    if (last && d.curriculum) {
      const rem = progressThrough(
        d.curriculum,
        last.levelIndex,
        last.semesterIndex
      ).remainingSlots;
      if (rem[0]?.credits) return rem[0].credits;
    }
    return state.plannedNextCreditHours || 18;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.mode, state.semesters, progress.remainingSlots, d.curriculum]);

  const remainingDefault =
    state.mode === 'current' && progress.hasCreditData
      ? progress.remainingCredits
      : Math.max(0, d.totalProgrammeCredits - record.creditHours);

  const [futureCredits, setFutureCredits] = useState<number | null>(null);
  const [customGpa, setCustomGpa] = useState<number | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const ncr = futureCredits ?? nextCreditsDefault;
  const rem = remaining ?? remainingDefault;

  // Required future GPA (drives the "Target" preset).
  const analysis = useMemo(
    () =>
      analyzeTarget(
        {
          currentPoints: record.points,
          creditsCompleted: record.creditHours,
          creditsRemaining: rem,
          targetCgpa: target,
          currentCgpa: record.cgpa,
        },
        grading,
        classification
      ),
    [record.points, record.creditHours, rem, target, record.cgpa, grading, classification]
  );

  const presets = useMemo(
    () => scenarioPresets(grading, record.cgpa, analysis.requiredFutureGpa),
    [grading, record.cgpa, analysis.requiredFutureGpa]
  );

  const activeCustom = customGpa ?? presets[1].gpa;

  const scenarios: FutureScenario[] = useMemo(() => {
    const mk = (futureGpa: number, label?: string) =>
      futureScenario(
        {
          currentPoints: record.points,
          currentCredits: record.creditHours,
          currentCgpa: record.cgpa,
          futureCredits: ncr,
          futureGpa,
          remainingCredits: rem,
          targetCgpa: target,
          label,
        },
        grading,
        classification
      );
    return [
      mk(presets[0].gpa, presets[0].label),
      mk(presets[1].gpa, presets[1].label),
      mk(presets[2].gpa, presets[2].label),
      mk(activeCustom, `What if next GPA is ${activeCustom.toFixed(2)}?`),
    ];
  }, [
    record.points,
    record.creditHours,
    record.cgpa,
    ncr,
    rem,
    target,
    grading,
    classification,
    presets,
    activeCustom,
  ]);

  function reset() {
    setCustomGpa(null);
    setFutureCredits(null);
    setRemaining(null);
    // Remounting the pending-grades card clears its component-local scenario.
    setResetKey((k) => k + 1);
  }

  const noData = record.cgpa === null;

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle
          icon="🔀"
          title="What-If Simulator"
          subtitle="Try a future GPA — “what if my next GPA is 3.0 / 3.5 / 4.0?” This never changes your confirmed calculation, is never saved, and never invents individual grades."
        />

        {/* Print-only header */}
        <div className="print-only">
          <p className="text-lg font-black text-slate-900">CGPA Pilot — What-If Scenario</p>
          <p className="text-xs text-slate-500">
            {d.institutionLabel} · {new Date().toLocaleDateString()} ·
            Scenarios are projections, not guaranteed outcomes.
          </p>
        </div>

        {noData && (
          <Note>
            Enter your current CGPA on the Calculate tab (Quick or GPA History
            mode) first — the simulator projects from your confirmed position.
          </Note>
        )}

        {/* ── Controls (not printed) ─────────────────────────────────── */}
        <div className="no-print mt-2 space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="label">Next-period credits</span>
              <input
                type="number"
                min={1}
                max={40}
                className="input text-center text-lg font-black"
                value={futureCredits ?? ncr}
                onChange={(e) =>
                  setFutureCredits(
                    e.target.value === '' ? null : Math.max(1, Number(e.target.value) || 1)
                  )
                }
              />
            </label>
            <label className="block">
              <span className="label">Remaining to graduation</span>
              <input
                type="number"
                min={0}
                max={400}
                className="input text-center text-lg font-black"
                value={remaining ?? rem}
                onChange={(e) =>
                  setRemaining(
                    e.target.value === '' ? null : Math.max(0, Number(e.target.value) || 0)
                  )
                }
              />
            </label>
            <label className="block col-span-2 sm:col-span-1">
              <span className="label">What if my next GPA is: {activeCustom.toFixed(2)}</span>
              <input
                type="range"
                min={0}
                max={d.maxPoints}
                step={0.05}
                value={clamp(activeCustom, 0, d.maxPoints)}
                onChange={(e) => setCustomGpa(Number(e.target.value))}
                className="mt-4 w-full accent-brand-600"
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            {[3.0, 3.5, 4.0].map((v) => (
              <button
                key={v}
                onClick={() => setCustomGpa(Math.min(v, d.maxPoints))}
                className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-200"
                title={`What if it is ${v.toFixed(1)}?`}
              >
                What if it is {v.toFixed(1)}?
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* ── Scenario comparison (printable) ──────────────────────────── */}
      <Card className="print-sheet">
        <div className="no-print mb-2 flex items-center justify-between">
          <h3 className="text-sm font-extrabold text-slate-800">Compare scenarios</h3>
          <div className="flex gap-2">
            <button
              onClick={() => window.print()}
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-brand-700"
            >
              🖨️ Print Scenario
            </button>
            <button
              onClick={reset}
              className="rounded-lg bg-slate-100 px-3 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-slate-200"
            >
              ↺ Reset Scenario
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-[10px] uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-2">Scenario</th>
                <th className="py-2 pr-2 text-right">Next GPA</th>
                <th className="py-2 pr-2 text-right">Projected CGPA</th>
                <th className="py-2 pr-2 text-right">Δ vs now</th>
                <th className="py-2 pr-2 text-right">Δ vs target</th>
                <th className="py-2 pr-2 text-right">Final if held</th>
                <th className="py-2 pr-2 text-right">Target feasibility</th>
              </tr>
            </thead>
            <tbody>
              {scenarios.map((s) => (
                <tr key={s.label} className="border-b border-slate-100">
                  <td className="py-2 pr-2 font-bold text-slate-700">
                    {s.label}
                    <span className="block text-[10px] font-medium text-slate-400">
                      {s.futureCredits} cr next period
                    </span>
                  </td>
                  <td className="py-2 pr-2 text-right font-black tabular-nums">{fmt2(s.projectedSemesterGpa)}</td>
                  <td className="py-2 pr-2 text-right font-black tabular-nums text-brand-700">
                    {fmt2(s.projectedCgpa)}
                    {s.classification && (
                      <span className="block text-[9px] font-semibold text-slate-400">
                        {s.classification.label.split('(')[0].trim()}
                      </span>
                    )}
                  </td>
                  <td className={`py-2 pr-2 text-right font-bold tabular-nums ${s.differenceFromCurrent !== null && s.differenceFromCurrent < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                    {s.differenceFromCurrent === null ? '—' : `${s.differenceFromCurrent >= 0 ? '+' : ''}${fmt2(s.differenceFromCurrent)}`}
                  </td>
                  <td className={`py-2 pr-2 text-right font-bold tabular-nums ${s.differenceFromTarget !== null && s.differenceFromTarget < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                    {s.differenceFromTarget === null ? '—' : `${s.differenceFromTarget >= 0 ? '+' : ''}${fmt2(s.differenceFromTarget)}`}
                  </td>
                  <td className="py-2 pr-2 text-right font-bold tabular-nums text-slate-700">
                    {fmt2(s.trajectoryFinalCgpa)}
                  </td>
                  <td className={`py-2 pr-2 text-right font-bold ${VERDICT_TONE[s.targetStatus]}`}>
                    {s.targetStatusLabel}
                    {s.requiredFutureGpaAfter !== null &&
                      s.targetStatus !== 'meets-target' &&
                      s.targetStatus !== 'impossible' && (
                        <span className="block text-[9px] font-semibold text-slate-400">
                          need {fmt2(s.requiredFutureGpaAfter)} after
                        </span>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-2 rounded-lg bg-slate-50 px-2 py-1.5 text-[10px] leading-relaxed text-slate-500 ring-1 ring-slate-100">
          Projected CGPA is your confirmed CGPA blended with the hypothetical
          next period (credit-weighted). “Final if held” extrapolates the same
          average over all {rem} remaining credits. Scenarios are projections
          over results not yet earned — not guaranteed outcomes. No individual
          course grades are inferred.
        </p>
      </Card>

      <PendingGradesCard key={resetKey} />
    </div>
  );
}

/**
 * The pending-course grade scratchpad (Prompt 7). Kept as a secondary,
 * non-printing card: assume a grade for pending results or add hypothetical
 * courses. Component-local state only.
 */
function PendingGradesCard() {
  const d = useDerived();
  const { record, grading, classification } = d;

  const pendingCourses = useMemo(
    () => collectPending(d.state.semesters),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [d.state.semesters]
  );

  const [assumed, setAssumed] = useState<Record<string, string>>({});
  const [hypothetical, setHypothetical] = useState<CourseEntry[]>([]);

  function setGrade(id: string, grade: string) {
    setAssumed((g) => ({ ...g, [id]: g[id] === grade ? '' : grade }));
  }
  function addHypo() {
    setHypothetical((cs) => [
      ...cs,
      {
        id: Math.random().toString(36).slice(2, 9),
        code: '',
        name: '',
        creditHours: 3,
        score: null,
        grade: null,
        pending: false,
      },
    ]);
  }
  function patchHypo(id: string, patch: Partial<CourseEntry>) {
    setHypothetical((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  const result = runWhatIf(
    {
      basePoints: record.points,
      baseCreditHours: record.creditHours,
      assumedGrades: assumed,
      pendingCourses,
      hypothetical: hypothetical.map((c) => ({
        creditHours: c.creditHours,
        grade: c.grade,
      })),
    },
    grading,
    classification
  );

  if (pendingCourses.length === 0) return null;

  return (
    <Card className="no-print">
      <SectionTitle
        icon="⏳"
        title="Assume grades for pending results"
        subtitle="Trial a grade for each pending course — your confirmed record is untouched and nothing is saved."
      />
      <div className="space-y-2">
        {pendingCourses.map((c) => (
          <div key={c.id} className="rounded-xl border border-amber-200 bg-amber-50/50 p-2.5">
            <div className="text-xs font-semibold text-slate-700">
              {c.code || 'Course'} {c.name ? `· ${c.name}` : ''}
              <span className="ml-1 text-slate-400">
                ({c.creditHours} cr · {c.semesterLabel})
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {grading.bands.map((b) => (
                <button
                  key={b.grade}
                  onClick={() => setGrade(c.id, b.grade)}
                  className={`rounded-md px-2 py-1 text-xs font-bold ring-1 transition ${
                    assumed[c.id] === b.grade
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
        ))}
      </div>

      {/* Optional: a hypothetical future semester built course-by-course. */}
      <details className="mt-3 group">
        <summary className="cursor-pointer text-[11px] font-bold text-slate-500 hover:text-brand-600">
          ▸ Or build a hypothetical semester course-by-course
        </summary>
        <div className="mt-2 space-y-2">
          {hypothetical.map((c) => (
            <div
              key={c.id}
              className="grid grid-cols-12 items-center gap-2 rounded-xl border border-slate-200 p-2"
            >
              <input
                className="input col-span-5"
                placeholder="Course (optional)"
                value={c.name}
                onChange={(e) => patchHypo(c.id, { name: e.target.value })}
              />
              <input
                type="number"
                min={1}
                max={12}
                className="input col-span-2 text-center"
                value={c.creditHours}
                onChange={(e) =>
                  patchHypo(c.id, {
                    creditHours: Math.max(1, Number(e.target.value) || 1),
                  })
                }
              />
              <select
                className="input col-span-4 text-center font-bold"
                value={c.grade ?? ''}
                onChange={(e) => patchHypo(c.id, { grade: e.target.value || null })}
              >
                <option value="">Grade…</option>
                {grading.bands.map((b) => (
                  <option key={b.grade} value={b.grade}>
                    {b.grade} ({b.points})
                  </option>
                ))}
              </select>
              <button
                onClick={() => setHypothetical((cs) => cs.filter((x) => x.id !== c.id))}
                className="col-span-1 text-right text-red-400 hover:text-red-600"
              >
                ✕
              </button>
            </div>
          ))}
          <button onClick={addHypo} className="w-full rounded-lg border border-dashed border-slate-300 py-1.5 text-[11px] font-bold text-slate-500 hover:border-brand-400 hover:text-brand-600">
            ＋ Add hypothetical course
          </button>
        </div>
      </details>

      <Card className="mt-3 bg-slate-900 text-white ring-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
              If these grades land
            </p>
            <p className="text-4xl font-black tabular-nums text-amber-300">
              {fmt2(result.scenarioCgpa)}
            </p>
          </div>
          <div className="text-right text-xs text-slate-300">
            <p>
              Now <strong className="text-white">{fmt2(record.cgpa)}</strong> → scenario
            </p>
            <p>
              +{result.addedCreditHours} credits · +{fmt2(result.addedPoints)} points
            </p>
            {result.classification && (
              <p className="mt-1 rounded-full bg-white/10 px-3 py-1 font-bold">
                {result.classification.label}
              </p>
            )}
          </div>
        </div>
      </Card>
    </Card>
  );
}
