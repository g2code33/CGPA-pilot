// ─────────────────────────────────────────────────────────────────────────
// curriculumService — configuration-driven academic catalog access.
// All functions are synchronous and offline: they read the runtime catalog,
// which boot (services/configSync.ts) populates from the locally cached /
// synced / bundled published configuration. No student data flows through
// this service.
// ─────────────────────────────────────────────────────────────────────────

import { ACTIVE_CONTEXT, resolveContext } from '../config/context';
import {
  getRuntimeCatalog,
  seedRuntimeCatalog,
  setRuntimeCatalog,
  type CachedConfig,
} from '../config/runtime';
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
  clearCachedConfig,
  readCachedConfigAsync,
  writeCachedConfig,
} from './configCache';

let initialised = false;

/**
 * Populate the runtime catalog from the locally cached configuration
 * (IndexedDB → legacy → bundled seed). Async because the primary payload
 * store is IndexedDB. Boot (main.tsx) always does this BEFORE first render;
 * this is the fallback entry point.
 */
export async function initCurriculum(): Promise<void> {
  if (initialised) return;
  const config: CachedConfig = await readCachedConfigAsync();
  setRuntimeCatalog(config);
  initialised = true;
}

/** Synchronous defensive init: guarantees a valid (seed) catalog exists. */
export function ensureCurriculumInit(): void {
  getRuntimeCatalog();
  initialised = true;
}

function catalog(): CachedConfig {
  return getRuntimeCatalog();
}

// ── Lookups ───────────────────────────────────────────────────────────────

export function getUniversity(id: string): University | undefined {
  return catalog().universities.find((u) => u.id === id);
}

/** All universities in the current catalog (for the student selector). */
export function listUniversities(): University[] {
  return catalog().universities.filter((u) => u.status === 'active');
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
  return catalog().curricula.find((c) => c.id === id);
}

export function getCurriculaForProgramme(programmeId: string): CurriculumVersion[] {
  return catalog()
    .curricula.filter((c) => c.programmeId === programmeId)
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

/** All versions in the current catalog for a programme, newest first. */
export function getAllCurriculaForProgramme(programmeId: string): CurriculumVersion[] {
  return catalog()
    .curricula.filter((c) => c.programmeId === programmeId)
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

/** Info about the locally-stored configuration (shown in the Privacy view). */
export function cacheInfo(): {
  cachedAt: string | null;
  source: string;
  version: number | null;
} {
  const config = catalog();
  const fromSeed = config.source === 'seed';
  return {
    cachedAt: fromSeed ? null : config.cachedAt,
    source: fromSeed ? 'bundled' : config.source,
    version: config.version,
  };
}

// ── Configuration updates (non-personal) ──────────────────────────────────

/**
 * Accept a published curriculum document and cache it locally (runtime +
 * device store). Malformed documents are rejected so offline use always has
 * a valid config.
 */
export function publishCurriculum(version: CurriculumVersion): boolean {
  if (!isValidCurriculum(version)) return false;
  const config = catalog();
  const others = config.curricula.filter((c) => c.id !== version.id);
  const curricula = [...others, version];
  const next: CachedConfig = { ...config, curricula, cachedAt: new Date().toISOString() };
  setRuntimeCatalog(next);
  void writeCachedConfig(
    { universities: next.universities, curricula: next.curricula, appearance: next.appearance },
    { version: next.version, updatedAt: next.updatedAt, source: 'local' }
  );
  return true;
}

/**
 * Optional manual remote refresh of a single curriculum document — never
 * required for student calculations (the boot sync is the normal path).
 */
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

/** Forget the local cache and fall back to the bundled seed immediately. */
export function resetCurriculumCache(): void {
  clearCachedConfig();
  setRuntimeCatalog(seedRuntimeCatalog());
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
