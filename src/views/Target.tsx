import { useState } from 'react';
import { useDerived } from '../state/derived';
import { Card, SectionTitle } from '../components/ui';
import { PendingProjectionPanel } from '../components/PendingProjection';
import { analyzeTarget, type TargetAnalysis } from '../services/targetService';
import { fmt2 } from '../util/format';

/** Full-precision formatter used near feasibility boundaries. */
function fmt3(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toFixed(3);
}

type ResultTone = 'green' | 'amber' | 'orange' | 'red' | 'gray';

/** Friendly, student-facing presentation for each engine status. */
function presentation(a: TargetAnalysis): {
  badge: string;
  emoji: string;
  headline: string;
  body: string;
  tone: ResultTone;
} {
  const cls = a.targetClass?.label?.split('(')[0].trim();
  const targetText = cls ? `${fmt2(a.targetCgpa)} ${cls}` : `${fmt2(a.targetCgpa)}`;
  const req = a.requiredFutureGpa;
  const top = a.maxGradePoints;
  const reqTxt = req === null ? '' : fmt2(req);

  // "No room for error" fires only when the future average required is
  // essentially equal to the scale ceiling — i.e. reachable but only with a
  // (near-)perfect run. If the required average still clears the ceiling, that
  // is genuinely OUT OF REACH (see 'impossible' below). We never describe a
  // mathematically-reachable boundary as unreachable.
  const atCeiling =
    req !== null && req >= top - 1e-6 && req <= top + 1e-6;

  switch (a.status) {
    case 'met':
      return {
        badge: 'Target achieved',
        emoji: '🎯',
        tone: 'green',
        headline: `You’re already there — keep it.`,
        body: `Your current CGPA of ${fmt2(a.currentCgpa)} already meets your ${targetText} target. Hold your confirmed average at or above ${fmt2(a.targetCgpa)} through the remaining ${a.creditsRemaining} credits to keep the classification.`,
      };
    case 'achievable':
      return {
        badge: 'On course',
        emoji: '🟢',
        tone: 'green',
        headline: `Aim for at least ${reqTxt} from now on.`,
        body: `${targetText} is still comfortably within reach — you don’t need perfect marks. Average about ${reqTxt} across your remaining ${a.creditsRemaining} credits and you’ll get there.`,
      };
    case 'very-demanding':
      return {
        badge: 'High pressure',
        emoji: '🟠',
        tone: 'orange',
        headline: 'You’ll need strong results from here on.',
        body: `${targetText} is still possible, but it will take consistently strong grades — about ${reqTxt} on average over your remaining ${a.creditsRemaining} credits. There’s little room for slips.`,
      };
    case 'extremely-demanding':
      if (atCeiling) {
        return {
          badge: 'No room for error',
          emoji: '🔴',
          tone: 'red',
          headline: `Possible — but only with a perfect run.`,
          body: `${targetText} is still reachable, but only if you average ${fmt2(top)} (your top grade) in every single one of the remaining ${a.creditsRemaining} credits. There is no margin: one result below your best grade would put it out of reach.`,
        };
      }
      return {
        badge: 'No room for error',
        emoji: '🔴',
        tone: 'red',
        headline: 'Only a near-perfect run can do it.',
        body: `${targetText} is still mathematically possible — but you’ll need exceptionally strong results, around ${reqTxt} on average, over your remaining ${a.creditsRemaining} credits. A slip could put it out of reach.`,
      };
    case 'impossible':
      return {
        badge: 'Out of reach',
        emoji: '🔴',
        tone: 'red',
        headline: 'Even a perfect run wouldn’t be enough.',
        body: `${targetText} is no longer mathematically possible. Even with your best grade (${fmt2(top)}) in every one of the remaining ${a.creditsRemaining} credits, the best you could finish is ${fmt3(a.maxFinalCgpa)} — a hair below your ${fmt2(a.targetCgpa)} target. Try a nearby classification, or lower the target to what the remaining credits can still deliver.`,
      };
    default:
      return {
        badge: 'Awaiting your data',
        emoji: '⚪',
        tone: 'gray',
        headline: 'Tell us a little more.',
        body: 'Enter your current CGPA and the credits still ahead, and CGPA Pilot will work out what your future results need to reach the target.',
      };
  }
}

/** "What you need" headline value + helper caption, per status. */
function needValue(a: TargetAnalysis): string {
  if (a.status === 'met') return '—';
  if (a.requiredFutureGpa === null) return '—';
  if (a.requiredFutureGpa > a.maxGradePoints + 1e-9)
    return `Above ${fmt2(a.maxGradePoints)}`;
  return fmt2(a.requiredFutureGpa);
}

function needSub(a: TargetAnalysis): string | undefined {
  if (a.status === 'met') return 'already met';
  if (a.requiredFutureGpa === null) return undefined;
  if (a.requiredFutureGpa > a.maxGradePoints + 1e-9)
    return 'beyond the scale — not possible';
  return 'future average';
}

export function Target() {
  const d = useDerived();
  const { record, dispatch, classification, grading, progress, state } = d;

  // Both completed and remaining credits auto-fill from the configured
  // (admin-published) curriculum; the user can override either for a custom
  // scenario.
  const curriculumCompleted =
    state.mode === 'current' && progress.hasCreditData ? progress.completedCredits : null;
  const defaultCompleted = curriculumCompleted ?? record.creditHours;
  const defaultRemaining =
    state.mode === 'current' && progress.hasCreditData
      ? progress.remainingCredits
      : Math.max(0, d.totalProgrammeCredits - record.creditHours);
  const [completed, setCompleted] = useState<number | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [custom, setCustom] = useState<string>('');
  const [howOpen, setHowOpen] = useState(false);
  const [mathOpen, setMathOpen] = useState(false);
  const creditsCompleted = Math.max(0, completed ?? defaultCompleted);
  const creditsRemaining = Math.max(0, remaining ?? defaultRemaining);

  const target = state.targetCgpa ?? 3.6;

  // Keep the CGPA consistent with an overridden completed-credit count: the
  // reported current CGPA is presumed to hold over whichever completed figure
  // the user is using, so quality points scale with it.
  const cgpaBase = record.cgpa;
  const currentPoints =
    cgpaBase !== null && creditsCompleted > 0
      ? cgpaBase * creditsCompleted
      : record.points;

  const analysis = analyzeTarget(
    {
      currentPoints,
      creditsCompleted,
      creditsRemaining,
      targetCgpa: target,
      currentCgpa: cgpaBase,
    },
    grading,
    classification
  );

  const p = presentation(analysis);
  const progShort = d.programme?.shortName?.trim() || 'programme';

  // Targetable classification bands come from the active configured rules.
  const classes = classification.bands.filter(
    (b) => (classification.graduationMinCgpa ?? 0) <= b.minCgpa
  );

  const toneCard: Record<string, string> = {
    green: 'bg-emerald-50 ring-emerald-300',
    amber: 'bg-amber-50 ring-amber-300',
    orange: 'bg-orange-50 ring-orange-300',
    red: 'bg-red-50 ring-red-300',
    gray: 'bg-slate-100 ring-slate-200',
  };
  const toneText: Record<string, string> = {
    green: 'text-emerald-700',
    amber: 'text-amber-700',
    orange: 'text-orange-700',
    red: 'text-red-700',
    gray: 'text-slate-600',
  };

  const clsLabel = analysis.targetClass?.label?.split('(')[0].trim();

  // Plain-language summary (no quality points) shown behind "How did we get this?".
  function plainWhy(): string {
    const cur = fmt2(analysis.currentCgpa);
    const remainingTxt = `${analysis.creditsRemaining} credits`;
    const targetTxt = `${fmt2(analysis.targetCgpa)}${clsLabel ? ` (${clsLabel})` : ''}`;
    const req = analysis.requiredFutureGpa;
    const top = analysis.maxGradePoints;
    switch (analysis.status) {
      case 'met':
        return `You currently have a ${cur} CGPA, which already reaches your ${targetTxt} target. Keep your average at or above ${fmt2(analysis.targetCgpa)} over the ${remainingTxt} still ahead.`;
      case 'impossible':
        return `You currently have a ${cur} CGPA. Even scoring your maximum grade (${fmt2(top)}) on every one of the ${remainingTxt} ahead in your ${progShort} would finish just below your ${targetTxt} target — so it’s out of reach under the current curriculum.`;
      default:
        return `You currently have a ${cur} CGPA. Based on the ${remainingTxt} still ahead in your ${progShort}, you would need to average about ${fmt2(req ?? 0)} for all your remaining coursework to finish at ${targetTxt}.`;
    }
  }

  function applyCustom() {
    const v = Number(custom);
    if (!Number.isNaN(v) && v >= 0 && v <= d.maxPoints + 1e-9) {
      dispatch({ type: 'setTarget', target: v });
    }
  }

  return (
    <div className="space-y-4">
      {/* ── Choose a target ─────────────────────────────────────────── */}
      <Card>
        <SectionTitle
          icon="🎯"
          title="Your target"
          subtitle="Tap a degree class, or set a custom CGPA."
          info={
            <>
              A target is shown as <strong>🔴 out of reach</strong> only when even a
              perfect run — your top grade in every remaining credit — would finish
              below it. Every other status is still mathematically possible; the
              colours show how hard you’d have to push. Nothing is saved.
            </>
          }
        />

        <div className="flex flex-wrap gap-2">
          {classes.map((b) => {
            const active = target >= b.minCgpa && target <= b.maxCgpa;
            return (
              <button
                key={b.id}
                onClick={() => {
                  setCustom('');
                  dispatch({ type: 'setTarget', target: b.minCgpa });
                }}
                className={`rounded-full px-3 py-1.5 text-[11px] font-bold ring-1 transition ${
                  active
                    ? 'bg-brand-600 text-white ring-brand-600'
                    : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'
                }`}
              >
                {b.label.split('(')[0].trim()} · {b.minCgpa.toFixed(2)}
              </button>
            );
          })}
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="label">Custom CGPA target</span>
            <input
              type="number"
              min={0}
              max={d.maxPoints}
              step={0.01}
              className="input w-36 text-center text-lg font-black"
              placeholder={`0.00–${d.maxPoints.toFixed(2)}`}
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyCustom()}
            />
          </label>
          <button
            onClick={applyCustom}
            className="rounded-xl bg-brand-600 px-4 py-2 text-xs font-bold text-white hover:bg-brand-700"
          >
            Set target
          </button>
          <span className="pb-2 text-xs font-bold text-brand-700">
            Current target: {fmt2(target)}
            {clsLabel ? ` · ${clsLabel}` : ''}
          </span>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={d.maxPoints}
            step={0.05}
            value={Math.min(target, d.maxPoints)}
            onChange={(e) => {
              setCustom('');
              dispatch({ type: 'setTarget', target: Number(e.target.value) });
            }}
            className="flex-1 accent-brand-600"
          />
        </div>
      </Card>

      {/* ── Credits completed & remaining ───────────────────────────── */}
      <Card>
        <SectionTitle
          icon="🧮"
          title="Credits completed & remaining"
          subtitle="Auto-filled from the admin curriculum — tap to edit for your own scenario."
          info={
            <>
              Completed and remaining credits are <strong>filled in automatically</strong>{' '}
              from your institution’s published curriculum.
              <br />
              <br />
              You can <strong>edit either number</strong> for a custom scenario (e.g. a
              different course load). Use the reset button below to snap back to the
              curriculum values at any time.
            </>
          }
        />
        <div className="grid grid-cols-2 gap-3 text-center">
          <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
            <input
              type="number"
              min={0}
              max={400}
              className="input w-full bg-white text-center text-2xl font-black text-slate-800"
              value={completed ?? creditsCompleted}
              onChange={(e) =>
                e.target.value === ''
                  ? setCompleted(null)
                  : setCompleted(Math.max(0, Number(e.target.value) || 0))
              }
            />
            <p className="mt-1 text-[11px] font-semibold text-slate-500">credits completed</p>
            {curriculumCompleted !== null && completed === null && (
              <p className="mt-1 text-[9px] font-bold text-brand-600">auto · from curriculum</p>
            )}
          </div>
          <div className="rounded-xl bg-brand-50 p-3 ring-1 ring-brand-100">
            <input
              type="number"
              min={0}
              max={400}
              className="input w-full bg-white text-center text-2xl font-black text-brand-700"
              value={remaining ?? creditsRemaining}
              onChange={(e) =>
                e.target.value === ''
                  ? setRemaining(null)
                  : setRemaining(Math.max(0, Number(e.target.value) || 0))
              }
            />
            <p className="mt-1 text-[11px] font-semibold text-brand-700">credits remaining</p>
          </div>
        </div>
        <button
          onClick={() => {
            setCompleted(null);
            setRemaining(null);
          }}
          disabled={completed === null && remaining === null}
          className="mt-2.5 w-full rounded-lg bg-slate-100 px-3 py-2 text-[11px] font-bold text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-slate-100"
        >
          ↺ Reset to auto-filled ({defaultCompleted} done · {defaultRemaining} to go)
        </button>
        <p className="mt-1 text-center text-[9px] text-slate-400">
          Snaps the numbers back to what was auto-filled from the admin curriculum.
        </p>
      </Card>

      {/* ── RESULT ──────────────────────────────────────────────────── */}
      <Card className={`ring-2 ${toneCard[p.tone]}`}>
        {/* Status headline */}
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white text-3xl shadow-sm ring-1 ring-black/5">
            {p.emoji}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
              Target status
            </p>
            <p className={`truncate text-2xl font-black ${toneText[p.tone]}`}>{p.badge}</p>
          </div>
        </div>

        {/* Mission headline + friendly copy */}
        {analysis.status !== 'unknown' && (
          <div className="mt-3 rounded-xl bg-white/80 p-3 ring-1 ring-black/5">
            <p className="text-base font-black text-slate-900">{p.headline}</p>
            <p className="mt-1 text-sm leading-relaxed text-slate-600">{p.body}</p>
          </div>
        )}

        {/* Key numbers: Current / Target / What you need / Best possible */}
        {analysis.status !== 'unknown' && (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Metric label="Current CGPA" value={fmt2(analysis.currentCgpa)} tone="slate" />
            <Metric
              label="Target"
              value={fmt2(analysis.targetCgpa)}
              sub={clsLabel ?? undefined}
              tone="brand"
            />
            <Metric
              label="What you need"
              value={needValue(analysis)}
              sub={needSub(analysis)}
              tone={
                analysis.status === 'impossible'
                  ? 'red'
                  : analysis.status === 'met'
                    ? 'slate'
                    : 'amber'
              }
            />
            <Metric
              label="Best possible final CGPA"
              value={analysis.status === 'impossible' ? fmt3(analysis.maxFinalCgpa) : fmt2(analysis.maxFinalCgpa)}
              sub={analysis.status === 'impossible' ? 'even with perfect grades' : undefined}
              tone="slate"
            />
          </div>
        )}

        {/* Collapsible: how did we get this? (plain) + optional math */}
        <div className="mt-4 border-t border-black/5 pt-2">
          <button
            onClick={() => setHowOpen((v) => !v)}
            aria-expanded={howOpen}
            className="text-[11px] font-bold text-brand-700 underline-offset-2 hover:underline"
          >
            {howOpen ? '▾ Hide explanation' : 'ⓘ How did CGPA Pilot get this?'}
          </button>

          {howOpen && (
            <div className="mt-2 space-y-2">
              <p className="rounded-xl bg-white/70 px-3 py-2 text-[13px] leading-relaxed text-slate-600 ring-1 ring-slate-200">
                {analysis.status === 'unknown'
                  ? 'Enter your current CGPA (Quick or GPA History mode) and confirm the credits ahead. CGPA Pilot then works out what your future results need to reach the target — all on this device, nothing is saved.'
                  : plainWhy()}
              </p>

              {analysis.status !== 'unknown' && (
                <button
                  onClick={() => setMathOpen((v) => !v)}
                  aria-expanded={mathOpen}
                  className="text-[11px] font-bold text-slate-500 underline-offset-2 hover:underline"
                >
                  {mathOpen ? '▾ Hide calculation details' : 'Show calculation details'}
                </button>
              )}

              {mathOpen && analysis.status !== 'unknown' && (
                <dl className="grid grid-cols-1 gap-x-4 gap-y-1 rounded-xl bg-white/70 px-3 py-2 text-[12px] text-slate-600 ring-1 ring-slate-200 sm:grid-cols-2">
                  <DetailRow label="Current credits" value={String(analysis.creditsCompleted)} />
                  <DetailRow label="Remaining credits" value={String(analysis.creditsRemaining)} />
                  <DetailRow label="Programme credits" value={String(analysis.totalCredits)} />
                  <DetailRow label="Current quality points" value={fmt2(analysis.currentPoints)} />
                  <DetailRow
                    label="Required final quality points"
                    value={fmt2(analysis.targetCgpa * analysis.totalCredits)}
                  />
                  <DetailRow
                    label="Required future GPA"
                    value={
                      analysis.requiredFutureGpa !== null &&
                      analysis.requiredFutureGpa > analysis.maxGradePoints + 1e-9
                        ? `Above ${fmt2(analysis.maxGradePoints)}`
                        : fmt2(analysis.requiredFutureGpa)
                    }
                  />
                  <DetailRow label="Best possible final" value={fmt3(analysis.maxFinalCgpa)} />
                  <DetailRow
                    label="Scale ceiling"
                    value={fmt2(analysis.maxGradePoints)}
                    muted
                  />
                </dl>
              )}
            </div>
          )}
        </div>
      </Card>

      {/* ── Pending results (Prompt 7) ──────────────────────────────── */}
      {record.pendingCount > 0 && (
        <PendingProjectionPanel pending={d.pending} target={state.targetCgpa} />
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
  tone = 'slate',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'slate' | 'brand' | 'amber' | 'red';
}) {
  const valueTone: Record<string, string> = {
    slate: 'text-slate-800',
    brand: 'text-brand-700',
    amber: 'text-amber-600',
    red: 'text-red-600',
  };
  return (
    <div className="rounded-xl bg-white/90 p-2.5 text-center ring-1 ring-black/5">
      <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`text-xl font-black tabular-nums ${valueTone[tone]}`}>{value}</p>
      {sub ? <p className="truncate text-[9px] font-semibold text-slate-400">{sub}</p> : null}
    </div>
  );
}

function DetailRow({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-slate-100 py-1 last:border-0">
      <dt className={muted ? 'text-slate-400' : 'font-medium text-slate-500'}>{label}</dt>
      <dd className={`font-black tabular-nums ${muted ? 'text-slate-400' : 'text-slate-700'}`}>
        {value}
      </dd>
    </div>
  );
}
