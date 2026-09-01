import { useState } from 'react';
import { useDerived } from '../state/derived';
import { Card, SectionTitle, Note } from '../components/ui';
import { targetableBands } from '../services/classificationService';
import {
  creditHoursToTargetAtStraightA,
  assessFeasibility,
} from '../services/projectionService';
import {
  requiredFutureGpaPrecise,
  maximumFinalCgpa,
  targetFeasible,
} from '../services/coreCgpaService';
import { fmt2 } from '../util/format';

export function Target() {
  const d = useDerived();
  const { record, dispatch, classification, grading, progress, maxPoints } = d;

  // Default remaining credits come from the configured curriculum (in current
  // mode) or the total programme structure; the student can override.
  const defaultRemaining =
    d.state.mode === 'current' && progress.hasCreditData
      ? progress.remainingCredits
      : Math.max(0, d.totalProgrammeCredits - record.creditHours);
  const [remaining, setRemaining] = useState<number | null>(null);
  const remainingCredits = remaining ?? defaultRemaining;

  const target = d.state.targetCgpa ?? 3.6;
  const cgpa = record.cgpa;

  const reqPrecise = requiredFutureGpaPrecise(
    record.points,
    record.creditHours,
    remainingCredits,
    target
  );
  const max = maximumFinalCgpa(
    record.points,
    record.creditHours,
    remainingCredits,
    grading
  );
  const feasibility = assessFeasibility(
    record.points,
    record.creditHours,
    remainingCredits,
    target,
    cgpa,
    maxPoints
  );
  const feasible = targetFeasible(reqPrecise, grading);
  const atStraightA = creditHoursToTargetAtStraightA(
    record.points,
    record.creditHours,
    target,
    maxPoints
  );
  const projected =
    reqPrecise !== null && reqPrecise >= 0 && feasible
      ? (record.points + reqPrecise * remainingCredits) /
        (record.creditHours + remainingCredits)
      : null;

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle
          icon="🎯"
          title="Target"
          subtitle="Choose your destination — the class of degree you are navigating towards."
        />
        <div className="flex items-center gap-4">
          <input
            type="range"
            min={1}
            max={maxPoints}
            step={0.05}
            value={Math.min(target, maxPoints)}
            onChange={(e) =>
              dispatch({ type: 'setTarget', target: Number(e.target.value) })
            }
            className="flex-1 accent-brand-600"
          />
          <span className="w-16 rounded-xl bg-brand-600 py-2 text-center text-lg font-black text-white">
            {Math.min(target, maxPoints).toFixed(2)}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {targetableBands(classification).map((b) => (
            <button
              key={b.id}
              onClick={() => dispatch({ type: 'setTarget', target: b.minCgpa })}
              className={`rounded-full px-3 py-1.5 text-[11px] font-bold ring-1 transition ${
                target >= b.minCgpa && target <= b.maxCgpa
                  ? 'bg-brand-100 text-brand-700 ring-brand-300'
                  : 'bg-white text-slate-500 ring-slate-200 hover:bg-slate-50'
              }`}
            >
              {b.label} ({b.minCgpa.toFixed(1)})
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <SectionTitle
          icon="🧭"
          title="Feasibility analysis"
          subtitle="How many graded credits remain until you graduate?"
        />
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-bold uppercase text-slate-500">
              Remaining credits
            </label>
            <input
              type="number"
              min={0}
              max={400}
              className="input w-36 text-center text-lg font-black"
              value={remaining ?? remainingCredits}
              onChange={(e) =>
                e.target.value === ''
                  ? setRemaining(null)
                  : setRemaining(Math.max(0, Number(e.target.value) || 0))
              }
            />
          </div>
          {d.state.mode === 'current' && progress.hasCreditData && (
            <button
              onClick={() => setRemaining(progress.remainingCredits)}
              className="rounded-lg bg-emerald-100 px-3 py-2 text-[11px] font-bold text-emerald-700 hover:bg-emerald-200"
            >
              Use curriculum ({progress.remainingCredits})
            </button>
          )}
          <div className="flex gap-1.5">
            {[30, 60, 90, 120, 180].map((v) => (
              <button
                key={v}
                onClick={() => setRemaining(v)}
                className="rounded-lg bg-slate-100 px-2.5 py-2 text-[11px] font-bold text-slate-600 hover:bg-slate-200"
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        <div
          className={`mt-4 rounded-2xl p-4 text-center ${
            cgpa === null
              ? 'bg-slate-100'
              : feasibility.zone === 'achieved'
                ? 'bg-emerald-50 ring-1 ring-emerald-200'
                : feasibility.zone === 'on'
                  ? 'bg-sky-50 ring-1 ring-sky-200'
                  : 'bg-red-50 ring-1 ring-red-200'
          }`}
        >
          {cgpa === null ? (
            <p className="text-sm text-slate-500">
              Enter your record on the Calculate tab first.
            </p>
          ) : (
            <>
              <p
                className={`text-[11px] font-bold uppercase tracking-widest ${
                  feasibility.zone === 'off' ? 'text-red-600' : 'text-emerald-700'
                }`}
              >
                {feasibility.zone === 'achieved'
                  ? '✅ Target achieved'
                  : feasibility.zone === 'on'
                    ? '🟢 Target reachable'
                    : '🔴 Out of range'}
              </p>
              {reqPrecise !== null && feasibility.zone !== 'achieved' && (
                <p
                  className={`my-1 text-5xl font-black ${
                    feasibility.zone === 'off' ? 'text-red-600' : 'text-sky-700'
                  }`}
                >
                  {reqPrecise < 0 ? "0.00" : fmt2(reqPrecise)}
                </p>
              )}
              <p className="text-sm font-medium text-slate-700">{feasibility.message}</p>
              {projected !== null && feasibility.zone === 'on' && (
                <p className="mt-1 text-xs font-semibold text-sky-800">
                  Finish on {fmt2(projected)} after {remainingCredits} more credits.
                </p>
              )}
            </>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <Card className="text-center">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Maximum possible CGPA
          </p>
          <p className="mt-1 text-2xl font-black text-emerald-600">{fmt2(max)}</p>
          <p className="text-[10px] text-slate-400">if every remaining course is an A</p>
        </Card>
        <Card className="text-center">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Credits to target at straight A
          </p>
          <p className="mt-1 text-2xl font-black text-brand-600">
            {atStraightA === null ? '—' : Math.ceil(atStraightA)}
          </p>
          <p className="text-[10px] text-slate-400">minimum credits needed</p>
        </Card>
      </div>

      {record.pendingCount > 0 && (
        <Note>
          You have {record.pendingCount} pending result{record.pendingCount === 1 ? '' : 's'} (
          {record.pendingCreditHours} credits). Use the What-If tab to preview grades before they land — they
          could shift both your CGPA and the required average above.
        </Note>
      )}
    </div>
  );
}
