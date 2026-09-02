// ─────────────────────────────────────────────────────────────────────────
// adminConfigService — all admin configuration operations over the catalog.
// Pure functions that take/return an AdminCatalog, so the UI store can apply
// results and persist them. Workflow enforces:
//   DRAFT → REVIEW → PUBLISHED → ARCHIVED
// Only PUBLISHED curricula are distributed to students. Published curriculum
// cannot be edited or deleted; edits require duplicating into a new version.
// ─────────────────────────────────────────────────────────────────────────

import type {
  ClassificationBand,
  ClassificationSystem,
  CurriculumCourse,
  CurriculumLevel,
  CurriculumSemester,
  CurriculumVersion,
  EntityStatus,
  GradeBand,
  GradingSystem,
  Programme,
  School,
  University,
} from '../config/types';
import { ucc } from '../config/institutions/ucc';
import { uccPharmDCurriculum } from '../config/curricula/ucc-pharmd';
import type { AdminCatalog } from './adminStorage';

// Official UCC rules (seed) — used for the "reset to official" action.
export function uccOfficialGrading(): GradingSystem {
  return clone(ucc.gradingSystem!);
}
export function uccOfficialClassification(): ClassificationSystem {
  return clone(ucc.classificationSystem!);
}

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
  patch: Partial<Pick<University, 'name' | 'shortName' | 'country' | 'status' | 'logo'>>
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
  patch: Partial<Pick<School, 'name' | 'status' | 'logo'>>
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
    published: ['published', 'archived'],
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

  // Publishing is BLOCKED at the service layer when critical validation
  // fails (defense in depth — the UI also disables the action). No
  // curriculum with blocking errors can ever reach students.
  if (to === 'published' && !canPublish(cur)) {
    const blockers = reviewCurriculum(cur)
      .filter((i) => i.severity === 'error')
      .map((i) => i.message);
    return {
      catalog,
      ok: false,
      reason: `Cannot publish — critical validation fails: ${blockers.join(' · ')}`,
    };
  }

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
  return status === 'draft' || status === 'review' || status === 'published';
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

export function updateSemester(
  catalog: AdminCatalog,
  id: string,
  levelIndex: number,
  semesterIndex: number,
  patch: Partial<Pick<CurriculumSemester, 'label'>>
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
                s.index !== semesterIndex ? s : { ...s, ...patch }
              ),
            }
      ),
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

/** One imported period (semester or Level-600 cycle) with its courses. */
export interface ImportedLevelSpec {
  levelIndex: number;
  label?: string;
  semesters: {
    semesterIndex: number;
    label?: string;
    rows: BulkRow[];
  }[];
}

/**
 * Apply an ENTIRE imported curriculum structure at once: ensures the needed
 * levels (1..N) and two semester slots per level exist, then appends the
 * imported courses (skipping codes already present). Works for draft/review
 * curricula only — published versions are locked.
 */
export function importAllCourses(
  catalog: AdminCatalog,
  id: string,
  levels: ImportedLevelSpec[]
): { catalog: AdminCatalog; added: number; skipped: number } {
  let added = 0;
  let skipped = 0;

  const next = editCurriculum(catalog, id, (c) => {
    if (!mutatable(c.status)) return c;

    // Ensure enough levels, each with at least two semesters.
    const maxLevel = Math.max(c.levels.length, ...levels.map((l) => l.levelIndex));
    let levelsArr = c.levels.map((l) => ({ ...l, semesters: l.semesters.map((s) => ({ ...s, courses: [...s.courses] })) }));
    for (let i = levelsArr.length; i < maxLevel; i++) {
      const index = i + 1;
      levelsArr.push({
        index,
        label: `Level ${index * 100}`,
        semesters: [
          { index: 1, label: 'Semester 1', courses: [] },
          { index: 2, label: 'Semester 2', courses: [] },
        ],
      });
    }

    for (const lvSpec of levels) {
      const lv = levelsArr.find((l) => l.index === lvSpec.levelIndex);
      if (!lv) continue;
      if (lvSpec.label) lv.label = lvSpec.label;
      for (const semSpec of lvSpec.semesters) {
        let sem = lv.semesters.find((s) => s.index === semSpec.semesterIndex);
        if (!sem) {
          sem = { index: semSpec.semesterIndex, label: semSpec.label ?? `Semester ${semSpec.semesterIndex}`, courses: [] };
          lv.semesters.push(sem);
          lv.semesters.sort((a, b) => a.index - b.index);
        }
        const existing = new Set(sem.courses.map((x) => x.code.toUpperCase()));
        for (const row of semSpec.rows) {
          if (!row.code) continue;
          if (existing.has(row.code)) {
            skipped++;
            continue;
          }
          // Split combined codes like "PHM608, 610, 612, 614" into one course per code.
          const codes = expandCombinedCodes(row.code);
          for (const code of codes) {
            if (existing.has(code)) {
              skipped++;
              continue;
            }
            sem.courses.push({
              id: cid('crs'),
              code,
              name: row.name,
              creditHours: row.creditHours,
              level: lv.index,
              semester: sem.index,
              programmeId: c.programmeId,
              curriculumId: id,
              status: 'active' as const,
              core: true,
            });
            existing.add(code);
            added++;
          }
        }
      }
    }

    return { ...c, levels: levelsArr };
  });

  return { catalog: next, added, skipped };
}

/**
 * Expand a combined code cell into individual course codes.
 * "PHM608, 610, 612, 614" → ["PHM608", "PHM610", "PHM612", "PHM614"].
 * Plain codes pass through unchanged.
 */
export function expandCombinedCodes(code: string): string[] {
  const parts = code.split(/[,/;]|\s+and\s+/i).map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return [code.toUpperCase()];
  const out: string[] = [];
  let prefix = '';
  for (const part of parts) {
    const withPrefix = /^[A-Za-z]+\d/.test(part);
    if (withPrefix) {
      prefix = part.replace(/\d+.*$/, '');
      out.push(part.toUpperCase());
    } else if (/^\d{2,3}[A-Z]?$/.test(part) && prefix) {
      out.push((prefix + part).toUpperCase());
    } else {
      out.push(part.toUpperCase());
    }
  }
  return out;
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

// ── Grading & classification systems ──────────────────────────────────────

function mapUniversity(
  catalog: AdminCatalog,
  universityId: string,
  fn: (u: University) => University
): AdminCatalog {
  return {
    ...catalog,
    universities: catalog.universities.map((u) =>
      u.id === universityId ? fn(u) : u
    ),
  };
}

function mapProgrammeScoped(
  catalog: AdminCatalog,
  programmeId: string,
  fn: (p: Programme) => Programme
): AdminCatalog {
  return {
    ...catalog,
    universities: catalog.universities.map((u) => ({
      ...u,
      schools: u.schools.map((s) => ({
        ...s,
        programmes: s.programmes.map((p) => (p.id === programmeId ? fn(p) : p)),
      })),
    })),
  };
}

export type RuleTarget =
  | { scope: 'university'; universityId: string }
  | { scope: 'programme'; programmeId: string };

export function getGradingSystem(
  catalog: AdminCatalog,
  target: RuleTarget
): GradingSystem | undefined {
  if (target.scope === 'university') {
    return catalog.universities.find((u) => u.id === target.universityId)?.gradingSystem;
  }
  const found = findProgramme(catalog, target.programmeId);
  if (!found) return undefined;
  return found.programme.gradingSystem ?? found.university.gradingSystem;
}

export function getClassificationSystem(
  catalog: AdminCatalog,
  target: RuleTarget
): ClassificationSystem | undefined {
  if (target.scope === 'university') {
    return catalog.universities.find((u) => u.id === target.universityId)
      ?.classificationSystem;
  }
  const found = findProgramme(catalog, target.programmeId);
  if (!found) return undefined;
  return found.programme.classificationSystem ?? found.university.classificationSystem;
}

export function setGradingSystem(
  catalog: AdminCatalog,
  target: RuleTarget,
  system: GradingSystem
): AdminCatalog {
  if (target.scope === 'university') {
    return mapUniversity(catalog, target.universityId, (u) => ({
      ...u,
      gradingSystemId: system.id,
      gradingSystem: system,
    }));
  }
  return mapProgrammeScoped(catalog, target.programmeId, (p) => ({
    ...p,
    gradingSystem: system,
  }));
}

export function setClassificationSystem(
  catalog: AdminCatalog,
  target: RuleTarget,
  system: ClassificationSystem
): AdminCatalog {
  if (target.scope === 'university') {
    return mapUniversity(catalog, target.universityId, (u) => ({
      ...u,
      classificationSystemId: system.id,
      classificationSystem: system,
    }));
  }
  return mapProgrammeScoped(catalog, target.programmeId, (p) => ({
    ...p,
    classificationSystem: system,
  }));
}

export interface RuleIssue {
  severity: 'error' | 'warning';
  message: string;
}

/**
 * Validate a grading system:
 *  - no duplicate grades / missing grade points / invalid points
 *  - no overlapping score ranges; bands sorted ascending; gaps are warnings
 *  - coverage of 0–100 is a warning; points should be non-increasing
 */
export function validateGradingSystem(system: GradingSystem | undefined): RuleIssue[] {
  const issues: RuleIssue[] = [];
  if (!system) {
    issues.push({ severity: 'error', message: 'No grading system defined.' });
    return issues;
  }
  const bands = system.bands;
  if (bands.length === 0) {
    issues.push({ severity: 'error', message: 'No grade bands defined.' });
    return issues;
  }

  const grades = new Set<string>();
  for (const b of bands) {
    const grade = b.grade?.trim();
    if (!grade) {
      issues.push({ severity: 'error', message: 'A grade band is missing its letter grade.' });
    } else if (grades.has(grade)) {
      issues.push({ severity: 'error', message: `Duplicate grade: ${grade}.` });
    }
    grades.add(grade);

    if (b.points === null || b.points === undefined || Number.isNaN(b.points) || b.points < 0) {
      issues.push({ severity: 'error', message: `${grade || 'A band'} is missing valid grade points (must be ≥ 0).` });
    }

    if (!Number.isFinite(b.minScore) || !Number.isFinite(b.maxScore)) {
      issues.push({ severity: 'error', message: `${grade || 'A band'} has a non-numeric score range.` });
    } else {
      if (b.minScore < 0 || b.minScore > 100 || b.maxScore < 0 || b.maxScore > 100) {
        issues.push({ severity: 'error', message: `${grade}: score range must be within 0–100.` });
      }
      if (b.minScore > b.maxScore) {
        issues.push({ severity: 'error', message: `${grade}: minimum score is above maximum.` });
      }
    }
  }

  // Overlaps & gaps (ascending by minScore).
  const sorted = [...bands].sort((a, b) => a.minScore - b.minScore);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (cur.minScore <= prev.maxScore) {
      issues.push({
        severity: 'error',
        message: `Overlapping score ranges: ${prev.grade} (${prev.minScore}–${prev.maxScore}) and ${cur.grade} (${cur.minScore}–${cur.maxScore}).`,
      });
    } else if (cur.minScore - prev.maxScore > 1.0001) {
      issues.push({
        severity: 'warning',
        message: `Gap between ${prev.grade} (up to ${prev.maxScore}) and ${cur.grade} (from ${cur.minScore}) — scores in between match no band.`,
      });
    }
    // Higher scores should not award fewer points than lower scores.
    if (typeof cur.points === 'number' && typeof prev.points === 'number' && cur.points > prev.points + 1e-9) {
      issues.push({
        severity: 'warning',
        message: `${cur.grade} (higher scores) awards more points than ${prev.grade} — points usually decrease as scores drop.`,
      });
    }
  }
  const top = sorted[sorted.length - 1];
  const bottom = sorted[0];
  if (top && top.maxScore < 100) {
    issues.push({ severity: 'warning', message: `Highest band ends at ${top.maxScore} — scores up to 100 are not covered.` });
  }
  if (bottom && bottom.minScore > 0) {
    issues.push({ severity: 'warning', message: `Lowest band starts at ${bottom.minScore} — scores from 0 are not covered.` });
  }

  return issues;
}

/**
 * Validate degree-classification ranges:
 *  - name present; numeric, ordered ranges
 *  - no overlapping ranges; gaps are warnings
 */
export function validateClassificationSystem(
  system: ClassificationSystem | undefined
): RuleIssue[] {
  const issues: RuleIssue[] = [];
  if (!system) {
    issues.push({ severity: 'error', message: 'No classification system defined.' });
    return issues;
  }
  const bands = system.bands;
  if (bands.length === 0) {
    issues.push({ severity: 'error', message: 'No classification bands defined.' });
    return issues;
  }

  const labels = new Set<string>();
  for (const b of bands) {
    if (!b.label?.trim()) {
      issues.push({ severity: 'error', message: 'A classification band is missing its name.' });
    } else if (labels.has(b.label.trim())) {
      issues.push({ severity: 'error', message: `Duplicate classification: ${b.label}.` });
    }
    labels.add(b.label.trim());

    if (!Number.isFinite(b.minCgpa) || !Number.isFinite(b.maxCgpa)) {
      issues.push({ severity: 'error', message: `${b.label || 'A band'} has a non-numeric CGPA range.` });
    } else if (b.minCgpa < 0 || b.minCgpa > 4 || b.maxCgpa < 0 || b.maxCgpa > 4) {
      issues.push({ severity: 'error', message: `${b.label}: CGPA range must be within 0.00–4.00.` });
    } else if (b.minCgpa > b.maxCgpa) {
      issues.push({ severity: 'error', message: `${b.label}: minimum CGPA is above maximum.` });
    }
  }

  const sorted = [...bands].sort((a, b) => b.minCgpa - a.minCgpa); // highest first
  for (let i = 1; i < sorted.length; i++) {
    const higher = sorted[i - 1];
    const lower = sorted[i];
    // Contiguous bands abut at two decimals: higher.min ≈ lower.max + 0.01.
    // Overlap when the lower band reaches up into (or past) the higher one.
    if (lower.maxCgpa + 1e-9 >= higher.minCgpa) {
      issues.push({
        severity: 'error',
        message: `Overlapping classification ranges: ${lower.label} (up to ${lower.maxCgpa}) and ${higher.label} (from ${higher.minCgpa}).`,
      });
    } else if (higher.minCgpa - lower.maxCgpa > 0.01 + 1e-9) {
      issues.push({
        severity: 'warning',
        message: `Gap between ${lower.label} (up to ${lower.maxCgpa}) and ${higher.label} (from ${higher.minCgpa}).`,
      });
    }
  }
  const top = sorted[0];
  if (top && top.maxCgpa < 4 - 1e-9) {
    issues.push({ severity: 'warning', message: `Top classification ends at ${top.maxCgpa} — a perfect 4.00 CGPA is unclassified.` });
  }

  return issues;
}

export function gradingSystemValid(system: GradingSystem | undefined): boolean {
  return !validateGradingSystem(system).some((i) => i.severity === 'error');
}
export function classificationSystemValid(system: ClassificationSystem | undefined): boolean {
  return !validateClassificationSystem(system).some((i) => i.severity === 'error');
}

export function makeGradingBand(partial: Partial<GradeBand> = {}): GradeBand {
  return {
    id: `gb-${Math.random().toString(36).slice(2, 8)}`,
    grade: '',
    minScore: 0,
    maxScore: 100,
    points: 0,
    interpretation: '',
    ...partial,
  };
}
export function makeClassificationBand(partial: Partial<ClassificationBand> = {}): ClassificationBand {
  return { id: `cls-${Math.random().toString(36).slice(2, 8)}`, label: '', minCgpa: 0, maxCgpa: 4, tone: 'gray', ...partial };
}
