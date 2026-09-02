// ─────────────────────────────────────────────────────────────────────────
// Admin Calculation Test Lab (Prompt 17).
//
// Runs the real student-facing calculation engines against FABRICATED test
// data and compares actual vs expected. No real student data is used, entered
// or stored — every input here is clearly marked as test data. Custom cases
// are session-only (admin convenience); they are never published or shipped.
// ─────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react';
import { useAdmin } from '../adminStore';
import {
  runLabCase,
  buildTestCurriculum,
  TEST_GRADING,
  TEST_CLASSIFICATION,
  type LabCase,
  type LabResult,
  type Metric,
} from '../testLab';
import { BUILTIN_TEST_CASES } from '../testLabCases';
import {
  getGradingSystem,
  getClassificationSystem,
} from '../adminConfigService';

const METRICS: { id: Metric; label: string }[] = [
  { id: 'cgpaHistory', label: 'Weighted CGPA (GPA history)' },
  { id: 'cgpaCurrent', label: 'Current-mode CGPA' },
  { id: 'semesterGpa', label: 'Semester GPA (courses)' },
  { id: 'classification', label: 'Classification label' },
  { id: 'requiredFutureGpa', label: 'Required future GPA' },
  { id: 'targetStatus', label: 'Target feasibility status' },
  { id: 'maxPossibleFinalCgpa', label: 'Maximum possible final CGPA' },
  { id: 'whatIfProjectedCgpa', label: 'What-If projected CGPA' },
  { id: 'whatIfTrajectoryCgpa', label: 'What-If held-average final CGPA' },
  { id: 'milestoneGraduationCgpa', label: 'Milestone projected graduation CGPA' },
  { id: 'nextRequiredGpa', label: 'Required next-semester GPA' },
  { id: 'scoreGradePoints', label: 'Grade points for a score' },
];

const STATUS_OPTIONS = ['met', 'achievable', 'very-demanding', 'extremely-demanding', 'impossible', 'unknown'];
const CLASS_OPTIONS = ['First Class', 'Second Class Upper', 'Second Class Lower', 'Third Class', 'Pass'];

/** Empty form for a fabricated custom test case. */
function blankCase(): Partial<LabCase> {
  return {
    name: '',
    metric: 'cgpaHistory',
    currentCgpa: 3.0,
    currentLevel: 1,
    currentSemester: 2,
    completedCredits: 36,
    pendingCredits: 0,
    targetCgpa: 3.6,
    futureGpa: 3.8,
    futureCredits: 18,
    score: 80,
    curriculumPreset: 'curr4',
    expected: '3.00',
  } as Partial<LabCase> & { curriculumPreset?: string };
}

export function TestLab() {
  const { catalog } = useAdmin();
  const [results, setResults] = useState<LabResult[] | null>(null);
  const [custom, setCustom] = useState<(LabCase & { curriculumPreset?: string })[]>([]);
  const [form, setForm] = useState<Partial<LabCase> & { curriculumPreset?: string }>(blankCase());
  const [error, setError] = useState<string | null>(null);

  // Real published curricula available to run TEST cases against.
  const realCurricula = useMemo(
    () => catalog.curricula.filter((c) => c.status === 'published'),
    [catalog]
  );
  const testCurricula = useMemo(
    () => [
      { id: 'curr4', label: 'TEST · 4 levels · 18 cr/sem (144 total)', value: buildTestCurriculum({ levels: 4 }) },
      { id: 'curr6', label: 'TEST · 6 levels · 18 cr/sem (216 total)', value: buildTestCurriculum({ levels: 6 }) },
      { id: 'currMixed', label: 'TEST · 4 levels · mixed loads (143 total)', value: buildTestCurriculum({ levels: 4, credits: [16, 16, 18, 18, 21, 21, 15, 18] }) },
    ],
    []
  );

  function curriculumFor(preset?: string) {
    const test = testCurricula.find((t) => t.id === preset);
    if (test) return test.value;
    const real = realCurricula.find((c) => c.id === preset);
    return real ?? undefined;
  }

  /** Grading/classification for a case: real programme rules when the case
   *  runs against a real published curriculum, else the TEST scale. */
  function rulesFor(preset?: string) {
    const real = realCurricula.find((c) => c.id === preset);
    if (real) {
      const grading =
        getGradingSystem(catalog, { scope: 'programme', programmeId: real.programmeId }) ?? TEST_GRADING;
      const classification =
        getClassificationSystem(catalog, { scope: 'programme', programmeId: real.programmeId }) ?? TEST_CLASSIFICATION;
      return { grading, classification };
    }
    return { grading: TEST_GRADING, classification: TEST_CLASSIFICATION };
  }

  function materialize(c: LabCase & { curriculumPreset?: string }): LabCase {
    const { grading, classification } = rulesFor(c.curriculumPreset);
    const { curriculumPreset: _ignored, ...rest } = c;
    return { ...rest, grading: c.grading ?? grading, classification: c.classification ?? classification, curriculum: c.curriculum ?? curriculumFor(c.curriculumPreset) };
  }

  function runBuiltIn() {
    setError(null);
    const all = [...BUILTIN_TEST_CASES, ...custom.map(materialize)];
    setResults(all.map(runLabCase));
  }

  function addCustomCase() {
    const f = form;
    if (!f.name?.trim()) {
      setError('Give the test case a name.');
      return;
    }
    if (f.expected === '' || f.expected === undefined) {
      setError('Define the expected result.');
      return;
    }
    const expected: number | string =
      f.metric === 'targetStatus' || f.metric === 'classification'
        ? String(f.expected)
        : Number(f.expected);
    if (f.metric !== 'targetStatus' && f.metric !== 'classification' && Number.isNaN(expected as number)) {
      setError('Expected result must be a number for this metric.');
      return;
    }
    const id = `custom-${Date.now()}`;
    const next: LabCase & { curriculumPreset?: string } = {
      id,
      name: `🧪 ${f.name.trim()}`,
      category: 'Credit weighting',
      metric: f.metric ?? 'cgpaHistory',
      currentCgpa: numOrNull(f.currentCgpa),
      currentLevel: f.currentLevel ?? 1,
      currentSemester: f.currentSemester ?? 1,
      completedCredits: f.completedCredits ?? 0,
      pendingCredits: f.pendingCredits ?? 0,
      targetCgpa: f.targetCgpa ?? 3.6,
      futureGpa: f.futureGpa ?? undefined,
      futureCredits: f.futureCredits ?? undefined,
      userScenarioGpa: f.futureGpa ?? undefined,
      score: f.score ?? undefined,
      semesters: f.semesters,
      curriculumPreset: f.curriculumPreset ?? 'curr4',
      expected,
      note: 'Custom fabricated case (session only).',
    };
    setCustom((cs) => [...cs, next]);
    setForm(blankCase());
    setError(null);
  }

  const summary = useMemo(() => {
    if (!results) return null;
    const pass = results.filter((r) => r.pass).length;
    return { pass, fail: results.length - pass, total: results.length };
  }, [results]);

  const grouped = useMemo(() => {
    if (!results) return [];
    const order = [
      'Credit weighting', 'Semester GPA', 'Maximum GPA', 'Minimum GPA',
      'Target feasibility', 'Pending results', 'Classification boundaries',
      'Rounding', 'Curriculum changes', 'Programme structure', 'What-If',
      'Milestones', 'Next-semester planning',
    ] as const;
    return order
      .map((category) => ({ category, rows: results.filter((r) => r.category === category) }))
      .filter((g) => g.rows.length > 0);
  }, [results]);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const stringMetric = form.metric === 'targetStatus' || form.metric === 'classification';

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-slate-900 px-4 py-3 text-white">
        <h1 className="text-lg font-black">🧪 Calculation Test Lab</h1>
        <p className="mt-1 text-xs text-slate-300">
          Verifies the math CGPA PILOT ships with. Every figure is{' '}
          <strong className="text-amber-300">fabricated TEST data</strong> — no real student
          data is used, required or stored. Tests run offline in this browser against the
          exact calculation engines the student app uses.
        </p>
      </div>

      {/* Run bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <button
          onClick={runBuiltIn}
          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-700"
        >
          ▶️ Run all tests ({BUILTIN_TEST_CASES.length} built-in{custom.length ? ` + ${custom.length} custom` : ''})
        </button>
        {summary && (
          <div className="flex items-center gap-2 text-sm font-bold">
            <span className="rounded-lg bg-green-100 px-3 py-1 text-green-800">✔ {summary.pass} PASS</span>
            <span className={`rounded-lg px-3 py-1 ${summary.fail ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-500'}`}>
              ✖ {summary.fail} FAIL
            </span>
            <span className="text-slate-400">/ {summary.total} tests</span>
          </div>
        )}
      </div>

      {/* Results */}
      {results && (
        <div className="space-y-3">
          {summary?.fail === 0 && (
            <div className="rounded-xl bg-green-50 px-4 py-2.5 text-sm font-bold text-green-800 ring-1 ring-green-200">
              ✅ All {summary.total} tests pass — the engines match every expected result at full precision.
            </div>
          )}
          {grouped.map((g) => (
            <div key={g.category} className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
              <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-black uppercase tracking-wide text-slate-500">
                {g.category}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-[10px] uppercase tracking-wide text-slate-400">
                      <th className="px-4 py-2">Test (fabricated data)</th>
                      <th className="px-3 py-2 text-right">Expected</th>
                      <th className="px-3 py-2 text-right">Actual</th>
                      <th className="px-3 py-2 text-center">Status</th>
                      <th className="px-4 py-2">Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((r) => (
                      <tr key={r.id} className="border-b border-slate-50 align-top">
                        <td className="px-4 py-2 font-semibold text-slate-700">{r.name}</td>
                        <td className="px-3 py-2 text-right font-mono font-bold tabular-nums text-slate-900">{r.expected}</td>
                        <td className={`px-3 py-2 text-right font-mono tabular-nums ${r.pass ? 'text-slate-700' : 'font-bold text-red-600'}`}>{r.actual}</td>
                        <td className="px-3 py-2 text-center">
                          <span
                            className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-black ${
                              r.pass ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                            }`}
                          >
                            {r.pass ? 'PASS' : 'FAIL'}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-[10px] text-slate-400">{r.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Custom case builder */}
      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h2 className="text-sm font-black text-slate-800">🧪 Build a custom test case <span className="font-semibold text-amber-600">(fabricated data only)</span></h2>
        <p className="mt-0.5 text-[11px] text-slate-500">
          Define inputs and the expected result; the lab runs it through the real engine and reports PASS/FAIL. Custom cases are kept for this admin session only.
        </p>

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="col-span-2 block text-[11px] font-bold text-slate-600 sm:col-span-4">
            Test name
            <input
              className="input mt-1 w-full"
              value={form.name ?? ''}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. 3.40 over 40cr + 4.00 over 20cr → ?"
            />
          </label>

          <label className="col-span-2 block text-[11px] font-bold text-slate-600 sm:col-span-2">
            Measured value
            <select
              className="input mt-1 w-full"
              value={form.metric}
              onChange={(e) => set('metric', e.target.value as Metric)}
            >
              {METRICS.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </label>

          <label className="col-span-2 block text-[11px] font-bold text-slate-600 sm:col-span-2">
            Curriculum version
            <select
              className="input mt-1 w-full"
              value={form.curriculumPreset ?? 'curr4'}
              onChange={(e) => set('curriculumPreset', e.target.value)}
            >
              {testCurricula.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
              {realCurricula.map((c) => (
                <option key={c.id} value={c.id}>📚 {c.versionName} (real published · {c.status})</option>
              ))}
            </select>
          </label>

          <NumField label="Current CGPA" value={form.currentCgpa} onChange={(v) => set('currentCgpa', v ?? undefined)} />
          <NumField label="Completed credits" value={form.completedCredits} onChange={(v) => set('completedCredits', v ?? undefined)} step={1} />
          <NumField label="Current level (1–6)" value={form.currentLevel} onChange={(v) => set('currentLevel', v ?? undefined)} step={1} />
          <NumField label="Completed semester (1/2)" value={form.currentSemester} onChange={(v) => set('currentSemester', v ?? undefined)} step={1} />
          <NumField label="Pending credits" value={form.pendingCredits} onChange={(v) => set('pendingCredits', v ?? undefined)} step={1} />
          <NumField label="Target CGPA" value={form.targetCgpa} onChange={(v) => set('targetCgpa', v ?? undefined)} />
          <NumField label="Future / scenario GPA" value={form.futureGpa} onChange={(v) => set('futureGpa', v ?? undefined)} />
          <NumField label="Future credits" value={form.futureCredits} onChange={(v) => set('futureCredits', v ?? undefined)} step={1} />

          {form.metric === 'scoreGradePoints' && (
            <NumField label="Raw score (0–100)" value={form.score} onChange={(v) => set('score', v ?? undefined)} step={1} />
          )}

          <label className="col-span-2 block text-[11px] font-bold text-slate-600 sm:col-span-2">
            {stringMetric ? 'Expected result' : 'Expected result (number)'}
            {stringMetric ? (
              <select
                className="input mt-1 w-full"
                value={String(form.expected ?? '')}
                onChange={(e) => set('expected', e.target.value)}
              >
                {(form.metric === 'classification' ? CLASS_OPTIONS : STATUS_OPTIONS).map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            ) : (
              <input
                className="input mt-1 w-full font-mono"
                value={String(form.expected ?? '')}
                onChange={(e) => set('expected', e.target.value)}
                placeholder="e.g. 3.3750"
              />
            )}
          </label>
        </div>

        {error && <p className="mt-2 text-xs font-bold text-red-600">⚠️ {error}</p>}

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={addCustomCase}
            className="rounded-xl bg-brand-600 px-4 py-2 text-xs font-bold text-white hover:bg-brand-700"
          >
            ➕ Add test case
          </button>
          {custom.length > 0 && (
            <button
              onClick={() => setCustom([])}
              className="rounded-xl bg-slate-100 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-red-50 hover:text-red-600"
            >
              Clear custom cases ({custom.length})
            </button>
          )}
        </div>

        {custom.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs text-slate-600">
            {custom.map((c) => (
              <li key={c.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5">
                <span>{c.name} — <span className="font-mono font-bold">{String(c.expected)}</span> <span className="text-slate-400">({METRICS.find((m) => m.id === c.metric)?.label})</span></span>
                <button
                  onClick={() => setCustom((cs) => cs.filter((x) => x.id !== c.id))}
                  className="font-bold text-slate-400 hover:text-red-600"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  step = 0.05,
}: {
  label: string;
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  step?: number;
}) {
  return (
    <label className="block text-[11px] font-bold text-slate-600">
      {label}
      <input
        type="number"
        step={step}
        className="input mt-1 w-full"
        value={value === null || value === undefined ? '' : value}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      />
    </label>
  );
}

function numOrNull(v: number | null | undefined): number | null {
  return v === undefined || Number.isNaN(v) ? null : v;
}
