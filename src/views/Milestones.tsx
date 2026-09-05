import { useMemo, useRef, useState } from 'react';
import { useDerived } from '../state/derived';
import { Card, SectionTitle, Note, Badge, Info, TipIcon, Th, tableStyles, PrintButton } from '../components/ui';
import { ideaTip } from '../infoTips';
import { permissionOn } from '../permissions';
import { analyzeMilestones, classAt } from '../services/milestoneService';
import { progressThrough } from '../services/structureService';
import { printFileName, printSection } from '../services/scopedPrint';
import { printAppLogo } from '../config/branding';
import { getRuntimeCatalog } from '../config/runtime';
import { fmt2, clamp } from '../util/format';

const COLORS = {
  best: '#10b981', // emerald
  target: '#f59e0b', // amber
  user: '#4f46e5', // indigo
  targetLine: '#ef4444', // red target line
};

const STATUS_TONE: Record<string, string> = {
  met: 'green',
  achievable: 'green',
  'very-demanding': 'amber',
  'extremely-demanding': 'orange',
  impossible: 'red',
  unknown: 'gray',
};

export function Milestones() {
  const d = useDerived();
  const { record, grading, classification, state, progress } = d;
  const target = state.targetCgpa ?? 3.6;

  const [userGpa, setUserGpa] = useState<number>(3.2);
  const [fallbackCredits, setFallbackCredits] = useState(18);
  const [fallbackSemesters, setFallbackSemesters] = useState(6);
  const sheetRef = useRef<HTMLDivElement>(null);
  const stageTableRef = useRef<HTMLDivElement>(null);
  const positionLabel = `Level ${d.confirmedPosition.levelIndex * 100} - Sem ${d.confirmedPosition.semesterIndex}`;
  const printSheet = () =>
    printSection(sheetRef.current, {
      title: 'Print Semester Projection — Milestones',
      institutionLabel: d.institutionLabel,
      programmeName: d.programme?.name ?? '',
      curriculumVersion: d.curriculum?.versionName,
      appLogo: printAppLogo(getRuntimeCatalog().appearance),
      institutionLogo: d.university?.logo,
      fileName: printFileName(positionLabel, 'Milestones'),
    });

  /** Print ONLY the stage-by-stage table (single sheet). */
  const printStageTable = () =>
    printSection(stageTableRef.current, {
      title: 'Stage-by-Stage Milestones',
      institutionLabel: d.institutionLabel,
      programmeName: d.programme?.name ?? '',
      curriculumVersion: d.curriculum?.versionName,
      appLogo: printAppLogo(getRuntimeCatalog().appearance),
      institutionLogo: d.university?.logo,
      fileName: printFileName(positionLabel, 'Milestones Table'),
    });

  const currentLevel =
    state.mode === 'current'
      ? d.confirmedPosition.levelIndex
      : Math.max(1, Math.ceil(state.semesters.length / 2));

  const remainingSlots = useMemo(() => {
    if (state.mode === 'current') return progress.remainingSlots;
    const last = state.semesters[state.semesters.length - 1];
    if (!last) return d.curriculum ? progressThrough(d.curriculum, 1, 1).remainingSlots : [];
    return progressThrough(d.curriculum, last.levelIndex, last.semesterIndex).remainingSlots;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.mode, state.baseline.levelIndex, state.baseline.semesterIndex, state.semesters, d.curriculum]);

  const analysis = useMemo(
    () =>
      analyzeMilestones(
        {
          currentPoints: record.points,
          currentCredits: record.creditHours,
          currentCgpa: record.cgpa,
          currentLevelIndex: currentLevel,
          remainingSlots,
          targetCgpa: target,
          userGpa: clamp(userGpa, 0, d.maxPoints),
          fallbackCreditsPerSemester: fallbackCredits,
          fallbackSemesterCount: fallbackSemesters,
        },
        grading,
        classification
      ),
    [
      record.points, record.creditHours, record.cgpa, currentLevel, remainingSlots,
      target, userGpa, fallbackCredits, fallbackSemesters, d.maxPoints, grading, classification,
    ]
  );

  const noData = record.cgpa === null;

  // ── Mini 3-scenario flight path ─────────────────────────────────────
  const stages = analysis.stages;
  const totalFutureCredits = stages.reduce(
    (s, st) => Math.max(s, st.cumulativeCredits + st.creditsRemainingAfter),
    record.creditHours
  ) - record.creditHours;
  const W = 720, H = 300, PAD_L = 44, PAD_R = 16, PAD_T = 18, PAD_B = 36;
  const points = [{ label: 'Now', projected: record.cgpa ?? 0 }, ...stages.map((s) => ({ label: s.label, projected: s.projected.user }))];
  const n = points.length;
  const xFor = (i: number) => PAD_L + (n <= 1 ? 0 : (i / (n - 1)) * (W - PAD_L - PAD_R));
  const yFor = (v: number) => PAD_T + (1 - clamp(v, 0, d.maxPoints) / d.maxPoints) * (H - PAD_T - PAD_B);
  const pathFor = (key: 'best' | 'target' | 'user') => {
    const start = `${xFor(0).toFixed(1)} ${yFor(record.cgpa ?? 0).toFixed(1)}`;
    const rest = stages.map((s, i) => `${xFor(i + 1).toFixed(1)} ${yFor(s.projected[key]).toFixed(1)}`).join(' L ');
    return `M ${start}${rest ? ' L ' + rest : ''}`;
  };

  const verdict = analysis.dropVerdict;

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle
          icon="🏁"
          title="Milestones & affordable drop"
          subtitle="Stage-by-stage targets to graduation."
          info={
            <>
              Shows the milestones you need to hit each level to reach your target — and
              how far you can let a future result <strong>slip</strong> before the goal
              gets out of reach.
              <br />
              <br />
              Move the <strong>“if I get”</strong> slider to test a possible dip in your
              next GPA. All three scenarios are computed locally and temporarily — nothing
              is saved or sent.
            </>
          }
        />

        {noData && (
          <Note>Enter your current CGPA on the Calculate tab first — milestones are projected from your confirmed position.</Note>
        )}

        <div className="no-print grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="label">Your scenario GPA: {userGpa.toFixed(2)}</span>
            <input
              type="range"
              min={0}
              max={d.maxPoints}
              step={0.05}
              value={clamp(userGpa, 0, d.maxPoints)}
              onChange={(e) => setUserGpa(Number(e.target.value))}
              className="mt-3 w-full accent-indigo-600"
            />
          </label>
          <div className="flex flex-wrap items-end gap-1.5">
            <span className="w-full text-[10px] font-bold uppercase text-slate-400">Quick: “if I get…”</span>
            {[2.5, 3.0, 3.2, 3.5].map((v) => (
              <button
                key={v}
                onClick={() => setUserGpa(v)}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-bold ring-1 transition ${
                  Math.abs(userGpa - v) < 1e-9 ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'
                }`}
              >
                {v.toFixed(2)}
              </button>
            ))}
          </div>
          {analysis.fallback && (
            <div className="flex items-end gap-2">
              <label className="block">
                <span className="label">Credits/sem</span>
                {permissionOn('allowCreditEditing') ? (
                  <input type="number" min={1} max={30} className="input w-20 text-center font-black" value={fallbackCredits}
                    onChange={(e) => setFallbackCredits(clamp(Math.round(Number(e.target.value) || 1), 1, 30))} />
                ) : (
                  <p className="w-20 rounded-xl bg-slate-50 px-2 py-2 text-center font-black text-slate-700 ring-1 ring-slate-200">
                    {fallbackCredits} <span className="text-[8px] font-bold text-brand-600">🔒</span>
                  </p>
                )}
              </label>
              <label className="block">
                <span className="label">Semesters</span>
                <input type="number" min={1} max={12} className="input w-20 text-center font-black" value={fallbackSemesters}
                  onChange={(e) => setFallbackSemesters(clamp(Math.round(Number(e.target.value) || 1), 1, 12))} />
              </label>
            </div>
          )}
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          <strong className="text-indigo-700">
            “If I get {userGpa.toFixed(2)}{' '}
            {d.semesterRole === 'finish-current'
              ? 'this semester (finishing it)'
              : d.semesterRole === 'upon-release'
                ? 'in the semester I just wrote'
                : 'next semester'}
            , can I still reach {target.toFixed(2)}?”
          </strong>
        </p>
      </Card>

      {/* ── Affordable drop verdict ─────────────────────────────────── */}
      {!noData && verdict && (
        <Card className={`print-sheet ring-2 ${
          verdict.status === 'impossible' ? 'bg-red-50 ring-red-200'
            : verdict.status === 'achievable' ? 'bg-emerald-50 ring-emerald-200'
            : 'bg-amber-50 ring-amber-200'
        }`}>
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={STATUS_TONE[verdict.status] ?? 'gray'}>
              {verdict.status === 'impossible' ? '🔴' : '🟢'} {verdict.statusLabel}
            </Badge>
            <p className="flex-1 text-sm font-bold text-slate-800">{verdict.answer}</p>
          </div>
          <div className="no-print mt-3 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
            <Mini
              label="Projected CGPA after"
              value={fmt2(verdict.projectedCgpaAfter)}
              info={ideaTip('milestones.projectedAfter')}
            />
            <Mini
              label="Required future GPA"
              value={verdict.requiredFutureGpaAfter === null ? '—' : fmt2(verdict.requiredFutureGpaAfter)}
              info={ideaTip('milestones.requiredAfter')}
            />
            <Mini
              label="Best possible after"
              value={fmt2(verdict.maxPossibleFinal)}
              info={ideaTip('milestones.bestAfter')}
            />
            <Mini
              label="Credits still ahead"
              value={String(verdict.remainingCreditsAfter)}
              info={ideaTip('milestones.creditsAhead')}
            />
          </div>
        </Card>
      )}

      {!noData && permissionOn('allowPrinting') && (
        <div className="no-print flex justify-end">
          <button onClick={printSheet} className="rounded-lg bg-brand-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-brand-700">
            🖨️ Print semester projection
          </button>
        </div>
      )}

      <div ref={sheetRef}>
      {!noData && (
        <Card className="print-sheet">
          <div className="mb-1 flex items-center justify-between">
            <h3 className="text-sm font-extrabold text-slate-800">Updated flight path</h3>
          </div>
          <p className="mb-1 text-[11px] text-slate-600">
            Best case = maximum configured grade point; Target case = the steady average needed;
            Your scenario = the GPA you set (a possible drop). These are planning projections.
          </p>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Milestone scenarios graph">
            <line x1={PAD_L} x2={W - PAD_R} y1={yFor(target)} y2={yFor(target)} stroke={COLORS.targetLine} strokeWidth={2} />
            <text x={W - PAD_R} y={yFor(target) - 5} fontSize={11} fill={COLORS.targetLine} fontWeight={800} textAnchor="end">Target {target.toFixed(2)}</text>
            <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={H - PAD_B} stroke="#cbd5e1" />
            <line x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B} stroke="#cbd5e1" />
            {Array.from({ length: Math.round(d.maxPoints) + 1 }, (_, g) => g).map((g) => (
              <text key={g} x={PAD_L - 8} y={yFor(g) + 4} fontSize={10} textAnchor="end" fill="#94a3b8">{g.toFixed(1)}</text>
            ))}
            <path d={pathFor('best')} fill="none" stroke={COLORS.best} strokeWidth={2} strokeDasharray="2 0" />
            <path d={pathFor('target')} fill="none" stroke={COLORS.target} strokeWidth={2.5} strokeDasharray="7 5" />
            <path d={pathFor('user')} fill="none" stroke={COLORS.user} strokeWidth={2.75} strokeLinejoin="round" />
            {stages.map((s, i) => (
              <g key={i}>
                {s.isLevelEnd && <line x1={xFor(i + 1)} x2={xFor(i + 1)} y1={PAD_T} y2={H - PAD_B} stroke="#e2e8f0" />}
                <circle cx={xFor(i + 1)} cy={yFor(s.projected.user)} r={3.5} fill={COLORS.user} stroke="#fff" strokeWidth={1.2} />
                <text x={xFor(i + 1)} y={H - PAD_B + 16} fontSize={10} fontWeight={s.isLevelEnd || s.isGraduation ? 800 : 600} textAnchor="middle" fill="#475569">{s.label}</text>
              </g>
            ))}
            <circle cx={xFor(0)} cy={yFor(record.cgpa ?? 0)} r={5} fill="#0f172a" stroke="#fff" strokeWidth={1.5} />
            <text x={xFor(0)} y={H - PAD_B + 16} fontSize={10} fontWeight={800} textAnchor="middle" fill="#0f172a">Now</text>
          </svg>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-bold text-slate-600">
            <Legend color={COLORS.best} label={`Best case · all ${d.maxPoints.toFixed(2)}`} />
            <Legend color={COLORS.target} label="Target case · steady required average" dashed />
            <Legend color={COLORS.user} label={`Your scenario · ${userGpa.toFixed(2)}`} />
          </div>
        </Card>
      )}

      {/* ── Per-stage milestone table ───────────────────────────────── */}
      {!noData && (
        <div ref={stageTableRef}>
        <Card className="print-sheet">
          <SectionTitle icon="📍" title="Stage-by-stage milestones" subtitle="End of each remaining level through graduation." />
          {permissionOn('allowPrinting') && <PrintButton onClick={printStageTable} />}
          <div className={tableStyles.wrap}>
            <table className={`${tableStyles.table} min-w-[600px]`}>
              <thead>
                <tr className={tableStyles.headRow}>
                  <Th label="Stage" tip={ideaTip('table.ms.stage')} />
                  <Th label="Required GPA" tip={ideaTip('table.ms.requiredGpa')} right />
                  <Th label="Projected CGPA" tip={ideaTip('table.ms.projected')} right />
                  <Th label="Your scenario" tip={ideaTip('table.ms.scenario')} right />
                  <Th label="Target" tip={ideaTip('table.ms.target')} right />
                  <Th label="Max possible" tip={ideaTip('table.ms.max')} right />
                  <Th label="Credits left" tip={ideaTip('table.ms.credits')} right />
                </tr>
              </thead>
              <tbody>
                <tr className={`${tableStyles.row} bg-slate-100/60 hover:bg-slate-100`}>
                  <td className={`${tableStyles.cell} font-bold text-slate-700`}>
                    📍 Now · Level {currentLevel * 100}
                    <span className="block text-[10px] font-semibold text-slate-400">
                      {d.semesterRole === 'finish-current'
                        ? 'confirmed position — the next milestone is finishing this semester'
                        : d.semesterRole === 'upon-release'
                          ? 'confirmed position — results pending on release'
                          : 'current position'}
                    </span>
                  </td>
                  <td className={`${tableStyles.cell} text-right text-slate-300`}>—</td>
                  <td className={`${tableStyles.cell} text-right font-black tabular-nums text-slate-800`}>{fmt2(record.cgpa)}</td>
                  <td className={`${tableStyles.cell} text-right text-slate-300`}>—</td>
                  <td className={`${tableStyles.cell} text-right font-bold tabular-nums text-red-500`}>{fmt2(target)}</td>
                  <td className={`${tableStyles.cell} text-right text-slate-300`}>—</td>
                  <td className={`${tableStyles.cell} text-right tabular-nums text-slate-500`}>{stages.length ? totalFutureCredits : '—'}</td>
                </tr>
                {stages.filter((s) => s.isLevelEnd || s.isGraduation).map((s, i) => (
                  <tr key={i} className={tableStyles.row}>
                    <td className={`${tableStyles.cell} font-bold text-slate-700`}>
                      {s.isGraduation ? '🎓 ' : '🏁 '}{s.detail}
                    </td>
                    <td className={`${tableStyles.cell} text-right font-bold tabular-nums text-amber-600`}>
                      {s.requiredGpaAfter.target === null ? '—' : fmt2(s.requiredGpaAfter.target)}
                    </td>
                    <td className={`${tableStyles.cell} text-right font-black tabular-nums text-amber-700`}>{fmt2(s.projected.target)}</td>
                    <td className={`${tableStyles.cell} text-right font-bold tabular-nums ${s.reachable.user ? 'text-indigo-700' : 'text-red-600'}`}>
                      {fmt2(s.projected.user)}
                      <span className="block text-[9px] font-semibold text-slate-400">
                        {s.requiredGpaAfter.user === null ? (s.reachable.user ? 'target met' : 'short') : `then need ${fmt2(s.requiredGpaAfter.user)}`}
                      </span>
                    </td>
                    <td className={`${tableStyles.cell} text-right font-bold tabular-nums text-red-500`}>{fmt2(target)}</td>
                    <td className={`${tableStyles.cell} text-right font-bold tabular-nums text-emerald-600`}>{fmt2(s.maxPossibleCgpa)}</td>
                    <td className={`${tableStyles.cell} text-right tabular-nums text-slate-500`}>{s.creditsRemainingAfter}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
            Projected CGPA uses each scenario’s steady future GPA credit-weighted; “required GPA” is the average still needed after that stage; max possible is the configured top grade from here. These are planning scenarios — not guaranteed outcomes, and no real-world grade data is assumed.
          </p>
        </Card>
        </div>
      )}
      </div>

      {/* ── Scenario definitions ─────────────────────────────────────── */}
      {!noData && (
        <Card className="no-print">
          <SectionTitle icon="🧭" title="The three scenarios" />
          <div className="grid gap-2 sm:grid-cols-3">
            {(['best', 'target', 'user'] as const).map((id) => (
              <div key={id} className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100">
                <p className="flex items-center gap-1 text-xs font-black uppercase tracking-wide" style={{ color: COLORS[id] }}>
                  {id === 'best' ? 'Best case' : id === 'target' ? 'Target case' : 'User scenario'}
                  <TipIcon
                    tip={ideaTip(id === 'best' ? 'milestones.best' : id === 'target' ? 'milestones.target' : 'milestones.user')}
                    label="About this scenario"
                  />
                </p>
                <p className="mt-1 text-lg font-black tabular-nums text-slate-800">{analysis.scenarios[id].futureGpa.toFixed(2)}</p>
                <p className="mt-1 text-[10px] leading-relaxed text-slate-500">{analysis.scenarios[id].description}</p>
                <p className="mt-1 text-[10px] font-semibold text-slate-400">
                  {classAt(stages[stages.length - 1]?.projected[id] ?? null, classification)} at graduation
                </p>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Note>All three scenarios are computed locally and temporarily. Nothing is saved or sent, and no individual course grades or real-world pass rates are inferred.</Note>
    </div>
  );
}

function Legend({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width="26" height="8">
        <line x1="0" y1="4" x2="26" y2="4" stroke={color} strokeWidth="3" strokeLinecap="round" strokeDasharray={dashed ? '6 4' : undefined} />
      </svg>
      {label}
    </span>
  );
}

function Mini({ label, value, info }: { label: string; value: string; info?: string }) {
  return (
    <div className="rounded-xl bg-white/80 p-2.5 ring-1 ring-slate-200">
      <p className="flex items-center justify-center gap-1 text-[9px] font-bold uppercase tracking-wide text-slate-400">
        <span className="truncate">{label}</span>
        {info && <Info compact label={`About: ${label}`}>{info}</Info>}
      </p>
      <p className="text-lg font-black tabular-nums text-slate-800">{value}</p>
    </div>
  );
}
