import { useState } from 'react';
import { useAdmin } from '../adminStore';
import { DEFAULT_PASSCODE } from '../adminStorage';

export function Login() {
  const { login } = useAdmin();
  const [pass, setPass] = useState('');
  const [error, setError] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await login(pass);
    if (!ok) {
      setError(true);
      setPass('');
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

        <form onSubmit={submit} className="space-y-3">
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
                setError(false);
              }}
              placeholder="••••••••"
            />
          </label>
          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 ring-1 ring-red-200">
              Incorrect passcode. Try again.
            </p>
          )}
          <button type="submit" className="btn-primary w-full">
            Enter console
          </button>
        </form>

        <div className="mt-4 rounded-xl bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-500 ring-1 ring-slate-100">
          <p>
            First run? Use the factory passcode <strong>{DEFAULT_PASSCODE}</strong>{' '}
            (you can change it on the Dashboard). This console manages published
            curriculum configuration. It never accesses student data.
          </p>
        </div>
      </div>
    </div>
  );
}
