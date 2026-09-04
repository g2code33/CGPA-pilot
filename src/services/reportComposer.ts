// ─────────────────────────────────────────────────────────────────────────
// REPORT COMPOSER (Prompt 15)
//
// Builds the composed offline print documents — PRINT SUMMARY and PRINT FULL
// REPORT — as HTML strings handed to scopedPrint. Uses only numbers entered
// for this session plus published curriculum labels; no identity data.
// ─────────────────────────────────────────────────────────────────────────

import {
  htmlTable,
  metricGrid,
  sectionHeading,
  TONE,
} from './scopedPrint';
import type { DashboardModel } from './dashboardService';
import { planSectionNoun } from './dashboardService';

export function summaryReport(m: DashboardModel): { html: string } {
  const metrics = metricGrid([
    { label: 'Current level', value: `L${m.currentLevel * 100}`, tone: TONE.slate },
    { label: 'Current CGPA', value: m.currentCgpa === null ? '—' : m.currentCgpa.toFixed(2), tone: TONE.brand },
    { label: 'Classification', value: m.currentClassLabel ?? '—' },
    { label: 'Target', value: m.targetCgpa.toFixed(2), tone: TONE.emerald },
    { label: 'Required future GPA', value: m.requiredFutureGpa === null ? '—' : m.requiredFutureGpa.toFixed(2), tone: TONE.amber },
    { label: 'Projected final CGPA', value: m.projectedFinalCgpa === null ? '—' : m.projectedFinalCgpa.toFixed(2), tone: TONE.brand },
  ]);
  const semLabel =
    m.semesterRole === 'upon-release'
      ? 'Results (upon release)'
      : m.semesterRole === 'finish-current'
        ? 'This semester'
        : 'Next semester';
  const table = htmlTable(
    ['Flight status', 'Value'],
    [
      ['Status', `${m.statusEmoji} ${m.statusLabel}`],
      ['Target classification', m.targetClassLabel],
      ['Maximum possible final CGPA', m.maxPossibleFinalCgpa === null ? '—' : m.maxPossibleFinalCgpa.toFixed(2)],
      ['Graded credits completed', String(m.creditsCompleted)],
      [semLabel, m.next ? m.next.next.label : '—'],
      [`${semLabel} required GPA`, m.next?.requiredNextGpa != null ? m.next.requiredNextGpa.toFixed(2) : '—'],
      ['Curriculum version', m.curriculumVersion ?? 'not published'],
    ]
  );
  return {
    html: `${sectionHeading('🧾', 'Print Summary')}${metrics}<div class="print-card">${table}</div>
      <p style="font-size:10px;color:#64748b;">Required/Projected figures are planning values: the target is a goal; the projected final CGPA assumes a steady future average and is not a prediction.</p>`,
  };
}

export function fullReport(
  m: DashboardModel
): { html: string; pageBreakBefore?: boolean }[] {
  const summary = summaryReport(m).html;

  // Flight path / milestones.
  const fp = m.flightPath.milestones;
  const pathRows = fp
    .filter((p) => p.kind === 'current' || p.isLevelEnd || p.isGraduation)
    .map((p) => [
      p.kind === 'current' ? 'Now' : p.detail,
      String(p.cumulativeCredits),
      p.projectedCgpa.toFixed(2),
      p.requiredCgpa === null ? '—' : p.requiredCgpa.toFixed(2),
    ]);
  const flightHtml = `${sectionHeading('🛩️', 'Flight path & milestones')}
    <p style="font-size:10px;color:#64748b;margin:0 0 6px;">
      Current position: ${m.currentCgpa === null ? '—' : m.currentCgpa.toFixed(2)} · Target: ${m.targetCgpa.toFixed(2)} (green line).
      The projected trajectory assumes a steady future average${m.flightPath.requiredFutureGpa !== null ? ` of ${m.flightPath.requiredFutureGpa.toFixed(2)}` : ''}; the required line is what must be held to reach the target.
    </p>
    <div class="print-card">${htmlTable(
      ['Milestone', 'Credits', 'Projected CGPA', 'Required CGPA'],
      pathRows as (string | number)[][]
    )}</div>`;

  // Next semester plan (heading is role-aware so a mid-semester student's
  // report never mislabels the current/pending semester as "next").
  const planHeading = planSectionNoun(m.semesterRole);
  let nextHtml = `${sectionHeading('▶️', planHeading)}<p style="font-size:10px;color:#64748b;">No semester-plan data yet.</p>`;
  if (m.next) {
    const courseRows = m.next.next.courses.map((c) => [
      c.code,
      String(c.creditHours),
      m.next!.combos[0]?.assignments.find((a) => a.code === c.code)?.grade ?? '—',
    ]);
    nextHtml = `${sectionHeading('▶️', planHeading)}
      <p style="font-size:11px;margin:0 0 6px;">
        <strong>${m.next.next.label}</strong> · Required GPA:
        <strong style="color:${TONE.brand};">${m.next.requiredNextGpa === null ? '—' : m.next.requiredNextGpa.toFixed(2)}</strong>
        · Target: ${m.next.targetClassLabel}
      </p>
      <div class="print-card">${
        courseRows.length
          ? htmlTable(['Course', 'Credits', 'Target grade'], courseRows as (string | number)[][])
          : '<p style="font-size:10px;color:#64748b;">Curriculum courses not published yet — the target grade table fills in when the administrator publishes courses. These are planning targets, not predicted grades.</p>'
      }</div>`;
  }

  // Pilot brief.
  const briefHtml = `${sectionHeading('🗣️', 'Pilot brief')}
    <ul style="margin:0;padding-left:18px;font-size:11px;">
      ${m.brief.map((b) => `<li style="margin-bottom:3px;">${b}</li>`).join('')}
    </ul>`;

  return [
    { html: summary },
    { html: flightHtml, pageBreakBefore: true },
    { html: nextHtml, pageBreakBefore: true },
    { html: briefHtml, pageBreakBefore: true },
  ];
}

/** Standalone concise pilot brief (PRINT PILOT BRIEF). */
export function pilotBriefReport(m: DashboardModel): { html: string } {
  return {
    html: `${sectionHeading('🗣️', 'Pilot Brief')}
      <ul style="margin:0;padding-left:18px;font-size:12px;">
        ${m.brief.map((b) => `<li style="margin-bottom:4px;">${b}</li>`).join('')}
      </ul>`,
  };
}
