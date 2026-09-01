import { useDerived } from '../state/derived';
import { Card, SectionTitle, Note, Badge } from '../components/ui';
import { nextSemesterScenarios } from '../services/scenarioService';
import { fmt2 } from '../util/format';

export function NextSemester() {
  const d = useDerived();
  const { record, dispatch, grading, classification, progress, slots } = d;
  // Next semester's configured credit load, when the curriculum is published
  // (the slot immediately after the current position in current mode;
  // otherwise the first un-planned slot after the history semesters).
  const configuredNext =
    d.state.mode === 'current' && progress.hasCreditData
      ? progress.remainingSlots[0]?.credits
      : slots[d.state.semesters.length]?.credits;
  const credits = configuredNext && configuredNext > 0
    ? configuredNext
    : d.state.plannedNextCreditHours;
  const target = d.state.targetCgpa;

  const scenarios =
    record.cgpa !== null
      ? nextSemesterScenarios(
          record.points,
          record.creditHours,
          credits,
          target,
          grading,
          classification
        )
      : [];

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle
          icon="▶️"
          title="Next Semester Pilot"
          subtitle="Point into the coming semester: see where each possible average lands your CGPA, and what you need to stay on target."
        />

        {record.cgpa === null && <Note>Enter your record or current CGPA first.</Note>}

        <label className="mb-1 block text-xs font-bold uppercase text-slate-500">
          Credits planned next semester
        </label>
        <div className="flex flex-wrap items-end gap-3">
          <input
            type="number"
            min={1}
            max={30}
            className="input w-32 text-center text-lg font-black"
            value={credits}
            onChange={(e) =>
              dispatch({
                type: 'setPlannedNext',
                creditHours: Math.max(1, Number(e.target.value) || 1),
              })
            }
          />
          <div className="flex gap-1.5">
            {[15, 18, 21].map((v) => (
              <button
                key={v}
                onClick={() => dispatch({ type: 'setPlannedNext', creditHours: v })}
                className="rounded-lg bg-slate-100 px-3 py-2 text-[11px] font-bold text-slate-600 hover:bg-slate-200"
              >
                {v} cr
              </button>
            ))}
          </div>
        </div>
      </Card>

      {record.cgpa !== null && (
        <Card>
          <h3 className="mb-3 text-sm font-bold text-slate-800">
            Where each result takes you ({credits} credits)
          </h3>
          <div className="overflow-hidden rounded-xl ring-1 ring-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Semester GPA</th>
                  <th className="px-3 py-2 text-right">New CGPA</th>
                  <th className="hidden px-3 py-2 text-right sm:table-cell">Class</th>
                  <th className="px-3 py-2 text-right">vs. target</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {scenarios.map((s) => (
                  <tr key={s.grade} className="hover:bg-slate-50">
                    <td className="px-3 py-2.5">
                      <span className="font-black text-brand-700">{s.grade}</span>
                      <span className="ml-2 text-xs text-slate-500">
                        {s.gpa.toFixed(1)} · {s.interpretation}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-black tabular-nums">
                      {fmt2(s.newCgpa)}
                    </td>
                    <td className="hidden px-3 py-2.5 text-right text-xs font-semibold text-slate-600 sm:table-cell">
                      {s.classification?.label ?? '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {target !== null ? (
                        <Badge tone={s.meetsTarget ? 'green' : 'gray'}>
                          {s.meetsTarget
                            ? '✅ on target'
                            : `need ${fmt2(Math.max(0, target - (s.newCgpa ?? 0)))}`}
                        </Badge>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 rounded-xl bg-brand-50 p-3 text-xs leading-relaxed text-brand-900 ring-1 ring-brand-200">
            <strong>Co-pilot read:</strong> you are on {fmt2(record.cgpa)} over{' '}
            {record.creditHours} credits.{' '}
            {target !== null
              ? `To protect a ${fmt2(target)} target, `
              : ''}
            every credit above your target this semester builds a cushion for
            harder courses later.
          </div>
        </Card>
      )}
    </div>
  );
}
