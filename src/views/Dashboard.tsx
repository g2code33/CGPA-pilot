import { useDerived } from '../state/derived';
import { Card, SectionTitle, Stat } from '../components/ui';
import { buildBrief } from '../services/pilotBriefService';
import { classifyCgpa } from '../services/classificationService';
import { fmt2, fmt1 } from '../util/format';

type Tab = 'calculate' | 'target' | 'whatif' | 'flight' | 'next' | 'print' | 'privacy';

export function Dashboard({ onNavigate }: { onNavigate: (t: Tab) => void }) {
  const d = useDerived();
  const { record, classBand } = d;

  const targetClass = d.state.targetCgpa
    ? classifyCgpa(d.state.targetCgpa, d.classification)
    : null;

  const brief = buildBrief({
    cgpa: record.cgpa,
    creditHours: record.creditHours,
    pendingCreditHours: record.pendingCreditHours,
    pendingCount: record.pendingCount,
    target: d.state.targetCgpa,
    remainingCreditHours: 0,
    classification: classBand,
    targetClassLabel: targetClass?.label ?? 'target',
    maxPoints: d.maxPoints,
  });

  const atTarget =
    record.cgpa !== null && d.state.targetCgpa !== null
      ? record.cgpa >= d.state.targetCgpa
      : null;

  return (
    <div className="space-y-4">
      {/* Context strip */}
      <div className="flex flex-wrap items-center gap-2 px-1 text-[11px] font-semibold text-slate-500">
        <span className="rounded-full bg-brand-50 px-2.5 py-1 text-brand-700 ring-1 ring-brand-200">
          🏛 {d.university.name}
        </span>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 ring-1 ring-slate-200">
          {d.school?.name} · {d.programme?.shortName}
        </span>
        {d.curriculum && (
          <span
            className={`rounded-full px-2.5 py-1 ring-1 ${
              d.curriculumPublished
                ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                : 'bg-amber-50 text-amber-700 ring-amber-200'
            }`}
            title={`Curriculum: ${d.curriculum.versionName}`}
          >
            {d.curriculumPublished ? '📗 Published curriculum' : '📒 Awaiting published curriculum'}
          </span>
        )}
      </div>

      {/* Hero CGPA instrument */}
      <Card className="overflow-hidden bg-gradient-to-br from-brand-700 via-brand-600 to-indigo-900 text-white ring-0">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand-200">
              Current CGPA
            </p>
            <div className="mt-1 flex items-end gap-2">
              <span className="text-6xl font-black tabular-nums leading-none">
                {fmt2(record.cgpa)}
              </span>
              <span className="pb-1 text-sm text-brand-200">/ {d.maxPoints.toFixed(2)}</span>
            </div>
            <p className="mt-2 text-xs text-brand-200">
              {record.creditHours} graded credits · {fmt1(record.points)} grade points
            </p>
          </div>
          <div className="text-right">
            {classBand ? (
              <span className="inline-block rounded-full bg-white/15 px-3 py-1 text-[11px] font-bold ring-1 ring-white/25">
                🏅 {classBand.label}
              </span>
            ) : (
              <span className="inline-block rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold text-brand-200">
                Awaiting data
              </span>
            )}
          </div>
        </div>

        <div className="mt-4">
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/15">
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber-300 to-emerald-300 transition-all"
              style={{ width: `${Math.min(100, ((record.cgpa ?? 0) / d.maxPoints) * 100)}%` }}
            />
          </div>
          <div className="mt-1.5 flex justify-between text-[10px] font-semibold text-brand-200">
            <span>0.00</span>
            <span>
              Target {d.state.targetCgpa ? fmt2(d.state.targetCgpa) : '—'}
              {atTarget === true && ' · ✅ on track'}
              {atTarget === false && ' · ⬆️ below target'}
            </span>
            <span>4.00</span>
          </div>
        </div>
      </Card>

      {record.pendingCount > 0 && (
        <div className="flex items-center justify-between rounded-2xl bg-amber-50 px-4 py-3 ring-1 ring-amber-200">
          <p className="text-xs font-semibold text-amber-800">
            ⏳ {record.pendingCount} pending result{record.pendingCount === 1 ? '' : 's'} (
            {record.pendingCreditHours} credits) excluded from CGPA.
          </p>
          <button
            onClick={() => onNavigate('whatif')}
            className="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-amber-700"
          >
            Preview
          </button>
        </div>
      )}

      {/* Pilot Brief */}
      <Card>
        <SectionTitle icon="🗣️" title="Pilot Brief" subtitle="Your co-pilot's status read-out" />
        <ul className="space-y-2">
          {brief.map((line, i) => (
            <li key={i} className="flex gap-2 text-sm leading-relaxed text-slate-700">
              <span className="mt-0.5 text-brand-500">▸</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Semesters" value={d.state.semesters.length} />
        <Stat
          label="Courses logged"
          value={d.state.semesters.reduce(
            (n, s) => n + s.courses.filter((c) => c.grade || c.score !== null).length,
            0
          )}
        />
        <Stat label="Pending" value={record.pendingCount} sub={`${record.pendingCreditHours} cr.`} />
        <Stat label="Mode" value={d.state.mode === 'history' ? 'GPA History' : 'Current CGPA'} />
      </div>

      <Card>
        <SectionTitle icon="🧭" title="Navigation" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {[
            { t: 'calculate' as Tab, icon: '🧮', label: 'Calculate CGPA' },
            { t: 'target' as Tab, icon: '🎯', label: 'Target & Feasibility' },
            { t: 'whatif' as Tab, icon: '🔀', label: 'What-If Simulator' },
            { t: 'flight' as Tab, icon: '🛩️', label: 'Flight Path' },
            { t: 'next' as Tab, icon: '▶️', label: 'Next Semester Pilot' },
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
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-center text-[11px] leading-relaxed text-amber-700 ring-1 ring-amber-200">
          The {d.programme?.shortName} course curriculum has not been published
          yet — you can still calculate freely. The administrator configures
          real courses; CGPA PILOT never invents them.
        </p>
      )}

      <p className="px-2 text-center text-[10px] leading-relaxed text-slate-400">
        {d.university.shortName} grading &amp; classification per published
        university rules · CGPA PILOT is an unofficial planning aid, not an
        academic record.
      </p>
    </div>
  );
}
