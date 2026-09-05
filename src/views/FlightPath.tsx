import { useMemo, useRef, useState } from 'react';
import { useDerived } from '../state/derived';
import { Card, SectionTitle, Note, Badge, Info, TipIcon, Th, tableStyles, PrintButton } from '../components/ui';
import { ideaTip } from '../infoTips';
import { buildFlightPath } from '../services/flightPathService';
import { classifyCgpa } from '../services/classificationService';
import { progressThrough } from '../services/structureService';
import { printFileName, printSection, printHtml, type PrintBranding } from '../services/scopedPrint';
import { printAppLogo } from '../config/branding';
import { getRuntimeCatalog } from '../config/runtime';
import { permissionOn } from '../permissions';
import { smoothPath, smoothAreaPath, type Pt } from '../util/curve';
import { fmt2, clamp } from '../util/format';
import type { MouseEvent as RMouseEvent } from 'react';

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

// Graph geometry (viewBox scales responsively).
const W = 720;
const H = 340;
const PAD_L = 46;
const PAD_R = 18;
const PAD_T = 20;
const PAD_B = 40;

/** Clone an element for the "print entire page" sheet, dropping screen-only bits. */
function cleanSheet(el: HTMLElement | null): string | null {
  if (!el) return null;
  const c = el.cloneNode(true) as HTMLElement;
  c.classList.remove('no-print');
  c.querySelectorAll('.no-print').forEach((n) => n.remove());
  return c.outerHTML;
}

export function FlightPathView() {
  const d = useDerived();
  const { record, classification, grading, maxPoints, state, progress } = d;

  const [assumedGpa, setAssumedGpa] = useState<number | null>(null);
  const [fallbackCredits, setFallbackCredits] = useState(18);
  const [fallbackSemesters, setFallbackSemesters] = useState(6);
  const graphRef = useRef<HTMLDivElement>(null);
  const statsRef = useRef<HTMLDivElement>(null);
  const gradRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const printBranding = (title: string, docName: string): PrintBranding => ({
    title,
    institutionLabel: d.institutionLabel,
    programmeName: d.programme?.name ?? '',
    curriculumVersion: d.curriculum?.versionName,
    appLogo: printAppLogo(getRuntimeCatalog().appearance),
    institutionLogo: d.university?.logo,
    fileName: printFileName(
      `Level ${d.confirmedPosition.levelIndex * 100} - Sem ${d.confirmedPosition.semesterIndex}`,
      docName
    ),
  });

  /** Print just the graph sheet. */
  const printGraph = () =>
    printSection(graphRef.current, printBranding('Print Flight Path', 'Flight Path'));

  /** Print the entire page: summary strip + graph + graduation + milestones. */
  const printPage = () => {
    const sheets = [statsRef.current, graphRef.current, gradRef.current, tableRef.current]
      .map(cleanSheet)
      .filter((h): h is string => !!h);
    if (sheets.length === 0) return;
    printHtml(
      sheets.map((html) => ({ html })),
      printBranding('Flight Path — Entire Page', 'Flight Path Full')
    );
  };

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

  // ── Graph geometry ────────────────────────────────────────────────────
  const n = milestones.length;
  const xFor = (i: number) =>
    PAD_L + (n <= 1 ? 0 : (i / (n - 1)) * (W - PAD_L - PAD_R));
  const yFor = (cgpa: number) =>
    PAD_T + (1 - clamp(cgpa, 0, maxPoints) / maxPoints) * (H - PAD_T - PAD_B);

  // Smoothed geometry (Catmull-Rom → Bézier) for the flight-path curves.
  const projPts: Pt[] = milestones.map((m, i) => ({ x: xFor(i), y: yFor(m.projectedCgpa) }));
  const projectedSmooth = smoothPath(projPts);
  const areaPath = smoothAreaPath(projPts, H - PAD_B);
  const reqRuns: Pt[][] = (() => {
    const runs: Pt[][] = [];
    let run: Pt[] = [];
    milestones.forEach((m, i) => {
      if (m.requiredCgpa === null) {
        if (run.length) {
          runs.push(run);
          run = [];
        }
      } else {
        run.push({ x: xFor(i), y: yFor(m.requiredCgpa) });
      }
    });
    if (run.length) runs.push(run);
    return runs;
  })();
  // Alternately shade the plot columns of each level so levels stand out.
  const levelShades: { x1: number; x2: number }[] = (() => {
    const ends = milestones
      .map((m, i) => ({ m, i }))
      .filter((e) => e.m.isLevelEnd || e.m.isGraduation);
    const out: { x1: number; x2: number }[] = [];
    for (let k = 0; k < ends.length - 1; k++) {
      if (k % 2 === 1) out.push({ x1: xFor(ends[k].i), x2: xFor(ends[k + 1].i) });
    }
    return out;
  })();
  const gridTicks = Array.from({ length: Math.round(maxPoints) + 1 }, (_, g) => g);

  // Nearest-milestone hover for inspecting values.
  function onHoverMove(e: RMouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    const x = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < n; i++) {
      const dd = Math.abs(xFor(i) - x);
      if (dd < bd) {
        bd = dd;
        best = i;
      }
    }
    setHover(best);
  }

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
            <span className="label flex items-center gap-1">
              Assumed future GPA: {(assumedGpa ?? record.cgpa ?? target).toFixed(2)}
              <TipIcon tip={ideaTip('flight.assumeGpa')} label="About assumed future GPA" />
            </span>
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
            <div className="flex items-center gap-1.5 self-end">
              <button
                onClick={() =>
                  setAssumedGpa(
                    clamp(model.requiredFutureGpa ?? target, 0, maxPoints)
                  )
                }
                className="rounded-lg bg-amber-100 px-2 py-2 text-[11px] font-bold text-amber-800 ring-1 ring-amber-300 hover:bg-amber-200"
              >
                Fly the required line ({fmt2(model.requiredFutureGpa)})
              </button>
              <TipIcon tip={ideaTip('flight.flyRequired')} label="About the required line" />
            </div>
          )}
          {model.fallback && (
            <>
              <label className="block">
                <span className="label">Credits / semester</span>
                {permissionOn('allowCreditEditing') ? (
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
                ) : (
                  <p className="input bg-slate-50 text-center font-black text-slate-700">
                    {fallbackCredits}{' '}
                    <span className="align-middle text-[9px] font-bold text-brand-600">🔒 locked</span>
                  </p>
                )}
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
      <div ref={statsRef} className="no-print grid grid-cols-2 gap-2 sm:grid-cols-4">
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

      {/* ── Print actions (kept outside the printable refs) ───────────── */}
      {permissionOn('allowPrinting') && (
        <div className="no-print flex flex-wrap justify-end gap-2">
          <button
            onClick={printPage}
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-brand-700"
          >
            📄 Print entire page
          </button>
          <button
            onClick={printGraph}
            className="rounded-lg bg-white px-3 py-1.5 text-[11px] font-bold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
          >
            🖨️ Print graph
          </button>
        </div>
      )}

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

        <div className="relative">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full"
            role="img"
            aria-label="CGPA flight path graph"
            onMouseMove={onHoverMove}
            onMouseLeave={() => setHover(null)}
          >
            <defs>
              <linearGradient id="fp-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={COLORS.projected} stopOpacity={0.2} />
                <stop offset="100%" stopColor={COLORS.projected} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="fp-line" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#312e81" />
                <stop offset="100%" stopColor="#6366f1" />
              </linearGradient>
              <clipPath id="fp-plot">
                <rect
                  x={PAD_L}
                  y={PAD_T - 8}
                  width={W - PAD_L - PAD_R}
                  height={H - PAD_T - PAD_B + 8}
                />
              </clipPath>
            </defs>

            {/* Level column shading (alternating) */}
            {levelShades.map((s, i) => (
              <rect
                key={i}
                x={s.x1}
                y={PAD_T}
                width={Math.max(0, s.x2 - s.x1)}
                height={H - PAD_T - PAD_B}
                fill="#eef2ff"
                opacity={0.4}
              />
            ))}

            {/* Horizontal gridlines */}
            {gridTicks.map((g) => (
              <line
                key={g}
                x1={PAD_L}
                x2={W - PAD_R}
                y1={yFor(g)}
                y2={yFor(g)}
                stroke="#e2e8f0"
                strokeWidth={1}
                strokeDasharray="2 5"
              />
            ))}

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
                  opacity={0.35}
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
            {gridTicks.map((g) => (
              <text key={g} x={PAD_L - 8} y={yFor(g) + 4} fontSize={10} textAnchor="end" fill="#94a3b8">
                {g.toFixed(1)}
              </text>
            ))}

            {/* Curves (clipped to the plot) */}
            <g clipPath="url(#fp-plot)">
              {/* Gradient area under the projected curve */}
              <path d={areaPath} fill="url(#fp-area)" />
              {/* Required path (smooth dashed amber) */}
              {reqRuns.map((run, i) =>
                run.length > 1 ? (
                  <path
                    key={i}
                    d={smoothPath(run)}
                    fill="none"
                    stroke={COLORS.required}
                    strokeWidth={2}
                    strokeDasharray="7 5"
                    strokeLinecap="round"
                  />
                ) : null
              )}
              {/* Projected path (smooth gradient indigo) */}
              <path
                d={projectedSmooth}
                fill="none"
                stroke="url(#fp-line)"
                strokeWidth={3}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </g>

            {/* Hover guide */}
            {hover !== null && (
              <line
                x1={xFor(hover)}
                x2={xFor(hover)}
                y1={PAD_T}
                y2={H - PAD_B}
                stroke="#64748b"
                strokeWidth={1}
                strokeDasharray="3 3"
                opacity={0.7}
              />
            )}

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
                {/* graduation halo */}
                {m.isGraduation && (
                  <circle
                    cx={xFor(i)}
                    cy={yFor(m.projectedCgpa)}
                    r={10}
                    fill="none"
                    stroke={COLORS.projected}
                    strokeWidth={2}
                    opacity={0.35}
                  />
                )}
                {/* projected marker (grows on hover) */}
                <circle
                  cx={xFor(i)}
                  cy={yFor(m.projectedCgpa)}
                  r={
                    hover === i
                      ? m.kind === 'current'
                        ? 8
                        : 6
                      : m.kind === 'current'
                        ? 6
                        : m.isGraduation
                          ? 6
                          : 4
                  }
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

            {/* Value pills at the journey's start and end */}
            {projPts.length > 0 && (
              <Pill
                x={projPts[0].x}
                y={projPts[0].y}
                text={fmt2(milestones[0].projectedCgpa)}
                clampLeft={PAD_L + 4}
              />
            )}
            {projPts.length > 1 && (
              <Pill
                x={projPts[projPts.length - 1].x}
                y={projPts[projPts.length - 1].y}
                text={fmt2(milestones[milestones.length - 1].projectedCgpa)}
                clampRight={W - PAD_R - 4}
              />
            )}
          </svg>

          {/* Hover tooltip (screen only) */}
          {hover !== null && (
            <div
              className="no-print pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-xl bg-slate-900/95 px-3 py-2 text-[10px] font-bold leading-relaxed text-white shadow-lg"
              style={{ left: `${Math.min(84, Math.max(16, (xFor(hover) / W) * 100))}%` }}
            >
              <p className="font-black">{milestones[hover].detail}</p>
              <p className="text-indigo-300">Projected {fmt2(milestones[hover].projectedCgpa)}</p>
              <p className="text-amber-300">
                Required {milestones[hover].requiredCgpa === null ? '—' : fmt2(milestones[hover].requiredCgpa)}
              </p>
              <p className="text-emerald-300">Target {fmt2(target)}</p>
            </div>
          )}
        </div>

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
        <div ref={gradRef}>
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
        </div>
      )}

      {/* ── Milestone table ───────────────────────────────────────────── */}
      {!noData && (
        <div ref={tableRef}>
        <Card className="print-sheet">
          <SectionTitle icon="📍" title="Milestones" subtitle="End of each level through graduation." />
          {permissionOn('allowPrinting') && (
            <PrintButton
              onClick={() =>
                printSection(tableRef.current, printBranding('Milestones', 'Milestones Table'))
              }
            />
          )}
          <div className={tableStyles.wrap}>
            <table className={tableStyles.table}>
              <thead>
                <tr className={tableStyles.headRow}>
                  <Th label="Milestone" tip={ideaTip('table.fm.milestone')} />
                  <Th label="Credits" tip={ideaTip('table.fm.credits')} right />
                  <Th label="Projected CGPA" tip={ideaTip('table.fm.projected')} right />
                  <Th label="Required CGPA" tip={ideaTip('table.fm.required')} right />
                  <Th label="Projected class" tip={ideaTip('table.fm.class')} right />
                </tr>
              </thead>
              <tbody>
                {milestones
                  .filter((m) => m.kind === 'current' || m.isLevelEnd)
                  .map((m, i) => {
                    const cls = classifyCgpa(m.projectedCgpa, classification);
                    return (
                      <tr key={i} className={tableStyles.row}>
                        <td className={`${tableStyles.cell} font-bold text-slate-700`}>
                          {m.kind === 'current' ? '📍 ' : m.isGraduation ? '🎓 ' : '🏁 '}
                          {m.detail}
                        </td>
                        <td className={`${tableStyles.cell} text-right tabular-nums`}>{m.cumulativeCredits}</td>
                        <td className={`${tableStyles.cell} text-right font-black tabular-nums text-brand-700`}>
                          {fmt2(m.projectedCgpa)}
                        </td>
                        <td className={`${tableStyles.cell} text-right font-bold tabular-nums text-amber-600`}>
                          {m.requiredCgpa === null ? '—' : fmt2(m.requiredCgpa)}
                        </td>
                        <td className={`${tableStyles.cell} text-right text-slate-600`}>{cls?.label ?? '—'}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </Card>
        </div>
      )}
      </div>
    </div>
  );
}

/** Small dark value pill above a graph point (clamped inside the plot). */
function Pill({
  x,
  y,
  text,
  clampLeft,
  clampRight,
}: {
  x: number;
  y: number;
  text: string;
  clampLeft?: number;
  clampRight?: number;
}) {
  const w = text.length * 6.4 + 16;
  const cx = Math.min(clampRight ?? W - 4, Math.max(clampLeft ?? 4, x));
  const above = y > PAD_T + 36;
  const ry = above ? y - 34 : y + 14;
  return (
    <g>
      <rect x={cx - w / 2} y={ry} width={w} height={20} rx={10} fill="#0f172a" opacity={0.9} />
      <text x={cx} y={ry + 14} fontSize={11} fontWeight={800} fill="#fff" textAnchor="middle">
        {text}
      </text>
    </g>
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
