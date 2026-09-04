// Shared fixtures: a minimal but fully VALID admin catalog + a fake fetch
// factory for the sync/admin API tests.

export function makeValidCatalog(opts = {}) {
  const {
    programmeId = 'prog-1',
    publishedCourses = 3,
    addDraft = false,
    duplicateCode = false,
    missingCourseName = false,
    orphanCurriculum = false,
  } = opts;

  const course = (n, creditHours = 3) => ({
    id: `crs-pub-${n}`,
    code: duplicateCode && n === publishedCourses ? 'TST11' : `TST1${n}`,
    name: missingCourseName && n === 1 ? '' : `Test Course ${n}`,
    creditHours,
    level: 1,
    semester: 1,
    programmeId,
    curriculumId: 'cur-pub',
    status: 'active',
    core: true,
  });

  const published = {
    id: 'cur-pub',
    versionName: 'Test Curriculum 2026/27',
    programmeId,
    effectiveAcademicYear: '2026/27',
    effectiveDate: '2026-08-31',
    status: 'published',
    levels: [
      {
        index: 1,
        label: 'Level 100',
        semesters: [
          {
            index: 1,
            label: 'Semester 1',
            courses: Array.from({ length: publishedCourses }, (_, i) => course(i + 1)),
          },
        ],
      },
    ],
  };

  const curricula = [published];
  if (addDraft) {
    curricula.push({
      ...published,
      id: 'cur-draft',
      versionName: 'Draft Curriculum 2027/28',
      status: 'draft',
      effectiveDate: '2027-08-31',
      levels: [
        {
          index: 1,
          label: 'Level 100',
          semesters: [{ index: 1, label: 'Semester 1', courses: [] }],
        },
      ],
    });
  }
  if (orphanCurriculum) {
    curricula.push({
      ...published,
      id: 'cur-orphan',
      versionName: 'Orphan Curriculum',
      programmeId: 'prog-does-not-exist',
      status: 'published',
    });
  }

  return {
    universities: [
      {
        id: 'uni-1',
        name: 'Test University',
        shortName: 'TU',
        country: 'Testland',
        status: 'active',
        gradingSystemId: 'tu-std',
        classificationSystemId: 'tu-class',
        gradingSystem: {
          id: 'tu-std',
          name: 'TU Standard',
          bands: [
            { grade: 'A', minScore: 80, maxScore: 100, points: 4 },
            { grade: 'C', minScore: 50, maxScore: 79, points: 2 },
            { grade: 'F', minScore: 0, maxScore: 49, points: 0 },
          ],
        },
        classificationSystem: {
          id: 'tu-class',
          name: 'TU Classification',
          bands: [
            { id: 'c1', label: 'First Class', minCgpa: 3.6, maxCgpa: 4, tone: 'gold' },
            { id: 'c2', label: 'Second Class', minCgpa: 2.4, maxCgpa: 3.59, tone: 'blue' },
            { id: 'c3', label: 'Pass', minCgpa: 1.0, maxCgpa: 2.39, tone: 'gray' },
          ],
        },
        schools: [
          {
            id: 'sch-1',
            name: 'School of Test',
            universityId: 'uni-1',
            status: 'active',
            programmes: [
              {
                id: programmeId,
                name: 'Test Programme',
                shortName: 'TP',
                schoolId: 'sch-1',
                status: 'active',
                duration: { years: 1, expectedLevels: 1, label: '1-year programme' },
                curriculumVersionIds: addDraft ? ['cur-pub', 'cur-draft'] : ['cur-pub'],
              },
            ],
          },
        ],
      },
    ],
    curricula,
    trash: [],
  };
}

/** A valid distribution document (what students receive) for the fixture catalog. */
export function makeDistributionPayload(catalog = makeValidCatalog()) {
  return {
    format: 'cgpa-pilot-curriculum',
    schemaVersion: 1,
    generatedAt: '2026-09-04T00:00:00.000Z',
    universities: catalog.universities,
    curricula: catalog.curricula.filter((c) => c.status === 'published'),
  };
}

/**
 * Fake fetch that dispatches on URL substring. Each handler:
 *   { path, status?, body?, throw?, hang? }
 * `hang` returns a promise that rejects when the request signal aborts
 * (simulating a slow network that respects AbortController).
 */
export function makeFakeFetch(handlers) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, opts });
    const h = handlers.find((x) => u.includes(x.path));
    if (!h) throw new Error(`network unreachable: ${u}`);
    if (h.throw) throw new Error(h.throw);
    if (h.hang) {
      return new Promise((resolve, reject) => {
        const s = opts?.signal;
        if (s) {
          if (s.aborted) reject(new DOMException('The operation was aborted.', 'AbortError'));
          else s.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')), { once: true });
        }
        // If no signal is ever provided the promise simply never settles.
        if (!s) resolve(new Response('{}', { status: 200 }));
      });
    }
    const body = typeof h.body === 'function' ? h.body() : h.body;
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status: h.status ?? 200,
      headers: { 'content-type': h.contentType ?? 'application/json' },
    });
  };
  fn.calls = calls;
  return fn;
}

/** Minimal localStorage double (good enough for the storage boundaries). */
export function makeLocalStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => void map.clear(),
    _map: map,
  };
}
