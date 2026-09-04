import type {
  University,
  School,
  Programme,
  GradingSystem,
  ClassificationSystem,
  InstitutionContext,
} from './types';
import type { CurriculumVersion } from './types';
import { SEED_UNIVERSITIES, SEED_CURRICULA } from './seed';
import { getRuntimeCatalog } from './runtime';

// ── Build-time (seed) catalog ─────────────────────────────────────────────
// The committed config-as-code seed (admin-catalog.json) — shipped inside
// the bundle as the bootstrap / emergency fallback ONLY. The catalog the app
// actually RUNS under is the runtime catalog (see runtime.ts), which boot
// populates from the synced/cached configuration and from the seed when no
// better local data exists.
export const UNIVERSITIES: University[] = SEED_UNIVERSITIES;
export const BUNDLED_CURRICULA: CurriculumVersion[] = SEED_CURRICULA;

// The single institution/programme context the student app runs under.
export const ACTIVE_CONTEXT: InstitutionContext = {
  universityId: 'ucc',
  schoolId: 'ucc-school-of-pharmacy',
  programmeId: 'ucc-pharmd',
  // curriculumId omitted → curriculumService selects the latest published
  // version for the programme (falling back to the newest bundled version).
};

export function findUniversity(id: string): University | undefined {
  return getRuntimeCatalog().universities.find((u) => u.id === id);
}

/**
 * Resolve the institution/programme context against the RUNTIME catalog
 * (the synced/cached configuration currently active on this device).
 * Unknown ids fall back to the first active entity so a catalog that was
 * re-published without the previously selected ids never breaks the app.
 */
export function resolveContext(ctx: InstitutionContext = ACTIVE_CONTEXT) {
  const catalog = getRuntimeCatalog();
  const university: University =
    catalog.universities.find((u) => u.id === ctx.universityId) ??
    catalog.universities[0];
  const school: School | undefined =
    university?.schools.find((s) => s.id === ctx.schoolId) ??
    university?.schools.find((s) => s.status === 'active') ??
    undefined;
  const programme: Programme | undefined =
    school?.programmes.find((p) => p.id === ctx.programmeId) ??
    school?.programmes.find((p) => p.status === 'active') ??
    undefined;

  // A programme may override the university-wide systems; otherwise the
  // university's published rules apply.
  const gradingSystem: GradingSystem | undefined =
    programme?.gradingSystem ?? university?.gradingSystem;
  const classificationSystem: ClassificationSystem | undefined =
    programme?.classificationSystem ?? university?.classificationSystem;

  return { university, school, programme, gradingSystem, classificationSystem };
}

/** Human label for the ACTIVE context, computed at call time (catalog may change). */
export function institutionLabel(ctx: InstitutionContext = ACTIVE_CONTEXT): string {
  const { university, school, programme } = resolveContext(ctx);
  return `${university?.shortName ?? ''} · ${school?.name ?? ''} · ${programme?.shortName ?? ''}`.trim();
}
