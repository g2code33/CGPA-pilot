// ─────────────────────────────────────────────────────────────────────────
// Academic configuration types
//
// CGPA PILOT is built multi-tenant from day one: a University owns one or
// more Schools, each School runs Programmes, and each Programme has versioned
// Curricula (levels → semesters → courses). Only the institution/programme
// selected by the administrator is ever exposed to the student app.
//
// None of this is personal/student data: it is published, non-personal
// curriculum configuration and may be cached locally for offline use.
// ─────────────────────────────────────────────────────────────────────────

/** One letter-grade band of a university grading scale. */
export interface GradeBand {
  /** Letter shown to students, e.g. "A", "B+", "E" */
  grade: string;
  /** Inclusive lower bound of raw score (0–100) */
  minScore: number;
  /** Inclusive upper bound of raw score (0–100) */
  maxScore: number;
  /** Grade points per credit hour */
  points: number;
  /** Official interpretation, e.g. "Excellent", "Weak Pass" */
  interpretation?: string;
}

/** University grading scale. */
export interface GradingScale {
  id: string;
  name: string;
  bands: GradeBand[];
}

/** One band of a degree-classification table. */
export interface ClassificationBand {
  id: string;
  label: string;
  /** Inclusive lower CGPA bound */
  minCgpa: number;
  /** Inclusive upper CGPA bound */
  maxCgpa: number;
  /** Visual tone used for badges */
  tone: 'gold' | 'green' | 'teal' | 'blue' | 'red' | 'gray';
}

/** Classification rules for a programme. */
export interface ClassificationRules {
  id: string;
  scaleName: string;
  bands: ClassificationBand[];
  /** Minimum CGPA required to graduate, if published */
  graduationMinCgpa?: number;
}

/** A published course in a curriculum (non-personal). */
export interface CurriculumCourse {
  code: string;
  title: string;
  credits: number;
  /** Compulsory core or elective — used by later planning prompts */
  kind?: 'core' | 'elective' | 'required' | 'optional';
}

/** One semester of a level (semester 1 / 2, etc.). */
export interface CurriculumSemester {
  index: number; // 1-based
  label: string; // e.g. "Semester 1"
  courses: CurriculumCourse[];
}

/** One academic level of a programme (Level 100 … 600 for PharmD). */
export interface CurriculumLevel {
  index: number; // 1-based
  label: string; // e.g. "Level 100"
  semesters: CurriculumSemester[];
}

/** A versioned curriculum for a programme. */
export interface CurriculumVersion {
  id: string;
  label: string; // e.g. "2024/2025"
  /** Empty until the administrator publishes the actual course list. */
  levels: CurriculumLevel[];
}

export interface Programme {
  id: string;
  name: string; // e.g. "Doctor of Pharmacy"
  shortName: string; // e.g. "PharmD"
  /** Expected number of levels, used to scaffold future planning prompts */
  expectedLevels: number;
  curricula: CurriculumVersion[];
}

export interface School {
  id: string;
  name: string;
  programmes: Programme[];
}

export interface University {
  id: string;
  name: string;
  shortName: string;
  country: string;
  gradingScale: GradingScale;
  classification: ClassificationRules;
  schools: School[];
}

/** The single institution context the student app runs under. */
export interface InstitutionConfig {
  universityId: string;
  schoolId: string;
  programmeId: string;
  curriculumId: string;
}
