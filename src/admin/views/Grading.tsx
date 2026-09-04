import { useMemo, useState } from 'react';
import { useAdmin } from '../adminStore';
import { confirmThen } from '../confirm';
import {
  findProgramme,
  getGradingSystem,
  getClassificationSystem,
  setGradingSystem,
  setClassificationSystem,
  validateGradingSystem,
  validateClassificationSystem,
  gradingSystemValid,
  classificationSystemValid,
  uccOfficialGrading,
  uccOfficialClassification,
  makeGradingBand,
  makeClassificationBand,
  type RuleTarget,
} from '../adminConfigService';
import type { GradeBand, ClassificationBand } from '../../config/types';
import { writeCachedConfig } from '../../services/configCache';
import { maxGradePoints } from '../../services/gradingService';

type Target =
  | { kind: 'university'; universityId: string; label: string }
  | { kind: 'programme'; programmeId: string; label: string };

export function Grading() {
  const { catalog, apply } = useAdmin();
  const [notice, setNotice] = useState<string | null>(null);

  function flash(msg: string) {
    setNotice(msg);
    setTimeout(() => setNotice(null), 4500);
  }

  // All rule targets (universities + programmes).
  const targets: Target[] = useMemo(() => {
    const list: Target[] = [];
    for (const u of catalog.universities) {
      list.push({ kind: 'university', universityId: u.id, label: `${u.shortName} — university default` });
      for (const s of u.schools) {
        for (const p of s.programmes) {
          list.push({
            kind: 'programme',
            programmeId: p.id,
            label: `${u.shortName} · ${p.shortName} — programme`,
          });
        }
      }
    }
    return list;
  }, [catalog]);

  const [targetId, setTargetId] = useState<string>(targets[0]?.label ?? '');
  const target: Target =
    targets.find((t) => t.label === targetId) ?? targets[0];

  if (!target) {
    return <p className="text-sm text-slate-500">No institutions configured.</p>;
  }

  const ruleTarget: RuleTarget =
    target.kind === 'university'
      ? { scope: 'university', universityId: target.universityId }
      : { scope: 'programme', programmeId: target.programmeId };

  const programmeOverride =
    target.kind === 'programme'
      ? findProgramme(catalog, target.programmeId)?.programme.gradingSystem !== undefined
      : false;

  const grading = getGradingSystem(catalog, ruleTarget);
  const classification = getClassificationSystem(catalog, ruleTarget);
  const gIssues = validateGradingSystem(grading);
  const cIssues = validateClassificationSystem(classification);
  const gErrors = gIssues.filter((i) => i.severity === 'error').length;
  const cErrors = cIssues.filter((i) => i.severity === 'error').length;

  function updateGrading(mut: (system: NonNullable<typeof grading>) => void) {
    if (!grading) return;
    const copy = JSON.parse(JSON.stringify(grading));
    mut(copy);
    copy.bands.sort((a: GradeBand, b: GradeBand) => a.minScore - b.minScore);
    apply((c) => setGradingSystem(c, ruleTarget, copy));
  }

  /** Apply a change to the grading band currently shown at `rowIndex` in the
   *  sorted table (identity = stable id, or object reference otherwise). */
  function editBand(rowIndex: number, patch: Partial<GradeBand>) {
    if (!grading) return;
    const sorted = [...grading.bands].sort((a, b) => a.minScore - b.minScore);
    const targetBand = sorted[rowIndex];
    if (!targetBand) return;
    updateGrading((sys) => {
      const match = sys.bands.find(
        (x: GradeBand) =>
          (targetBand.id && x.id === targetBand.id) ||
          (!targetBand.id && x.grade === targetBand.grade && x.minScore === targetBand.minScore)
      );
      if (match) Object.assign(match, patch);
    });
  }

  function removeBand(rowIndex: number) {
    if (!grading) return;
    const sorted = [...grading.bands].sort((a, b) => a.minScore - b.minScore);
    const targetBand = sorted[rowIndex];
    if (!targetBand) return;
    confirmThen(`Remove grade ${targetBand.grade}?`, () =>
      updateGrading((sys) => {
        sys.bands = sys.bands.filter(
          (x: GradeBand) =>
            !(
              (targetBand.id && x.id === targetBand.id) ||
              (!targetBand.id && x.grade === targetBand.grade && x.minScore === targetBand.minScore)
            )
        );
      })
    );
  }

  function updateClassification(
    mut: (system: NonNullable<typeof classification>) => void
  ) {
    if (!classification) return;
    const copy = JSON.parse(JSON.stringify(classification));
    mut(copy);
    copy.bands.sort((a: ClassificationBand, b: ClassificationBand) => b.minCgpa - a.minCgpa);
    apply((c) => setClassificationSystem(c, ruleTarget, copy));
  }

  function useOfficialUcc() {
    confirmThen('Reset these rules to the official published UCC grading & classification?', () => {
      let next = setGradingSystem(catalog, ruleTarget, uccOfficialGrading());
      next = setClassificationSystem(next, ruleTarget, uccOfficialClassification());
      apply(() => next);
      flash('Reset to official UCC rules.');
    });
  }

  function inheritUniversity() {
    if (target.kind !== 'programme') return;
    confirmThen('Remove the programme override and inherit the university rules?', () => {
      apply((c) =>
        c.universities
          ? {
              ...c,
              universities: c.universities.map((u) => ({
                ...u,
                schools: u.schools.map((s) => ({
                  ...s,
                  programmes: s.programmes.map((p) =>
                    p.id === target.programmeId
                      ? { ...p, gradingSystem: undefined, classificationSystem: undefined }
                      : p
                  ),
                })),
              })),
            }
          : c
      );
    });
  }

  function copyUniversityToProgramme() {
    if (target.kind !== 'programme' || !grading || !classification) return;
    apply((c) => setGradingSystem(c, ruleTarget, JSON.parse(JSON.stringify(grading))));
    apply((c) =>
      setClassificationSystem(c, ruleTarget, JSON.parse(JSON.stringify(classification)))
    );
    flash('Programme now has its own editable copy of the university rules.');
  }

  function applyToDevice() {
    void writeCachedConfig(
      {
        universities: catalog.universities,
        curricula: catalog.curricula,
      },
      { version: null, source: 'local' }
    );
    flash('Preview stored — the student app on THIS device uses these rules from its next open. Use "Save & Publish" (Dashboard) to ship to every device.');
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-black text-slate-900">Grading &amp; Classification</h1>
        <p className="text-xs text-slate-500">
          Define raw-score ranges, letter grades, grade points, interpretations
          and degree-classification CGPA ranges. The calculation engine always
          uses the active published rules — nothing is hard-coded in the
          student UI. Enter only the official rules for the institution.
        </p>
      </header>

      {notice && <div className="rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white">{notice}</div>}

      <div className="flex flex-wrap items-end gap-2 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <label className="block">
          <span className="label">Rule set</span>
          <select
            className="input min-w-[260px]"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
          >
            {targets.map((t) => (
              <option key={t.label} value={t.label}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <div className="ml-auto flex flex-wrap gap-2">
          {target.kind === 'programme' && !programmeOverride && (
            <button className="btn-ghost" onClick={copyUniversityToProgramme}>
              ⎘ Customise for this programme
            </button>
          )}
          {target.kind === 'programme' && programmeOverride && (
            <button className="btn-ghost" onClick={inheritUniversity}>
              ↩ Inherit university rules
            </button>
          )}
          <button className="btn-ghost" onClick={useOfficialUcc}>
            ↺ Reset to official UCC
          </button>
          <button className="btn-primary" onClick={applyToDevice}>
            📲 Apply to student app
          </button>
        </div>
      </div>

      {/* Grading system */}
      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-bold text-slate-800">Grading system</h2>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${
              gErrors === 0
                ? 'bg-emerald-100 text-emerald-700 ring-emerald-300'
                : 'bg-red-100 text-red-700 ring-red-300'
            }`}
          >
            {gErrors === 0 ? '✅ valid' : `⛔ ${gErrors} error${gErrors === 1 ? '' : 's'}`}
          </span>
          {grading && (
            <span className="ml-auto text-[11px] font-bold text-brand-700">
              Top grade point: {maxGradePoints(grading).toFixed(2)}
            </span>
          )}
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] text-xs">
            <thead>
              <tr className="text-left uppercase tracking-wide text-slate-400">
                <th className="py-1 pr-2">Grade</th>
                <th className="py-1 pr-2">Min score</th>
                <th className="py-1 pr-2">Max score</th>
                <th className="py-1 pr-2">Grade point</th>
                <th className="py-1 pr-2">Interpretation</th>
                <th className="py-1"></th>
              </tr>
            </thead>
            <tbody>
              {grading?.bands
                .slice()
                .sort((a, b) => a.minScore - b.minScore)
                .map((band, rowIndex) => (
                  <tr
                    key={band.id ?? `row-${rowIndex}`}
                    className="border-t border-slate-100"
                  >
                    <td className="py-1 pr-2">
                      <input
                        className="input w-16 px-2 py-1 text-center font-bold"
                        value={band.grade}
                        onChange={(e) => editBand(rowIndex, { grade: e.target.value })}
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        type="number"
                        className="input w-20 px-2 py-1 text-center"
                        value={band.minScore}
                        onChange={(e) => editBand(rowIndex, { minScore: Number(e.target.value) })}
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        type="number"
                        className="input w-20 px-2 py-1 text-center"
                        value={band.maxScore}
                        onChange={(e) => editBand(rowIndex, { maxScore: Number(e.target.value) })}
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        type="number"
                        step="0.1"
                        className="input w-20 px-2 py-1 text-center font-bold"
                        value={band.points}
                        onChange={(e) => editBand(rowIndex, { points: Number(e.target.value) })}
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        className="input px-2 py-1"
                        value={band.interpretation ?? ''}
                        onChange={(e) => editBand(rowIndex, { interpretation: e.target.value })}
                      />
                    </td>
                    <td className="py-1 text-right">
                      <button
                        className="text-red-400 hover:text-red-600"
                        onClick={() => removeBand(rowIndex)}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        <div className="mt-2 flex gap-2">
          <button
            className="btn-ghost py-1.5 text-xs"
            onClick={() =>
              updateGrading((g) => {
                g.bands.push(makeGradingBand());
              })
            }
          >
            ＋ Add grade band
          </button>
        </div>

        <IssueList issues={gIssues} />
      </section>

      {/* Classification system */}
      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-bold text-slate-800">Degree classification</h2>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${
              cErrors === 0
                ? 'bg-emerald-100 text-emerald-700 ring-emerald-300'
                : 'bg-red-100 text-red-700 ring-red-300'
            }`}
          >
            {cErrors === 0 ? '✅ valid' : `⛔ ${cErrors} error${cErrors === 1 ? '' : 's'}`}
          </span>
        </div>

        <div className="mt-3 space-y-2">
          {classification?.bands
            .slice()
            .sort((a, b) => b.minCgpa - a.minCgpa)
            .map((band) => (
              <div
                key={band.id}
                className="grid grid-cols-12 items-center gap-2 rounded-lg bg-slate-50 p-2 ring-1 ring-slate-100"
              >
                <input
                  className="input col-span-6 px-2 py-1.5 text-sm font-semibold sm:col-span-7"
                  value={band.label}
                  onChange={(e) =>
                    updateClassification((sys) => {
                      const b = sys.bands.find((x: ClassificationBand) => x.id === band.id);
                      if (b) b.label = e.target.value;
                    })
                  }
                />
                <input
                  type="number"
                  step="0.01"
                  className="input col-span-2 px-1 py-1.5 text-center"
                  value={band.minCgpa}
                  onChange={(e) =>
                    updateClassification((sys) => {
                      const b = sys.bands.find((x) => x.id === band.id);
                      if (b) b.minCgpa = Number(e.target.value);
                    })
                  }
                />
                <span className="col-span-1 text-center text-slate-400">–</span>
                <input
                  type="number"
                  step="0.01"
                  className="input col-span-2 px-1 py-1.5 text-center"
                  value={band.maxCgpa}
                  onChange={(e) =>
                    updateClassification((sys) => {
                      const b = sys.bands.find((x) => x.id === band.id);
                      if (b) b.maxCgpa = Number(e.target.value);
                    })
                  }
                />
                <button
                  className="col-span-1 text-right text-red-400 hover:text-red-600"
                  onClick={() =>
                    confirmThen(`Remove "${band.label}"?`, () =>
                      updateClassification((sys) => {
                        sys.bands = sys.bands.filter((x) => x.id !== band.id);
                      })
                    )
                  }
                >
                  ✕
                </button>
              </div>
            ))}
        </div>

        <div className="mt-2 flex gap-2">
          <button
            className="btn-ghost py-1.5 text-xs"
            onClick={() =>
              updateClassification((sys) => {
                sys.bands.push(makeClassificationBand());
              })
            }
          >
            ＋ Add classification band
          </button>
        </div>

        <IssueList issues={cIssues} />
      </section>
    </div>
  );
}

function IssueList({ issues }: { issues: { severity: string; message: string }[] }) {
  if (issues.length === 0) {
    return <p className="mt-2 text-[11px] font-semibold text-emerald-700">✅ No issues.</p>;
  }
  return (
    <div className="mt-2 space-y-1">
      {issues.map((i, n) => (
        <p
          key={n}
          className={i.severity === 'error' ? 'text-[11px] font-semibold text-red-600' : 'text-[11px] text-amber-700'}
        >
          {i.severity === 'error' ? '⛔ ' : '⚠️ '}
          {i.message}
        </p>
      ))}
    </div>
  );
}
