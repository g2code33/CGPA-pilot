// ─────────────────────────────────────────────────────────────────────────
// curriculumService — configuration-driven academic catalog access.
// All functions are synchronous and offline: they read the locally cached /
// bundled published curriculum. No student data flows through this service.
// ─────────────────────────────────────────────────────────────────────────

import {
  ACTIVE_CONTEXT,
  BUNDLED_CURRICULA,
  UNIVERSITIES,
  resolveContext,
} from '../config/context';
import type {
  CurriculumCourse,
  CurriculumLevel,
  CurriculumSemester,
  CurriculumVersion,
  FlatCourse,
  InstitutionContext,
  Programme,
  School,
  University,
} from '../config/types';
import {
  bundledConfig,
  clearCachedConfig,
  readCachedConfig,
  seedCacheIfEmpty,
  writeCachedConfig,
} from './configCache';

let universities: University[] = UNIVERSITIES;
let curricula: CurriculumVersion[] = BUNDLED_CURRICULA;
let initialised = false;

/** Load the latest valid published curriculum available on the device. */
export function initCurriculum(): void {
  if (initialised) return;
  const config = seedCacheIfEmpty();
  universities = config.universities;
  curricula = config.curricula;
  initialised = true;
}

function ensureInit(): void {
  if (!initialised) initCurriculum();
}

// ── Lookups ───────────────────────────────────────────────────────────────

export function getUniversity(id: string): University | undefined {
  ensureInit();
  return universities.find((u) => u.id === id);
}

export function getSchool(
  universityId: string,
  schoolId: string
): School | undefined {
  return getUniversity(universityId)?.schools.find((s) => s.id === schoolId);
}

export function getProgramme(
  universityId: string,
  schoolId: string,
  programmeId: string
): Programme | undefined {
  return getSchool(universityId, schoolId)?.programmes.find(
    (p) => p.id === programmeId
  );
}

export function getCurriculumVersion(id: string): CurriculumVersion | undefined {
  ensureInit();
  return curricula.find((c) => c.id === id);
}

export function getCurriculaForProgramme(programmeId: string): CurriculumVersion[] {
  ensureInit();
  return curricula
    .filter((c) => c.programmeId === programmeId)
    .sort((a, b) => (a.effectiveDate < b.effectiveDate ? 1 : -1));
}

/**
 * The curriculum the STUDENT app should use: the latest PUBLISHED version for
 * the programme. Draft / review / archived versions are never served to
 * students — if no published version exists, this returns undefined (the UI
 * shows "awaiting published curriculum").
 */
export function getActiveCurriculum(
  ctx: InstitutionContext = ACTIVE_CONTEXT
): CurriculumVersion | undefined {
  ensureInit();
  if (ctx.curriculumId) {
    const explicit = getCurriculumVersion(ctx.curriculumId);
    if (explicit && explicit.status === 'published') return explicit;
  }
  const programme = getProgramme(
    ctx.universityId,
    ctx.schoolId,
    ctx.programmeId
  );
  const versions = (
    programme?.curriculumVersionIds
      .map((id) => getCurriculumVersion(id))
      .filter(Boolean) as CurriculumVersion[]
  )
    .filter((c) => c.status === 'published')
    .sort((a, b) => (a.effectiveDate < b.effectiveDate ? 1 : -1));

  return versions[0] ?? undefined;
}

/** All versions the ADMIN can see, newest effective date first. */
export function getAllCurriculaForProgramme(programmeId: string): CurriculumVersion[] {
  ensureInit();
  return curricula
    .filter((c) => c.programmeId === programmeId)
    .sort((a, b) => (a.effectiveDate < b.effectiveDate ? 1 : -1));
}

export function getLevels(curriculum?: CurriculumVersion): CurriculumLevel[] {
  return curriculum?.levels ?? [];
}

export function getSemesters(level?: CurriculumLevel): CurriculumSemester[] {
  return level?.semesters ?? [];
}

/** Flatten the level/semester tree into a list of courses with context. */
export function flattenCourses(
  curriculum: CurriculumVersion,
  ctx: InstitutionContext = ACTIVE_CONTEXT
): FlatCourse[] {
  const out: FlatCourse[] = [];
  for (const level of curriculum.levels) {
    for (const sem of level.semesters) {
      for (const c of sem.courses) {
        out.push({
          ...c,
          universityId: ctx.universityId,
          schoolId: ctx.schoolId,
          levelLabel: level.label,
          semesterLabel: sem.label,
        });
      }
    }
  }
  return out;
}

export function activeCourses(curriculum: CurriculumVersion): FlatCourse[] {
  return flattenCourses(curriculum).filter((c) => c.status === 'active');
}

export function courseById(
  curriculum: CurriculumVersion,
  id: string
): FlatCourse | undefined {
  return flattenCourses(curriculum).find((c) => c.id === id);
}

export function findCourseByCode(
  curriculum: CurriculumVersion,
  code: string
): FlatCourse | undefined {
  const needle = code.trim().toUpperCase();
  return flattenCourses(curriculum).find(
    (c) => c.code.trim().toUpperCase() === needle
  );
}

export function curriculumTotalCredits(curriculum: CurriculumVersion): number {
  return activeCourses(curriculum).reduce((sum, c) => sum + c.creditHours, 0);
}

export function isPublished(curriculum?: CurriculumVersion): boolean {
  return curriculum?.status === 'published';
}

export function cacheInfo(): { cachedAt: string | null; source: string } {
  ensureInit();
  const config = readCachedConfig();
  return {
    cachedAt: config.cachedAt.startsWith('1970') ? null : config.cachedAt,
    source: config.cachedAt.startsWith('1970') ? 'bundled' : 'cached',
  };
}

// ── Configuration updates (non-personal) ──────────────────────────────────

/**
 * Accept a published curriculum document (bundled in a future release or
 * optionally fetched by an administrator refresh) and cache it locally.
 * Malformed documents are rejected so offline use always has a valid config.
 */
export function publishCurriculum(version: CurriculumVersion): boolean {
  ensureInit();
  if (!isValidCurriculum(version)) return false;
  const others = curricula.filter((c) => c.id !== version.id);
  curricula = [...others, version];
  const config = readCachedConfig();
  writeCachedConfig({
    ...config,
    curricula,
  });
  return true;
}

/** Optional remote refresh — never required for student calculations. */
export async function refreshFromRemote(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return false;
    const doc = (await res.json()) as CurriculumVersion;
    return publishCurriculum(doc);
  } catch {
    return false; // offline / invalid → keep the cached or bundled config
  }
}

export function resetCurriculumCache(): void {
  clearCachedConfig();
  const fresh = bundledConfig();
  universities = fresh.universities;
  curricula = fresh.curricula;
}

export function isValidCurriculum(c: CurriculumVersion): boolean {
  return (
    !!c &&
    typeof c.id === 'string' &&
    typeof c.versionName === 'string' &&
    typeof c.programmeId === 'string' &&
    Array.isArray(c.levels) &&
    (c.status === 'draft' ||
      c.status === 'review' ||
      c.status === 'published' ||
      c.status === 'archived') &&
    c.levels.every(
      (l) =>
        typeof l.index === 'number' &&
        Array.isArray(l.semesters) &&
        l.semesters.every((s) => typeof s.index === 'number' && Array.isArray(s.courses))
    )
  );
}

export const activeInstitution = () => resolveContext();
