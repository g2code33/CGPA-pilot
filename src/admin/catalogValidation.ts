// ─────────────────────────────────────────────────────────────────────────
// catalogValidation — pure, environment-free validation of admin catalogs
// and published distribution documents.
//
// Used in BOTH places the configuration is written:
//   • the admin console (client-side gate before a publish call) and
//   • the Cloudflare Worker (server-side gate before persisting to D1).
//
// This module must stay DOM-free and storage-free so the Worker (Node-like
// runtime) and the browser bundle can share the exact same rules.
// ─────────────────────────────────────────────────────────────────────────

import type { AdminCatalog, TrashEntry } from './catalogTypes';
import type {
  AppAppearance,
  ClassificationSystem,
  CurriculumCourse,
  CurriculumLevel,
  CurriculumSemester,
  CurriculumVersion,
  GradingSystem,
  Programme,
  School,
  University,
} from '../config/types';
import { buildDistribution, reviewCurriculum } from './catalogPublish';

export interface ValidationResult {
  ok: boolean;
  issues: string[];
}

const CURRICULUM_STATUSES = ['draft', 'review', 'published', 'archived'] as const;
const APPEARANCE_STRING_KEYS = ['logo', 'appName', 'tagline', 'appImage', 'taglineImage'] as const;

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Light structural check of a grading system (bands present + sane numbers). */
function checkGradingSystem(system: unknown, label: string, issues: string[]): void {
  if (system === undefined) return; // optional (may be inherited at the university level)
  const gs = system as GradingSystem;
  if (!isPlainObject(gs)) {
    issues.push(`${label}.gradingSystem must be an object.`);
    return;
  }
  if (!Array.isArray(gs.bands) || gs.bands.length === 0) {
    issues.push(`${label}.gradingSystem.bands must be a non-empty array.`);
    return;
  }
  gs.bands.forEach((b, i) => {
    const bl = `${label}.gradingSystem.bands[${i}]`;
    if (!isPlainObject(b)) {
      issues.push(`${bl} must be an object.`);
      return;
    }
    if (!isNonEmptyString(b.grade)) issues.push(`${bl} is missing its grade.`);
    if (!isFiniteNum(b.minScore) || !isFiniteNum(b.maxScore)) {
      issues.push(`${bl} has a non-numeric score range.`);
    }
    if (!isFiniteNum(b.points) || b.points < 0) {
      issues.push(`${bl} has invalid grade points.`);
    }
  });
}

/** Light structural check of a classification system. */
function checkClassificationSystem(system: unknown, label: string, issues: string[]): void {
  if (system === undefined) return;
  const cs = system as ClassificationSystem;
  if (!isPlainObject(cs)) {
    issues.push(`${label}.classificationSystem must be an object.`);
    return;
  }
  if (!Array.isArray(cs.bands) || cs.bands.length === 0) {
    issues.push(`${label}.classificationSystem.bands must be a non-empty array.`);
    return;
  }
  cs.bands.forEach((b, i) => {
    const bl = `${label}.classificationSystem.bands[${i}]`;
    if (!isPlainObject(b)) {
      issues.push(`${bl} must be an object.`);
      return;
    }
    if (!isNonEmptyString(b.label)) issues.push(`${bl} is missing its label.`);
    if (!isFiniteNum(b.minCgpa) || !isFiniteNum(b.maxCgpa)) {
      issues.push(`${bl} has a non-numeric CGPA range.`);
    }
  });
}

function checkSchool(s: unknown, label: string, issues: string[]): void {
  const school = s as School;
  if (!isPlainObject(s)) {
    issues.push(`${label} must be an object.`);
    return;
  }
  if (!isNonEmptyString(school.id)) issues.push(`${label} is missing its id.`);
  if (!isNonEmptyString(school.name)) issues.push(`${label} is missing its name.`);
  if (school.status !== 'active' && school.status !== 'inactive') {
    issues.push(`${label} has an invalid status.`);
  }
  if (!Array.isArray(school.programmes)) {
    issues.push(`${label}.programmes must be an array.`);
    return;
  }
  school.programmes.forEach((p, k) => {
    const pl = `${label}.programmes[${k}]`;
    const prog = p as Programme;
    if (!isPlainObject(p)) {
      issues.push(`${pl} must be an object.`);
      return;
    }
    if (!isNonEmptyString(prog.id)) issues.push(`${pl} is missing its id.`);
    if (!isNonEmptyString(prog.name)) issues.push(`${pl} is missing its name.`);
    if (!isNonEmptyString(prog.shortName)) issues.push(`${pl} is missing its short name.`);
    if (prog.status !== 'active' && prog.status !== 'inactive') {
      issues.push(`${pl} has an invalid status.`);
    }
    if (!Array.isArray(prog.curriculumVersionIds)) {
      issues.push(`${pl}.curriculumVersionIds must be an array.`);
    }
    checkGradingSystem(prog.gradingSystem, pl, issues);
    checkClassificationSystem(prog.classificationSystem, pl, issues);
  });
}

function checkLevel(lv: unknown, label: string, curriculumId: string, issues: string[]): void {
  const level = lv as CurriculumLevel;
  if (!isPlainObject(lv)) {
    issues.push(`${label} must be an object.`);
    return;
  }
  if (!isFiniteNum(level.index) || level.index < 1) {
    issues.push(`${label} has an invalid index.`);
  }
  if (!Array.isArray(level.semesters)) {
    issues.push(`${label}.semesters must be an array.`);
    return;
  }
  level.semesters.forEach((sm, si) => {
    const ml = `${label}.semesters[${si}]`;
    const sem = sm as CurriculumSemester;
    if (!isPlainObject(sm)) {
      issues.push(`${ml} must be an object.`);
      return;
    }
    if (!isFiniteNum(sem.index) || sem.index < 1) {
      issues.push(`${ml} has an invalid index.`);
    }
    if (!Array.isArray(sem.courses)) {
      issues.push(`${ml}.courses must be an array.`);
      return;
    }
    sem.courses.forEach((cr, ci) => {
      const crl = `${ml}.courses[${ci}]`;
      const course = cr as CurriculumCourse;
      if (!isPlainObject(cr)) {
        issues.push(`${crl} must be an object.`);
        return;
      }
      if (!isNonEmptyString(course.code)) issues.push(`${crl} is missing its code.`);
      if (!isNonEmptyString(course.name)) issues.push(`${crl} is missing its name.`);
      if (!isFiniteNum(course.creditHours) || course.creditHours <= 0 || course.creditHours > 20) {
        issues.push(`${crl} has invalid credit hours (must be 1–20).`);
      }
      if (!isFiniteNum(course.level) || (isFiniteNum(level.index) && course.level !== level.index)) {
        issues.push(`${crl} has a level that does not match its placement.`);
      }
      if (!isFiniteNum(course.semester) || (isFiniteNum(sem.index) && course.semester !== sem.index)) {
        issues.push(`${crl} has a semester that does not match its placement.`);
      }
      if (!isNonEmptyString(course.programmeId)) {
        issues.push(`${crl} is missing its programme link.`);
      }
      if (isNonEmptyString(curriculumId) && isNonEmptyString(course.curriculumId) && course.curriculumId !== curriculumId) {
        issues.push(`${crl} is linked to the wrong curriculum.`);
      }
    });
  });
}

/**
 * Structural validation of a full admin catalog (any curriculum status).
 *
 * @param opts.checkPublishedGate — also run the per-curriculum publish
 *   review (duplicate codes, missing names, bad credits…) for every
 *   PUBLISHED curriculum, mirroring the admin console's publish gate.
 */
export function validateCatalogStructure(
  input: unknown,
  opts: { checkPublishedGate?: boolean } = {}
): ValidationResult {
  const issues: string[] = [];
  const catalog = input as AdminCatalog;
  if (!isPlainObject(input)) {
    return { ok: false, issues: ['Catalog must be a JSON object.'] };
  }
  if (!Array.isArray(catalog.universities)) {
    return { ok: false, issues: ['universities must be an array.'] };
  }
  if (!Array.isArray(catalog.curricula)) {
    return { ok: false, issues: ['curricula must be an array.'] };
  }
  if (catalog.universities.length === 0) {
    issues.push('At least one university is required.');
  }

  const uniIds = new Set<string>();
  const programmeIds = new Set<string>();

  catalog.universities.forEach((uRaw, i) => {
    const label = `universities[${i}]`;
    const u = uRaw as University;
    if (!isPlainObject(uRaw)) {
      issues.push(`${label} must be an object.`);
      return;
    }
    if (!isNonEmptyString(u.id)) {
      issues.push(`${label} is missing its id.`);
    } else if (uniIds.has(u.id)) {
      issues.push(`Duplicate university id: ${u.id}.`);
    } else {
      uniIds.add(u.id);
    }
    if (!isNonEmptyString(u.name)) issues.push(`${label} is missing its name.`);
    if (!isNonEmptyString(u.shortName)) issues.push(`${label} is missing its short name.`);
    if (u.status !== 'active' && u.status !== 'inactive') {
      issues.push(`${label} has an invalid status.`);
    }
    checkGradingSystem(u.gradingSystem, label, issues);
    checkClassificationSystem(u.classificationSystem, label, issues);
    if (!Array.isArray(u.schools)) {
      issues.push(`${label}.schools must be an array.`);
      return;
    }
    u.schools.forEach((s, j) => {
      const sl = `${label}.schools[${j}]`;
      checkSchool(s, sl, issues);
      const school = s as School;
      if (isPlainObject(s)) {
        for (const p of school.programmes ?? []) {
          const prog = p as Programme;
          if (isPlainObject(p) && isNonEmptyString(prog.id)) programmeIds.add(prog.id);
        }
      }
    });
  });

  catalog.curricula.forEach((cRaw, i) => {
    const cl = `curricula[${i}]`;
    const c = cRaw as CurriculumVersion;
    if (!isPlainObject(cRaw)) {
      issues.push(`${cl} must be an object.`);
      return;
    }
    if (!isNonEmptyString(c.id)) issues.push(`${cl} is missing its id.`);
    if (!isNonEmptyString(c.versionName)) issues.push(`${cl} is missing its version name.`);
    if (!isNonEmptyString(c.programmeId)) {
      issues.push(`${cl} is missing its programme link.`);
    } else if (!programmeIds.has(c.programmeId)) {
      issues.push(`${cl} references an unknown programme: ${c.programmeId}.`);
    }
    if (!CURRICULUM_STATUSES.includes(c.status as (typeof CURRICULUM_STATUSES)[number])) {
      issues.push(`${cl} has an invalid status: ${String(c.status)}.`);
    }
    if (!Array.isArray(c.levels)) {
      issues.push(`${cl}.levels must be an array.`);
      return;
    }
    c.levels.forEach((lv, li) => checkLevel(lv, `${cl}.levels[${li}]`, c.id, issues));

    if (opts.checkPublishedGate && c.status === 'published') {
      for (const issue of reviewCurriculum(c)) {
        if (issue.severity === 'error') issues.push(`${cl} (published): ${issue.message}`);
      }
    }
  });

  if (catalog.trash !== undefined && !Array.isArray(catalog.trash)) {
    issues.push('trash must be an array when present.');
  } else {
    (catalog.trash as TrashEntry[] | undefined)?.forEach((t, i) => {
      if (!isPlainObject(t) || !isNonEmptyString((t as TrashEntry).id)) {
        issues.push(`trash[${i}] must be an object with an id.`);
      }
    });
  }

  return { ok: issues.length === 0, issues };
}

/** Validate the optional non-personal appearance block (branding/icons). */
export function validateAppearance(appearance: unknown, issues: string[], label = 'appearance'): void {
  if (appearance === undefined || appearance === null) return;
  const ap = appearance as AppAppearance;
  if (!isPlainObject(ap)) {
    issues.push(`${label} must be an object when present.`);
    return;
  }
  for (const key of APPEARANCE_STRING_KEYS) {
    const v = ap[key];
    if (v !== undefined && v !== null && typeof v !== 'string') {
      issues.push(`${label}.${key} must be a string when present.`);
    }
  }
  if (
    ap.logoSize !== undefined &&
    ap.logoSize !== null &&
    (typeof ap.logoSize !== 'number' || !Number.isFinite(ap.logoSize) || ap.logoSize < 16 || ap.logoSize > 256)
  ) {
    issues.push(`${label}.logoSize must be a number between 16 and 256 when present.`);
  }
  const checkTextStyle = (style: unknown, sl: string): void => {
    if (style === undefined || style === null) return;
    if (!isPlainObject(style)) {
      issues.push(`${sl} must be an object when present.`);
      return;
    }
    const st = style as Record<string, unknown>;
    if (
      st.fontSize !== undefined &&
      st.fontSize !== null &&
      (typeof st.fontSize !== 'number' || !Number.isFinite(st.fontSize) || st.fontSize < 8 || st.fontSize > 128)
    ) {
      issues.push(`${sl}.fontSize must be a number between 8 and 128 when present.`);
    }
    if (st.color !== undefined && st.color !== null && typeof st.color !== 'string') {
      issues.push(`${sl}.color must be a string (hex colour) when present.`);
    }
    if (st.fontFamily !== undefined && st.fontFamily !== null && typeof st.fontFamily !== 'string') {
      issues.push(`${sl}.fontFamily must be a string (font key) when present.`);
    }
  };
  checkTextStyle(ap.appNameStyle, `${label}.appNameStyle`);
  checkTextStyle(ap.taglineStyle, `${label}.taglineStyle`);
  const checkIcon = (icon: unknown, il: string): void => {
    if (!isPlainObject(icon)) {
      issues.push(`${il} must be an object.`);
      return;
    }
    const ic = icon as unknown as AppAppearance['appIcon'];
    if (!ic || typeof ic !== 'object') return;
    if (!isNonEmptyString(ic.emoji)) issues.push(`${il} is missing its emoji.`);
    if (ic.image !== undefined && ic.image !== null && typeof ic.image !== 'string') {
      issues.push(`${il}.image must be a string (data URL) when present.`);
    }
    if (
      ic.size !== undefined &&
      ic.size !== null &&
      (typeof ic.size !== 'number' || !Number.isFinite(ic.size) || ic.size < 8 || ic.size > 256)
    ) {
      issues.push(`${il}.size must be a number between 8 and 256 (px) when present.`);
    }
  };
  if (ap.appIcon !== undefined) checkIcon(ap.appIcon, `${label}.appIcon`);
  if (ap.icons !== undefined) {
    if (!isPlainObject(ap.icons)) {
      issues.push(`${label}.icons must be an object when present.`);
    } else {
      for (const [slot, icon] of Object.entries(ap.icons)) checkIcon(icon, `${label}.icons.${slot}`);
    }
  }
}

/**
 * Validate a PUBLISHED distribution document (what students receive):
 *   • exact wire format (format + schemaVersion)
 *   • full structural integrity
 *   • ONLY published curricula, each passing the publish review gate
 */
export function validateDistributionDocument(input: unknown): ValidationResult {
  const p = input as {
    format?: string;
    schemaVersion?: number;
    universities?: unknown[];
    curricula?: unknown[];
    appearance?: unknown;
  };
  if (!isPlainObject(input)) {
    return { ok: false, issues: ['Document must be a JSON object.'] };
  }
  if (p.format !== 'cgpa-pilot-curriculum') {
    return { ok: false, issues: [`Unknown document format: ${String(p.format)}.`] };
  }
  if (p.schemaVersion !== 1) {
    return { ok: false, issues: [`Unsupported schema version: ${String(p.schemaVersion)}.`] };
  }
  const structural = validateCatalogStructure(
    { universities: p.universities, curricula: p.curricula },
    { checkPublishedGate: true }
  );
  if (!structural.ok) return structural;
  const issues: string[] = [];
  (p.curricula as CurriculumVersion[] | undefined)?.forEach((c, i) => {
    if (c && c.status !== 'published') {
      issues.push(`curricula[${i}] is ${c.status} — a distribution document may only contain published curricula.`);
    }
  });
  validateAppearance(p.appearance, issues);
  return { ok: issues.length === 0, issues };
}

/**
 * Validate a full admin catalog for PUBLISH (admin working state, any
 * curriculum status) with the published gate enforced server-side.
 */
export function validateAdminCatalogForPublish(input: unknown): ValidationResult {
  const structural = validateCatalogStructure(input, { checkPublishedGate: true });
  if (!structural.ok) return structural;
  const issues: string[] = [];
  validateAppearance((input as AdminCatalog).appearance, issues);
  const st = (input as AdminCatalog).settings;
  if (st !== undefined && st !== null) {
    if (!isPlainObject(st)) {
      issues.push('settings must be an object when present.');
    } else {
      for (const key of [
        'allowCreditEditing',
        'allowWhatIf',
        'allowCustomTarget',
        'allowPrinting',
        'playIntroSplash',
      ] as const) {
        if (st[key] !== undefined && typeof st[key] !== 'boolean') {
          issues.push(`settings.${key} must be a boolean when present.`);
        }
      }
      const it = st.ideaTips;
      if (it !== undefined && it !== null) {
        if (!isPlainObject(it)) {
          issues.push('settings.ideaTips must be an object when present.');
        } else {
          if (it.enabled !== undefined && typeof it.enabled !== 'boolean') {
            issues.push('settings.ideaTips.enabled must be a boolean when present.');
          }
          if (it.texts !== undefined && it.texts !== null) {
            if (!isPlainObject(it.texts)) {
              issues.push('settings.ideaTips.texts must be an object when present.');
            } else {
              for (const [k, v] of Object.entries(it.texts)) {
                if (typeof v !== 'string') {
                  issues.push(`settings.ideaTips.texts.${k} must be a string.`);
                }
              }
            }
          }
        }
      }
    }
  }
  return { ok: issues.length === 0, issues };
}

/** Re-export for the Worker (single place that derives the student payload). */
export { buildDistribution };
