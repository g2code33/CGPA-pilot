// ─────────────────────────────────────────────────────────────────────────
// Academic configuration model (configuration-driven architecture)
//
// Hierarchy:
//   University → School/College → Programme → Curriculum Version
//              → Level → Semester → Course
//
// This is PUBLISHED, NON-PERSONAL curriculum configuration. It is the only
// kind of data the app may cache locally (see services/configCache.ts);
// student academic data never enters this layer.
// ─────────────────────────────────────────────────────────────────────────

export type EntityStatus = 'active' | 'inactive';

/** Curriculum publication workflow. Only `published` versions reach students. */
export type CurriculumStatus = 'draft' | 'review' | 'published' | 'archived';

/** One letter-grade band of a university grading system. */
export interface GradingSystem {
  id: string;
  name: string;
  bands: GradeBand[];
}

export interface GradeBand {
  /** Stable id used by editors (optional for legacy/seed configs). */
  id?: string;
  grade: string;
  minScore: number; // inclusive, 0–100
  maxScore: number; // inclusive, 0–100
  points: number; // grade points per credit hour
  interpretation?: string;
}

/** One band of a degree-classification system. */
export interface ClassificationBand {
  id: string;
  label: string;
  minCgpa: number; // inclusive
  maxCgpa: number; // inclusive
  tone: 'gold' | 'green' | 'teal' | 'blue' | 'red' | 'gray';
}

export interface ClassificationSystem {
  id: string;
  name: string;
  bands: ClassificationBand[];
  graduationMinCgpa?: number;
}

export interface University {
  id: string;
  name: string;
  shortName: string;
  country: string;
  status: EntityStatus;
  gradingSystemId: string;
  classificationSystemId: string;
  /** Optional URL/path to school/university logo image. */
  logo?: string;
  /** Grading/classification systems may be defined in-catalog or referenced. */
  gradingSystem?: GradingSystem;
  classificationSystem?: ClassificationSystem;
  schools: School[];
}

export interface School {
  id: string;
  name: string;
  universityId: string;
  status: EntityStatus;
  /** Optional URL/path to school/department logo image. */
  logo?: string;
  programmes: Programme[];
}

export interface Programme {
  id: string;
  name: string;
  shortName: string;
  schoolId: string;
  status: EntityStatus;
  /** Nominal duration, e.g. { years: 6, label: '6-year professional doctorate' } */
  duration: ProgrammeDuration;
  curriculumVersionIds: string[];
  /**
   * Optional programme-level override. When absent, the programme uses its
   * university's grading/classification systems. This lets a programme define
   * its own rules without affecting the rest of the university.
   */
  gradingSystem?: GradingSystem;
  classificationSystem?: ClassificationSystem;
}

export interface ProgrammeDuration {
  years: number;
  expectedLevels: number;
  label: string;
}

export interface CurriculumVersion {
  id: string;
  versionName: string;
  programmeId: string;
  /** Academic year / effective date this curriculum applies from. */
  effectiveAcademicYear: string;
  effectiveDate: string; // ISO
  status: CurriculumStatus;
  /** Published courses arranged by level and semester. */
  levels: CurriculumLevel[];
}

export interface CurriculumLevel {
  index: number; // 1-based (Level 100 …)
  label: string;
  semesters: CurriculumSemester[];
}

export interface CurriculumSemester {
  index: number; // 1-based within a level
  label: string;
  courses: CurriculumCourse[];
}

export interface CurriculumCourse {
  id: string; // stable config id, e.g. "phar111"
  code: string;
  name: string;
  creditHours: number;
  level: number;
  semester: number; // semester index within the level
  programmeId: string;
  curriculumId: string;
  status: 'active' | 'inactive';
  core: boolean;
}

/** A course flattened out of the level/semester tree, with context filled in. */
export interface FlatCourse extends CurriculumCourse {
  universityId: string;
  schoolId: string;
  levelLabel: string;
  semesterLabel: string;
}

/** Which institution/programme/curriculum the student app is running under. */
export interface InstitutionContext {
  universityId: string;
  schoolId: string;
  programmeId: string;
  /** Optional explicit curriculum; default = latest published for programme. */
  curriculumId?: string;
}

/** A replaceable app icon: an emoji OR an uploaded image (data URL). */
export interface AppIcon {
  /** Emoji used when no image is supplied (fallback). */
  emoji: string;
  /** Optional uploaded image (png/jpg/jpeg/webp as a data URL). */
  image?: string;
}

/**
 * Non-personal branding / appearance that the administrator can set and which
 * is shipped to the student app as part of its offline config (so it shows
 * even without a network). Only ever contains non-personal assets.
 */
export interface AppAppearance {
  /** App logo image (data URL) overriding the bundled icon-512. */
  logo?: string;
  /** Replaces the app icon used on the home hub / hero when present. */
  appIcon?: AppIcon;
  /** Overridable icons keyed by a slot name (e.g. a tool id). */
  icons?: Record<string, AppIcon>;
  /** Optional product wordmark / tagline override. */
  appName?: string;
  tagline?: string;
}
