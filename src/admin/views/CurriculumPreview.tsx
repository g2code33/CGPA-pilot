import { useAdmin } from '../adminStore';
import { findProgramme, curriculumStats } from '../adminConfigService';

/** Read-only, student-style preview: only ACTIVE courses are shown. */
export function CurriculumPreview({
  curriculumId,
  onBack,
}: {
  curriculumId: string;
  onBack: () => void;
}) {
  const { catalog } = useAdmin();
  const version = catalog.curricula.find((c) => c.id === curriculumId);

  if (!version) {
    return (
      <div className="space-y-3">
        <button className="btn-ghost" onClick={onBack}>← Back</button>
        <p className="text-sm text-slate-500">Curriculum not found.</p>
      </div>
    );
  }

  const found = findProgramme(catalog, version.programmeId);
  const stats = curriculumStats(version);

  return (
    <div className="space-y-4">
      <button className="btn-ghost" onClick={onBack}>← Back to editor</button>

      <header className="rounded-2xl bg-white p-5 text-center shadow-sm ring-1 ring-slate-200">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
          Student preview
        </p>
        <h1 className="text-lg font-black text-slate-900">{found?.programme.name}</h1>
        <p className="text-xs text-slate-500">
          {found?.university.name} · {found?.school.name}
        </p>
        <p className="mt-1 text-xs font-semibold text-brand-700">
          {version.versionName} · {version.effectiveAcademicYear}
        </p>
        <div className="mt-3 flex justify-center gap-2 text-[11px] font-bold">
          <span className="rounded-full bg-brand-50 px-3 py-1 text-brand-700 ring-1 ring-brand-200">
            {stats.totalCredits} total credits
          </span>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600 ring-1 ring-slate-200">
            {stats.totalActiveCourses} active courses
          </span>
        </div>
      </header>

      {stats.levels.map((levelStat) => {
        const level = version.levels.find((l) => l.index === levelStat.index)!;
        return (
          <section key={level.index} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h2 className="text-sm font-black text-slate-900">{level.label}</h2>
              <span className="text-[11px] font-bold text-brand-700">
                {levelStat.credits} credits · {levelStat.courses} courses
              </span>
            </div>
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {level.semesters.map((sem) => {
                const active = sem.courses.filter((c) => c.status === 'active');
                return (
                  <div key={sem.index} className="rounded-xl bg-slate-50 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                        {sem.label}
                      </h3>
                      <span className="text-[10px] font-bold text-brand-700">
                        {active.reduce((s, c) => s + c.creditHours, 0)} cr
                      </span>
                    </div>
                    <table className="w-full text-[11px]">
                      <tbody className="divide-y divide-slate-100">
                        {active.map((c) => (
                          <tr key={c.id}>
                            <td className="py-1 font-mono font-bold text-slate-700">{c.code}</td>
                            <td className="py-1 text-slate-600">{c.name}</td>
                            <td className="py-1 text-right font-bold tabular-nums text-slate-700">
                              {c.creditHours}
                            </td>
                          </tr>
                        ))}
                        {active.length === 0 && (
                          <tr>
                            <td colSpan={3} className="py-2 text-center text-slate-400">
                              No active courses.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      <p className="rounded-xl bg-slate-50 px-3 py-2 text-center text-[11px] text-slate-500 ring-1 ring-slate-100">
        This preview shows only <strong>active</strong> courses — exactly what
        students will receive. Inactive courses and internal notes are hidden.
      </p>
    </div>
  );
}
