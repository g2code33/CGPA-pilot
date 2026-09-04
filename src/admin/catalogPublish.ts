// ─────────────────────────────────────────────────────────────────────────
// catalogPublish — pure publishing primitives for the admin catalog:
//   • the per-curriculum publish REVIEW (the gate that blocks critical
//     validation errors at both the UI and the service layer)
//   • the DISTRIBUTION payload (the versioned, non-personal document that
//     students receive — universities + PUBLISHED curricula + appearance)
//
// Pure by design (no DOM, no storage): shared by the admin console, the
// tests, and the Cloudflare Worker, which derives the student document
// server-side from the same code.
// ─────────────────────────────────────────────────────────────────────────

import type {
  AppAppearance,
  CurriculumVersion,
  University,
} from '../config/types';
import type { AdminCatalog } from './catalogTypes';

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ── Review validation (the publish gate) ─────────────────────────────────

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
  /** Optional non-personal branding/icons the admin set for the student app. */
  appearance?: AppAppearance;
}

/**
 * Build the versioned configuration document for offline distribution.
 * Includes the full university catalog plus PUBLISHED curricula only
 * (drafts/review/archived are never distributed), and the optional
 * non-personal branding/appearance. This document contains no student
 * academic data.
 */
export function buildDistribution(catalog: AdminCatalog): DistributionPayload {
  return {
    format: 'cgpa-pilot-curriculum',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    universities: deepClone(catalog.universities),
    curricula: catalog.curricula.filter((c) => c.status === 'published').map(deepClone),
    appearance: catalog.appearance ? deepClone(catalog.appearance) : undefined,
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
