import { useMemo, useState } from 'react';
import { useDerived } from '../state/derived';
import { Card, SectionTitle, Note } from '../components/ui';
import { pointsForGrade } from '../engine/grades';
import { classify } from '../engine/grades';
import { fmt2 } from '../engine/format';
import type { CourseEntry } from '../engine/types';

/**
 * What-If simulator — fully local scratchpad.
 * Grades are chosen in component state only; global academic state is never
 * mutated. "Reset" returns to the pending picture; nothing is saved anywhere.
 */
export function WhatIf() {
  const d = useDerived();
  const { record, scale, rules } = d;

  // Collect every pending course (history mode) into the scratchpad.
  const pendingCourses = useMemo(
    () =>
      d.state.semesters.flatMap((s) =>
        s.courses
          .filter((c) => c.pending)
          .map((c) => ({ ...c, semesterLabel: s.label }))
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [d.state.semesters]
  );

  // Hypothetical grade per pending course id.
  const [grades, setGrades] = useState<Record<string, string>>({});
  // Extra hypothetical future semester.
  const [hypoCourses, setHypoCourses] = useState<CourseEntry[]>([]);

  function setGrade(id: string, grade: string) {
    setGrades((g) => ({ ...g, [id]: g[id] === grade ? '' : grade }));
  }

  function addHypo() {
    setHypoCourses((cs) => [
      ...cs,
      {
        id: Math.random().toString(36).slice(2, 9),
        code: '',
        name: '',
        credits: 3,
        score: null,
        grade: null,
        pending: false,
      },
    ]);
  }

  function patchHypo(id: string, patch: Partial<CourseEntry>) {
    setHypoCourses((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  // Scenario math
  let addedPoints = 0;
  let addedCredits = 0;
  for (const c of pendingCourses) {
    const g = grades[c.id];
    if (!g) continue;
    const pts = pointsForGrade(g, scale);
    if (pts === null) continue;
    addedPoints += pts * c.credits;
    addedCredits += c.credits;
  }
  for (const c of hypoCourses) {
    if (!c.grade) continue;
    const pts = pointsForGrade(c.grade, scale);
    if (pts === null) continue;
    addedPoints += pts * c.credits;
    addedCredits += c.credits;
  }

  const scenarioCredits = record.credits + addedCredits;
  const scenarioPoints = record.points + addedPoints;
  const scenarioCgpa =
    scenarioCredits > 0 ? scenarioPoints / scenarioCredits : null;
  const scenarioClass = classify(scenarioCgpa, rules);

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle
          icon="🔀"
          title="What-If Simulator"
          subtitle="Try grades for pending results or a hypothetical semester. This never changes your entered data — and nothing is saved."
        />

        {pendingCourses.length === 0 && (
          <Note>
            No pending results yet. Mark courses as ⏳ Pending on the Calculate
            tab to preview them here, or add a hypothetical semester below.
          </Note>
        )}

        {pendingCourses.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
              Pending results — assume a grade
            </p>
            {pendingCourses.map((c) => (
              <div
                key={c.id}
                className="rounded-xl border border-amber-200 bg-amber-50/50 p-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-slate-700">
                    {c.code || 'Course'} {c.name ? `· ${c.name}` : ''}
                    <span className="ml-1 text-slate-400">
                      ({c.credits} cr · {c.semesterLabel})
                    </span>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {scale.bands.map((b) => (
                    <button
                      key={b.grade}
                      onClick={() => setGrade(c.id, b.grade)}
                      className={`rounded-md px-2.5 py-1 text-xs font-bold ring-1 transition ${
                        grades[c.id] === b.grade
                          ? 'bg-brand-600 text-white ring-brand-600'
                          : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-100'
                      }`}
                      title={`${b.points} pts`}
                    >
                      {b.grade}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Hypothetical future semester */}
        <div className="mt-4">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
            Hypothetical future semester
          </p>
          <div className="mt-2 space-y-2">
            {hypoCourses.map((c) => (
              <div key={c.id} className="grid grid-cols-12 items-center gap-2 rounded-xl border border-slate-200 p-2">
                <input
                  className="input col-span-5"
                  placeholder="Course (optional)"
                  value={c.name}
                  onChange={(e) => patchHypo(c.id, { name: e.target.value })}
                />
                <input
                  type="number"
                  min={1}
                  max={12}
                  className="input col-span-2 text-center"
                  value={c.credits}
                  onChange={(e) =>
                    patchHypo(c.id, { credits: Math.max(1, Number(e.target.value) || 1) })
                  }
                />
                <select
                  className="input col-span-4 text-center font-bold"
                  value={c.grade ?? ''}
                  onChange={(e) => patchHypo(c.id, { grade: e.target.value || null })}
                >
                  <option value="">Grade…</option>
                  {scale.bands.map((b) => (
                    <option key={b.grade} value={b.grade}>
                      {b.grade} ({b.points})
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => setHypoCourses((cs) => cs.filter((x) => x.id !== c.id))}
                  className="col-span-1 text-right text-red-400 hover:text-red-600"
                >
                  ✕
                </button>
              </div>
            ))}
            <button onClick={addHypo} className="btn-ghost w-full">
              ＋ Add hypothetical course
            </button>
          </div>
        </div>

        <div className="mt-3 flex gap-2">
          <button
            onClick={() => {
              setGrades({});
              setHypoCourses([]);
            }}
            className="btn-ghost flex-1"
          >
            ↺ Reset scenario
          </button>
        </div>
      </Card>

      {/* Scenario outcome */}
      <Card className="bg-slate-900 text-white ring-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
              Scenario CGPA
            </p>
            <p className="text-4xl font-black tabular-nums text-amber-300">
              {fmt2(scenarioCgpa)}
            </p>
          </div>
          <div className="text-right text-xs text-slate-300">
            <p>
              Now: <strong className="text-white">{fmt2(record.cgpa)}</strong> →
              Scenario
            </p>
            <p>
              +{addedCredits} credits · +{fmt2(addedPoints)} points
            </p>
            {scenarioClass && (
              <p className="mt-1 rounded-full bg-white/10 px-3 py-1 font-bold">
                {scenarioClass.label}
              </p>
            )}
          </div>
        </div>
        <p className="mt-3 text-[11px] text-slate-400">
          Courses left ungraded are ignored. The scenario assumes the grades you
          pick are final.
        </p>
      </Card>
    </div>
  );
}
