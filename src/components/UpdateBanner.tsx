import { useEffect, useState } from 'react';
import type { UpdaterStatus } from '../desktop';

// Auto-updater banner — desktop (Electron) only. In web/PWA/Android this
// renders nothing (updates there are served by the host / PWA service worker).
export function UpdateBanner() {
  const [status, setStatus] = useState<UpdaterStatus | null>(null);
  const desktop = typeof window !== 'undefined' && !!window.cgpaPilot;

  useEffect(() => {
    if (!window.cgpaPilot) return;
    const unsubscribe = window.cgpaPilot.onUpdaterStatus((s) => setStatus(s));
    return unsubscribe;
  }, []);

  if (!desktop || !status) return null;

  if (status.status === 'checking') {
    return (
      <div className="bg-slate-100 px-4 py-1.5 text-center text-xs text-slate-600">
        Checking for updates…
      </div>
    );
  }

  if (status.status === 'available') {
    return (
      <div className="no-print flex flex-wrap items-center justify-center gap-3 bg-brand-600 px-4 py-2 text-center text-xs font-medium text-white">
        <span>🔄 Update available: v{status.version}</span>
        <button
          className="rounded-lg bg-white/20 px-3 py-1 font-semibold hover:bg-white/30"
          onClick={async () => {
            const res = await window.cgpaPilot?.downloadUpdate();
            if (res && !res.ok) {
              setStatus({ status: 'error', message: res.message ?? 'Download failed' });
            }
          }}
        >
          Download &amp; install
        </button>
      </div>
    );
  }

  if (status.status === 'downloading') {
    return (
      <div className="bg-brand-600 px-4 py-2 text-center text-xs font-medium text-white">
        Downloading update… {status.percent ?? 0}%
      </div>
    );
  }

  if (status.status === 'downloaded') {
    return (
      <div className="flex flex-wrap items-center justify-center gap-3 bg-green-600 px-4 py-2 text-center text-xs font-medium text-white">
        <span>✅ Update v{status.version} ready — restart to install.</span>
        <button
          className="rounded-lg bg-white/20 px-3 py-1 font-semibold hover:bg-white/30"
          onClick={() => window.cgpaPilot?.installUpdate()}
        >
          Restart now
        </button>
      </div>
    );
  }

  if (status.status === 'error') {
    return (
      <div className="bg-amber-50 px-4 py-1.5 text-center text-xs text-amber-700">
        Update check failed: {status.message}
      </div>
    );
  }

  return null;
}
