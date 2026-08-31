import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { AdminCatalog } from './adminStorage';
import {
  readAdminCatalog,
  writeAdminCatalog,
  readAdminAuth,
  writeAdminAuth,
  clearAdminSession,
  hashPasscode,
  DEFAULT_PASSCODE,
} from './adminStorage';
import { seedCatalog } from './adminConfigService';

interface AdminStore {
  catalog: AdminCatalog;
  authed: boolean;
  /** apply a catalog transform and persist it */
  apply: (fn: (c: AdminCatalog) => AdminCatalog) => void;
  setCatalog: (c: AdminCatalog) => void;
  login: (pass: string) => Promise<boolean>;
  setPasscode: (pass: string) => Promise<void>;
  logout: () => void;
}

const AdminContext = createContext<AdminStore | null>(null);

export function AdminProvider({ children }: { children: ReactNode }) {
  const [catalog, setCatalogState] = useState<AdminCatalog>(() =>
    readAdminCatalog(seedCatalog())
  );
  const [authed, setAuthed] = useState<boolean>(() => {
    const auth = readAdminAuth();
    return !!auth?.session;
  });

  useEffect(() => {
    writeAdminCatalog(catalog);
  }, [catalog]);

  const value = useMemo<AdminStore>(
    () => ({
      catalog,
      authed,
      apply: (fn) => setCatalogState((c) => fn(c)),
      setCatalog: (c) => setCatalogState(c),
      async login(pass) {
        const auth = readAdminAuth();
        const hash = await hashPasscode(pass);
        // First run: no passcode set yet → accept the factory default and
        // persist it, prompting the admin to change it afterwards.
        if (!auth) {
          if (pass === DEFAULT_PASSCODE) {
            writeAdminAuth({ passHash: hash, session: true });
            setAuthed(true);
            return true;
          }
          // Also allow setting a brand-new passcode on first login.
          writeAdminAuth({ passHash: hash, session: true });
          setAuthed(true);
          return true;
        }
        if (auth.passHash === hash) {
          writeAdminAuth({ ...auth, session: true });
          setAuthed(true);
          return true;
        }
        return false;
      },
      async setPasscode(pass) {
        const hash = await hashPasscode(pass);
        writeAdminAuth({ passHash: hash, session: true });
      },
      logout() {
        clearAdminSession();
        setAuthed(false);
      },
    }),
    [catalog, authed]
  );

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

export function useAdmin(): AdminStore {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error('useAdmin must be used within AdminProvider');
  return ctx;
}
