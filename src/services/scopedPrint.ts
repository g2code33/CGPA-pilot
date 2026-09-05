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
  /** App logo image (data URL or bundled path) shown in the sheet header. */
  appLogo?: string;
  /** University / institution logo image shown in the sheet header. */
  institutionLogo?: string;
  /** Default Save-as-PDF file name (browser print dialog). */
  fileName?: string;
}

/** Build the standard save name: CGPA PILOT - <position> - <document>. */
export function printFileName(positionLabel: string, docName: string): string {
  return `CGPA PILOT - ${positionLabel} - ${docName}`;
}

/** Make a string safe for use as a file name. */
function sanitizeFileName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
}

const DEFAULT_DISCLAIMER =
  'Targets are goals you set; projections and trajectories are scenarios based on assumed future results — not predicted grades or guaranteed outcomes. This sheet is anonymous: CGPA PILOT does not collect names, IDs, email, phone or account details.';

/** Escape text before it is placed into a print HTML template. All values
 *  interpolated here originate from configuration or numeric engine output,
 *  but escaping is applied unconditionally as defense in depth. */
function esc(value: string | undefined | null): string {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function brandingHtml(b: PrintBranding): string {
  const date = new Date().toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const appLogo = b.appLogo
    ? `<img src="${esc(b.appLogo)}" alt="" style="width:34px;height:34px;object-fit:contain;border-radius:8px;">`
    : '';
  const instLogo = b.institutionLogo
    ? `<img src="${esc(b.institutionLogo)}" alt="" style="width:34px;height:34px;object-fit:contain;border-radius:8px;">`
    : '';
  return `
    <div class="print-brand" style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
      <div style="display:flex;align-items:flex-start;gap:10px;">
        ${appLogo}
        <div>
          <div style="font-size:18px;font-weight:900;letter-spacing:0.5px;">
            CGPA <span style="color:#4f46e5;">PILOT</span>
          </div>
          <div style="font-style:italic;color:#64748b;font-size:10px;">Navigate Your Academic Future.</div>
          <div style="font-weight:800;margin-top:4px;">${esc(b.title)}</div>
        </div>
      </div>
      <div style="display:flex;align-items:flex-start;gap:10px;justify-content:flex-end;">
        <div style="text-align:right;font-size:10px;color:#475569;">
          ${b.institutionLabel ? `<div style="font-weight:700;">${esc(b.institutionLabel)}</div>` : ''}
          ${b.programmeName ? `<div>${esc(b.programmeName)}</div>` : ''}
          <div>Curriculum: ${esc(b.curriculumVersion) || 'not published'}</div>
          <div>${date}</div>
          <div style="font-weight:700;color:#059669;">Anonymous · no personal data</div>
        </div>
        ${instLogo}
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

function triggerPrintAndCleanup(root: HTMLElement, fileName?: string) {
  const originalTitle = document.title;
  const pretty = fileName ? sanitizeFileName(fileName) : '';
  if (pretty) document.title = pretty; // becomes the Save-as-PDF default name

  const cleanup = () => {
    root.innerHTML = '';
    document.title = originalTitle;
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
  triggerPrintAndCleanup(root, branding.fileName);
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
  triggerPrintAndCleanup(root, branding.fileName);
}

// ── Small HTML helpers used by the composed reports ───────────────────────

export function htmlTable(headers: string[], rows: (string | number)[][]): string {
  const head = headers
    .map((h) => `<th style="text-align:left;border-bottom:1px solid #0f172a;padding:4px 6px;font-size:9.5px;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;">${esc(h)}</th>`)
    .join('');
  const body = rows
    .map(
      (r) =>
        `<tr>${r
          .map(
            (c, i) =>
              `<td style="padding:4px 6px;border-bottom:1px solid #e2e8f0;${i > 0 ? 'text-align:right;' : 'font-weight:600;'}">${esc(String(c))}</td>`
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
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;font-weight:700;">${esc(it.label)}</div>
        <div style="font-size:18px;font-weight:900;color:${it.tone ?? '#0f172a'};">${esc(it.value)}</div>
      </div>`
      )
      .join('')}
  </div>`;
}

export function sectionHeading(icon: string, title: string): string {
  return `<h2 style="font-size:13px;font-weight:900;margin:0 0 6px 0;">${icon} ${esc(title)}</h2>`;
}

export const TONE = {
  brand: '#4f46e5',
  emerald: '#059669',
  amber: '#d97706',
  red: '#dc2626',
  slate: '#475569',
};
