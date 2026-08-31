import type {
  University,
  InstitutionConfig,
  School,
  Programme,
  CurriculumVersion,
} from './types';
import { ucc } from './institutions/ucc';

// ─────────────────────────────────────────────────────────────────────────
// Institution registry + the active (admin-selected) context.
// Future prompts add more universities here; the student app only ever sees
// the ACTIVE context.
// ─────────────────────────────────────────────────────────────────────────

export const UNIVERSITIES: University[] = [ucc];

const ACTIVE: InstitutionConfig = {
  universityId: 'ucc',
  schoolId: 'ucc-pharmacy',
  programmeId: 'ucc-pharmacy-pharmd',
  curriculumId: 'ucc-pharmd-current',
};

export const university: University =
  UNIVERSITIES.find((u) => u.id === ACTIVE.universityId) ?? UNIVERSITIES[0];

export const school: School =
  university.schools.find((s) => s.id === ACTIVE.schoolId) ??
  university.schools[0];

export const programme: Programme =
  school.programmes.find((p) => p.id === ACTIVE.programmeId) ??
  school.programmes[0];

export const curriculum: CurriculumVersion =
  programme.curricula.find((c) => c.id === ACTIVE.curriculumId) ??
  programme.curricula[0];

export { ACTIVE as activeConfig };

/** Full human label of the configured context, e.g. for the header. */
export const INSTITUTION_LABEL =
  `${university.shortName} · ${school.name} · ${programme.shortName}`;
