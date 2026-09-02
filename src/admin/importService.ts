// ─────────────────────────────────────────────────────────────────────────
// importService — import semester course lists from files in the admin
// curriculum editor. Supported:
//   • JSON  — a structured course list (or a whole curriculum document)
//   • XLSX  — spreadsheets exported from a university handbook table
//   • PDF   — the official semester table (extracted text is parsed)
//
// Parsing is heuristic for XLSX/PDF (real handbooks vary in formatting), so
// the editor always shows a PREVIEW before applying anything. The parser
// mirrors the table format used by UCC: columns Code / Title / T / P / C,
// with the credit total C = T + P, or a single trailing credits column.
// This is ADMIN tooling; it never runs in the student bundle.
// ─────────────────────────────────────────────────────────────────────────

import type { BulkRow } from './adminConfigService';

export interface ImportedSemester {
  levelIndex: number; // 1-based
  semesterIndex: number; // 1-based within the level
  label: string;
  rows: BulkRow[];
}

export interface ImportResult {
  semesters: ImportedSemester[];
  /** Unparseable / ignored lines, shown so the admin can verify. */
  ignored: string[];
  format: 'json' | 'xlsx' | 'pdf';
  fileName: string;
}

// ── Row parsing shared by XLSX/PDF ───────────────────────────────────────

const SEMESTER_HEADING =
  /(?:^|\s)(\d)(?:st|nd|rd|th)?\s*(?:sem(?:ester)?|sem\b)/i;
const LEVEL_HEADING =
  /level\s*(\d{3})|(?:^|\s)([1-6])0{2}(\s|$)|level\s*([1-6])(\b|$)/i;

/** A row is a course when its first cell looks like a course code. */
function looksLikeCode(value: string): boolean {
  const v = value.trim().toUpperCase();
  if (!v) return false;
  if (/^(TOTAL|GRAND\s*TOTAL|COURSE|CODE|S\/?N|NO\.?|TITLE|CREDIT|MODULE|^P$|^T$|^C$)/.test(v)) return false;
  // e.g. PHM101, PHA 111, CMS107, ILT101, ASP (short all-letter codes like
  // the university's "African Studies Course"), or combined LAR/LSS/LED.
  const single = /^[A-Z]{2,5}(\s?\d{2,3}[A-Z]?)?$/;
  const combined = /^[A-Z]{2,5}(\s*\/\s*[A-Z]{2,5})+(\s?\d{2,3}[A-Z]?)?$/;
  return single.test(v) || combined.test(v);
}

function toCreditNumber(v: unknown): number {
  const n = Number(String(v).trim());
  return Number.isFinite(n) && n >= 0 && n <= 20 ? n : 0;
}

/**
 * Convert a matrix of string cells (a worksheet or PDF text lines split into
 * columns) into semester groups of course rows.
 */
export function parseMatrix(lines: string[][]): { semesters: ImportedSemester[]; ignored: string[] } {
  const semesters: ImportedSemester[] = [];
  const ignored: string[] = [];
  let level = 0;
  let semester = 0;

  const ensure = () => {
    if (level === 0) {
      // Level heading not seen yet — infer level 1.
      level = 1;
    }
    if (semester === 0) semester = 1;
    const key = `${level}-${semester}`;
    let sem = semesters.find(
      (s) => s.levelIndex === level && s.semesterIndex === semester
    );
    if (!sem) {
      sem = {
        levelIndex: level,
        semesterIndex: semester,
        label: `Level ${level * 100} · Semester ${semester}`,
        rows: [],
      };
      semesters.push(sem);
    }
    return { sem, key };
  };

  for (const cellsIn of lines) {
    const cells = cellsIn.map((c) => c.trim()).filter((c) => c !== '');
    if (cells.length === 0) continue;
    const joined = cells.join(' ');

    const lvl = joined.match(LEVEL_HEADING);
    if (lvl) {
      const digits = lvl[1] ?? lvl[2] ?? lvl[4];
      const next = digits ? (digits.length === 3 ? Math.round(Number(digits) / 100) : Number(digits)) : level;
      if (next >= 1 && next <= 8) {
        level = next;
        semester = 0;
        continue;
      }
    }
    const sm = joined.match(SEMESTER_HEADING);
    if (sm) {
      const next = Number(sm[1]);
      if (next >= 1 && next <= 4) {
        semester = next;
        continue;
      }
    }
    if (/^(TOTAL|GRAND TOTAL|CREDITS?\s*$)/i.test(cells[0])) continue;

    // Course row: code first, credits among the trailing numeric cells.
    const codeCell = cells[0];
    if (!looksLikeCode(codeCell)) {
      // Not a heading we handle and not a course — ignore quietly unless it
      // has substantial text (helpful feedback).
      if (joined.length > 3 && !/^[0-9.\s]+$/.test(joined)) ignored.push(joined);
      continue;
    }
    const code = codeCell.toUpperCase();
    const trailing = cells.slice(1);
    // Last numeric cell = credits (C). If the table has T and P columns,
    // C = T + P, but we trust C when present; else sum trailing numbers.
    const numbers = trailing.map(toCreditNumber).filter((n) => n >= 0);
    let credits = 0;
    if (numbers.length >= 3) {
      // T, P, C pattern → the LAST number is C (total credits = T + P).
      const c = numbers[numbers.length - 1];
      const tp = numbers.slice(0, -1).reduce((s, n) => s + n, 0);
      // Trust C when present and consistent; otherwise sum T+P.
      credits = c > 0 ? c : tp;
    } else if (numbers.length === 2) {
      // (T, P) with no C → sum; or a single value plus noise → use larger.
      const sum = numbers[0] + numbers[1];
      credits = sum <= 20 ? sum : Math.max(...numbers);
    } else if (numbers.length === 1) {
      credits = numbers[0];
    }
    // Name = everything between code and the trailing numeric columns.
    const nameCells = trailing.filter((c) => !/^\d+(\.\d+)?$/.test(c.trim()));
    const name = nameCells.join(' ').replace(/\s+/g, ' ').trim();

    const { sem } = ensure();
    sem.rows.push({
      code,
      name: name || '(title not detected)',
      creditHours: credits,
      valid: !!code && credits > 0,
    });
  }

  return { semesters, ignored };
}

// ── JSON ────────────────────────────────────────────────────────────────

interface JsonCourse {
  code?: string;
  courseCode?: string;
  id?: string;
  name?: string;
  title?: string;
  courseTitle?: string;
  creditHours?: number | string;
  credits?: number | string;
  credit?: number | string;
  C?: number | string;
  level?: number;
  levelIndex?: number;
  semester?: number;
  semesterIndex?: number;
}

function parseJson(text: string, fileName: string): ImportResult {
  const data = JSON.parse(text) as unknown;
  const list: JsonCourse[] = [];
  const levels = (data as { levels?: unknown[] })?.levels;

  const pushCourse = (c: JsonCourse, levelFallback?: number, semFallback?: number) => {
    list.push({
      ...c,
      level: levelFallback ?? c.level ?? c.levelIndex,
      semester: semFallback ?? c.semester ?? c.semesterIndex,
    });
  };

  if (Array.isArray(data)) {
    for (const item of data as JsonCourse[]) {
      if (item && typeof item === 'object') pushCourse(item);
    }
  } else if (Array.isArray(levels)) {
    for (const lv of levels as { index?: number; label?: string; semesters?: { index?: number; courses?: JsonCourse[] }[] }[]) {
      const li = lv.index;
      for (const sem of lv.semesters ?? []) {
        for (const c of sem.courses ?? []) pushCourse(c, li, sem.index);
      }
    }
  } else if (Array.isArray((data as { courses?: JsonCourse[] })?.courses)) {
    for (const c of (data as { courses: JsonCourse[] }).courses) pushCourse(c);
  } else {
    throw new Error('JSON must be a course array or contain levels[].semesters[].courses[]');
  }

  const grouped = new Map<string, ImportedSemester>();
  const ignored: string[] = [];
  for (const c of list) {
    const code = String(c.code ?? c.courseCode ?? c.id ?? '').toUpperCase().trim();
    const credits = toCreditNumber(c.creditHours ?? c.credits ?? c.credit ?? c.C ?? 0);
    const level = Number(c.level) || 1;
    const semester = Number(c.semester) || 1;
    if (!code) {
      ignored.push(JSON.stringify(c));
      continue;
    }
    const key = `${level}-${semester}`;
    let sem = grouped.get(key);
    if (!sem) {
      sem = {
        levelIndex: level,
        semesterIndex: semester,
        label: `Level ${level * 100} · Semester ${semester}`,
        rows: [],
      };
      grouped.set(key, sem);
    }
    sem.rows.push({
      code,
      name: String(c.name ?? c.title ?? c.courseTitle ?? '(untitled)'),
      creditHours: credits,
      valid: credits > 0,
    });
  }

  return {
    semesters: [...grouped.values()].sort(
      (a, b) => a.levelIndex - b.levelIndex || a.semesterIndex - b.semesterIndex
    ),
    ignored,
    format: 'json',
    fileName,
  };
}

// ── XLSX (dynamic import keeps SheetJS out of the base admin chunk) ──────

async function parseXlsx(file: File): Promise<ImportResult> {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const lines: string[][] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: '' });
    for (const r of rows) {
      lines.push(r.map((c) => String(c ?? '')));
    }
  }
  const { semesters, ignored } = parseMatrix(lines);
  return { semesters, ignored, format: 'xlsx', fileName: file.name };
}

// ── PDF (dynamic import of pdfjs; worker disabled for local parsing) ─────

async function parsePdf(file: File): Promise<ImportResult> {
  const pdfjs = await import('pdfjs-dist');
  // Legacy build ships a worker; for local extraction we run without one.
  const loadingTask = pdfjs.getDocument({
    data: await file.arrayBuffer(),
    // Disable the worker thread (Vite-compatible, main-thread parsing).
    disableWorker: true,
  } as Parameters<typeof pdfjs.getDocument>[0]);
  const doc = await loadingTask.promise;
  const lines: string[][] = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    // Reconstruct rows by grouping items whose Y coordinate matches.
    interface Item { y: number; x: number; text: string }
    const items: Item[] = [];
    for (const item of content.items as { str?: string; transform?: number[] }[]) {
      if (!item.str?.trim()) continue;
      const y = item.transform?.[5] ?? 0;
      const x = item.transform?.[4] ?? 0;
      items.push({ y: Math.round(y * 10) / 10, x, text: item.str });
    }
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    // Group items into text lines by their Y coordinate (top of page = first).
    const rowYs = [...new Set(items.map((i) => Math.round(i.y)))].sort((a, z) => z - a);
    for (const y of rowYs) {
      const rowItems = items
        .filter((i) => Math.abs(i.y - y) < 2)
        .sort((a, b) => a.x - b.x);
      const text = rowItems.map((i) => i.text).join(' ').replace(/\s+/g, ' ').trim();
      if (text) lines.push([text]);
    }
  }
  const { semesters, ignored } = parseMatrix(lines.map((l) => splitPdfLine(l[0])));
  return { semesters, ignored, format: 'pdf', fileName: file.name };
}

/**
 * Split a PDF text line into columns. Handbook tables typically read as
 * "CODE   Course title   T  P  C" or "CODE  Course title  C". We pull the
 * leading code and trailing numbers off, leaving the title in the middle.
 */
export function splitPdfLine(line: string): string[] {
  const trimmed = line.trim();
  // Combined code forms like "LAR/LSS/LED".
  const codeMatch = trimmed.match(/^([A-Z]{2,5}(?:\s*\/\s*[A-Z]{2,5})*(?:\s?\d{2,3}[A-Z]?)?)\b(.*)$/);
  if (!codeMatch) return [trimmed];
  const code = codeMatch[1].replace(/\s+/g, ' ').trim();
  const rest = codeMatch[2] ?? '';
  const tailNumbers = rest.match(/((?:\d+(?:\.\d+)?)\s*)+$/);
  const middle = tailNumbers ? rest.slice(0, rest.length - tailNumbers[0].length).trim() : rest.trim();
  const nums = (tailNumbers?.[0] ?? '').trim().split(/\s+/).filter(Boolean);
  return [code, middle, ...nums];
}

// ── Public entry point ──────────────────────────────────────────────────

export async function importCoursesFile(file: File): Promise<ImportResult> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.json')) {
    return parseJson(await file.text(), file.name);
  }
  if (name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.csv')) {
    if (name.endsWith('.csv')) {
      const text = await file.text();
      const lines = text
        .split(/\r?\n/)
        .map((l) => l.split(',').map((c) => c.trim()));
      const { semesters, ignored } = parseMatrix(lines);
      return { semesters, ignored, format: 'xlsx', fileName: file.name };
    }
    return parseXlsx(file);
  }
  if (name.endsWith('.pdf')) {
    return parsePdf(file);
  }
  throw new Error('Unsupported file type. Use JSON, XLSX, CSV or PDF.');
}
