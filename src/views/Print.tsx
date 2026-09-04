import { useDerived } from '../state/derived';
import { Card, SectionTitle, Note } from '../components/ui';
import { printHtml, sectionHeading } from '../services/scopedPrint';
import {
  summaryReport,
  fullReport,
  pilotBriefReport,
} from '../services/reportComposer';

/**
 * Print hub — all documents are generated locally and sent to the browser's
 * print / Save-as-PDF dialog. No online/paid service, fully offline, and
 * nothing is saved. Every sheet is anonymous (no name, ID, email, phone or
 * account data — CGPA PILOT does not collect these).
 */
export function PrintView() {
  const d = useDerived();
  const m = d.dashboard;

  const branding = {
    institutionLabel: m.institutionLabel,
    programmeName: d.programme?.name ?? '',
    curriculumVersion: m.curriculumVersion ?? undefined,
  };

  const options = [
    {
      icon: '🧾',
      title: 'Print Summary',
      desc: 'Current level, CGPA & classification, target, required future GPA and projected final CGPA.',
      run: () => printHtml([summaryReport(m)], { ...branding, title: 'Print Summary' }),
      ready: m.hasData,
    },
    {
      icon: '🛩️',
      title: 'Print Flight Path',
      desc: 'Trajectory graph, current position, target line, milestones and assumptions — use the Flight Path tab for the full graph sheet.',
      run: () => {
        const rows = m.flightPath.milestones
          .filter((p) => p.kind === 'current' || p.isLevelEnd || p.isGraduation)
          .map((p) => [
            p.kind === 'current' ? 'Now' : p.detail,
            String(p.cumulativeCredits),
            p.projectedCgpa.toFixed(2),
            p.requiredCgpa === null ? '—' : p.requiredCgpa.toFixed(2),
          ]);
        const html = `${sectionHeading('🛩️', 'Flight path & milestones')}
          <p style="font-size:10px;color:#64748b;">Current CGPA ${m.currentCgpa?.toFixed(2) ?? '—'} · Target ${m.targetCgpa.toFixed(2)} (a goal). Projected trajectory assumes a steady future GPA — a scenario, not a guaranteed outcome. The full colour graph prints from the Flight Path tab.</p>
          <div class="print-card">${rowsTable(rows)}</div>`;
        printHtml([{ html }], { ...branding, title: 'Print Flight Path' });
      },
      ready: m.hasData,
    },
    {
      icon: '▶️',
      title:
        m.semesterRole === 'upon-release'
          ? 'Print On-Release Result'
          : m.semesterRole === 'finish-current'
            ? 'Print This-Semester Plan'
            : 'Print Next Semester Plan',
      desc:
        m.semesterRole === 'upon-release'
          ? 'What your CGPA becomes once the pending results are released (best / worst), plus the steady average you needed.'
          : 'Semester, courses, credits, mathematically-derived target grades and required GPA.',
      run: () => {
        if (m.semesterRole === 'upon-release') {
          const f = (n: number | null) => (n === null ? '—' : n.toFixed(2));
          const p = d.pending;
          const html = `${sectionHeading('📋', 'Upon release')}
            <div class="print-card">
              <p style="margin:0 0 4px;"><strong>${m.next?.next.label ?? 'Semester'}</strong> — results pending (${p.pendingCreditHours} credits). Confirmed: ${p.confirmedCreditHours} credits at ${f(p.confirmedCgpa)}.</p>
              ${rowsTable(
                [
                  ['If top grades', f(p.bestCaseCgpa), p.bestCaseClass?.label ?? '—'],
                  ['If minimum pass', f(p.minPassCgpa), p.minPassClass?.label ?? '—'],
                  ['Worst case', f(p.worstCaseCgpa), p.worstCaseClass?.label ?? '—'],
                ],
                ['Outcome', 'CGPA once released', 'Classification']
              )}
              ${m.next?.requiredNextGpa != null ? `<p style="font-size:10px;color:#64748b;margin-top:4px;">Required steady average across these pending credits and what remains: ${f(m.next.requiredNextGpa)}.</p>` : ''}
            </div>`;
          printHtml([{ html }], { ...branding, title: 'Print On-Release Result' });
          return;
        }
        const next = m.next;
        const heading = m.semesterRole === 'finish-current' ? 'This semester plan' : 'Next semester plan';
        const courseRows = next
          ? next.next.courses.map((c) => [
              c.code,
              String(c.creditHours),
              next.combos[0]?.assignments.find((a) => a.code === c.code)?.grade ?? '—',
            ])
          : [];
        const html = `${sectionHeading('▶️', heading)}
          <div class="print-card">
            <p style="margin:0 0 4px;"><strong>${next?.next.label ?? '—'}</strong> · Required GPA <strong>${next?.requiredNextGpa?.toFixed(2) ?? '—'}</strong> · Target: ${next?.targetClassLabel ?? '—'}</p>
            ${courseRows.length ? rowsTable(courseRows, ['Course', 'Credits', 'Target grade']) : '<p style="font-size:10px;color:#64748b;">Curriculum courses not published yet. Target grades are planning targets, not predicted grades.</p>'}
          </div>`;
        printHtml([{ html }], { ...branding, title: heading });
      },
      ready: m.hasData && !!m.next,
    },
    {
      icon: '🗣️',
      title: 'Print Pilot Brief',
      desc: 'The concise co-pilot summary: current, target, status, required GPA, next-semester target, max possible CGPA, assumptions and curriculum version.',
      run: () => printHtml([pilotBriefReport(m)], { ...branding, title: 'Pilot Brief' }),
      ready: m.hasData,
    },
    {
      icon: '📚',
      title: 'Print Full Report',
      desc: 'Combines summary, flight path & milestones, next-semester plan and pilot brief into one A4 multi-page report.',
      run: () => printHtml(fullReport(m), { ...branding, title: 'Full Report' }),
      ready: m.hasData,
    },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle
          icon="🖨️"
          title="Print Centre"
          subtitle="Browser-native printing and Save-as-PDF — fully offline, no paid or online service. Each sheet is anonymous; CGPA PILOT collects no name, ID, email, phone or account details."
        />
        <div className="grid gap-2 sm:grid-cols-2">
          {options.map((o) => (
            <button
              key={o.title}
              onClick={o.run}
              disabled={!o.ready}
              className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-brand-300 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="text-xl">{o.icon}</span>
              <span>
                <span className="block text-sm font-extrabold text-slate-800">{o.title}</span>
                <span className="block text-[11px] leading-snug text-slate-500">{o.desc}</span>
              </span>
            </button>
          ))}
        </div>
        {!m.hasData && (
          <Note>Enter your current CGPA on the Calculate tab first — the reports fill in from your confirmed position.</Note>
        )}
        <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
          Every printout carries CGPA PILOT branding, the curriculum version and a
          note distinguishing your <strong>target</strong> (a goal you set) from
          <strong> projections/predictions</strong> (scenarios based on assumed
          future results). Printing does not save or transmit your information.
        </p>
      </Card>

      <Card className="no-print">
        <SectionTitle icon="🔒" title="Privacy while printing" />
        <ul className="space-y-1.5 text-sm text-slate-600">
          <li>▸ Nothing is sent to any server — the print sheet is rendered on this device.</li>
          <li>▸ No name, student ID, email, phone number or account appears.</li>
          <li>▸ Your numbers are not stored; a refresh clears the session.</li>
        </ul>
      </Card>
    </div>
  );
}

function rowsTable(rows: (string | number)[][], headers = ['Milestone', 'Credits', 'Projected CGPA', 'Required CGPA']) {
  const head = headers
    .map(
      (h) =>
        `<th style="text-align:left;border-bottom:1px solid #0f172a;padding:4px 6px;font-size:9.5px;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;">${h}</th>`
    )
    .join('');
  const body = rows
    .map(
      (r) =>
        `<tr>${r
          .map(
            (c, i) =>
              `<td style="padding:4px 6px;border-bottom:1px solid #e2e8f0;${i > 0 ? 'text-align:right;' : 'font-weight:600;'}">${c}</td>`
          )
          .join('')}</tr>`
    )
    .join('');
  return `<table style="width:100%;border-collapse:collapse;"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}
