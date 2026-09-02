import { useRef, useState } from 'react';
import { useAdmin } from '../adminStore';
import { bulkAddCourses } from '../adminConfigService';
import { importCoursesFile, type ImportResult } from '../importService';

/**
 * File-based course import for the curriculum editor. Accepts JSON, XLSX/CSV
 * and PDF files (e.g. an official university semester handbook table like
 * Code / Course title / T / P / C). Extraction from spreadsheets/PDFs is
 * heuristic, so a PREVIEW is always shown before anything is applied.
 */
export function CourseImport({
  curriculumId,
  levelIndex,
  semesterIndex,
  locked,
}: {
  curriculumId: string;
  levelIndex: number;
  semesterIndex: number;
  locked: boolean;
}) {
  const { apply } = useAdmin();
  const fileRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await importCoursesFile(file);
      if (res.semesters.length === 0) {
        setError('No course rows recognised. Check the file layout (Code, Title, … Credits).');
      } else {
        setResult(res);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that file.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  /** Apply the imported semesters: matching level/semester rows are placed
   *  automatically; rows for other semesters are placed by their position. */
  function applyImport() {
    if (!result) return;
    apply((catalog) => {
      let next = catalog;
      // Prefer the semester this button belongs to; fall back to parsed slots.
      const target =
        result.semesters.find(
          (s) => s.levelIndex === levelIndex && s.semesterIndex === semesterIndex
        ) ?? result.semesters[0];
      for (const sem of result.semesters) {
        const valid = sem.rows.filter((r) => r.valid);
        if (valid.length === 0) continue;
        const li = sem.levelIndex || target.levelIndex;
        const si = sem.semesterIndex || target.semesterIndex;
        next = bulkAddCourses(next, curriculumId, li, si, valid);
      }
      return next;
    });
    setResult(null);
  }

  const totalRows = result?.semesters.reduce((s, x) => s + x.rows.length, 0) ?? 0;
  const validRows =
    result?.semesters.reduce(
      (s, x) => s + x.rows.filter((r) => r.valid).length,
      0
    ) ?? 0;

  return (
    <div className="mt-2 rounded-lg bg-white p-2 ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={locked || busy}
          onClick={() => fileRef.current?.click()}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-slate-700 disabled:opacity-40"
        >
          {busy ? '⏳ Reading…' : '📂 Import from file'}
        </button>
        <span className="text-[10px] text-slate-400">
          JSON · XLSX · CSV · PDF — semester table (Code, Title, T/P/C credits)
        </span>
        <input
          ref={fileRef}
          type="file"
          accept=".json,.xlsx,.xls,.csv,.pdf"
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
      </div>

      {error && (
        <p className="mt-2 rounded bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700">
          ⚠️ {error}
        </p>
      )}

      {result && (
        <div className="mt-2 space-y-2">
          <p className="text-[11px] font-bold text-slate-700">
            Preview — {result.fileName} ({result.format.toUpperCase()}):{' '}
            <span className="text-emerald-700">{validRows} valid</span>
            {validRows !== totalRows && (
              <span className="text-red-600"> · {totalRows - validRows} need credits</span>
            )}{' '}
            across {result.semesters.length} semester
            {result.semesters.length === 1 ? '' : 's'}
          </p>
          <div className="max-h-48 overflow-y-auto rounded-lg ring-1 ring-slate-100">
            {result.semesters.map((sem) => (
              <div key={`${sem.levelIndex}-${sem.semesterIndex}`} className="border-b border-slate-100 last:border-0">
                <p className="bg-slate-50 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-slate-500">
                  {sem.label}
                </p>
                {sem.rows.map((r, i) => (
                  <div
                    key={i}
                    className={`flex items-center justify-between px-2 py-1 text-[11px] ${
                      r.valid ? 'text-slate-700' : 'bg-red-50 text-red-700'
                    }`}
                  >
                    <span className="font-mono font-bold">{r.code}</span>
                    <span className="flex-1 truncate px-2">{r.name}</span>
                    <span className="font-bold">{r.creditHours || '—'} cr</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          {result.ignored.length > 0 && (
            <p className="text-[10px] text-slate-400">
              {result.ignored.length} unrecognised line{result.ignored.length === 1 ? '' : 's'} skipped.
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={validRows === 0}
              onClick={applyImport}
              className="btn-primary py-1.5 text-[11px]"
            >
              ✅ Add {validRows} course{validRows === 1 ? '' : 's'}
            </button>
            <button
              type="button"
              onClick={() => setResult(null)}
              className="btn-ghost py-1.5 text-[11px]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
