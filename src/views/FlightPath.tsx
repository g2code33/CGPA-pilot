import { useMemo, useState } from 'react';
import { useDerived } from '../state/derived';
import { Card, SectionTitle, Note } from '../components/ui';
import { flightPath } from '../services/projectionService';
import { classifyCgpa } from '../services/classificationService';
import { fmt2, clamp } from '../util/format';

const CLASS_LINES: { label: string; min: number; tone: string }[] = [
  { label: 'First', min: 3.6, tone: '#f59e0b' },
  { label: '2:1', min: 3.0, tone: '#10b981' },
  { label: '2:2', min: 2.5, tone: '#14b8a6' },
  { label: '3rd', min: 2.0, tone: '#0ea5e9' },
  { label: 'Pass', min: 1.0, tone: '#94a3b8' },
];

export function FlightPathView() {
  const d = useDerived();
  const { record, classification } = d;

  const [semesterCount, setSemesterCount] = useState(6);
  const [perSemesterCredits, setPerSemesterCredits] = useState(18);
  const [assumedGpa, setAssumedGpa] = useState(3.6);

  const semesterCredits = useMemo(
    () => Array.from({ length: semesterCount }, () => perSemesterCredits),
    [semesterCount, perSemesterCredits]
  );

  const path = useMemo(
    () =>
      flightPath(
        record.points,
        record.creditHours,
        semesterCredits,
        assumedGpa
      ),
    [record.points, record.creditHours, semesterCredits, assumedGpa]
  );

  const finalPoint = path[path.length - 1];
  const finalClass = classifyCgpa(finalPoint?.cgpa ?? null, classification);

  const W = 640;
  const H = 300;
  const PAD_L = 44;
  const PAD_R = 16;
  const PAD_T = 18;
  const PAD_B = 34;
  const xFor = (i: number) =>
    PAD_L + (i / Math.max(1, path.length - 1)) * (W - PAD_L - PAD_R);
  const yFor = (cgpa: number) =>
    PAD_T + (1 - cgpa / 4) * (H - PAD_T - PAD_B);

  const linePath = path
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i).toFixed(1)} ${yFor(p.cgpa).toFixed(1)}`)
    .join(' ');

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle
          icon="🛩️"
          title="Flight Path"
          subtitle="Projected CGPA at each future semester if you hold a steady average. Watch where your path lands."
        />

        {record.cgpa === null && (
          <Note>
            Enter your record on the Calculate tab to plot a flight path from
            where you are now.
          </Note>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-xs font-bold uppercase text-slate-500">
              Upcoming semesters
            </span>
            <input
              type="number"
              min={1}
              max={12}
              className="input text-center font-black"
              value={semesterCount}
              onChange={(e) =>
                setSemesterCount(clamp(Math.round(Number(e.target.value) || 1), 1, 12))
              }
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-bold uppercase text-slate-500">
              Credits per semester
            </span>
            <input
              type="number"
              min={1}
              max={30}
              className="input text-center font-black"
              value={perSemesterCredits}
              onChange={(e) =>
                setPerSemesterCredits(
                  clamp(Math.round(Number(e.target.value) || 1), 1, 30)
                )
              }
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-bold uppercase text-slate-500">
              Held semester GPA: {assumedGpa.toFixed(2)}
            </span>
            <input
              type="range"
              min={0}
              max={4}
              step={0.05}
              value={assumedGpa}
              onChange={(e) => setAssumedGpa(Number(e.target.value))}
              className="mt-3 w-full accent-brand-600"
            />
          </label>
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-slate-800">
            Projected arrival:{' '}
            <span className="text-brand-700">{fmt2(finalPoint?.cgpa ?? null)}</span>
          </h3>
          {finalClass && (
            <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-bold text-slate-700">
              🏅 {finalClass.label}
            </span>
          )}
        </div>

        <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 w-full" role="img" aria-label="Flight path graph">
          {CLASS_LINES.map((c) => (
            <g key={c.label}>
              <line
                x1={PAD_L}
                x2={W - PAD_R}
                y1={yFor(c.min)}
                y2={yFor(c.min)}
                stroke={c.tone}
                strokeWidth={1}
                strokeDasharray="4 4"
                opacity={0.35}
              />
              <text x={6} y={yFor(c.min) + 4} fontSize={10} fill={c.tone} fontWeight={700}>
                {c.label} {c.min.toFixed(1)}
              </text>
            </g>
          ))}

          {d.state.targetCgpa !== null && (
            <line
              x1={PAD_L}
              x2={W - PAD_R}
              y1={yFor(d.state.targetCgpa)}
              y2={yFor(d.state.targetCgpa)}
              stroke="#4f46e5"
              strokeWidth={1.5}
            />
          )}

          <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={H - PAD_B} stroke="#cbd5e1" />
          <line x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B} stroke="#cbd5e1" />
          {[0, 1, 2, 3, 4].map((g) => (
            <text key={g} x={PAD_L - 8} y={yFor(g) + 4} fontSize={10} textAnchor="end" fill="#94a3b8">
              {g.toFixed(1)}
            </text>
          ))}

          <path d={linePath} fill="none" stroke="#4f46e5" strokeWidth={2.5} strokeLinejoin="round" />
          {path.map((p, i) => (
            <g key={i}>
              <circle cx={xFor(i)} cy={yFor(p.cgpa)} r={i === 0 ? 5 : 4} fill={i === 0 ? '#0f172a' : '#4f46e5'} />
              <text x={xFor(i)} y={H - PAD_B + 16} fontSize={10} textAnchor="middle" fill="#64748b">
                {i === 0 ? 'Now' : `S${i}`}
              </text>
            </g>
          ))}
        </svg>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {path.slice(1).map((p, i) => {
            const cls = classifyCgpa(p.cgpa, classification);
            return (
              <div
                key={i}
                className="rounded-xl bg-slate-50 p-2 text-center ring-1 ring-slate-100"
              >
                <p className="text-[10px] font-bold uppercase text-slate-400">
                  After S{i + 1}
                </p>
                <p className="text-lg font-black text-slate-800">{fmt2(p.cgpa)}</p>
                <p className="text-[10px] font-semibold text-slate-500">
                  {cls?.label ?? '—'}
                </p>
              </div>
            );
          })}
        </div>
      </Card>

      <Note>
        Milestones assume {perSemesterCredits} credits each semester at a
        consistent {assumedGpa.toFixed(2)} GPA. Adjust the controls to fly
        different paths — your actual route changes with each result.
      </Note>
    </div>
  );
}
