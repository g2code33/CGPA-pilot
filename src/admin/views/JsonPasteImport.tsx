import { useState } from 'react';
import { useAdmin } from '../adminStore';
import { bulkAddCourses, importAllCourses, parseBulkCourses } from '../adminConfigService';
import { parseJson, type ImportResult } from '../importService';

/**
 * Simple JSON-paste import — replaces file-based import. Admin pastes
 * the JSON script into a text area and clicks Load.
 */
export function JsonPasteImport({
  curriculumId,
  levelIndex,
  semesterIndex,
  locked,
  mode = 'whole',
}: {
  curriculumId: string;
  levelIndex?: number;
  semesterIndex?: number;
  locked?: boolean;
  mode?: 'whole' | 'semester';
}) {
  const { apply } = useAdmin();
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      const trimmed = text.trim();
      if (!trimmed) {
        setError('Paste some JSON first.');
        return;
      }
      const res = parseJson(trimmed, 'pasted.json');
      setPreview(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid JSON.');
    } finally {
      setBusy(false);
    }
  }

  function applyImport() {
    if (!preview) return;
    apply((catalog) => {
      if (mode === 'whole') {
        const spec = preview.levels.map((lv) => ({
          levelIndex: lv.levelIndex,
          label: lv.label,
          semesters: lv.semesters.map((s) => ({
            semesterIndex: s.semesterIndex,
            label: s.label,
            rows: s.rows.filter((r) => r.valid),
          })),
        }));
        const { catalog: next } = importAllCourses(catalog, curriculumId, spec);
        return next;
      }
      // Semester mode: apply to the nearest matching semester.
      let next = catalog;
      const target =
        preview.semesters.find(
          (s) => s.levelIndex === levelIndex && s.semesterIndex === semesterIndex
        ) ?? preview.semesters[0];
      for (const sem of preview.semesters) {
        const valid = sem.rows.filter((r) => r.valid);
        if (valid.length === 0) continue;
        const li = sem.levelIndex || target.levelIndex || (levelIndex ?? 1);
        const si = sem.semesterIndex || target.semesterIndex || (semesterIndex ?? 1);
        next = bulkAddCourses(next, curriculumId, li, si, valid);
      }
      return next;
    });
    setPreview(null);
    setText('');
  }

  const totalRows = preview?.semesters.reduce((s, x) => s + x.rows.length, 0) ?? 0;
  const validRows =
    preview?.semesters.reduce(
      (s, x) => s + x.rows.filter((r) => r.valid).length,
      0
    ) ?? 0;

  return (
    <div className="rounded-lg bg-white p-3 ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-black text-slate-800">📋 JSON Import</span>
        <span className="text-[10px] text-slate-400">Paste JSON · load · apply</span>
      </div>

      {!locked && (
        <textarea
          className="mt-2 w-full rounded-lg border border-slate-200 bg-slate-50 p-2 font-mono text-[11px] text-slate-700 shadow-inner focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-200"
          rows={6}
          placeholder={`{ "program": "UCC PharmD", "levels": [ { "level": "Level 100", "semesters": [ { "semester": "1st semester", "courses": [ { "code": "PHA 111", "title": "Intro to Pharmacy", "C": 3 } ], "total_credits": 3 } ] } ] }`}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      )}

      {!locked && (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            disabled={busy || locked}
            onClick={load}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-slate-700 disabled:opacity-40"
          >
            {busy ? '⏳ Reading…' : '📂 Load JSON'}
          </button>
          <span className="text-[10px] text-slate-400 self-center">Paste full curriculum JSON or a semester array.</span>
        </div>
      )}

      {error && (
        <p className="mt-2 rounded bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700">
          ⚠️ {error}
        </p>
      )}

      {preview && (
        <div className="mt-2 space-y-2">
          <p className="text-[11px] font-bold text-slate-700">
            Preview: <span className="text-emerald-700">{validRows} valid courses</span>
            {validRows !== totalRows && (
              <span className="text-red-600"> · {totalRows - validRows} need fixing</span>
            )} across {preview.semesters.length} semester
            {preview.semesters.length === 1 ? '' : 's'}
          </p>
          <div className="max-h-48 overflow-y-auto rounded-lg ring-1 ring-slate-100">
            {preview.semesters.map((sem) => (
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
                    <span className="flex-1 truncate px-2">{r.name || '(no name)'}</span>
                    <span className="font-bold">{r.creditHours || '—'} cr</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={validRows === 0 || locked}
              onClick={applyImport}
              className="btn-primary py-1.5 text-[11px]"
            >
              ✅ Load {validRows} course{validRows === 1 ? '' : 's'}
            </button>
            <button
              type="button"
              onClick={() => setPreview(null)}
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
