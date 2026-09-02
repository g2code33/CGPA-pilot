import type { PendingProjection } from '../services/pendingService';
import { fmt2 } from '../util/format';

/**
 * Pending-results projection panel. Clearly labels every figure: the
 * confirmed CGPA is a fact; best/worst-case figures are explicitly marked as
 * projections over results not yet released. No grade is ever assumed as
 * certain while pending.
 */
export function PendingProjectionPanel({
  pending,
  target,
}: {
  pending: PendingProjection;
  target: number | null;
}) {
  if (pending.pendingCreditHours <= 0) return null;

  const status = pending.targetStatus;

  return (
    <div className="rounded-2xl bg-amber-50/70 p-4 ring-1 ring-amber-200">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-base">⏳</span>
        <h3 className="text-sm font-extrabold text-amber-900">
          Pending results · {pending.pendingCreditHours} credits awaiting
          release
        </h3>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-amber-800">
        These results are <strong>not graded yet</strong> — they are excluded
        from your confirmed CGPA. The figures below are projections across the
        possible outcomes once released; nothing is assumed or saved.
      </p>

      {/* Confirmed vs. possible range */}
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-white p-2.5 ring-1 ring-slate-200">
          <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">
            Confirmed
          </p>
          <p className="text-lg font-black tabular-nums text-slate-900">
            {fmt2(pending.confirmedCgpa)}
          </p>
          <p className="text-[9px] font-semibold text-slate-500">
            {pending.confirmedCreditHours} cr released
          </p>
        </div>
        <div className="rounded-xl bg-red-50 p-2.5 ring-1 ring-red-200">
          <p className="text-[9px] font-bold uppercase tracking-wide text-red-400">
            Worst case
          </p>
          <p className="text-lg font-black tabular-nums text-red-700">
            {fmt2(pending.worstCaseCgpa)}
          </p>
          <p className="text-[9px] font-semibold text-red-500">
            {pending.worstCaseClass?.label ?? '—'}
          </p>
        </div>
        <div className="rounded-xl bg-emerald-50 p-2.5 ring-1 ring-emerald-200">
          <p className="text-[9px] font-bold uppercase tracking-wide text-emerald-500">
            Best case
          </p>
          <p className="text-lg font-black tabular-nums text-emerald-700">
            {fmt2(pending.bestCaseCgpa)}
          </p>
          <p className="text-[9px] font-semibold text-emerald-600">
            {pending.bestCaseClass?.label ?? '—'}
          </p>
        </div>
      </div>

      {/* Range bar */}
      <div className="mt-3">
        <div className="relative h-2 rounded-full bg-gradient-to-r from-red-300 via-amber-300 to-emerald-300">
          {pending.confirmedCgpa !== null && (
            <div
              className="absolute top-1/2 h-3.5 w-1 -translate-y-1/2 rounded-full bg-slate-900"
              style={{
                left: `${Math.min(
                  100,
                  Math.max(0, (pending.confirmedCgpa / pending.maxPoints) * 100)
                )}%`,
              }}
              title="Confirmed CGPA"
            />
          )}
        </div>
        <div className="mt-1 flex justify-between text-[9px] font-bold text-slate-500">
          <span>Worst {fmt2(pending.worstCaseCgpa)}</span>
          <span>
            possible swing {fmt2(pending.swing)} ({pending.minPositivePoints > 0 &&
              `min-pass ${fmt2(pending.minPassCgpa)} · `}
            confirmed {fmt2(pending.confirmedCgpa)})
          </span>
          <span>Best {fmt2(pending.bestCaseCgpa)}</span>
        </div>
      </div>

      {/* Target feasibility under possible outcomes */}
      {target !== null && status && (
        <div
          className={`mt-3 rounded-xl px-3 py-2 text-[11px] font-semibold ring-1 ${
            status === 'guaranteed'
              ? 'bg-emerald-100 text-emerald-800 ring-emerald-300'
              : status === 'possible'
                ? 'bg-amber-100 text-amber-800 ring-amber-300'
                : 'bg-red-100 text-red-800 ring-red-300'
          }`}
        >
          {status === 'guaranteed' && (
            <>
              🎯 Target {fmt2(target)} ({pending.targetRequiredClass?.label}) is{' '}
              <strong>secured regardless</strong> of the pending results — even
              the worst-case projection stays above it.
            </>
          )}
          {status === 'possible' && (
            <>
              🎯 Target {fmt2(target)} ({pending.targetRequiredClass?.label}) is{' '}
              <strong>within reach but not guaranteed</strong>. The pending
              credits need an average of about{' '}
              <strong>{fmt2(pending.requiredPendingGpa)}</strong> /{' '}
              {pending.maxPoints.toFixed(2)}.
              {pending.requiredPendingGpa !== null &&
                pending.requiredPendingGpa <= pending.minPositivePoints + 1e-9 && (
                  <> A minimum pass would suffice.</>
                )}
            </>
          )}
          {status === 'unreachable' && (
            <>
              ⚠️ Target {fmt2(target)} ({pending.targetRequiredClass?.label}) is{' '}
              <strong>not reachable</strong> from these pending credits alone —
              even straight top grades give {fmt2(pending.bestCaseCgpa)}.
            </>
          )}
        </div>
      )}

      <p className="mt-2 text-[9px] uppercase tracking-wide text-amber-700/70">
        Projection — depends on results not yet released
      </p>
    </div>
  );
}
