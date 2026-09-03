import { useState } from 'react';
import { useDerived } from '../state/derived';
import { Card, SectionTitle } from '../components/ui';
import { PendingProjectionPanel } from '../components/PendingProjection';
import { analyzeTarget } from '../services/targetService';
import { fmt2 } from '../util/format';

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
  const [showWhy, setShowWhy] = useState(false);
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

  // Targetable classification bands come from the active configured rules.
  const classes = classification.bands.filter(
    (b) => (classification.graduationMinCgpa ?? 0) <= b.minCgpa
  );

  const toneCard: Record<string, string> = {
    green: 'bg-green-50 ring-green-300',
    amber: 'bg-amber-50 ring-amber-300',
    orange: 'bg-orange-50 ring-orange-300',
    red: 'bg-red-50 ring-red-300',
    gray: 'bg-slate-100 ring-slate-200',
  };
  const toneText: Record<string, string> = {
    green: 'text-green-700',
    amber: 'text-amber-700',
    orange: 'text-orange-700',
    red: 'text-red-700',
    gray: 'text-slate-600',
  };

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
              A target is shown as <strong>🔴 mathematically impossible</strong> only
              when the average future GPA it requires exceeds the maximum grade point of
              your configured grading system ({d.maxPoints.toFixed(2)}).
              <br />
              <br />
              All other statuses mean it is <strong>within the possible range</strong> —
              the colours simply show how hard you would have to push. Nothing is saved.
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
            {analysis.targetClass ? ` · ${analysis.targetClass.label.split('(')[0].trim()}` : ''}
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

      {/* ── TARGET STATUS ───────────────────────────────────────────── */}
      <Card className={`ring-2 ${toneCard[analysis.tone]}`}>
        <div className="flex items-center gap-3">
          <span className="text-4xl leading-none">{analysis.statusEmoji}</span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
              Target status
            </p>
            <p className={`text-2xl font-black ${toneText[analysis.tone]}`}>
              {analysis.statusLabel}
            </p>
          </div>
          <div className="ml-auto text-right text-xs">
            <p className="text-slate-500">Current</p>
            <p className="text-lg font-black tabular-nums text-slate-800">
              {fmt2(record.cgpa)}
            </p>
            <p className="text-slate-500">Target</p>
            <p className="text-lg font-black tabular-nums text-brand-700">{fmt2(target)}</p>
          </div>
        </div>

        {analysis.status !== 'unknown' && (
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Metric label="Required future QP" value={analysis.requiredFuturePoints} />
            <Metric label="Required future GPA" value={analysis.requiredFutureGpa} strong />
            <Metric label="Max possible final" value={analysis.maxFinalCgpa} />
            <Metric label="Scale ceiling" value={analysis.maxGradePoints} />
          </div>
        )}

        <button
          onClick={() => setShowWhy((v) => !v)}
          className="mt-3 text-[11px] font-bold text-brand-700 underline"
        >
          {showWhy ? '▾ Hide explanation' : '❓ Why am I seeing this?'}
        </button>
        {showWhy && (
          <ul className="mt-2 space-y-2 rounded-xl bg-white/70 p-3 ring-1 ring-slate-200">
            {analysis.explanation.map((line, i) => (
              <li key={i} className="flex gap-2 text-[12px] leading-relaxed text-slate-700">
                <span className="mt-0.5 text-brand-500">▸</span>
                <span>{line}</span>
              </li>
            ))}
            <li className="pt-1 text-[10px] italic text-slate-400">
              Figures use full internal precision and are rounded only for
              display. Everything is temporary and stays on this device.
            </li>
          </ul>
        )}
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
  strong = false,
}: {
  label: string;
  value: number | null;
  strong?: boolean;
}) {
  return (
    <div className="rounded-xl bg-white/80 p-2.5 text-center ring-1 ring-slate-200">
      <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p
        className={`text-lg font-black tabular-nums ${
          strong ? 'text-brand-700' : 'text-slate-800'
        }`}
      >
        {value === null ? '—' : fmt2(value)}
      </p>
    </div>
  );
}
