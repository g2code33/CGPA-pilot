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

// Registry of all universities known to this build. Future institutions are
// added here — the student app only ever exposes the ACTIVE context below.
// This list is driven by the committed config-as-code seed (admin-catalog.json)
// so that published admin data ships inside every build.
export const UNIVERSITIES: University[] = SEED_UNIVERSITIES;

// All curriculum versions known to this build, keyed by id.
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
  return UNIVERSITIES.find((u) => u.id === id);
}

export function resolveContext(ctx: InstitutionContext = ACTIVE_CONTEXT) {
  const university: University =
    findUniversity(ctx.universityId) ?? UNIVERSITIES[0];
  const school: School | undefined = university.schools.find(
    (s) => s.id === ctx.schoolId
  );
  const programme: Programme | undefined = school?.programmes.find(
    (p) => p.id === ctx.programmeId
  );

  // A programme may override the university-wide systems; otherwise the
  // university's published rules apply.
  const gradingSystem: GradingSystem | undefined =
    programme?.gradingSystem ?? university.gradingSystem;
  const classificationSystem: ClassificationSystem | undefined =
    programme?.classificationSystem ?? university.classificationSystem;

  return { university, school, programme, gradingSystem, classificationSystem };
}

export const INSTITUTION_LABEL = (() => {
  const { university, school, programme } = resolveContext();
  return `${university.shortName} · ${school?.name ?? ''} · ${programme?.shortName ?? ''}`.trim();
})();
