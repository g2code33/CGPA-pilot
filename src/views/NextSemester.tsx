import { useMemo, useRef, useState } from 'react';
import { useDerived } from '../state/derived';
import { Card, SectionTitle, Note } from '../components/ui';
import {
  nextSemesterAfter,
  planNextSemester,
  whatIfGrades,
} from '../services/nextSemesterService';
import { classifyCgpa } from '../services/classificationService';
import { printSection } from '../services/scopedPrint';
import { fmt2 } from '../util/format';

const STATUS_TONE: Record<string, string> = {
  'on-track': 'bg-emerald-50 ring-emerald-300 text-emerald-800',
  'already-above': 'bg-sky-50 ring-sky-300 text-sky-800',
  impossible: 'bg-red-50 ring-red-300 text-red-800',
  'no-data': 'bg-slate-100 ring-slate-200 text-slate-600',
};

export function NextSemester() {
  const d = useDerived();
  const { record, grading, classification, state, progress } = d;
  const target = state.targetCgpa ?? 3.6;

  const [comboId, setComboId] = useState<'efficient' | 'balanced' | 'top'>('efficient');
  const [locked, setLocked] = useState<Record<string, string>>({});
  const [showWhatIf, setShowWhatIf] = useState(false);
  const planRef = useRef<HTMLDivElement>(null);
  const printPlan = () =>
    printSection(planRef.current, {
      title: 'Print Next Semester Plan',
      institutionLabel: d.institutionLabel,
      programmeName: d.programme?.name ?? '',
      curriculumVersion: d.curriculum?.versionName,
    });

  // Current position → next semester.
  const position = useMemo(() => {
    if (state.mode === 'current') {
      return { level: state.baseline.levelIndex, sem: state.baseline.semesterIndex };
    }
    const last = state.semesters[state.semesters.length - 1];
    return last
      ? { level: last.levelIndex, sem: last.semesterIndex }
      : { level: 1, sem: 1 };
  }, [state.mode, state.baseline.levelIndex, state.baseline.semesterIndex, state.semesters]);

  const next = useMemo(
    () => nextSemesterAfter(d.curriculum, position.level, position.sem),
    [d.curriculum, position.level, position.sem]
  );

  const remainingCredits =
    state.mode === 'current' && progress.hasCreditData
      ? progress.remainingCredits
      : Math.max(0, d.totalProgrammeCredits - record.creditHours);

  const plan = useMemo(
    () =>
      planNextSemester(
        {
          currentPoints: record.points,
          currentCredits: record.creditHours,
          currentCgpa: record.cgpa,
          remainingCredits,
          targetCgpa: target,
          next,
          fallbackCredits: state.plannedNextCreditHours || 18,
          curriculumPublished: d.curriculumPublished && next.courses.length > 0,
        },
        grading,
        classification
      ),
    [
      record.points,
      record.creditHours,
      record.cgpa,
      remainingCredits,
      target,
      next,
      state.plannedNextCreditHours,
      d.curriculumPublished,
      grading,
      classification,
    ]
  );

  // What-if: locked grades + derived targets for the rest.
  const lockedCodes = Object.keys(locked);
  const whatIf = useMemo(() => {
    if (!showWhatIf || plan.requiredNextPoints === null) return null;
    return whatIfGrades(
      plan.next.courses,
      locked,
      grading,
      plan.requiredNextPoints
    );
  }, [showWhatIf, locked, plan, grading]);

  const activeCombo = plan.combos.find((c) => c.id === comboId) ?? plan.combos[0];
  const rows = showWhatIf && whatIf
    ? whatIf.assignments
    : activeCombo?.assignments ?? [];

  const projectedAfter =
    showWhatIf && whatIf
      ? (record.points + whatIf.totalPoints) / (record.creditHours + plan.next.credits)
      : plan.projectedCgpaAfter;
  const projectedClass = classifyCgpa(projectedAfter, classification);

  function reset() {
    setLocked({});
    setShowWhatIf(false);
  }

  return (
    <div className="space-y-4">
      {/* ── YOUR NEXT MISSION ─────────────────────────────────────────── */}
      <Card className="bg-gradient-to-br from-brand-700 via-brand-600 to-indigo-900 text-white ring-0">
        <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-brand-200">
          🧭 Your next mission
        </p>
        <div className="mt-2 grid grid-cols-3 gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-200">
              Next semester
            </p>
            <p className="text-sm font-black leading-tight">{next.label}</p>
            <p className="mt-0.5 text-[11px] text-brand-200">{plan.next.credits} credits</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-200">
              Required GPA
            </p>
            <p className="text-4xl font-black tabular-nums leading-none">
              {plan.requiredNextGpa === null ? '—' : fmt2(plan.requiredNextGpa)}
            </p>
            <p className="mt-0.5 text-[11px] text-brand-200">/ {plan.maxNextGpa.toFixed(2)}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-200">
              Target
            </p>
            <p className="text-sm font-black leading-tight">
              {plan.targetClassLabel}
            </p>
            <p className="mt-0.5 text-[11px] text-brand-200">{fmt2(target)}</p>
          </div>
        </div>
      </Card>

      {record.cgpa === null ? (
        <Card>
          <Note>Enter your current CGPA on the Calculate tab first — the pilot plans from where you are now.</Note>
        </Card>
      ) : (
        <>
          {/* Status line */}
          <div className={`rounded-2xl px-4 py-3 text-xs font-semibold ring-1 ${STATUS_TONE[plan.status]}`}>
            {plan.status === 'already-above' &&
              `You're already above your target — even modest results this semester keep a ${fmt2(target)} average in reach.`}
            {plan.status === 'on-track' &&
              `Aim for about ${fmt2(plan.requiredNextGpa)} this semester (${plan.next.credits} credits) to stay on the ${plan.targetClassLabel} trajectory; your CGPA then sits around ${fmt2(plan.projectedCgpaAfter)}.`}
            {plan.status === 'impossible' &&
              `Even a straight ${plan.maxNextGpa.toFixed(2)} semester can't protect a ${fmt2(target)} finish — the target is out of range on the credits that remain. Consider a nearby classification.`}
          </div>

          {/* ── Target-grade combinations ─────────────────────────────── */}
          <div ref={planRef}>
          <Card className="print-sheet">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-extrabold text-slate-800">🎯 Next semester — {next.label}</h3>
                <p className="text-[11px] text-slate-500">
                  Required GPA <strong className="text-brand-700">{fmt2(plan.requiredNextGpa)}</strong> · Target {plan.targetClassLabel} · Target grade combinations are mathematically derived from the configured grading and course credits.
                </p>
              </div>
            </div>

            {plan.combos.length > 0 && (
              <div className="no-print mb-3 flex flex-wrap gap-2">
                {plan.combos.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setComboId(c.id)}
                    className={`rounded-lg px-3 py-1.5 text-[11px] font-bold ring-1 transition ${
                      !showWhatIf && comboId === c.id
                        ? 'bg-brand-600 text-white ring-brand-600'
                        : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {c.label} · {c.semesterGpa.toFixed(2)}
                  </button>
                ))}
              </div>
            )}

            {activeCombo && (
              <p className="no-print mb-2 text-[11px] text-slate-500">
                {activeCombo.description}
              </p>
            )}

            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-[10px] uppercase tracking-wide text-slate-400">
                  <th className="py-1.5 pr-2">Course</th>
                  <th className="py-1.5 pr-2 text-right">Credits</th>
                  <th className="py-1.5 pr-2 text-right">Target grade</th>
                  <th className="no-print py-1.5 pr-2 text-right">Grade points</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  const isLocked = showWhatIf && !!locked[a.code];
                  return (
                    <tr key={a.code + a.name + a.grade} className="border-b border-slate-100">
                      <td className="py-2 pr-2 font-semibold text-slate-700">
                        {a.code}
                        {a.name && a.name !== 'Curriculum not published' && (
                          <span className="block text-[10px] font-normal text-slate-400">{a.name}</span>
                        )}
                        {isLocked && <span className="ml-1 text-[9px] font-bold text-brand-600">· your pick</span>}
                      </td>
                      <td className="py-2 pr-2 text-right tabular-nums">{a.creditHours}</td>
                      <td className={`py-2 pr-2 text-right font-black ${isLocked ? 'text-brand-700' : 'text-slate-900'}`}>
                        {a.grade}
                      </td>
                      <td className="no-print py-2 pr-2 text-right tabular-nums text-slate-500">
                        {a.points.toFixed(1)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] font-bold text-slate-600">
              <span>
                Semester average: <span className="text-brand-700">
                  {showWhatIf && whatIf ? whatIf.semesterGpa.toFixed(2) : activeCombo?.semesterGpa.toFixed(2)}
                </span>
              </span>
              <span>
                Projected CGPA after: <span className="text-brand-700">{fmt2(projectedAfter)}</span>
                {projectedClass && <span className="ml-1 text-slate-400">· {projectedClass.label}</span>}
              </span>
            </div>

            <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1.5 text-[10px] font-semibold text-amber-800 ring-1 ring-amber-200">
              These are planning targets, not predicted grades.
            </p>

            {!plan.curriculumPublished && plan.next.courses[0]?.name === 'Curriculum not published' && (
              <p className="no-print mt-2 text-[10px] text-slate-400">
                The published curriculum’s courses aren’t available yet, so the plan uses a single {plan.next.credits}-credit block. Publish the curriculum to see per-course target grades.
              </p>
            )}

            <div className="no-print mt-3 flex flex-wrap gap-2">
              <button
                onClick={() => setShowWhatIf((v) => !v)}
                className="rounded-lg bg-slate-100 px-3 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-200"
              >
                {showWhatIf ? '✕ Close what-if' : '🔀 What if I get a specific grade?'}
              </button>
              <button
                onClick={printPlan}
                className="rounded-lg bg-brand-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-brand-700"
              >
                🖨️ Print Next Semester Plan
              </button>
              {showWhatIf && lockedCodes.length > 0 && (
                <button
                  onClick={reset}
                  className="rounded-lg bg-white px-3 py-1.5 text-[11px] font-bold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
                >
                  ↺ Reset what-if
                </button>
              )}
            </div>
          </Card>
          </div>

          {/* ── What-if grade picker ─────────────────────────────────── */}
          {showWhatIf && whatIf && (
            <Card className="no-print">
              <SectionTitle
                icon="🔀"
                title="What if I get B+ in this course?"
                subtitle="Lock a grade for any course — the remaining target grades and the semester average recalculate instantly."
              />
              <div className="space-y-2">
                {plan.next.courses.map((c) => (
                  <div key={c.code} className="rounded-xl border border-slate-200 p-2.5">
                    <div className="text-xs font-semibold text-slate-700">
                      {c.code}
                      {c.name && <span className="ml-1 text-slate-400">· {c.name}</span>}
                      <span className="ml-1 text-slate-400">({c.creditHours} cr)</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {grading.bands.map((b) => (
                        <button
                          key={b.grade}
                          onClick={() =>
                            setLocked((l) => ({
                              ...l,
                              [c.code]: l[c.code] === b.grade ? '' : b.grade,
                            }))
                          }
                          className={`rounded-md px-2 py-1 text-xs font-bold ring-1 transition ${
                            locked[c.code] === b.grade
                              ? 'bg-brand-600 text-white ring-brand-600'
                              : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-100'
                          }`}
                          title={`${b.points} grade points`}
                        >
                          {b.grade}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className={`mt-3 rounded-xl px-3 py-2 text-xs font-bold ring-1 ${whatIf.clears ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-red-50 text-red-700 ring-red-200'}`}>
                {whatIf.clears
                  ? `✅ With your picks, the semester averages ${whatIf.semesterGpa.toFixed(2)} — enough to protect the ${fmt2(target)} trajectory.`
                  : `⚠️ Your picks average ${whatIf.semesterGpa.toFixed(2)} — short of the ${fmt2(plan.requiredNextGpa ?? 0)} required; the other courses would need to cover the gap, and even top grades may not.`}
              </div>
            </Card>
          )}

          <Note>
            Everything here is computed locally and works offline. Nothing is saved or sent.
          </Note>
        </>
      )}
    </div>
  );
}
