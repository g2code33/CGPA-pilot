// ─────────────────────────────────────────────────────────────────────────
// printService — assembles an anonymous printable Pilot Brief model.
// Contains ONLY numbers entered for this session and published curriculum
// labels; no identity data is ever collected.
// ─────────────────────────────────────────────────────────────────────────

import type {
  ClassificationSystem,
  GradingSystem,
} from '../config/types';
import type { AcademicState } from '../state/studentState';
import { confirmedRecord, semesterTotals } from './cgpaCalculationService';
import { effectiveGrade } from './gradingService';
import { classifyCgpa } from './classificationService';
import type { CurriculumVersion } from '../config/types';

export interface PrintCourseRow {
  code: string;
  name: string;
  creditHours: number;
  grade: string;
  points: string;
  pending: boolean;
}

export interface PrintSemesterRow {
  label: string;
  gpa: string;
  creditHours: number;
  courses: PrintCourseRow[];
}

export interface PrintReport {
  generatedAt: string;
  institutionLabel: string;
  programmeName: string;
  curriculumName: string;
  curriculumStatus: string;
  modeLabel: string;
  cgpa: string;
  classificationLabel: string;
  gradedCreditHours: number;
  totalPoints: string;
  targetLabel: string;
  targetStanding: string;
  semesters: PrintSemesterRow[];
  pendingCount: number;
  pendingCreditHours: number;
}

export function buildPrintReport(input: {
  state: AcademicState;
  grading: GradingSystem;
  classification: ClassificationSystem;
  institutionLabel: string;
  programmeName: string;
  curriculum?: CurriculumVersion;
}): PrintReport {
  const { state, grading, classification } = input;
  const record = confirmedRecord(state, grading);
  const cls = classifyCgpa(record.cgpa, classification);

  const semesters: PrintSemesterRow[] =
    state.mode === 'history'
      ? state.semesters.map((s) => {
          const totals = semesterTotals(s, grading);
          return {
            label: s.label,
            gpa: totals.cgpa === null ? '—' : totals.cgpa.toFixed(2),
            creditHours: totals.creditHours,
            courses: s.courses
              .filter((c) => c.grade || c.score !== null || c.pending)
              .map((c) => {
                const g = effectiveGrade(c, grading);
                const pts = g
                  ? (grading.bands.find((b) => b.grade === g)?.points ?? 0) *
                    c.creditHours
                  : null;
                return {
                  code: c.code || '—',
                  name: c.name || '—',
                  creditHours: c.creditHours,
                  grade: c.pending ? 'PENDING' : g ?? '—',
                  points: c.pending || pts === null ? '—' : pts.toFixed(1),
                  pending: c.pending,
                };
              }),
          };
        })
      : [];

  const target = state.targetCgpa;
  const targetStanding =
    record.cgpa !== null && target !== null
      ? record.cgpa >= target
        ? 'at/above target'
        : 'below target'
      : '—';

  return {
    generatedAt: new Date().toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }),
    institutionLabel: input.institutionLabel,
    programmeName: input.programmeName,
    curriculumName: input.curriculum?.versionName ?? '—',
    curriculumStatus: input.curriculum?.status ?? 'draft',
    modeLabel: state.mode === 'history' ? 'GPA History' : 'Current CGPA',
    cgpa: record.cgpa === null ? '—' : record.cgpa.toFixed(2),
    classificationLabel: cls?.label ?? '—',
    gradedCreditHours: record.creditHours,
    totalPoints: record.points.toFixed(1),
    targetLabel: target ? target.toFixed(2) : 'not set',
    targetStanding,
    semesters,
    pendingCount: record.pendingCount,
    pendingCreditHours: record.pendingCreditHours,
  };
}

/** Trigger the browser/Electron print dialog (save as PDF supported). */
export function printReport(): void {
  window.print();
}
