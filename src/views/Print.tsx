import { useDerived } from '../state/derived';
import { Card, SectionTitle, Note } from '../components/ui';
import { courseGrade } from '../engine/grades';
import { INSTITUTION_LABEL, university } from '../config';
import { fmt2, fmt1 } from '../engine/format';

export function PrintView() {
  const d = useDerived();
  const { record, state, scale } = d;
  const today = new Date().toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="space-y-4">
      <Card className="no-print">
        <SectionTitle
          icon="🖨️"
          title="Print"
          subtitle="Generate a clean, anonymous academic brief — no name, ID or personal details appear on it. Print it or save as PDF. The file stays on your device."
        />
        <button onClick={() => window.print()} className="btn-primary w-full">
          🖨️ Print / Save as PDF
        </button>
        <div className="mt-3">
          <Note>
            The report contains only numbers you entered this session. Because
            nothing is stored, re-enter your data after a refresh if you need
            another copy.
          </Note>
        </div>
      </Card>

      {/* Printable report */}
      <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 print:ring-0 print:shadow-none">
        {/* Report header */}
        <div className="flex items-start justify-between border-b-2 border-slate-900 pb-3">
          <div>
            <h1 className="text-xl font-black uppercase tracking-wide">
              CGPA <span className="text-brand-600">Pilot</span>
            </h1>
            <p className="text-xs italic text-slate-500">
              Navigate Your Academic Future.
            </p>
          </div>
          <div className="text-right text-[11px] text-slate-500">
            <p className="font-bold text-slate-700">{INSTITUTION_LABEL}</p>
            <p>Pilot Brief — {today}</p>
            <p className="mt-1 font-semibold text-emerald-700">
              Anonymous · no personal data
            </p>
          </div>
        </div>

        {/* CGPA summary */}
        <div className="mt-4 grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-slate-900 p-3 text-center text-white">
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
              CGPA
            </p>
            <p className="text-3xl font-black tabular-nums">{fmt2(record.cgpa)}</p>
          </div>
          <div className="rounded-xl bg-slate-100 p-3 text-center">
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">
              Graded credits
            </p>
            <p className="text-3xl font-black tabular-nums">{record.credits}</p>
          </div>
          <div className="rounded-xl bg-slate-100 p-3 text-center">
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">
              Classification
            </p>
            <p className="mt-2 text-sm font-black leading-tight text-slate-800">
              {d.classification?.label ?? '—'}
            </p>
          </div>
        </div>

        <p className="mt-3 text-xs text-slate-600">
          <strong>Target:</strong>{' '}
          {state.targetCgpa ? fmt2(state.targetCgpa) : 'not set'}
          {record.cgpa !== null && state.targetCgpa !== null && (
            <>
              {' '}— currently{' '}
              <strong>
                {record.cgpa >= state.targetCgpa ? 'at/above target ✅' : 'below target'}
              </strong>
            </>
          )}
        </p>

        {/* History table */}
        {state.mode === 'history' && (
          <div className="mt-4">
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-700">
              Semester breakdown
            </h2>
            {d.semesters.map(({ semester, totals }) => (
              <div key={semester.id} className="mb-3">
                <div className="flex items-center justify-between bg-slate-50 px-2 py-1 text-xs font-bold text-slate-700">
                  <span>{semester.label}</span>
                  <span>
                    GPA {fmt2(totals.cgpa)} · {totals.credits} cr
                  </span>
                </div>
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-slate-400">
                      <th className="py-1 font-semibold">Code</th>
                      <th className="font-semibold">Course</th>
                      <th className="text-center font-semibold">Cr</th>
                      <th className="text-center font-semibold">Grade</th>
                      <th className="text-right font-semibold">Points</th>
                    </tr>
                  </thead>
                  <tbody>
                    {semester.courses
                      .filter((c) => c.grade || c.score !== null || c.pending)
                      .map((c) => {
                        const g = courseGrade(c, scale);
                        return (
                          <tr key={c.id} className="border-b border-slate-100">
                            <td className="py-1 font-mono">{c.code || '—'}</td>
                            <td>{c.name || '—'}</td>
                            <td className="text-center">{c.credits}</td>
                            <td className="text-center font-bold">
                              {c.pending ? 'PENDING' : g ?? '—'}
                            </td>
                            <td className="text-right tabular-nums">
                              {c.pending || !g
                                ? '—'
                                : fmt1(
                                    (scale.bands.find((b) => b.grade === g)?.points ?? 0) *
                                      c.credits
                                  )}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}

        {state.mode === 'current' && (
          <p className="mt-4 text-xs text-slate-600">
            Entered in Current CGPA mode: CGPA {fmt2(state.baseline.cgpa)} over{' '}
            {state.baseline.credits} total credits.
          </p>
        )}

        {record.pendingCount > 0 && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800">
            ⏳ {record.pendingCount} pending result{record.pendingCount === 1 ? '' : 's'} (
            {record.pendingCredits} credits) not included in the CGPA above.
          </p>
        )}

        <div className="mt-5 border-t border-slate-200 pt-3 text-[10px] leading-relaxed text-slate-400">
          <p>
            Generated by CGPA PILOT ({university.name} grading scale). This is a
            personal planning aid, not an official transcript or academic record.
            No account was used and no academic information was saved or
            transmitted.
          </p>
        </div>
      </div>
    </div>
  );
}
