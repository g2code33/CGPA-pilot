import { useEffect, useMemo, useRef, useState } from 'react';
import { useDerived } from '../state/derived';
import { Card, SectionTitle, Note, Info, Th, tableStyles } from '../components/ui';
import { ideaTip } from '../infoTips';
import { permissionOn } from '../permissions';
import {
  nextSemesterAfter,
  planNextSemester,
  reshuffleSpace,
  whatIfGrades,
  type ShuffledCombo,
} from '../services/nextSemesterService';
import { classifyCgpa } from '../services/classificationService';
import { printAppLogo } from '../config/branding';
import { getRuntimeCatalog } from '../config/runtime';
import { printFileName, printSection } from '../services/scopedPrint';
import { fmt2 } from '../util/format';
import type { PendingProjection } from '../services/pendingService';

const STATUS_TONE: Record<string, string> = {
  'on-track': 'bg-emerald-50 ring-emerald-300 text-emerald-800',
  'already-above': 'bg-sky-50 ring-sky-300 text-sky-800',
  impossible: 'bg-red-50 ring-red-300 text-red-800',
  'no-data': 'bg-slate-100 ring-slate-200 text-slate-600',
};

/** Stable identity of a result form: the ordered grade list. */
const gradeKey = (c: ShuffledCombo) => c.assignments.map((a) => a.grade).join('|');

export function NextSemester() {
  const d = useDerived();
  const { record, grading, classification, state, progress } = d;
  const target = state.targetCgpa ?? 3.6;

  // Role = single source of truth for how to name + behave toward the act-on
  // semester. Just Started → finish the current semester; Not Released →
  // completed semester with pending results ("upon release"); Released/History
  // → the genuine next semester.
  const role = d.semesterRole;
  const meta = d.roleMeta;
  const isUponRelease = role === 'upon-release';
  const isFinishCurrent = role === 'finish-current';

  const [comboId, setComboId] = useState<'efficient' | 'balanced' | 'top'>('efficient');
  const [locked, setLocked] = useState<Record<string, string>>({});
  const [showWhatIf, setShowWhatIf] = useState(false);
  // Reshuffle history: index -1 = the selected preset plan; 0..n-1 = the
  // reshuffled plans. Undo / Redo walk this history back and forth.
  const [shuffleHistory, setShuffleHistory] = useState<ShuffledCombo[]>([]);
  const [shuffleIndex, setShuffleIndex] = useState(-1);
  // Short auto-dismissing prompt shown when reshuffle is pressed on the last form.
  const [shuffleNotice, setShuffleNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const planRef = useRef<HTMLDivElement>(null);
  const printPlan = () =>
    printSection(planRef.current, {
      title: isUponRelease ? 'Print On-Release Plan' : 'Print Semester Plan',
      institutionLabel: d.institutionLabel,
      programmeName: d.programme?.name ?? '',
      curriculumVersion: d.curriculum?.versionName,
      appLogo: printAppLogo(getRuntimeCatalog().appearance),
      institutionLogo: d.university?.logo,
      fileName: printFileName(next.label.replace(/—/g, ' '), isUponRelease ? 'On-Release Plan' : 'Semester Plan'),
    });

  // The semester this screen acts on = the one immediately after the CONFIRMED
  // position:
  //  • released          → a true "next" semester.
  //  • justStarted       → the current semester (confirmed = previous).
  //  • notReleased       → the semester whose results are pending (confirmed =
  //    previous); this screen shows the "upon release" consequence.
  const next = useMemo(
    () =>
      nextSemesterAfter(
        d.curriculum,
        d.confirmedPosition.levelIndex,
        d.confirmedPosition.semesterIndex
      ),
    [d.curriculum, d.confirmedPosition.levelIndex, d.confirmedPosition.semesterIndex]
  );

  // Credits genuinely ahead of the CONFIRMED position. For a mid-semester
  // (Just Started / Not Released) student this INCLUDES the current semester,
  // so the required-GPA tally counts every credit exactly once toward the
  // target — no dropped or double-counted credits.
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
  const activeShuffle = shuffleIndex >= 0 ? shuffleHistory[shuffleIndex] ?? null : null;
  const rows = showWhatIf && whatIf
    ? whatIf.assignments
    : activeShuffle?.assignments ?? activeCombo?.assignments ?? [];

  // A reshuffle only makes sense for the plan it was generated from.
  useEffect(() => {
    setShuffleHistory([]);
    setShuffleIndex(-1);
    setShuffleNotice(null);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
  }, [plan.requiredNextPoints, plan.next.credits, plan.status, showWhatIf, comboId]);

  // Clear the pending notice timer on unmount.
  useEffect(() => () => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
  }, []);

  function showShuffleNotice(msg: string) {
    setShuffleNotice(msg);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setShuffleNotice(null), 3400);
  }

  // The full space of possible RESULT FORMS for this semester: every valid
  // grade combination that clears the required points, ordered as a ladder
  // (lightest clearing form → top grades). Reshuffle climbs the ladder one
  // unused form at a time, then keeps going with random-but-valid mixes.
  const planSpace = useMemo(
    () => reshuffleSpace(plan.next.courses, grading, plan.requiredNextPoints ?? 0),
    [plan.next.courses, grading, plan.requiredNextPoints]
  );

  function doReshuffle() {
    if (plan.requiredNextPoints === null) return;
    // A form counts as "taken" only up to (and including) the CURRENT position.
    // Undo steps back, freeing every form after it — that is how reshuffle
    // comes back to life. There is deliberately NO random fallback: once the
    // whole ladder is taken, reshuffle stops working until you undo.
    const taken = new Set(shuffleHistory.slice(0, shuffleIndex + 1).map(gradeKey));
    const combo = planSpace.find((c) => !taken.has(gradeKey(c)));
    if (!combo) {
      showShuffleNotice(
        planSpace.length > 0
          ? `You’ve reached the end of the form ladder (Form ${planSpace.length.toLocaleString()} of ${planSpace.length.toLocaleString()}). Undo to step back, then reshuffle.`
          : 'There are no other valid forms for this plan.'
      );
      return;
    }
    const keep = shuffleHistory.slice(0, shuffleIndex + 1); // drop any redo tail
    setShuffleHistory([...keep, combo]);
    setShuffleIndex(keep.length);
  }
  const canUndo = shuffleIndex >= 0;
  const canRedo = shuffleIndex < shuffleHistory.length - 1;
  const undoCount = shuffleIndex + 1;
  const redoCount = shuffleHistory.length - 1 - shuffleIndex;

  // The GPA used for the semester being acted on. For the study-plan roles this
  // is the derived required average; for "upon release" it is the pending
  // semester's required average to stay on target.
  const semesterGpaUsed = plan.requiredNextGpa;
  const projectedAfter =
    showWhatIf && whatIf
      ? (record.points + whatIf.totalPoints) / (record.creditHours + plan.next.credits)
      : semesterGpaUsed !== null
        ? (record.points + semesterGpaUsed * plan.next.credits) /
          (record.creditHours + plan.next.credits)
        : plan.projectedCgpaAfter;
  const projectedClass = classifyCgpa(projectedAfter, classification);

  function reset() {
    setLocked({});
    setShowWhatIf(false);
  }

  const noData = record.cgpa === null;

  return (
    <div className="space-y-4">
      {/* ── HERO ─────────────────────────────────────────────────────── */}
      <Card className="bg-gradient-to-br from-brand-700 via-brand-600 to-indigo-900 text-white ring-0">
        <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-brand-200">
          {meta.mission}
        </p>
        <div className="mt-2 grid grid-cols-3 gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-200">
              {meta.noun}
            </p>
            <p className="text-sm font-black leading-tight">{next.label}</p>
            <p className="mt-0.5 text-[11px] text-brand-200">{plan.next.credits} credits</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-200">
              {isUponRelease ? 'Avg you need' : 'Required GPA'}
            </p>
            <p className="text-4xl font-black tabular-nums leading-none">
              {semesterGpaUsed === null ? '—' : fmt2(semesterGpaUsed)}
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
        <div className="mt-3 flex justify-end">
          <Info label="How is this worked out?" className="[&>button]:bg-white/15 [&>button]:text-white [&>button]:ring-white/30 [&>button]:hover:bg-white/25">
            <span>
              {isFinishCurrent && (
                <>
                  You’re in this semester now, so this is the average you need to{' '}
                  <strong>finish it</strong> to stay on course for your {fmt2(target)}{' '}
                  target. It counts this semester’s credits together with everything
                  still ahead, so the numbers add up exactly.
                </>
              )}
              {isUponRelease && (
                <>
                  You’ve already <strong>written</strong> this semester but its results
                  aren’t out. This is the steady average you need across these pending
                  credits and the semesters still ahead (what this semester needed to
                  earn), and the CGPA you’ll land on once results are{' '}
                  <strong>released</strong>.
                </>
              )}
              {!isFinishCurrent && !isUponRelease && (
                <>
                  The <strong>Required GPA</strong> is the semester average you’d need
                  to stay on course for your {fmt2(target)} target over the credits
                  that remain.
                </>
              )}
              <br />
              <br />
              It is a <strong>steady average to hold from this semester to
              graduation</strong> — not a target for the end of this semester alone.
              Everything is computed locally and works offline.
            </span>
          </Info>
        </div>
      </Card>

      {noData ? (
        <Card>
          <Note>Enter your current CGPA on the Calculate tab first — the pilot plans from where you are now.</Note>
        </Card>
      ) : isUponRelease ? (
        <UponReleaseCard
          pending={d.pending}
          target={target}
          nextLabel={next.label}
          steadyRequiredGpa={plan.requiredNextGpa}
        />
      ) : (
        <>
          {/* Status line */}
          <div className={`rounded-2xl px-4 py-3 text-xs font-semibold ring-1 ${STATUS_TONE[plan.status]}`}>
            {plan.status === 'already-above' &&
              `You're already above your target — even modest results in ${meta.noun.toLowerCase()} keep a ${fmt2(target)} average in reach.`}
            {plan.status === 'on-track' &&
              `${meta.statusLead} ${fmt2(plan.requiredNextGpa)} across ${plan.next.credits} credits ${meta.noun.toLowerCase()} to stay on the ${plan.targetClassLabel} trajectory; ${meta.projectedLabel.toLowerCase()} lands around ${fmt2(projectedAfter)}.`}
            {plan.status === 'impossible' &&
              `Even a straight ${plan.maxNextGpa.toFixed(2)} semester can't protect a ${fmt2(target)} finish — the target is out of range on the credits that remain. Consider a nearby classification.`}
          </div>

          {/* ── Your-numbers credit audit ─────────────────────────────── */}
          {/* Shown only when no results are pending, so every completed credit is
              already inside the confirmed CGPA and the cells below partition the
              whole programme exactly — nothing dropped, nothing double-counted. */}
          {record.pendingCreditHours === 0 && d.progress.hasCreditData && (
            <Card className="no-print">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">
                ✓ Your credits, all accounted for
              </p>
              <div className="grid grid-cols-3 gap-2 text-center">
                <Audit
                  label="Confirmed credits"
                  value={record.creditHours}
                  note="in your CGPA now"
                  info={ideaTip('next.confirmed')}
                />
                <Audit
                  label={role === 'finish-current' ? 'This semester' : 'Next semester'}
                  value={plan.next.credits}
                  note={role === 'finish-current' ? 'you are finishing it now' : 'to be written'}
                  info={ideaTip('next.semester')}
                />
                <Audit
                  label="After that"
                  value={Math.max(0, remainingCredits - plan.next.credits)}
                  note="semesters still to come"
                  info={ideaTip('next.after')}
                />
              </div>
              <p className="mt-2 text-center text-[10px] font-semibold text-emerald-700">
                {record.creditHours} + {plan.next.credits} + {Math.max(0, remainingCredits - plan.next.credits)} = {d.totalProgrammeCredits} programme credits · nothing dropped or double-counted
              </p>
            </Card>
          )}

          {/* ── Plan card ─────────────────────────────────────────────── */}
          <div ref={planRef}>
          <Card className="print-sheet">
            <div className="mb-2 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-sm font-extrabold text-slate-800">{meta.planPrefix} {next.label}</h3>
                <p className="text-[11px] text-slate-500">
                  Required GPA <strong className="text-brand-700">{fmt2(plan.requiredNextGpa)}</strong> · Target {plan.targetClassLabel}
                </p>
              </div>
            </div>

            {plan.combos.length > 0 && (
              <div className="no-print mb-3 flex flex-wrap gap-2">
                {plan.combos.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      setComboId(c.id);
                      setShuffleHistory([]);
                      setShuffleIndex(-1);
                    }}
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

            {activeShuffle ? (
              <p className="no-print mb-2 text-[11px] font-semibold text-brand-700">
                🔀 Reshuffled plan — a different mix of target grades that still meets
                the required GPA.
              </p>
            ) : (
              activeCombo && (
                <p className="no-print mb-2 text-[11px] text-slate-500">
                  {activeCombo.description}
                </p>
              )
            )}

            <div className={tableStyles.wrap}>
            {/* Fixed layout + narrow numeric columns: the whole table always
                fits the screen width — no horizontal scroll on this table. */}
            <table className={`${tableStyles.table} table-fixed`}>
              <thead>
                <tr className={tableStyles.headRow}>
                  <Th label="Course" tip={ideaTip('table.ns.course')} />
                  <Th label="Credits" tip={ideaTip('table.ns.credits')} right className="w-12" />
                  <Th label="Target grade" tip={ideaTip('table.ns.grade')} right className="w-14" />
                  <Th label="Grade points" tip={ideaTip('table.ns.points')} right className="no-print w-14" />
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  const isLocked = showWhatIf && !!locked[a.code];
                  return (
                    <tr key={a.code + a.name + a.grade} className={tableStyles.row}>
                      <td className={`${tableStyles.cell} font-semibold text-slate-700`}>
                        {a.code}
                        {a.name && a.name !== 'Curriculum not published' && (
                          <span className="block text-[10px] font-normal text-slate-400">{a.name}</span>
                        )}
                        {isLocked && <span className="ml-1 text-[9px] font-bold text-brand-600">· your pick</span>}
                      </td>
                      <td className={`${tableStyles.cell} text-right tabular-nums`}>{a.creditHours}</td>
                      <td className={`${tableStyles.cell} text-right font-black ${isLocked ? 'text-brand-700' : 'text-slate-900'}`}>
                        {a.grade}
                      </td>
                      <td className={`${tableStyles.cell} no-print text-right tabular-nums text-slate-500`}>
                        {a.points.toFixed(1)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>

            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] font-bold text-slate-600">
              <span>
                Semester average: <span className="text-brand-700">
                  {showWhatIf && whatIf
                    ? whatIf.semesterGpa.toFixed(2)
                    : (activeShuffle?.semesterGpa ?? activeCombo?.semesterGpa ?? 0).toFixed(2)}
                </span>
              </span>
              <span>
                {meta.projectedLabel}: <span className="text-brand-700">{fmt2(projectedAfter)}</span>
                {projectedClass && <span className="ml-1 text-slate-400">· {projectedClass.label}</span>}
              </span>
            </div>

            <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1.5 text-[10px] font-semibold text-amber-800 ring-1 ring-amber-200">
              {isFinishCurrent
                ? 'Finish this semester strong — these are planning targets for the semester you are in now, not predicted grades.'
                : 'These are planning targets, not predicted grades.'}
            </p>

            {!plan.curriculumPublished && plan.next.courses[0]?.name === 'Curriculum not published' && (
              <p className="no-print mt-2 text-[10px] text-slate-400">
                The published curriculum’s courses aren’t available yet, so the plan uses a single {plan.next.credits}-credit block. Publish the curriculum to see per-course target grades.
              </p>
            )}

            {shuffleNotice && (
              <p className="no-print mb-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200">
                💡 {shuffleNotice}
              </p>
            )}

            <div className="no-print mt-3 flex flex-wrap gap-2">
              {plan.combos.length > 0 && !showWhatIf && (
                <>
                  <button
                    onClick={doReshuffle}
                    className="rounded-lg bg-brand-50 px-3 py-1.5 text-[11px] font-bold text-brand-700 ring-1 ring-brand-200 transition hover:bg-brand-100"
                  >
                    🔀 Reshuffle
                  </button>
                  {shuffleIndex >= 0 && (
                    <span className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-[11px] font-bold tabular-nums text-slate-500 ring-1 ring-slate-200">
                      Form {shuffleIndex + 1}
                      {planSpace.length > 0 ? ` of ${planSpace.length.toLocaleString()}` : ''}
                    </span>
                  )}
                  <button
                    onClick={() => setShuffleIndex((i) => Math.max(-1, i - 1))}
                    disabled={!canUndo}
                    className="rounded-lg bg-white px-3 py-1.5 text-[11px] font-bold tabular-nums text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    ↩ Undo · {undoCount}
                  </button>
                  <button
                    onClick={() => setShuffleIndex((i) => Math.min(shuffleHistory.length - 1, i + 1))}
                    disabled={!canRedo}
                    className="rounded-lg bg-white px-3 py-1.5 text-[11px] font-bold tabular-nums text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    ↪ Redo · {redoCount}
                  </button>
                </>
              )}
              <button
                onClick={() => setShowWhatIf((v) => !v)}
                className={`rounded-lg px-3 py-1.5 text-[11px] font-bold transition ${
                  showWhatIf
                    ? 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    : 'animate-pulse-glow bg-gradient-to-r from-violet-600 via-brand-600 to-indigo-600 text-white ring-1 ring-white/40 hover:brightness-110'
                }`}
              >
                {showWhatIf ? (
                  '✕ Close what-if'
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="rounded bg-white/25 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider">
                      Advanced
                    </span>
                    ✨ What if I get a specific grade?
                  </span>
                )}
              </button>
              {permissionOn('allowPrinting') && (
                <button
                  onClick={printPlan}
                  className="rounded-lg bg-brand-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-brand-700"
                >
                  🖨️ Print {meta.planPrefix.replace(/[^\w ]/g, '').trim()}
                </button>
              )}
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
        </>
      )}
    </div>
  );
}

/** "Upon release" view for a Not Released student — the results are already
 *  written and pending; show the consequence, never a "finish/study" plan. */
function UponReleaseCard({
  pending,
  target,
  nextLabel,
  steadyRequiredGpa,
}: {
  pending: PendingProjection;
  target: number;
  nextLabel: string;
  /** Uniform steady average across the pending semester + all remaining. */
  steadyRequiredGpa: number | null;
}) {
  const f = (n: number | null) => (n === null ? '—' : fmt2(n));
  const classOf = (label: string | undefined) =>
    label ? ` · ${label.split('(')[0].trim()}` : '';
  const st = pending.targetStatus;
  const badge =
    pending.pendingCreditHours === 0
      ? { emoji: '✅', tone: 'bg-emerald-50 ring-emerald-200 text-emerald-800', text: 'All caught up' }
      : st === 'guaranteed'
        ? { emoji: '🟢', tone: 'bg-emerald-50 ring-emerald-200 text-emerald-800', text: 'Target secured' }
        : st === 'unreachable'
          ? { emoji: '🔴', tone: 'bg-red-50 ring-red-200 text-red-800', text: 'Target out of reach' }
          : { emoji: '🟠', tone: 'bg-amber-50 ring-amber-200 text-amber-800', text: 'Depends on your results' };

  return (
    <>
      <div className={`rounded-2xl px-4 py-3 text-xs font-semibold ring-1 ${badge.tone}`}>
        {pending.pendingCreditHours === 0
          ? `No results are pending right now — this screen shows the semester whose results are yet to be released.`
          : `${badge.emoji} ${badge.text} — your ${nextLabel} results are pending. Once released they are added to your confirmed CGPA (${pending.confirmedCreditHours} confirmed credits).`}
      </div>

      <Card className="print-sheet">
        <h3 className="text-sm font-extrabold text-slate-800">📋 Upon release — {nextLabel}</h3>
        <p className="text-[11px] text-slate-500">
          You already wrote this semester. Its {pending.pendingCreditHours} credits are
          pending — here is what your CGPA will be depending on the results you receive.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Stat label="If top grades" value={f(pending.bestCaseCgpa)} sub={`${classOf(pending.bestCaseClass?.label)}`} />
          <Stat label="If minimum pass" value={f(pending.minPassCgpa)} sub={`${classOf(pending.minPassClass?.label)}`} />
          <Stat label="Worst case" value={f(pending.worstCaseCgpa)} sub={`${classOf(pending.worstCaseClass?.label)}`} />
        </div>

        {pending.pendingCreditHours > 0 && steadyRequiredGpa !== null && (
          <div className="mt-3 rounded-xl bg-white/80 px-3 py-2 text-[12px] leading-relaxed text-slate-600 ring-1 ring-slate-200">
            To keep a <strong>{fmt2(target)}</strong> target you need about{' '}
            <strong className="text-brand-700">{fmt2(steadyRequiredGpa)}</strong>{' '}
            as a steady average across these {pending.pendingCreditHours} pending
            credits and the semesters still ahead — so this is what your just-written
            semester needed to have earned.
          </div>
        )}

        <p className="no-print mt-3 rounded-xl bg-sky-50 px-3 py-2 text-[11px] font-semibold text-sky-800 ring-1 ring-sky-200">
          Set this semester to <strong>Released</strong> on the Calculate tab once the
          results are out — your confirmed CGPA updates automatically and this estimate
          disappears.
        </p>
      </Card>
    </>
  );
}

function Audit({
  label,
  value,
  note,
  info,
}: {
  label: string;
  value: number;
  note: string;
  info?: string;
}) {
  return (
    <div className="rounded-xl bg-white/80 p-2 text-center ring-1 ring-slate-200">
      <p className="flex items-center justify-center gap-1 text-[9px] font-bold uppercase tracking-wide text-slate-400">
        <span className="truncate">{label}</span>
        {info && <Info compact label={`About: ${label}`}>{info}</Info>}
      </p>
      <p className="text-2xl font-black tabular-nums text-slate-800">{value}</p>
      <p className="truncate text-[9px] font-semibold text-slate-400">{note}</p>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-white/80 p-2.5 text-center ring-1 ring-slate-200">
      <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-xl font-black tabular-nums text-slate-800">{value}</p>
      {sub ? <p className="truncate text-[9px] font-semibold text-slate-400">{sub}</p> : null}
    </div>
  );
}
