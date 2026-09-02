import { useRef, useState } from 'react';
import { useAdmin } from '../adminStore';
import { importAllCourses } from '../adminConfigService';
import { importCoursesFile, type ImportResult } from '../importService';
import { confirmThen } from '../confirm';

/**
 * One top-level upload that imports ALL courses for the whole programme
 * (every level/year and semester — Level 600 "cycles" map to semesters).
 * JSON is the authoritative format:
 *   { program, levels: [ { level: "Level 100",
 *       semesters: [ { semester: "1st semester",
 *         courses: [{code,title,T,P,C}], total_credits } ] } ] }
 * XLSX/CSV/PDF of the full handbook are parsed heuristically and previewed.
 */
export function WholeCurriculumImport({
  curriculumId,
  locked,
  onImported,
}: {
  curriculumId: string;
  locked: boolean;
  onImported?: () => void;
}) {
  const { apply } = useAdmin();
  const fileRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await importCoursesFile(file);
      if (res.levels.length === 0) {
        setError('No levels/courses recognised. Use the JSON structure (levels → semesters → courses) or a handbook table.');
      } else {
        setResult(res);
        setOpen(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that file.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const totalCourses =
    result?.semesters.reduce((s, x) => s + x.rows.length, 0) ?? 0;
  const validCourses =
    result?.semesters.reduce((s, x) => s + x.rows.filter((r) => r.valid).length, 0) ?? 0;
  const totalCredits =
    result?.semesters.reduce(
      (s, x) => s + x.rows.filter((r) => r.valid).reduce((t, r) => t + r.creditHours, 0),
      0
    ) ?? 0;

  function applyAll() {
    if (!result) return;
    const spec = result.levels.map((lv) => ({
      levelIndex: lv.levelIndex,
      label: lv.label,
      semesters: lv.semesters.map((s) => ({
        semesterIndex: s.semesterIndex,
        label: s.label,
        rows: s.rows.filter((r) => r.valid),
      })),
    }));
    confirmThen(
      `Import ${validCourses} courses across ${result.levels.length} levels? Existing courses are kept; duplicate codes are skipped.`,
      () => {
        apply((catalog) => {
          const { catalog: next } = importAllCourses(catalog, curriculumId, spec);
          return next;
        });
        setResult(null);
        setOpen(false);
        onImported?.();
      }
    );
  }

  return (
    <section className="rounded-2xl bg-gradient-to-br from-brand-700 via-brand-600 to-indigo-800 p-4 text-white shadow-sm sm:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-2xl">🗂️</span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-black">Upload the entire curriculum</h2>
          <p className="text-[11px] text-brand-100">
            One file with all years (Levels 100–600). JSON is exact:{' '}
            <code className="text-white">levels → semesters → courses &#123;code, title, T, P, C&#125;</code>.
            XLSX/CSV/PDF handbooks are previewed before applying.
          </p>
        </div>
        <button
          type="button"
          disabled={locked || busy}
          onClick={() => fileRef.current?.click()}
          className="rounded-xl bg-white px-4 py-2 text-xs font-black text-brand-700 shadow-sm transition hover:bg-brand-50 disabled:opacity-50"
        >
          {busy ? '⏳ Reading file…' : '📤 Upload all courses'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,.xlsx,.xls,.csv,.pdf"
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
      </div>

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700">
          ⚠️ {error}
        </p>
      )}

      {result && open && (
        <div className="mt-4 rounded-xl bg-white p-3 text-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-black">
              {result.fileName}{' '}
              <span className="font-semibold text-slate-400">({result.format.toUpperCase()})</span>
            </p>
            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800">
              {validCourses} courses · {totalCredits} credits · {result.levels.length} levels
            </span>
          </div>
          {result.program && (
            <p className="mt-1 text-[11px] font-semibold text-brand-700">{result.program}</p>
          )}

          <div className="mt-2 max-h-64 overflow-y-auto rounded-lg ring-1 ring-slate-100">
            {result.levels.map((lv) => (
              <div key={lv.levelIndex} className="border-b border-slate-100 last:border-0">
                <p className="sticky top-0 bg-slate-50 px-2 py-1 text-[11px] font-black uppercase tracking-wide text-slate-600">
                  {lv.label}
                </p>
                {lv.semesters.map((sem) => {
                  const cr = sem.rows.filter((r) => r.valid).reduce((t, r) => t + r.creditHours, 0);
                  return (
                    <div key={`${sem.levelIndex}-${sem.semesterIndex}`} className="px-2 py-1">
                      <p className="text-[10px] font-bold text-slate-500">
                        {sem.label} · {sem.rows.length} courses ·{' '}
                        <span className={sem.totalCredits && cr !== sem.totalCredits ? 'text-amber-600' : 'text-emerald-700'}>
                          {cr} cr
                        </span>
                        {sem.totalCredits ? ` (file total ${sem.totalCredits})` : ''}
                      </p>
                      <p className="truncate text-[10px] text-slate-400">
                        {sem.rows.map((r) => r.code).join('  ·  ')}
                      </p>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {validCourses !== totalCourses && (
            <p className="mt-2 text-[11px] font-semibold text-red-600">
              {totalCourses - validCourses} course(s) have no detectable credits — review the file before applying.
            </p>
          )}
          {result.ignored.length > 0 && (
            <p className="mt-1 text-[10px] text-slate-400">{result.ignored.length} unrecognised entries skipped.</p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={validCourses === 0}
              onClick={applyAll}
              className="btn-primary py-2 text-xs"
            >
              ✅ Add {validCourses} courses to curriculum
            </button>
            <button
              type="button"
              onClick={() => {
                setResult(null);
                setOpen(false);
              }}
              className="btn-ghost py-2 text-xs"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
