// ─────────────────────────────────────────────────────────────────────────
// adminConfigService — all admin configuration operations over the catalog.
// Pure functions that take/return an AdminCatalog, so the UI store can apply
// results and persist them. Workflow enforces:
//   DRAFT → REVIEW → PUBLISHED → ARCHIVED
// Only PUBLISHED curricula are distributed to students. Published curriculum
// cannot be edited or deleted; edits require duplicating into a new version.
// ─────────────────────────────────────────────────────────────────────────

import type {
  CurriculumCourse,
  CurriculumLevel,
  CurriculumVersion,
  EntityStatus,
  Programme,
  School,
  University,
} from '../config/types';
import { ucc } from '../config/institutions/ucc';
import { uccPharmDCurriculum } from '../config/curricula/ucc-pharmd';
import type { AdminCatalog } from './adminStorage';

export function seedCatalog(): AdminCatalog {
  return {
    universities: [ucc],
    curricula: [uccPharmDCurriculum],
  };
}

// ── Deep clone / ids ──────────────────────────────────────────────────────
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function cid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Tree traversal / mutation helpers ─────────────────────────────────────

function mapUniversities(
  catalog: AdminCatalog,
  fn: (u: University) => University
): AdminCatalog {
  return { ...catalog, universities: catalog.universities.map(fn) };
}

function withProgramme(
  catalog: AdminCatalog,
  programmeId: string,
  fn: (p: Programme, s: School, u: University) => Programme
): AdminCatalog {
  return mapUniversities(catalog, (u) => ({
    ...u,
    schools: u.schools.map((s) => ({
      ...s,
      programmes: s.programmes.map((p) =>
        p.id === programmeId ? fn(p, s, u) : p
      ),
    })),
  }));
}

export function findProgramme(
  catalog: AdminCatalog,
  programmeId: string
): { university: University; school: School; programme: Programme } | undefined {
  for (const university of catalog.universities) {
    for (const school of university.schools) {
      const programme = school.programmes.find((p) => p.id === programmeId);
      if (programme) return { university, school, programme };
    }
  }
  return undefined;
}

// ── Universities ──────────────────────────────────────────────────────────

export function addUniversity(
  catalog: AdminCatalog,
  data: Pick<University, 'name' | 'shortName' | 'country'>
): AdminCatalog {
  const id = cid('uni');
  const university: University = {
    id,
    name: data.name,
    shortName: data.shortName,
    country: data.country,
    status: 'active',
    gradingSystemId: ucc.gradingSystemId,
    classificationSystemId: ucc.classificationSystemId,
    gradingSystem: clone(ucc.gradingSystem),
    classificationSystem: clone(ucc.classificationSystem),
    schools: [],
  };
  return { ...catalog, universities: [...catalog.universities, university] };
}

export function updateUniversity(
  catalog: AdminCatalog,
  id: string,
  patch: Partial<Pick<University, 'name' | 'shortName' | 'country' | 'status'>>
): AdminCatalog {
  return mapUniversities(catalog, (u) =>
    u.id === id ? { ...u, ...patch } : u
  );
}

export function setUniversityStatus(
  catalog: AdminCatalog,
  id: string,
  status: EntityStatus
): AdminCatalog {
  return updateUniversity(catalog, id, { status });
}

/** A university can be deleted only when it has no schools (empty config). */
export function canDeleteUniversity(
  catalog: AdminCatalog,
  id: string
): boolean {
  const u = catalog.universities.find((x) => x.id === id);
  return !!u && u.schools.length === 0;
}

export function deleteUniversity(catalog: AdminCatalog, id: string): AdminCatalog {
  return {
    ...catalog,
    universities: catalog.universities.filter((u) => u.id !== id),
  };
}

// ── Schools ───────────────────────────────────────────────────────────────

export function addSchool(
  catalog: AdminCatalog,
  universityId: string,
  name: string
): AdminCatalog {
  const school: School = {
    id: cid('sch'),
    name,
    universityId,
    status: 'active',
    programmes: [],
  };
  return mapUniversities(catalog, (u) =>
    u.id === universityId ? { ...u, schools: [...u.schools, school] } : u
  );
}

export function updateSchool(
  catalog: AdminCatalog,
  schoolId: string,
  patch: Partial<Pick<School, 'name' | 'status'>>
): AdminCatalog {
  return mapUniversities(catalog, (u) => ({
    ...u,
    schools: u.schools.map((s) => (s.id === schoolId ? { ...s, ...patch } : s)),
  }));
}

export function setSchoolStatus(
  catalog: AdminCatalog,
  schoolId: string,
  status: EntityStatus
): AdminCatalog {
  return updateSchool(catalog, schoolId, { status });
}

export function canDeleteSchool(catalog: AdminCatalog, schoolId: string): boolean {
  for (const u of catalog.universities) {
    const s = u.schools.find((x) => x.id === schoolId);
    if (s) return s.programmes.length === 0;
  }
  return false;
}

export function deleteSchool(catalog: AdminCatalog, schoolId: string): AdminCatalog {
  return mapUniversities(catalog, (u) => ({
    ...u,
    schools: u.schools.filter((s) => s.id !== schoolId),
  }));
}

// ── Programmes ────────────────────────────────────────────────────────────

export function addProgramme(
  catalog: AdminCatalog,
  schoolId: string,
  data: Pick<Programme, 'name' | 'shortName'> & { years: number }
): AdminCatalog {
  const programme: Programme = {
    id: cid('prog'),
    name: data.name,
    shortName: data.shortName,
    schoolId,
    status: 'active',
    duration: {
      years: data.years,
      expectedLevels: data.years,
      label: `${data.years}-year programme`,
    },
    curriculumVersionIds: [],
  };
  return mapUniversities(catalog, (u) => ({
    ...u,
    schools: u.schools.map((s) =>
      s.id === schoolId ? { ...s, programmes: [...s.programmes, programme] } : s
    ),
  }));
}

export function updateProgramme(
  catalog: AdminCatalog,
  programmeId: string,
  patch: Partial<Pick<Programme, 'name' | 'shortName' | 'status' | 'duration'>>
): AdminCatalog {
  return mapUniversities(catalog, (u) => ({
    ...u,
    schools: u.schools.map((s) => ({
      ...s,
      programmes: s.programmes.map((p) =>
        p.id === programmeId ? { ...p, ...patch } : p
      ),
    })),
  }));
}

export function setProgrammeStatus(
  catalog: AdminCatalog,
  programmeId: string,
  status: EntityStatus
): AdminCatalog {
  return updateProgramme(catalog, programmeId, { status });
}

export function canDeleteProgramme(
  catalog: AdminCatalog,
  programmeId: string
): boolean {
  // Cannot delete a programme that owns a published curriculum (accident guard).
  return !catalog.curricula.some(
    (c) => c.programmeId === programmeId && c.status === 'published'
  );
}

export function deleteProgramme(catalog: AdminCatalog, programmeId: string): AdminCatalog {
  return mapUniversities(catalog, (u) => ({
    ...u,
    schools: u.schools.map((s) => ({
      ...s,
      programmes: s.programmes.filter((p) => p.id !== programmeId),
    })),
  }));
}

// ── Curriculum versions ───────────────────────────────────────────────────

function scaffoldLevels(expectedLevels: number): CurriculumLevel[] {
  const levels: CurriculumLevel[] = [];
  for (let n = 1; n <= expectedLevels; n++) {
    levels.push({
      index: n,
      label: `Level ${n * 100}`,
      semesters: [
        { index: 1, label: 'Semester 1', courses: [] },
        { index: 2, label: 'Semester 2', courses: [] },
      ],
    });
  }
  return levels;
}

export function createCurriculum(
  catalog: AdminCatalog,
  programmeId: string,
  data: { versionName: string; effectiveAcademicYear: string; effectiveDate: string }
): AdminCatalog {
  const found = findProgramme(catalog, programmeId);
  const version: CurriculumVersion = {
    id: cid('cur'),
    versionName: data.versionName,
    programmeId,
    effectiveAcademicYear: data.effectiveAcademicYear,
    effectiveDate: data.effectiveDate || new Date().toISOString().slice(0, 10),
    status: 'draft',
    levels: scaffoldLevels(found?.programme.duration.expectedLevels ?? 4),
  };
  let next = { ...catalog, curricula: [...catalog.curricula, version] };
  next = withProgramme(next, programmeId, (p) => ({
    ...p,
    curriculumVersionIds: [...p.curriculumVersionIds, version.id],
  }));
  return next;
}

export function updateCurriculum(
  catalog: AdminCatalog,
  id: string,
  patch: Partial<Pick<CurriculumVersion, 'versionName' | 'effectiveAcademicYear' | 'effectiveDate' | 'levels'>>
): AdminCatalog {
  return {
    ...catalog,
    curricula: catalog.curricula.map((c) =>
      c.id === id ? { ...c, ...patch } : c
    ),
  };
}

/** Duplicate any version into a new, editable DRAFT (with a fresh id). */
export function duplicateCurriculum(
  catalog: AdminCatalog,
  id: string
): { catalog: AdminCatalog; newId: string } {
  const src = catalog.curricula.find((c) => c.id === id);
  if (!src) return { catalog, newId: id };
  const copy = clone(src);
  copy.id = cid('cur');
  copy.versionName = `${src.versionName} (copy)`;
  copy.status = 'draft';
  copy.effectiveDate = new Date().toISOString().slice(0, 10);
  let next = { ...catalog, curricula: [...catalog.curricula, copy] };
  next = withProgramme(next, src.programmeId, (p) => ({
    ...p,
    curriculumVersionIds: [...p.curriculumVersionIds, copy.id],
  }));
  return { catalog: next, newId: copy.id };
}

/** Workflow transitions; only valid moves are allowed. */
export function transitionCurriculum(
  catalog: AdminCatalog,
  id: string,
  to: CurriculumVersion['status']
): { catalog: AdminCatalog; ok: boolean; reason?: string } {
  const cur = catalog.curricula.find((c) => c.id === id);
  if (!cur) return { catalog, ok: false, reason: 'Not found.' };

  const allowed: Record<string, CurriculumVersion['status'][]> = {
    draft: ['review', 'archived'],
    review: ['draft', 'published', 'archived'],
    published: ['archived'],
    archived: ['draft'],
  };
  if (!allowed[cur.status]?.includes(to)) {
    return {
      catalog,
      ok: false,
      reason: `Cannot move from ${cur.status} to ${to}.`,
    };
  }

  let next = {
    ...catalog,
    curricula: catalog.curricula.map((c) =>
      c.id === id ? { ...c, status: to } : c
    ),
  };

  // Publishing: automatically archive other published versions of the SAME
  // programme (only one active published version is distributed).
  if (to === 'published') {
    next = {
      ...next,
      curricula: next.curricula.map((c) =>
        c.programmeId === cur.programmeId && c.id !== id && c.status === 'published'
          ? { ...c, status: 'archived' as const }
          : c
      ),
    };
  }
  return { catalog: next, ok: true };
}

export function deleteCurriculum(
  catalog: AdminCatalog,
  id: string
): { catalog: AdminCatalog; ok: boolean; reason?: string } {
  const cur = catalog.curricula.find((c) => c.id === id);
  if (!cur) return { catalog, ok: false, reason: 'Not found.' };
  if (cur.status === 'published') {
    return {
      catalog,
      ok: false,
      reason:
        'Published curriculum cannot be deleted — archive it instead. Students rely on it offline.',
    };
  }
  let next = {
    ...catalog,
    curricula: catalog.curricula.filter((c) => c.id !== id),
  };
  next = withProgramme(next, cur.programmeId, (p) => ({
    ...p,
    curriculumVersionIds: p.curriculumVersionIds.filter((x) => x !== id),
  }));
  return { catalog: next, ok: true };
}

// ── Academic structure (levels / semesters / courses) ──────────────────────

function editCurriculum(
  catalog: AdminCatalog,
  id: string,
  fn: (c: CurriculumVersion) => CurriculumVersion
): AdminCatalog {
  return {
    ...catalog,
    curricula: catalog.curricula.map((c) => (c.id === id ? fn(c) : c)),
  };
}

function mutatable(status: CurriculumVersion['status']): boolean {
  return status === 'draft' || status === 'review';
}

export function addLevel(catalog: AdminCatalog, id: string): AdminCatalog {
  return editCurriculum(catalog, id, (c) => {
    if (!mutatable(c.status)) return c;
    const index = (c.levels[c.levels.length - 1]?.index ?? 0) + 1;
    return {
      ...c,
      levels: [
        ...c.levels,
        {
          index,
          label: `Level ${index * 100}`,
          semesters: [
            { index: 1, label: 'Semester 1', courses: [] },
            { index: 2, label: 'Semester 2', courses: [] },
          ],
        },
      ],
    };
  });
}

export function addSemester(
  catalog: AdminCatalog,
  id: string,
  levelIndex: number
): AdminCatalog {
  return editCurriculum(catalog, id, (c) => {
    if (!mutatable(c.status)) return c;
    return {
      ...c,
      levels: c.levels.map((l) => {
        if (l.index !== levelIndex) return l;
        const semIndex = (l.semesters[l.semesters.length - 1]?.index ?? 0) + 1;
        return {
          ...l,
          semesters: [
            ...l.semesters,
            { index: semIndex, label: `Semester ${semIndex}`, courses: [] },
          ],
        };
      }),
    };
  });
}

export function addCourse(
  catalog: AdminCatalog,
  id: string,
  levelIndex: number,
  semesterIndex: number
): AdminCatalog {
  return editCurriculum(catalog, id, (c) => {
    if (!mutatable(c.status)) return c;
    const course: CurriculumCourse = {
      id: cid('crs'),
      code: '',
      name: '',
      creditHours: 2,
      level: levelIndex,
      semester: semesterIndex,
      programmeId: c.programmeId,
      curriculumId: id,
      status: 'active',
      core: true,
    };
    return {
      ...c,
      levels: c.levels.map((l) =>
        l.index !== levelIndex
          ? l
          : {
              ...l,
              semesters: l.semesters.map((s) =>
                s.index !== semesterIndex
                  ? s
                  : { ...s, courses: [...s.courses, course] }
              ),
            }
      ),
    };
  });
}

export function updateCourse(
  catalog: AdminCatalog,
  id: string,
  levelIndex: number,
  semesterIndex: number,
  courseId: string,
  patch: Partial<CurriculumCourse>
): AdminCatalog {
  return editCurriculum(catalog, id, (c) => {
    if (!mutatable(c.status)) return c;
    return {
      ...c,
      levels: c.levels.map((l) =>
        l.index !== levelIndex
          ? l
          : {
              ...l,
              semesters: l.semesters.map((s) =>
                s.index !== semesterIndex
                  ? s
                  : {
                      ...s,
                      courses: s.courses.map((course) =>
                        course.id === courseId
                          ? { ...course, ...patch, curriculumId: id }
                          : course
                      ),
                    }
              ),
            }
      ),
    };
  });
}

export function removeCourse(
  catalog: AdminCatalog,
  id: string,
  levelIndex: number,
  semesterIndex: number,
  courseId: string
): AdminCatalog {
  return editCurriculum(catalog, id, (c) => {
    if (!mutatable(c.status)) return c;
    return {
      ...c,
      levels: c.levels.map((l) =>
        l.index !== levelIndex
          ? l
          : {
              ...l,
              semesters: l.semesters.map((s) =>
                s.index !== semesterIndex
                  ? s
                  : { ...s, courses: s.courses.filter((x) => x.id !== courseId) }
              ),
            }
      ),
    };
  });
}

/** Move a course up or down within its semester list. */
export function reorderCourse(
  catalog: AdminCatalog,
  id: string,
  levelIndex: number,
  semesterIndex: number,
  courseId: string,
  direction: 'up' | 'down'
): AdminCatalog {
  return editCurriculum(catalog, id, (c) => {
    if (!mutatable(c.status)) return c;
    return {
      ...c,
      levels: c.levels.map((l) => {
        if (l.index !== levelIndex) return l;
        return {
          ...l,
          semesters: l.semesters.map((s) => {
            if (s.index !== semesterIndex) return s;
            const courses = [...s.courses];
            const idx = courses.findIndex((x) => x.id === courseId);
            const target = direction === 'up' ? idx - 1 : idx + 1;
            if (idx < 0 || target < 0 || target >= courses.length) return s;
            const tmp = courses[idx];
            courses[idx] = courses[target];
            courses[target] = tmp;
            return { ...s, courses };
          }),
        };
      }),
    };
  });
}

/** Duplicate a course (same name/credits, blank code to avoid a clash). */
export function duplicateCourse(
  catalog: AdminCatalog,
  id: string,
  levelIndex: number,
  semesterIndex: number,
  courseId: string
): AdminCatalog {
  return editCurriculum(catalog, id, (c) => {
    if (!mutatable(c.status)) return c;
    return {
      ...c,
      levels: c.levels.map((l) => {
        if (l.index !== levelIndex) return l;
        return {
          ...l,
          semesters: l.semesters.map((s) => {
            if (s.index !== semesterIndex) return s;
            const idx = s.courses.findIndex((x) => x.id === courseId);
            if (idx < 0) return s;
            const src = s.courses[idx];
            const copy: CurriculumCourse = {
              ...src,
              id: cid('crs'),
              code: '', // admin enters the real (unique) code
              curriculumId: id,
            };
            const courses = [...s.courses];
            courses.splice(idx + 1, 0, copy);
            return { ...s, courses };
          }),
        };
      }),
    };
  });
}

export interface BulkRow {
  code: string;
  name: string;
  creditHours: number;
  valid: boolean;
}

/**
 * Parse pasted bulk-course text. Accepts, per line:
 *   CODE <tab> Name <tab> Credits
 *   CODE, Name, Credits
 *   CODE  Name  Credits        (2+ spaces)
 *   CODE Name Credits          (heuristic: code = first token, credits = last number)
 */
export function parseBulkCourses(text: string): BulkRow[] {
  const rows: BulkRow[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const raw = rawLine.trim();
    if (!raw) continue;

    let parts: string[] = raw
      .split(/\t|,|\s{2,}/)
      .map((p) => p.trim())
      .filter(Boolean);

    if (parts.length < 3) {
      // Heuristic: leading course code (e.g. "PHA 111" or "PHA111"),
      // trailing credits, everything between = name.
      const tokens = raw.split(/\s+/);
      const last = tokens[tokens.length - 1];
      // Try a 1-token then 2-token leading code ("PHA111" / "PHA 111").
      let codeLen = 0;
      if (/^[A-Za-z]{2,5}\d{2,3}[A-Za-z]?$/.test(tokens[0] ?? '')) codeLen = 1;
      else if (/^[A-Za-z]{2,5}$/.test(tokens[0] ?? '') && /^\d{2,3}[A-Za-z]?$/.test(tokens[1] ?? '')) codeLen = 2;
      const nameTokens = tokens.slice(codeLen, -1);
      if (
        codeLen > 0 &&
        tokens.length >= codeLen + 2 &&
        /^\d+(\.\d{1,2})?$/.test(last)
      ) {
        parts = [tokens.slice(0, codeLen).join(' '), nameTokens.join(' '), last];
      }
    }

    const code = (parts[0] ?? '').toUpperCase();
    const creditHours = Number(parts[parts.length - 1]) || 0;
    const name = parts.slice(1, -1).join(' ').trim();
    const valid =
      !!code && /^\d+(\.\d{1,2})?$/.test(String(parts[parts.length - 1])) && creditHours > 0;

    rows.push({ code, name, creditHours: creditHours || 0, valid });
  }
  return rows;
}

export function bulkAddCourses(
  catalog: AdminCatalog,
  id: string,
  levelIndex: number,
  semesterIndex: number,
  rows: BulkRow[]
): AdminCatalog {
  return editCurriculum(catalog, id, (c) => {
    if (!mutatable(c.status)) return c;
    const newCourses: CurriculumCourse[] = rows
      .filter((r) => r.code)
      .map((r) => ({
        id: cid('crs'),
        code: r.code,
        name: r.name,
        creditHours: r.creditHours,
        level: levelIndex,
        semester: semesterIndex,
        programmeId: c.programmeId,
        curriculumId: id,
        status: 'active' as const,
        core: true,
      }));
    return {
      ...c,
      levels: c.levels.map((l) => {
        if (l.index !== levelIndex) return l;
        return {
          ...l,
          semesters: l.semesters.map((s) =>
            s.index !== semesterIndex
              ? s
              : { ...s, courses: [...s.courses, ...newCourses] }
          ),
        };
      }),
    };
  });
}

// ── Totals ────────────────────────────────────────────────────────────────

export interface SemesterStat {
  index: number;
  label: string;
  courses: number;
  credits: number;
}
export interface LevelStat {
  index: number;
  label: string;
  courses: number;
  credits: number;
  semesters: SemesterStat[];
}
export interface CurriculumStat {
  levels: LevelStat[];
  totalCourses: number;
  totalActiveCourses: number;
  totalCredits: number;
}

export function curriculumStats(version: CurriculumVersion): CurriculumStat {
  const levels: LevelStat[] = version.levels.map((l) => {
    const semesters: SemesterStat[] = l.semesters.map((s) => ({
      index: s.index,
      label: s.label,
      courses: s.courses.length,
      credits: s.courses
        .filter((c) => c.status === 'active')
        .reduce((sum, c) => sum + (c.creditHours || 0), 0),
    }));
    return {
      index: l.index,
      label: l.label,
      courses: l.semesters.reduce((n, s) => n + s.courses.length, 0),
      credits: semesters.reduce((sum, s) => sum + s.credits, 0),
      semesters,
    };
  });
  return {
    levels,
    totalCourses: version.levels.reduce(
      (n, l) => n + l.semesters.reduce((m, s) => m + s.courses.length, 0),
      0
    ),
    totalActiveCourses: version.levels.reduce(
      (n, l) =>
        n +
        l.semesters.reduce(
          (m, s) => m + s.courses.filter((c) => c.status === 'active').length,
          0
        ),
      0
    ),
    totalCredits: levels.reduce((sum, l) => sum + l.credits, 0),
  };
}

/** Suggested version name, e.g. "UCC PharmD — 2026/27". */
export function suggestVersionName(
  catalog: AdminCatalog,
  programmeId: string
): string {
  const found = findProgramme(catalog, programmeId);
  if (!found) return '';
  const year = new Date().getFullYear();
  return `${found.university.shortName} ${found.programme.shortName} — ${year}/${String((year + 1) % 100).padStart(2, '0')}`;
}

// ── Review validation ─────────────────────────────────────────────────────

export interface ReviewIssue {
  severity: 'error' | 'warning';
  message: string;
}

export function reviewCurriculum(version: CurriculumVersion): ReviewIssue[] {
  const issues: ReviewIssue[] = [];

  if (!version.versionName || version.versionName.includes('scaffold')) {
    issues.push({ severity: 'warning', message: 'Give this version a proper name before publishing.' });
  }
  if (!version.effectiveAcademicYear || version.effectiveAcademicYear === '—') {
    issues.push({ severity: 'error', message: 'Effective academic year is missing.' });
  }
  if (version.levels.length === 0) {
    issues.push({ severity: 'error', message: 'No academic levels defined.' });
  }

  const seenCodes = new Map<string, number>();
  let courseCount = 0;
  let activeCount = 0;
  let totalCredits = 0;

  // Levels should be indexed 1..N sequentially.
  version.levels.forEach((level, i) => {
    if (level.index !== i + 1) {
      issues.push({
        severity: 'error',
        message: `${level.label} has an invalid level index (expected ${i + 1}, got ${level.index}).`,
      });
    }
    if (!level.label?.trim()) {
      issues.push({ severity: 'error', message: `Level at position ${i + 1} is missing its label.` });
    }
    if (level.semesters.length === 0) {
      issues.push({ severity: 'error', message: `${level.label} has no semesters.` });
    }
    // Semesters should be indexed sequentially within the level.
    level.semesters.forEach((sem, j) => {
      if (sem.index !== j + 1) {
        issues.push({
          severity: 'error',
          message: `${level.label} has an invalid semester index (expected ${j + 1}, got ${sem.index}).`,
        });
      }
      if (sem.courses.length === 0) {
        issues.push({
          severity: 'warning',
          message: `${level.label} · ${sem.label} has no courses.`,
        });
      }
      for (const course of sem.courses) {
        courseCount++;
        // Course placement must match where it is stored.
        if (course.level !== level.index || course.semester !== sem.index) {
          issues.push({
            severity: 'error',
            message: `${course.code || 'A course'} (${level.label} · ${sem.label}) has an invalid level/semester reference.`,
          });
        }
        if (course.programmeId !== version.programmeId) {
          issues.push({
            severity: 'error',
            message: `${course.code || 'A course'} is linked to the wrong programme.`,
          });
        }
        const code = course.code.trim().toUpperCase();
        if (!code) {
          issues.push({
            severity: 'error',
            message: `${level.label} · ${sem.label}: a course is missing its code.`,
          });
        } else {
          seenCodes.set(code, (seenCodes.get(code) ?? 0) + 1);
        }
        if (!course.name.trim()) {
          issues.push({
            severity: 'error',
            message: `${code || 'A course'} (${level.label} · ${sem.label}) is missing its name.`,
          });
        }
        if (
          !Number.isFinite(course.creditHours) ||
          course.creditHours <= 0 ||
          course.creditHours > 20
        ) {
          issues.push({
            severity: 'error',
            message: `${code || 'A course'} has invalid credits (must be 1–20). Zero or negative credits are not allowed.`,
          });
        }
        if (course.status === 'active') {
          activeCount++;
          totalCredits += course.creditHours || 0;
        }
      }
    });
  });

  for (const [code, n] of seenCodes) {
    if (n > 1) {
      issues.push({ severity: 'error', message: `Duplicate course code: ${code} appears ${n} times.` });
    }
  }

  if (courseCount === 0) {
    issues.push({
      severity: 'error',
      message: 'No courses entered. Do not publish until verified course data has been added.',
    });
  }
  if (activeCount > 0) {
    issues.push({
      severity: 'warning',
      message: `${activeCount} active courses · ${totalCredits} total active credit hours.`,
    });
  }

  return issues;
}

export function canPublish(version: CurriculumVersion): boolean {
  return !reviewCurriculum(version).some((i) => i.severity === 'error');
}

// ── Offline distribution ──────────────────────────────────────────────────

export interface DistributionPayload {
  format: 'cgpa-pilot-curriculum';
  schemaVersion: 1;
  generatedAt: string;
  universities: University[];
  curricula: CurriculumVersion[];
}

/**
 * Build the versioned configuration document for offline distribution.
 * Includes the full university catalog plus PUBLISHED curricula only
 * (drafts/review/archived are never distributed). This document contains
 * non-personal configuration — no student academic data exists in it.
 */
export function buildDistribution(catalog: AdminCatalog): DistributionPayload {
  return {
    format: 'cgpa-pilot-curriculum',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    universities: clone(catalog.universities),
    curricula: catalog.curricula.filter((c) => c.status === 'published').map(clone),
  };
}

export function isDistributionPayload(value: unknown): value is DistributionPayload {
  const p = value as DistributionPayload;
  return (
    !!p &&
    p.format === 'cgpa-pilot-curriculum' &&
    p.schemaVersion === 1 &&
    Array.isArray(p.universities) &&
    Array.isArray(p.curricula)
  );
}
