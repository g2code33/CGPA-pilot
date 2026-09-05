import { useMemo, useRef, useState } from 'react';
import { useDerived } from '../state/derived';
import { Card, SectionTitle, Note, Badge, Info } from '../components/ui';
import { ideaTip } from '../infoTips';
import { buildFlightPath } from '../services/flightPathService';
import { classifyCgpa } from '../services/classificationService';
import { progressThrough } from '../services/structureService';
import { printFileName, printSection } from '../services/scopedPrint';
import { printAppLogo } from '../config/branding';
import { getRuntimeCatalog } from '../config/runtime';
import { fmt2, clamp } from '../util/format';

const TONE_COLOR: Record<string, string> = {
  gold: '#f59e0b',
  green: '#10b981',
  teal: '#14b8a6',
  blue: '#0ea5e9',
  red: '#ef4444',
  gray: '#94a3b8',
};

const COLORS = {
  current: '#0f172a',
  projected: '#4f46e5', // indigo
  required: '#f59e0b', // amber dashed
  target: '#10b981', // emerald solid
  axis: '#cbd5e1',
};

export function FlightPathView() {
  const d = useDerived();
  const { record, classification, grading, maxPoints, state, progress } = d;

  const [assumedGpa, setAssumedGpa] = useState<number | null>(null);
  const [fallbackCredits, setFallbackCredits] = useState(18);
  const [fallbackSemesters, setFallbackSemesters] = useState(6);
  const graphRef = useRef<HTMLDivElement>(null);
  const printGraph = () =>
    printSection(graphRef.current, {
      title: 'Print Flight Path',
      institutionLabel: d.institutionLabel,
      programmeName: d.programme?.name ?? '',
      curriculumVersion: d.curriculum?.versionName,
      appLogo: printAppLogo(getRuntimeCatalog().appearance),
      institutionLogo: d.university?.logo,
      fileName: printFileName(
        `Level ${d.confirmedPosition.levelIndex * 100} - Sem ${d.confirmedPosition.semesterIndex}`,
        'Flight Path'
      ),
    });

  const target = state.targetCgpa ?? 3.6;
  // Current level: explicit in current mode; in history mode infer from the
  // number of semesters entered (two semesters per level).
  const currentLevel =
    state.mode === 'current'
      ? state.baseline.levelIndex
      : Math.max(1, Math.ceil(state.semesters.length / 2));

  // Remaining slots: curriculum-driven, starting just after the student's
  // current point (baseline in current mode; last entered semester in history).
  const remainingSlots = useMemo(() => {
    if (state.mode === 'current') return progress.remainingSlots;
    const last = state.semesters[state.semesters.length - 1];
    if (!last) return d.curriculum ? progressThrough(d.curriculum, 1, 1).remainingSlots : [];
    return progressThrough(
      d.curriculum,
      last.levelIndex,
      last.semesterIndex
    ).remainingSlots;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.mode, state.baseline.levelIndex, state.baseline.semesterIndex, state.semesters, d.curriculum]);

  const model = useMemo(
    () =>
      buildFlightPath(
        {
          currentPoints: record.points,
          currentCredits: record.creditHours,
          currentCgpa: record.cgpa,
          currentLevelIndex: currentLevel,
          remainingSlots,
          assumedFutureGpa: assumedGpa ?? record.cgpa ?? target,
          targetCgpa: target,
          fallbackCreditsPerSemester: fallbackCredits,
          fallbackSemesterCount: fallbackSemesters,
          semesterRole: d.semesterRole,
        },
        grading,
        classification
      ),
    [
      record.points,
      record.creditHours,
      record.cgpa,
      currentLevel,
      remainingSlots,
      assumedGpa,
      target,
      fallbackCredits,
      fallbackSemesters,
      d.semesterRole,
      grading,
      classification,
    ]
  );

  const milestones = model.milestones;
  const grad = model.graduation;
  const gradClass = grad ? classifyCgpa(grad.projectedCgpa, classification) : null;

  // ── Graph geometry (viewBox scales responsively) ──────────────────────
  const W = 720;
  const H = 340;
  const PAD_L = 46;
  const PAD_R = 18;
  const PAD_T = 20;
  const PAD_B = 40;
  const n = milestones.length;
  const xFor = (i: number) =>
    PAD_L + (n <= 1 ? 0 : (i / (n - 1)) * (W - PAD_L - PAD_R));
  const yFor = (cgpa: number) =>
    PAD_T + (1 - clamp(cgpa, 0, maxPoints) / maxPoints) * (H - PAD_T - PAD_B);

  const projectedPath = milestones
    .map((m, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i).toFixed(1)} ${yFor(m.projectedCgpa).toFixed(1)}`)
    .join(' ');
  const requiredPath = milestones
    .map((m, i) =>
      m.requiredCgpa === null
        ? ''
        : `${i === 0 || milestones[i - 1].requiredCgpa === null ? 'M' : 'L'} ${xFor(i).toFixed(1)} ${yFor(m.requiredCgpa).toFixed(1)}`
    )
    .filter(Boolean)
    .join(' ');

  const classLines = classification.bands
    .filter((b) => b.minCgpa > 0)
    .map((b) => ({
      label: b.label.replace(/\s*\(.*\)/, '').split(' ')[0],
      min: b.minCgpa,
      tone: TONE_COLOR[b.tone] ?? '#94a3b8',
    }));

  const noData = record.cgpa === null;

  return (
    <div className="space-y-4">
      <Card className="no-print">
        <SectionTitle
          icon="🛩️"
          title="The CGPA Flight Path"
          subtitle="Your trajectory from today to graduation."
          info={
            <>
              This plots where your CGPA is heading, term by term, to graduation.
              <br />
              <br />
              <strong>Projected</strong> and <strong>required</strong> lines are{' '}
              <strong>scenarios, not promises</strong> — your actual route changes with
              each real result. Nothing is saved.
            </>
          }
        />

        {noData && (
          <Note>
            Enter your current CGPA on the Calculate tab (Quick or GPA History
            mode) to plot your flight path.
          </Note>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="block">
            <span className="label">Assumed future GPA: {(assumedGpa ?? record.cgpa ?? target).toFixed(2)}</span>
            <input
              type="range"
              min={0}
              max={maxPoints}
              step={0.05}
              value={clamp(assumedGpa ?? record.cgpa ?? target, 0, maxPoints)}
              onChange={(e) => setAssumedGpa(Number(e.target.value))}
              className="mt-3 w-full accent-brand-600"
            />
          </label>
          {model.requiredFutureGpa !== null && (
            <button
              onClick={() =>
                setAssumedGpa(
                  clamp(model.requiredFutureGpa ?? target, 0, maxPoints)
                )
              }
              className="self-end rounded-lg bg-amber-100 px-2 py-2 text-[11px] font-bold text-amber-800 ring-1 ring-amber-300 hover:bg-amber-200"
            >
              Fly the required line ({fmt2(model.requiredFutureGpa)})
            </button>
          )}
          {model.fallback && (
            <>
              <label className="block">
                <span className="label">Credits / semester</span>
                <input
                  type="number"
                  min={1}
                  max={30}
                  className="input text-center font-black"
                  value={fallbackCredits}
                  onChange={(e) =>
                    setFallbackCredits(clamp(Math.round(Number(e.target.value) || 1), 1, 30))
                  }
                />
              </label>
              <label className="block">
                <span className="label">Future semesters</span>
                <input
                  type="number"
                  min={1}
                  max={12}
                  className="input text-center font-black"
                  value={fallbackSemesters}
                  onChange={(e) =>
                    setFallbackSemesters(clamp(Math.round(Number(e.target.value) || 1), 1, 12))
                  }
                />
              </label>
            </>
          )}
        </div>
        {model.fallback && (
          <p className="mt-2 text-[10px] text-slate-400">
            The curriculum’s credit loads aren’t published yet, so future
            semesters use {fallbackCredits} credits each as a placeholder.
          </p>
        )}
      </Card>

      {/* ── Summary strip ─────────────────────────────────────────────── */}
      <div className="no-print grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label="Current CGPA"
          value={fmt2(record.cgpa)}
          tone={COLORS.current}
          info={ideaTip('flight.current')}
        />
        <Stat
          label="Target CGPA"
          value={fmt2(target)}
          tone={COLORS.target}
          info={ideaTip('flight.target')}
        />
        <Stat
          label="Required future GPA"
          value={model.requiredFutureGpa === null ? '—' : fmt2(model.requiredFutureGpa)}
          tone={COLORS.required}
          sub={model.targetReachable ? 'reachable' : 'above ceiling'}
          info={ideaTip('flight.required')}
        />
        <Stat
          label="Projected at graduation"
          value={fmt2(grad?.projectedCgpa ?? null)}
          tone={COLORS.projected}
          sub={gradClass?.label ?? ''}
          info={ideaTip('flight.projected')}
        />
      </div>

      {/* ── Print button (kept outside the printable ref) ─────────────── */}
      <div className="no-print flex justify-end">
        <button
          onClick={printGraph}
          className="rounded-lg bg-brand-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-brand-700"
        >
          🖨️ Print Flight Path
        </button>
      </div>

      <div ref={graphRef}>
      {/* ── Graph (printable) ─────────────────────────────────────────── */}
      <Card className="print-sheet">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-extrabold text-slate-800">
            Flight path · {d.programme?.shortName ?? 'Programme'} · Level{' '}
            {model.currentLevel * 100} → Graduation
          </h3>
        </div>

        <p className="mb-2 text-[11px] text-slate-600">
          Current CGPA <strong>{fmt2(record.cgpa)}</strong> · Target <strong>{fmt2(target)}</strong> (solid green line).
          The projected trajectory (solid) and required line (dashed amber) assume the configured curriculum
          credit loads and a steady future GPA; they are scenarios, not guaranteed outcomes.
        </p>

        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          role="img"
          aria-label="CGPA flight path graph"
        >
          {/* Class band lines */}
          {classLines.map((c) => (
            <g key={c.label}>
              <line
                x1={PAD_L}
                x2={W - PAD_R}
                y1={yFor(c.min)}
                y2={yFor(c.min)}
                stroke={c.tone}
                strokeWidth={1}
                strokeDasharray="4 5"
                opacity={0.3}
              />
              <text x={6} y={yFor(c.min) + 3.5} fontSize={10} fill={c.tone} fontWeight={700}>
                {c.label} {c.min.toFixed(1)}
              </text>
            </g>
          ))}

          {/* Target line */}
          <line
            x1={PAD_L}
            x2={W - PAD_R}
            y1={yFor(target)}
            y2={yFor(target)}
            stroke={COLORS.target}
            strokeWidth={2}
          />
          <text x={W - PAD_R} y={yFor(target) - 6} fontSize={11} fill={COLORS.target} fontWeight={800} textAnchor="end">
            Target {target.toFixed(2)}
          </text>

          {/* Axes */}
          <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={H - PAD_B} stroke={COLORS.axis} />
          <line x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B} stroke={COLORS.axis} />
          {Array.from({ length: Math.round(maxPoints) + 1 }, (_, g) => g).map((g) => (
            <text key={g} x={PAD_L - 8} y={yFor(g) + 4} fontSize={10} textAnchor="end" fill="#94a3b8">
              {g.toFixed(1)}
            </text>
          ))}

          {/* Required path (dashed amber) */}
          {requiredPath && (
            <path
              d={requiredPath}
              fill="none"
              stroke={COLORS.required}
              strokeWidth={2}
              strokeDasharray="7 5"
              strokeLinecap="round"
            />
          )}

          {/* Projected path (solid indigo) */}
          <path
            d={projectedPath}
            fill="none"
            stroke={COLORS.projected}
            strokeWidth={2.75}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* Milestone markers */}
          {milestones.map((m, i) => (
            <g key={i}>
              {m.isLevelEnd && (
                <line
                  x1={xFor(i)}
                  x2={xFor(i)}
                  y1={PAD_T}
                  y2={H - PAD_B}
                  stroke="#e2e8f0"
                  strokeWidth={1}
                />
              )}
              {/* projected marker */}
              <circle
                cx={xFor(i)}
                cy={yFor(m.projectedCgpa)}
                r={m.kind === 'current' ? 6 : m.isGraduation ? 6 : 4}
                fill={m.kind === 'current' ? COLORS.current : COLORS.projected}
                stroke="#fff"
                strokeWidth={1.5}
              />
              {/* required marker */}
              {m.requiredCgpa !== null && m.kind !== 'current' && (
                <circle
                  cx={xFor(i)}
                  cy={yFor(m.requiredCgpa)}
                  r={3.5}
                  fill="#fff"
                  stroke={COLORS.required}
                  strokeWidth={2}
                />
              )}
              <text
                x={xFor(i)}
                y={H - PAD_B + 18}
                fontSize={m.isGraduation ? 11 : 10}
                fontWeight={m.isLevelEnd || m.kind === 'current' ? 800 : 600}
                textAnchor="middle"
                fill={m.kind === 'current' ? COLORS.current : '#475569'}
              >
                {m.label}
              </text>
            </g>
          ))}
        </svg>

        {/* Legend */}
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-bold text-slate-600">
          <Legend color={COLORS.current} label="Current" solid />
          <Legend color={COLORS.projected} label="Projected (assumed future GPA)" solid />
          <Legend color={COLORS.required} label="Required to reach target" dashed />
          <Legend color={COLORS.target} label="Target" solid />
        </div>
        <p className="mt-2 rounded-lg bg-slate-50 px-2 py-1.5 text-[10px] leading-relaxed text-slate-500 ring-1 ring-slate-100">
          Projected and required lines are projections over results not yet
          earned — not guaranteed outcomes. Required line shows the cumulative
          CGPA you must hold at each milestone; if it rises above the{' '}
          {maxPoints.toFixed(2)} ceiling the target cannot be reached from here.
        </p>
      </Card>

      {/* ── Graduation projection ─────────────────────────────────────── */}
      {!noData && grad && (
        <Card className="print-sheet">
          <SectionTitle icon="🎓" title="Graduation projection" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-center">
            <Box label="Projected final CGPA" value={fmt2(grad.projectedCgpa)} tone="text-brand-700" />
            <Box label="Projected class" value={gradClass?.label ?? '—'} tone="text-slate-800" small />
            <Box
              label="Required future GPA"
              value={model.requiredFutureGpa === null ? '—' : fmt2(model.requiredFutureGpa)}
              tone="text-amber-600"
            />
            <Box label="Total programme credits" value={String(grad.cumulativeCredits)} tone="text-slate-800" />
          </div>
          <div className="mt-3 no-print">
            {model.requiredFutureGpa === null ? (
              <Badge tone="gray">Set a target to see the required path</Badge>
            ) : !model.targetReachable ? (
              <Badge tone="red">
                🔴 Target {fmt2(target)} is mathematically out of reach — required{' '}
                {fmt2(model.requiredFutureGpa)} exceeds the {maxPoints.toFixed(2)} ceiling
              </Badge>
            ) : (
              <Badge tone="green">
                🟢 Reachable — average about {fmt2(model.requiredFutureGpa)} over your
                remaining {grad.cumulativeCredits - record.creditHours} credits to finish on{' '}
                {fmt2(target)}
              </Badge>
            )}
          </div>
        </Card>
      )}

      {/* ── Milestone table ───────────────────────────────────────────── */}
      {!noData && (
        <Card className="print-sheet">
          <SectionTitle icon="📍" title="Milestones" subtitle="End of each level through graduation." />
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-[10px] uppercase tracking-wide text-slate-400">
                  <th className="py-1.5 pr-2">Milestone</th>
                  <th className="py-1.5 pr-2 text-right">Credits</th>
                  <th className="py-1.5 pr-2 text-right">Projected CGPA</th>
                  <th className="py-1.5 pr-2 text-right">Required CGPA</th>
                  <th className="py-1.5 pr-2 text-right">Projected class</th>
                </tr>
              </thead>
              <tbody>
                {milestones
                  .filter((m) => m.kind === 'current' || m.isLevelEnd)
                  .map((m, i) => {
                    const cls = classifyCgpa(m.projectedCgpa, classification);
                    return (
                      <tr key={i} className="border-b border-slate-100">
                        <td className="py-1.5 pr-2 font-bold text-slate-700">
                          {m.kind === 'current' ? '📍 ' : m.isGraduation ? '🎓 ' : '🏁 '}
                          {m.detail}
                        </td>
                        <td className="py-1.5 pr-2 text-right tabular-nums">{m.cumulativeCredits}</td>
                        <td className="py-1.5 pr-2 text-right font-black tabular-nums text-brand-700">
                          {fmt2(m.projectedCgpa)}
                        </td>
                        <td className="py-1.5 pr-2 text-right font-bold tabular-nums text-amber-600">
                          {m.requiredCgpa === null ? '—' : fmt2(m.requiredCgpa)}
                        </td>
                        <td className="py-1.5 pr-2 text-right text-slate-600">{cls?.label ?? '—'}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      </div>
    </div>
  );
}

function Legend({
  color,
  label,
  solid,
  dashed,
}: {
  color: string;
  label: string;
  solid?: boolean;
  dashed?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width="26" height="8">
        <line
          x1="0"
          y1="4"
          x2="26"
          y2="4"
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={dashed ? '6 4' : undefined}
        />
      </svg>
      {label}
    </span>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
  info,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
  /** Short plain-language explanation, behind a small 💡 icon. */
  info?: string;
}) {
  return (
    <div className="rounded-2xl bg-white p-3 text-center shadow-sm ring-1 ring-slate-200">
      <p className="flex items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
        <span className="truncate">{label}</span>
        {info && <Info compact label={`About: ${label}`}>{info}</Info>}
      </p>
      <p className={`mt-0.5 text-xl font-black tabular-nums ${tone ?? 'text-slate-900'}`}>{value}</p>
      {sub && <p className="text-[10px] text-slate-400">{sub}</p>}
    </div>
  );
}

function Box({
  label,
  value,
  tone,
  small,
}: {
  label: string;
  value: string;
  tone: string;
  small?: boolean;
}) {
  return (
    <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 font-black ${small ? 'text-sm' : 'text-2xl'} ${tone}`}>{value}</p>
    </div>
  );
}
