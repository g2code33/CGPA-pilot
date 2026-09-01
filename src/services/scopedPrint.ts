// ─────────────────────────────────────────────────────────────────────────
// SCOPED PRINT ENGINE (Prompt 15)
//
// Browser-native printing of a SINGLE section (or a composed multi-section
// report) without printing the rest of the app. We render the printable
// content into a hidden #cgpa-print-root container; the print stylesheet hides
// the live app (.app-root) and shows only that container. Uses the browser's
// print dialog / Save-as-PDF — no online or paid service, fully offline.
//
// Privacy: content is cloned/rendered in memory, shown only during printing,
// and removed immediately after. Nothing is persisted; no identity fields
// (name, ID, email, phone, account) are collected or included.
// ─────────────────────────────────────────────────────────────────────────

export interface PrintBranding {
  title: string;
  institutionLabel?: string;
  programmeName?: string;
  curriculumVersion?: string;
  /** Small note distinguishing target vs projection. */
  disclaimer?: string;
}

const DEFAULT_DISCLAIMER =
  'Targets are goals you set; projections and trajectories are scenarios based on assumed future results — not predicted grades or guaranteed outcomes. This sheet is anonymous: CGPA PILOT does not collect names, IDs, email, phone or account details.';

function brandingHtml(b: PrintBranding): string {
  const date = new Date().toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  return `
    <div class="print-brand" style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
      <div>
        <div style="font-size:18px;font-weight:900;letter-spacing:0.5px;">
          CGPA <span style="color:#4f46e5;">PILOT</span>
        </div>
        <div style="font-style:italic;color:#64748b;font-size:10px;">Navigate Your Academic Future.</div>
        <div style="font-weight:800;margin-top:4px;">${b.title}</div>
      </div>
      <div style="text-align:right;font-size:10px;color:#475569;">
        ${b.institutionLabel ? `<div style="font-weight:700;">${b.institutionLabel}</div>` : ''}
        ${b.programmeName ? `<div>${b.programmeName}</div>` : ''}
        <div>Curriculum: ${b.curriculumVersion ?? 'not published'}</div>
        <div>${date}</div>
        <div style="font-weight:700;color:#059669;">Anonymous · no personal data</div>
      </div>
    </div>`;
}

function disclaimerHtml(b?: string): string {
  return `<div style="margin-top:10px;padding:6px 8px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;font-size:9.5px;color:#64748b;">${b ?? DEFAULT_DISCLAIMER}</div>`;
}

function ensureRoot(): HTMLElement {
  let root = document.getElementById('cgpa-print-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'cgpa-print-root';
    document.body.appendChild(root);
  }
  return root;
}

let cleanupTimer: ReturnType<typeof setTimeout> | null = null;

function triggerPrintAndCleanup(root: HTMLElement) {
  const cleanup = () => {
    root.innerHTML = '';
    window.removeEventListener('afterprint', cleanup);
    if (cleanupTimer) clearTimeout(cleanupTimer);
  };
  window.addEventListener('afterprint', cleanup);
  // Fallback in case afterprint doesn't fire in some environments.
  cleanupTimer = setTimeout(cleanup, 1500);

  // Defer one frame so the DOM is laid out before printing.
  requestAnimationFrame(() => {
    try {
      window.print();
    } catch {
      cleanup();
    }
  });
}

/** Print a single DOM element (cloned) with branding. */
export function printSection(
  element: HTMLElement | null | undefined,
  branding: PrintBranding
): void {
  if (!element) return;
  const root = ensureRoot();
  const clone = element.cloneNode(true) as HTMLElement;
  // Drop any screen-only controls that were cloned along.
  clone.querySelectorAll('.no-print').forEach((n) => n.remove());
  root.innerHTML = `
    ${brandingHtml(branding)}
    <div class="print-content">${clone.outerHTML}</div>
    ${disclaimerHtml(branding.disclaimer)}
  `;
  triggerPrintAndCleanup(root);
}

/** Print composed HTML sections (used by the full/summary reports). */
export function printHtml(
  sections: { html: string; pageBreakBefore?: boolean }[],
  branding: PrintBranding
): void {
  const root = ensureRoot();
  const body = sections
    .map(
      (s) =>
        `<div class="print-block ${s.pageBreakBefore ? 'print-page-break' : ''}">${s.html}</div>`
    )
    .join('');
  root.innerHTML = `
    ${brandingHtml(branding)}
    ${body}
    ${disclaimerHtml(branding.disclaimer)}
  `;
  triggerPrintAndCleanup(root);
}

// ── Small HTML helpers used by the composed reports ───────────────────────

export function htmlTable(headers: string[], rows: (string | number)[][]): string {
  const head = headers
    .map((h) => `<th style="text-align:left;border-bottom:1px solid #0f172a;padding:4px 6px;font-size:9.5px;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;">${h}</th>`)
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
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

export function metricGrid(items: { label: string; value: string; tone?: string }[]): string {
  return `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px;">
    ${items
      .map(
        (it) => `<div class="print-card" style="text-align:center;">
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;font-weight:700;">${it.label}</div>
        <div style="font-size:18px;font-weight:900;color:${it.tone ?? '#0f172a'};">${it.value}</div>
      </div>`
      )
      .join('')}
  </div>`;
}

export function sectionHeading(icon: string, title: string): string {
  return `<h2 style="font-size:13px;font-weight:900;margin:0 0 6px 0;">${icon} ${title}</h2>`;
}

export const TONE = {
  brand: '#4f46e5',
  emerald: '#059669',
  amber: '#d97706',
  red: '#dc2626',
  slate: '#475569',
};
