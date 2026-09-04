import { useEffect, useState } from 'react';
import { useAdmin } from '../adminStore';
import { getAuthState, MAX_PASSCODE_LENGTH, MIN_PASSCODE_LENGTH } from '../adminApi';
import { readAdminAuth } from '../adminStorage';

type Mode = 'checking' | 'login' | 'setup' | 'offline-blocked' | 'not-configured';

export function Login() {
  const { login, setup } = useAdmin();
  const [mode, setMode] = useState<Mode>('checking');
  const [offlineLocal, setOfflineLocal] = useState(false);
  const [pass, setPass] = useState('');
  const [token, setToken] = useState('');
  const [setupPass, setSetupPass] = useState('');
  const [setupConfirm, setSetupConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Decide the mode: backend configured? passcode set yet? offline + local credential?
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const auth = readAdminAuth();
      const hasLocalCred = !!auth.credential || !!auth.legacyPassHash;
      const st = await getAuthState();
      if (cancelled) return;
      if (st.error === 'unreachable') {
        if (hasLocalCred) {
          setOfflineLocal(true);
          setMode('login');
        } else {
          setMode('offline-blocked');
        }
        return;
      }
      if (!st.configured) {
        if (hasLocalCred) {
          setOfflineLocal(true); // backend unavailable → offline verification only
          setMode('login');
        } else {
          setMode('not-configured');
        }
        return;
      }
      setMode(st.hasCredential ? 'login' : 'setup');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function submitLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await login(pass);
    setBusy(false);
    if (!r.ok) {
      setError(r.error ?? 'Sign-in failed.');
      setPass('');
    }
  }

  function submitSetup(e: React.FormEvent) {
    e.preventDefault();
    if (token.trim().length === 0) {
      setError('The operator API token is required for first-time setup.');
      return;
    }
    if (setupPass.length < MIN_PASSCODE_LENGTH) {
      setError(`Passcode must be at least ${MIN_PASSCODE_LENGTH} characters.`);
      return;
    }
    if (setupPass.length > MAX_PASSCODE_LENGTH) {
      setError(`Passcode must be at most ${MAX_PASSCODE_LENGTH} characters.`);
      return;
    }
    if (setupPass !== setupConfirm) {
      setError('The passcodes do not match.');
      return;
    }
    void doSetup();
  }

  async function doSetup() {
    setBusy(true);
    setError(null);
    const r = await setup(token, setupPass);
    setBusy(false);
    if (!r.ok) {
      setError(r.message ?? 'Setup failed.');
      setSetupPass('');
      setSetupConfirm('');
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-lg ring-1 ring-slate-200">
        <div className="mb-4 flex flex-col items-center text-center">
          <img src="./icon-512.png" alt="" className="h-14 w-14 rounded-2xl" width={56} height={56} />
          <h1 className="mt-3 text-lg font-black uppercase tracking-wide">
            CGPA <span className="text-brand-600">Pilot</span>
          </h1>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
            Admin Console
          </p>
        </div>

        {mode === 'checking' && (
          <p className="rounded-xl bg-slate-50 px-3 py-4 text-center text-xs font-bold text-slate-500 ring-1 ring-slate-100">
            Checking the configuration backend…
          </p>
        )}

        {mode === 'offline-blocked' && (
          <div className="space-y-2">
            <p className="rounded-xl bg-amber-50 px-3 py-3 text-xs font-semibold leading-relaxed text-amber-700 ring-1 ring-amber-200">
              📡 You are offline, and this device has no saved passcode
              credential yet. Sign in once while online and the same passcode
              will work on this device without internet afterwards.
            </p>
          </div>
        )}

        {mode === 'not-configured' && (
          <div className="space-y-2">
            <p className="rounded-xl bg-amber-50 px-3 py-3 text-xs font-semibold leading-relaxed text-amber-700 ring-1 ring-amber-200">
              ⚙️ The configuration backend is not set up yet (or is not
              reachable from this URL). Set it up once — D1 database + the
              operator token — following docs/DEPLOYMENT.md, then return here
              to create the admin passcode.
            </p>
          </div>
        )}

        {mode === 'login' && (
          <form onSubmit={submitLogin} className="space-y-3">
            {offlineLocal && (
              <p className="rounded-lg bg-sky-50 px-3 py-2 text-[11px] font-semibold leading-relaxed text-sky-700 ring-1 ring-sky-200">
                📡 Offline sign-in — your passcode is verified against this
                device’s saved credential (no internet needed).
              </p>
            )}
            <label className="block">
              <span className="mb-1 block text-xs font-bold uppercase text-slate-500">
                Admin passcode
              </span>
              <input
                type="password"
                autoFocus
                className="input text-center text-lg tracking-widest"
                value={pass}
                onChange={(e) => {
                  setPass(e.target.value);
                  setError(null);
                }}
                placeholder="••••••••"
              />
            </label>
            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold leading-relaxed text-red-600 ring-1 ring-red-200">
                {error}
              </p>
            )}
            <button type="submit" className="btn-primary w-full" disabled={busy}>
              {busy ? 'Signing in…' : 'Enter console'}
            </button>
          </form>
        )}

        {mode === 'setup' && (
          <form onSubmit={submitSetup} className="space-y-3">
            <p className="rounded-lg bg-indigo-50 px-3 py-2 text-[11px] font-semibold leading-relaxed text-indigo-700 ring-1 ring-indigo-200">
              First-time setup — create the ONE admin passcode. Every device
              will sign in with this same passcode. The backend stores only a
              salted digest, never the passcode itself.
            </p>
            <label className="block">
              <span className="mb-1 block text-xs font-bold uppercase text-slate-500">
                Operator API token
              </span>
              <input
                type="password"
                autoFocus
                className="input"
                value={token}
                onChange={(e) => {
                  setToken(e.target.value);
                  setError(null);
                }}
                placeholder="The ADMIN_TOKEN secret of the Worker"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold uppercase text-slate-500">
                New admin passcode
              </span>
              <input
                type="password"
                className="input"
                value={setupPass}
                onChange={(e) => {
                  setSetupPass(e.target.value);
                  setError(null);
                }}
                placeholder={`Min ${MIN_PASSCODE_LENGTH} characters`}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold uppercase text-slate-500">
                Confirm passcode
              </span>
              <input
                type="password"
                className="input"
                value={setupConfirm}
                onChange={(e) => {
                  setSetupConfirm(e.target.value);
                  setError(null);
                }}
                placeholder="Repeat the passcode"
              />
            </label>
            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold leading-relaxed text-red-600 ring-1 ring-red-200">
                {error}
              </p>
            )}
            <button type="submit" className="btn-primary w-full" disabled={busy}>
              {busy ? 'Setting up…' : 'Create passcode & sign in'}
            </button>
          </form>
        )}

        <div className="mt-4 rounded-xl bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-500 ring-1 ring-slate-100">
          <p>
            One admin, one passcode — the same sign-in on every device. This
            console manages published curriculum configuration. It never
            accesses student data.
          </p>
        </div>

        <button
          onClick={backToStudentApp}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-bold text-slate-600 ring-1 ring-slate-200 transition hover:bg-brand-50 hover:text-brand-700"
        >
          ← Back to the app
        </button>
      </div>
    </div>
  );
}

/** Leave the admin console and return to the students' app. */
function backToStudentApp() {
  try {
    window.location.assign('./index.html');
  } catch {
    window.location.href = './index.html';
  }
}
