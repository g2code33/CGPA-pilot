// ─────────────────────────────────────────────────────────────────────────
// Admin course-file import parser (Prompt 19 follow-up). parseMatrix turns a
// spreadsheet/handbook-style table (Code / Title / T / P / C) into grouped
// semester rows; splitPdfLine splits PDF-extracted lines.
// ─────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMatrix, splitPdfLine } from '../src/admin/importService.ts';

test('UCC Level 100 two-semester table parses with correct credits', () => {
  const lines = [
    ['Level 100'],
    ['1st semester'],
    ['Code', 'Course title', 'T', 'P', 'C'],
    ['ASP', 'African Studies Course', '3', '0', '3'],
    ['CMS107', 'Communicative Skills I', '3', '0', '3'],
    ['PHM102', 'Human Anatomy I (Practical)', '0', '1', '1'],
    ['TOTAL', '', '', '', '18'],
    ['2nd semester'],
    ['LAR/LSS/LED', 'Inter-faculty course', '3', '0', '3'],
    ['PHM111', 'Pharmaceutical Microbiology I (Practical)', '0', '1', '1'],
    ['TOTAL', '', '', '', '20'],
  ];
  const { semesters, ignored } = parseMatrix(lines);
  assert.equal(semesters.length, 2);
  const s1 = semesters.find((s) => s.semesterIndex === 1);
  const s2 = semesters.find((s) => s.semesterIndex === 2);
  assert.equal(s1.rows.length, 3);
  assert.equal(s2.rows.length, 2);
  // C column used, not summed: ASP is 3 credits, PHM102 practical is 1.
  const asp = s1.rows.find((r) => r.code === 'ASP');
  assert.equal(asp.creditHours, 3);
  const prac = s1.rows.find((r) => r.code === 'PHM102');
  assert.equal(prac.creditHours, 1);
  // Combined code form LAR/LSS/LED recognised.
  assert.ok(s2.rows.some((r) => r.code === 'LAR/LSS/LED'));
  // Header ignored, TOTAL ignored.
  assert.ok(!ignored.includes('TOTAL'));
});

test('level headings switch level and semester resets', () => {
  const lines = [
    ['Level 100'],
    ['1st semester'],
    ['PHM101', 'One', '2', '0', '2'],
    ['Level 200'],
    ['1st semester'],
    ['PHM201', 'Two', '3', '0', '3'],
  ];
  const { semesters } = parseMatrix(lines);
  const l1 = semesters.find((s) => s.levelIndex === 1 && s.semesterIndex === 1);
  const l2 = semesters.find((s) => s.levelIndex === 2 && s.semesterIndex === 1);
  assert.ok(l1);
  assert.ok(l2);
  assert.equal(l1.rows[0].code, 'PHM101');
  assert.equal(l2.rows[0].code, 'PHM201');
});

test('single trailing credits column works', () => {
  const { semesters } = parseMatrix([
    ['Level 100'],
    ['1st semester'],
    ['PHA211', 'Some course', '3'],
    ['PHA212', 'Another', '4'],
  ]);
  assert.equal(semesters[0].rows.length, 2);
  assert.equal(semesters[0].rows[1].creditHours, 4);
});

test('splitPdfLine pulls code, title and trailing credit numbers', () => {
  assert.deepEqual(splitPdfLine('PHM101 Human Anatomy I 2 0 2'), [
    'PHM101',
    'Human Anatomy I',
    '2',
    '0',
    '2',
  ]);
  assert.deepEqual(splitPdfLine('LAR/LSS/LED Inter-faculty course 3 0 3')[0], 'LAR/LSS/LED');
});

test('non-course text is ignored, not treated as a course', () => {
  const { semesters, ignored } = parseMatrix([
    ['Level 100'],
    ['1st semester'],
    ['Some random paragraph of text without a code'],
    ['PHM101', 'Real course', '2', '0', '2'],
  ]);
  assert.equal(semesters[0].rows.length, 1);
  assert.ok(ignored.length >= 1);
});
