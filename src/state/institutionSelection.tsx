// ─────────────────────────────────────────────────────────────────────────
// Institution selection (University → School → Programme).
//
// This is a TEMPORARY, IN-MEMORY React context. The student never creates an
// account. Their choice of institution is not persisted (no localStorage /
// sessionStorage / IndexedDB / cookies), is never put in a URL, and is never
// sent to a server. It simply chooses which bundled/published configuration
// the calculation engines resolve against for the current session.
// ─────────────────────────────────────────────────────────────────────────

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ACTIVE_CONTEXT, resolveContext } from '../config/context';
import type { InstitutionContext } from '../config/types';
import {
  getActiveCurriculum,
  getUniversity,
  listUniversities,
} from '../services/curriculumService';

interface InstitutionState {
  /** The active { universityId, schoolId, programmeId } context. */
  context: InstitutionContext;
  setContext: (ctx: InstitutionContext) => void;
  selectUniversity: (universityId: string) => void;
  selectSchool: (schoolId: string) => void;
  selectProgramme: (programmeId: string) => void;
}

const InstitutionContext = createContext<InstitutionState | null>(null);

/** Valid options for each cascade level (only active entities). */
function schoolsOf(universityId: string) {
  return getUniversity(universityId)?.schools.filter((s) => s.status === 'active') ?? [];
}
function programmesOf(universityId: string, schoolId: string) {
  return schoolsOf(universityId)
    .find((s) => s.id === schoolId)
    ?.programmes.filter((p) => p.status === 'active') ?? [];
}

export function InstitutionProvider({ children }: { children: ReactNode }) {
  // Default to the shipped context (UCC / School of Pharmacy / PharmD).
  const [context, setContext] = useState<InstitutionContext>(ACTIVE_CONTEXT);

  const value = useMemo<InstitutionState>(() => {
    return {
      context,
      setContext,
      selectUniversity: (universityId: string) => {
        const schools = schoolsOf(universityId);
        const school = schools[0];
        const programme = school?.programmes
          .filter((p) => p.status === 'active')[0];
        setContext({
          universityId,
          schoolId: school?.id ?? '',
          programmeId: programme?.id ?? '',
        });
      },
      selectSchool: (schoolId: string) => {
        const programme = programmesOf(context.universityId, schoolId)[0];
        setContext({
          universityId: context.universityId,
          schoolId: schoolId,
          programmeId: programme?.id ?? '',
        });
      },
      selectProgramme: (programmeId: string) =>
        setContext({ ...context, programmeId }),
    };
  }, [context]);

  return (
    <InstitutionContext.Provider value={value}>
      {children}
    </InstitutionContext.Provider>
  );
}

export function useInstitution(): InstitutionState {
  const ctx = useContext(InstitutionContext);
  if (!ctx) throw new Error('useInstitution must be used within InstitutionProvider');
  return ctx;
}

/** Convenience hook: the resolved configuration for the selected institution. */
export function useResolvedContext() {
  const { context } = useInstitution();
  return useMemo(() => resolveContext(context), [context]);
}

export { listUniversities, getActiveCurriculum };
