import { useDerived } from '../state/derived';
import { Card, SectionTitle, Stat } from '../components/ui';
import { PendingProjectionPanel } from '../components/PendingProjection';
import { InstitutionSelector } from '../components/InstitutionSelector';
import { printHtml } from '../services/scopedPrint';
import { summaryReport, fullReport, pilotBriefReport } from '../services/reportComposer';
import { toolNameFor } from '../services/semesterModel';
import { fmt2, fmt1, clamp } from '../util/format';

type Tab =
  | 'calculate'
  | 'target'
  | 'whatif'
  | 'flight'
  | 'milestones'
  | 'next'
  | 'print'
  | 'privacy';

const STATUS_TONE: Record<string, string> = {
  met: 'bg-emerald-50 ring-emerald-300 text-emerald-800',
  achievable: 'bg-emerald-50 ring-emerald-300 text-emerald-800',
  'very-demanding': 'bg-amber-50 ring-amber-300 text-amber-800',
  'extremely-demanding': 'bg-orange-50 ring-orange-300 text-orange-800',
  impossible: 'bg-red-50 ring-red-300 text-red-800',
  unknown: 'bg-slate-100 ring-slate-200 text-slate-600',
};

export function Dashboard({ onNavigate }: { onNavigate: (t: Tab) => void }) {
  const d = useDerived();
  const { record, dispatch, state } = d;

  const start = (mode: 'quick' | 'history' | 'planning') => {
    dispatch({ type: 'setInputMode', inputMode: mode });
    onNavigate('calculate');
  };

  const model = d.dashboard;
  const flight = model.flightPath.milestones;
  const positionRemainingCredits =
    d.state.mode === 'current' && d.progress.hasCreditData
      ? d.progress.remainingCredits
      : Math.max(0, d.totalProgrammeCredits - record.creditHours);

  const branding = {
    title: 'Pilot Brief',
    institutionLabel: model.institutionLabel,
    programmeName: d.programme?.name ?? '',
    curriculumVersion: model.curriculumVersion ?? undefined,
  };
  const printSummary = () => printHtml([summaryReport(model)], { ...branding, title: 'Print Summary' });
  const printBrief = () => printHtml([pilotBriefReport(model)], branding);
  const printFull = () =>
    printHtml(fullReport(model), { ...branding, title: 'Full Report' });

  return (
    <div className="space-y-4">
      {/* Institution selection (in-memory, config-driven) */}
      <div className="no-print">
        <InstitutionSelector compact />
      </div>

      {/* Quick start modes */}
      <div className="no-print grid grid-cols-1 gap-2 sm:grid-cols-3">
        {[
          { id: 'quick' as const, icon: '⚡', title: 'Quick mode', hint: 'Current level + CGPA' },
          { id: 'history' as const, icon: '📚', title: 'GPA History', hint: 'Enter each semester GPA' },
          { id: 'planning' as const, icon: '🗺️', title: 'Planning mode', hint: 'Target + future scenarios' },
        ].map((m) => (
          <button
            key={m.id}
            onClick={() => start(m.id)}
            className="rounded-2xl bg-white p-4 text-left shadow-sm ring-1 ring-slate-200 transition hover:ring-brand-400"
          >
            <span className="text-2xl">{m.icon}</span>
            <p className="mt-1 text-sm font-extrabold text-slate-800">{m.title}</p>
            <p className="text-[11px] text-slate-500">{m.hint}</p>
          </button>
        ))}
      </div>

      {/* ── CURRENT POSITION / DESTINATION hero ─────────────────────── */}
      <Card className="print-sheet overflow-hidden bg-gradient-to-br from-brand-700 via-brand-600 to-indigo-900 text-white ring-0">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-200">
              Current position
            </p>
            <p className="mt-1 text-5xl font-black tabular-nums leading-none">
              {fmt2(model.currentCgpa)}
            </p>
            <p className="mt-2 text-xs font-semibold text-brand-100">
              🏅 {model.currentClassLabel ?? 'Awaiting data'}
            </p>
            <p className="text-xs text-brand-200">
              Level {model.currentLevel * 100} · {model.creditsCompleted} graded credits
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-200">
              Destination
            </p>
            <p className="mt-1 text-5xl font-black tabular-nums leading-none text-emerald-300">
              {fmt2(model.targetCgpa)}
            </p>
            <p className="mt-2 text-xs font-semibold text-brand-100">
              🎯 {model.targetClassLabel}
            </p>
            <p className="text-xs text-brand-200">target classification</p>
          </div>
        </div>
        <div className="no-print mt-4 flex flex-wrap items-center justify-end gap-2">
          <button
            onClick={printBrief}
            className="rounded-lg bg-white/15 px-3 py-1.5 text-[11px] font-bold text-white ring-1 ring-white/25 hover:bg-white/25"
          >
            🖨️ Print Pilot Brief
          </button>
          <button
            onClick={printSummary}
            className="rounded-lg bg-white/15 px-3 py-1.5 text-[11px] font-bold text-white ring-1 ring-white/25 hover:bg-white/25"
          >
            🖨️ Print Summary
          </button>
          <button
            onClick={printFull}
            className="rounded-lg bg-white/25 px-3 py-1.5 text-[11px] font-bold text-white ring-1 ring-white/30 hover:bg-white/35"
          >
            🖨️ Print Full Report
          </button>
        </div>
      </Card>

      {/* ── FLIGHT STATUS ─────────────────────────────────────────── */}
      <Card className={`print-sheet ring-2 ${STATUS_TONE[model.status] ?? STATUS_TONE.unknown}`}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-3xl leading-none">{model.statusEmoji}</span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-70">
              Flight status
            </p>
            <p className="text-xl font-black">{model.statusLabel}</p>
          </div>
        </div>
      </Card>

      {/* ── Required performance + Next mission + Projected destination ── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card className="print-sheet text-center">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Required future avg GPA
          </p>
          <p className="mt-1 text-3xl font-black tabular-nums text-amber-600">
            {model.requiredFutureGpa === null ? '—' : fmt2(model.requiredFutureGpa)}
          </p>
          <p className="text-[10px] text-slate-400">over {positionRemainingCredits} remaining cr</p>
          <p className="mt-1 text-[10px] font-semibold text-emerald-600">
            Max possible final: {model.maxPossibleFinalCgpa === null ? '—' : fmt2(model.maxPossibleFinalCgpa)}
          </p>
        </Card>

        <Card className="print-sheet">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            {d.semesterRole === 'upon-release'
              ? '📋 Upon release'
              : d.semesterRole === 'finish-current'
                ? '▶️ Current mission'
                : '▶️ Next mission'}
          </p>
          {model.next ? (
            <>
              <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">
                {d.semesterRole === 'upon-release'
                  ? 'Semester you just wrote'
                  : d.semesterRole === 'finish-current'
                    ? 'Finish this semester'
                    : 'Next semester'}
              </p>
              <p className="mt-0.5 text-sm font-black text-slate-800">{model.next.next.label}</p>
              <p className="mt-1 text-2xl font-black tabular-nums text-brand-700">
                {fmt2(model.next.requiredNextGpa)}
              </p>
              <p className="text-[10px] text-slate-500">
                {d.semesterRole === 'upon-release' ? 'steady avg' : 'required GPA'} · {model.next.next.credits} credits
              </p>
              <p className="mt-1 text-[10px] font-semibold text-emerald-700">
                Target: {model.next.targetClassLabel}
              </p>
            </>
          ) : (
            <p className="mt-1 text-xs text-slate-400">Enter your CGPA to see what lies ahead.</p>
          )}
          <button
            onClick={() => onNavigate('next')}
            className="no-print mt-2 w-full rounded-lg bg-brand-50 px-2 py-1 text-[10px] font-bold text-brand-700 hover:bg-brand-100"
          >
            Open {toolNameFor(d.semesterRole)} →
          </button>
        </Card>

        <Card className="print-sheet text-center">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Projected destination
          </p>
          <p className="mt-1 text-3xl font-black tabular-nums text-indigo-700">
            {model.projectedFinalCgpa === null ? '—' : fmt2(model.projectedFinalCgpa)}
          </p>
          <p className="text-[10px] font-semibold text-slate-500">{model.projectedClassLabel ?? '—'}</p>
          <p className="text-[10px] text-slate-400">on the planned steady average</p>
          <button
            onClick={() => onNavigate('flight')}
            className="no-print mt-2 w-full rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600 hover:bg-slate-200"
          >
            See flight path →
          </button>
        </Card>
      </div>

      {/* ── Compact flight path ───────────────────────────────────── */}
      {model.hasData && flight.length > 1 && (
        <Card className="print-sheet">
          <div className="mb-1 flex items-center justify-between">
            <h3 className="text-sm font-extrabold text-slate-800">Flight path</h3>
            <button onClick={() => onNavigate('flight')} className="no-print text-[11px] font-bold text-brand-600">
              Enlarge →
            </button>
          </div>
          <CompactFlight
            milestones={flight}
            current={model.currentCgpa ?? 0}
            target={model.targetCgpa}
            max={d.maxPoints}
          />
        </Card>
      )}

      {/* Pending results */}
      {record.pendingCount > 0 && (
        <div className="no-print">
          <PendingProjectionPanel pending={d.pending} target={state.targetCgpa} />
        </div>
      )}

      {/* ── Pilot brief ───────────────────────────────────────────── */}
      <Card className="print-sheet">
        <SectionTitle icon="🗣️" title="Pilot Brief" subtitle="Your co-pilot's concise status read-out" />
        <ul className="space-y-2">
          {model.brief.map((line, i) => (
            <li key={i} className="flex gap-2 text-sm leading-relaxed text-slate-700">
              <span className="mt-0.5 text-brand-500">▸</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </Card>

      {/* Quick stats */}
      <div className="no-print grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Semesters" value={d.state.semesters.length} />
        <Stat
          label="Courses logged"
          value={d.state.semesters.reduce(
            (n, s) => n + s.courses.filter((c) => c.grade || c.score !== null).length,
            0
          )}
        />
        <Stat label="Pending" value={record.pendingCount} sub={`${record.pendingCreditHours} cr.`} />
        <Stat label="Graded points" value={fmt1(record.points)} />
      </div>

      {/* Navigation */}
      <Card className="no-print">
        <SectionTitle icon="🧭" title="Navigation" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {[
            { t: 'calculate' as Tab, icon: '🧮', label: 'Calculate CGPA' },
            { t: 'target' as Tab, icon: '🎯', label: 'Target & Feasibility' },
            { t: 'whatif' as Tab, icon: '🔀', label: 'What-If Simulator' },
            { t: 'flight' as Tab, icon: '🛩️', label: 'Flight Path' },
            { t: 'milestones' as Tab, icon: '🏁', label: 'Milestones & Drops' },
            { t: 'next' as Tab, icon: '▶️', label: toolNameFor(d.semesterRole) },
            { t: 'print' as Tab, icon: '🖨️', label: 'Print Brief' },
          ].map((a) => (
            <button
              key={a.t}
              onClick={() => onNavigate(a.t)}
              className="flex flex-col items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-2 py-3 text-center transition hover:border-brand-300 hover:bg-brand-50"
            >
              <span className="text-xl">{a.icon}</span>
              <span className="text-[11px] font-bold text-slate-700">{a.label}</span>
            </button>
          ))}
        </div>
        <button
          onClick={() => onNavigate('privacy')}
          className="mt-3 w-full rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 ring-1 ring-emerald-200 transition hover:bg-emerald-100"
        >
          🔒 No account required. Your academic information is not saved or shared.
        </button>
      </Card>

      {!d.curriculumPublished && (
        <p className="no-print rounded-xl bg-amber-50 px-3 py-2 text-center text-[11px] leading-relaxed text-amber-700 ring-1 ring-amber-200">
          The {d.programme?.shortName} course curriculum has not been published
          yet — you can still calculate freely. The administrator configures
          real courses; CGPA PILOT never invents them.
        </p>
      )}

      <p className="no-print px-2 text-center text-[10px] leading-relaxed text-slate-400">
        {d.university.shortName} grading &amp; classification per published
        university rules · CGPA PILOT is an unofficial planning aid, not an
        academic record.
      </p>
    </div>
  );
}

/** Compact sparkline-style trajectory graph for the dashboard. */
function CompactFlight({
  milestones,
  current,
  target,
  max,
}: {
  milestones: { projectedCgpa: number; label: string; isGraduation: boolean }[];
  current: number;
  target: number;
  max: number;
}) {
  const W = 320;
  const H = 120;
  const PAD_L = 8;
  const PAD_R = 8;
  const PAD_T = 10;
  const PAD_B = 18;
  const pts = [current, ...milestones.map((m) => m.projectedCgpa)];
  const n = pts.length;
  const x = (i: number) => PAD_L + (i / Math.max(1, n - 1)) * (W - PAD_L - PAD_R);
  const y = (v: number) => PAD_T + (1 - clamp(v, 0, max) / max) * (H - PAD_T - PAD_B);
  const line = pts.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Compact flight path">
      <line x1={PAD_L} x2={W - PAD_R} y1={y(target)} y2={y(target)} stroke="#10b981" strokeWidth={1.5} />
      <path d={line} fill="none" stroke="#4f46e5" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(0)} cy={y(current)} r={4} fill="#0f172a" />
      <circle cx={x(n - 1)} cy={y(pts[n - 1])} r={4} fill="#4f46e5" stroke="#fff" strokeWidth={1} />
      <text x={x(0)} y={H - 5} fontSize={9} fontWeight={700} textAnchor="middle" fill="#0f172a">Now</text>
      <text x={x(n - 1)} y={H - 5} fontSize={9} fontWeight={700} textAnchor="middle" fill="#4f46e5">Grad</text>
      <text x={W - PAD_R} y={y(target) - 3} fontSize={9} fontWeight={700} textAnchor="end" fill="#10b981">
        Target {target.toFixed(2)}
      </text>
    </svg>
  );
}
