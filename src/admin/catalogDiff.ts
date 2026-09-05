// ─────────────────────────────────────────────────────────────────────────
// catalogDiff — pure, testable structural diff of two admin catalogs.
//
// Powers the admin “Preview changes” flow: before anything is published the
// admin sees EXACTLY what changed between the last published catalog and the
// current working catalog — per entity (universities, curriculum versions),
// per field (old → new), and per course (added / removed / modified).
//
// No DOM, no storage: shared by the admin console and the tests.
// ─────────────────────────────────────────────────────────────────────────

import type { AdminCatalog } from './catalogTypes';

export type ChangeKind = 'added' | 'removed' | 'changed';

export interface FieldChange {
  /** Dotted/indexed path from the entity root, e.g. `schools[1].name`. */
  path: string;
  kind: ChangeKind;
  before: unknown;
  after: unknown;
}

export interface CourseRef {
  code: string;
  name: string;
  /** "L2 · Sem 1" placement. */
  placement: string;
  creditHours: number;
}

export interface CourseChange {
  course: CourseRef;
  changes: FieldChange[];
}

export interface EntityDiff {
  id: string;
  /** Display name (university name / curriculum version name). */
  name: string;
  kind: ChangeKind;
  /** Field-level changes (empty for pure adds/removes). */
  changes: FieldChange[];
  /** Curriculum-only detail: what happened at course level. */
  courses?: {
    added: CourseRef[];
    removed: CourseRef[];
    changed: CourseChange[];
  };
  /** Curriculum-only: status transition, e.g. draft → published. */
  status?: { before: string; after: string };
}

export interface CatalogDiffReport {
  universities: EntityDiff[];
  curricula: EntityDiff[];
  appearance: FieldChange[];
  settings: FieldChange[];
  trash: { before: number; after: number };
  totalChanges: number;
  isEmpty: boolean;
  /** One-line machine summary, e.g. "2 universities · 3 curricula · 12 changes". */
  summary: string;
}

const EMPTY_REPORT: CatalogDiffReport = {
  universities: [],
  curricula: [],
  appearance: [],
  settings: [],
  trash: { before: 0, after: 0 },
  totalChanges: 0,
  isEmpty: true,
  summary: 'No changes',
};

/**
 * Diff two catalogs (a = previously published, b = current working).
 * Missing sides are treated as empty catalogs.
 */
export function diffCatalogs(a: AdminCatalog | null | undefined, b: AdminCatalog | null | undefined): CatalogDiffReport {
  const left = a ?? { universities: [], curricula: [], trash: [] };
  const right = b ?? { universities: [], curricula: [], trash: [] };

  const universities = diffEntities(
    left.universities ?? [],
    right.universities ?? [],
    (u) => String((u as { id?: unknown })?.id ?? ''),
    (u) => String((u as { name?: unknown })?.name ?? (u as { shortName?: unknown })?.shortName ?? 'University'),
    diffUniversity
  );

  const curricula = diffCurricula(left.curricula ?? [], right.curricula ?? []);

  const appearance = deepFieldChanges(left.appearance ?? {}, right.appearance ?? {});
  const settings = deepFieldChanges(left.settings ?? {}, right.settings ?? {});

  const trashBefore = (left.trash ?? []).length;
  const trashAfter = (right.trash ?? []).length;

  const totalChanges =
    universities.length +
    curricula.length +
    appearance.length +
    settings.length +
    (trashBefore !== trashAfter ? 1 : 0);

  const parts: string[] = [];
  const uniChanged = universities.filter((u) => u.kind === 'changed').length;
  const curChanged = curricula.filter((c) => c.kind === 'changed').length;
  if (universities.length) parts.push(`${universities.length} universit${universities.length === 1 ? 'y' : 'ies'}`);
  if (curricula.length) parts.push(`${curricula.length} curriculum${curricula.length === 1 ? '' : 's'}`);
  if (appearance.length) parts.push(`${appearance.length} branding`);
  if (settings.length) parts.push(`${settings.length} setting${settings.length === 1 ? '' : 's'}`);
  if (trashBefore !== trashAfter) parts.push('recycle bin');
  const summary = parts.length ? parts.join(' · ') : 'No changes';

  const report: CatalogDiffReport = {
    universities,
    curricula,
    appearance,
    settings,
    trash: { before: trashBefore, after: trashAfter },
    totalChanges,
    isEmpty: totalChanges === 0,
    summary,
  };
  return totalChanges === 0 ? EMPTY_REPORT : report;
}

// ── Entity matching (universities) ────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function diffEntities<T extends object, S extends object>(
  left: T[],
  right: S[],
  idOf: (t: T | S) => string,
  nameOf: (t: T | S) => string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  diffBody: (l: any, r: any) => FieldChange[]
): EntityDiff[] {
  const out: EntityDiff[] = [];
  const lmap = new Map<string, T>();
  for (const l of left) lmap.set(idOf(l), l);
  const rmap = new Map<string, S>();
  for (const r of right) rmap.set(idOf(r), r);

  for (const [id, r] of rmap) {
    const l = lmap.get(id);
    if (!l) {
      out.push({ id, name: nameOf(r), kind: 'added', changes: [] });
    } else {
      const changes = diffBody(l, r);
      if (changes.length) out.push({ id, name: nameOf(r), kind: 'changed', changes });
    }
  }
  for (const [id, l] of lmap) {
    if (!rmap.has(id)) out.push({ id, name: nameOf(l), kind: 'removed', changes: [] });
  }
  return out;
}

function diffUniversity(l: unknown, r: unknown): FieldChange[] {
  const changes = deepFieldChanges(l as object, r as object);
  // Logos are data URLs — keep them (the preview renders images side by side).
  return changes;
}

// ── Curriculum diff (version-level + course-level detail) ─────────────────

function diffCurricula(left: AdminCatalog['curricula'], right: AdminCatalog['curricula']): EntityDiff[] {
  const out: EntityDiff[] = [];
  const lmap = new Map<string, (typeof left)[number]>();
  for (const l of left) lmap.set(l.id, l);
  const rmap = new Map<string, (typeof right)[number]>();
  for (const r of right) rmap.set(r.id, r);

  for (const [id, r] of rmap) {
    const l = lmap.get(id);
    if (!l) {
      out.push({
        id,
        name: r.versionName || id,
        kind: 'added',
        changes: [],
        status: { before: '—', after: r.status },
        courses: { added: listCourses(r), removed: [], changed: [] },
      });
    } else {
      const changes: FieldChange[] = [];
      // Top-level scalar/structural fields (skip levels — courses are
      // reported at course granularity below; status is reported separately).
      for (const key of ['versionName', 'effectiveAcademicYear', 'programmeId'] as const) {
        const before = (l as unknown as Record<string, unknown>)[key];
        const after = (r as unknown as Record<string, unknown>)[key];
        if (!looseEqual(before, after)) {
          changes.push({ path: key, kind: 'changed', before: before ?? null, after: after ?? null });
        }
      }
      const courseDiff = diffCourses(l, r);
      const statusChanged = l.status !== r.status;
      if (changes.length || courseDiff.added.length || courseDiff.removed.length || courseDiff.changed.length || statusChanged) {
        out.push({
          id,
          name: r.versionName || id,
          kind: 'changed',
          changes,
          courses: courseDiff,
          status: statusChanged ? { before: l.status, after: r.status } : undefined,
        });
      }
    }
  }
  for (const [id, l] of lmap) {
    if (!rmap.has(id)) {
      out.push({
        id,
        name: l.versionName || id,
        kind: 'removed',
        changes: [],
        status: { before: l.status, after: '—' },
        courses: { added: [], removed: listCourses(l), changed: [] },
      });
    }
  }
  return out;
}

interface CourseLocation {
  code: string;
  course: { code?: string; name?: string; creditHours?: number; status?: string; [k: string]: unknown };
  placement: string;
}

function courseLocations(v: {
  id: string;
  levels?: { index: number; label?: string; semesters: { index: number; label?: string; courses: { code?: string; name?: string; creditHours?: number; status?: string; [k: string]: unknown }[] }[] }[];
}): CourseLocation[] {
  const out: CourseLocation[] = [];
  for (const level of v.levels ?? []) {
    for (const sem of level.semesters ?? []) {
      const placement = `L${level.index} · Sem ${sem.index}`;
      for (const course of sem.courses ?? []) {
        out.push({ code: (course.code ?? '').trim().toUpperCase(), course, placement });
      }
    }
  }
  return out;
}

function refOf(loc: CourseLocation): CourseRef {
  return {
    code: loc.course.code || '—',
    name: loc.course.name || '',
    placement: loc.placement,
    creditHours: loc.course.creditHours ?? 0,
  };
}

function diffCourses(l: { id: string; levels?: unknown }, r: { id: string; levels?: unknown }): {
  added: CourseRef[];
  removed: CourseRef[];
  changed: CourseChange[];
} {
  const llocs = courseLocations(l as Parameters<typeof courseLocations>[0]);
  const rlocs = courseLocations(r as Parameters<typeof courseLocations>[0]);
  const lmap = new Map<string, CourseLocation>();
  for (const c of llocs) if (c.code) lmap.set(c.code, c);
  const rmap = new Map<string, CourseLocation>();
  for (const c of rlocs) if (c.code) rmap.set(c.code, c);

  const added: CourseRef[] = [];
  const removed: CourseRef[] = [];
  const changed: CourseChange[] = [];

  for (const [code, rc] of rmap) {
    const lc = lmap.get(code);
    if (!lc) {
      added.push(refOf(rc));
    } else {
      const changes = deepFieldChanges(lc.course as object, rc.course as object, 'course');
      if (changes.length) changed.push({ course: refOf(rc), changes });
    }
  }
  for (const [code, lc] of lmap) {
    if (!rmap.has(code)) removed.push(refOf(lc));
  }

  added.sort((x, y) => x.placement.localeCompare(y.placement) || x.code.localeCompare(y.code));
  removed.sort((x, y) => x.placement.localeCompare(y.placement) || x.code.localeCompare(y.code));
  changed.sort((x, y) => x.course.code.localeCompare(y.course.code));
  return { added, removed, changed };
}

function listCourses(v: { id: string; levels?: unknown }): CourseRef[] {
  return courseLocations(v as Parameters<typeof courseLocations>[0]).map(refOf);
}

// ── Deep field comparison ─────────────────────────────────────────────────

function looseEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b)) return true;
  return false;
}

/**
 * Recursive plain-value diff. Arrays are compared index-wise EXCEPT when the
 * elements look like id-bearing objects, in which case they are matched by id
 * (so a reordered-but-identical list is not reported as changes).
 */
export function deepFieldChanges(before: unknown, after: unknown, path = ''): FieldChange[] {
  const out: FieldChange[] = [];
  walk(before, after, path, out, 0);
  return out;
}

function walk(before: unknown, after: unknown, path: string, out: FieldChange[], depth: number): void {
  if (depth > 8) {
    if (!looseEqual(before, after)) out.push({ path: path || '(root)', kind: 'changed', before, after });
    return;
  }
  if (looseEqual(before, after)) return;

  const bNull = before == null;
  const aNull = after == null;
  if (bNull || aNull) {
    out.push({
      path: path || '(root)',
      kind: bNull ? 'added' : 'removed',
      before: before ?? null,
      after: after ?? null,
    });
    return;
  }

  const bObj = typeof before === 'object';
  const aObj = typeof after === 'object';
  if (!bObj || !aObj) {
    out.push({ path: path || '(root)', kind: 'changed', before, after });
    return;
  }

  const bArr = Array.isArray(before);
  const aArr = Array.isArray(after);
  if (bArr !== aArr) {
    out.push({ path: path || '(root)', kind: 'changed', before, after });
    return;
  }

  if (bArr && aArr) {
    const ba = before as unknown[];
    const aa = after as unknown[];
    const byId = ba.every((x) => x && typeof x === 'object' && 'id' in (x as object)) &&
      aa.every((x) => x && typeof x === 'object' && 'id' in (x as object));
    if (byId) {
      const bmap = new Map(ba.map((x) => [String((x as { id: unknown }).id), x]));
      const amap = new Map(aa.map((x) => [String((x as { id: unknown }).id), x]));
      for (const [id, av] of amap) {
        const bv = bmap.get(id);
        if (bv === undefined) out.push({ path: `${path}[${id}]`, kind: 'added', before: null, after: av });
        else walk(bv, av, `${path}[${id}]`, out, depth + 1);
      }
      for (const [id, bv] of bmap) {
        if (!amap.has(id)) out.push({ path: `${path}[${id}]`, kind: 'removed', before: bv, after: null });
      }
    } else {
      const n = Math.max(ba.length, aa.length);
      for (let i = 0; i < n; i++) {
        const hasB = i < ba.length;
        const hasA = i < aa.length;
        if (!hasB) out.push({ path: `${path}[${i}]`, kind: 'added', before: null, after: aa[i] });
        else if (!hasA) out.push({ path: `${path}[${i}]`, kind: 'removed', before: ba[i], after: null });
        else walk(ba[i], aa[i], `${path}[${i}]`, out, depth + 1);
      }
    }
    return;
  }

  const bo = before as Record<string, unknown>;
  const ao = after as Record<string, unknown>;
  const keys = Array.from(new Set([...Object.keys(bo), ...Object.keys(ao)]));
  for (const k of keys) {
    const child = path ? `${path}.${k}` : k;
    walk(bo[k], ao[k], child, out, depth + 1);
  }
}

/**
 * Human-readable rendering of a diff path:
 * `schools[0].programmes[1].name` → "Schools › Item 0 › Programmes › Item 1 › Name"
 */
export function humanizePath(path: string): string {
  if (!path) return 'Value';
  const tokens: string[] = [];
  const re = /([A-Za-z_][\w]*)|\[([^\]]+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path)) !== null) {
    if (m[1]) tokens.push(m[1]);
    else {
      const id = m[2];
      tokens.push(/^\d+$/.test(id) ? `Item ${id}` : id.length > 22 ? `#${id.slice(0, 19)}…` : `#${id}`);
    }
  }
  if (!tokens.length) return path;
  return tokens
    .map((t) => (t.startsWith('#') || t.startsWith('Item') ? t : t[0].toUpperCase() + t.slice(1)))
    .join(' › ');
}
