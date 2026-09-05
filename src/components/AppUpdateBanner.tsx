import { useEffect, useState } from 'react';
import { checkForNewerAppVersion, localAppVersion, isVersionNewer } from '../services/appUpdate';
import { platformKind } from '../platform';

/**
 * "New version available" banner for native mobile (Android / iOS) — those
 * builds cannot self-update, so we link to the GitHub Release where CI
 * attaches the new APK. Desktop uses its built-in auto-updater (UpdateBanner)
 * and web/PWA uses the service-worker shell update, so this renders nothing
 * there. Silently stays hidden offline.
 */
export function AppUpdateBanner() {
  const [latest, setLatest] = useState<{ version: string; url: string | null } | null>(null);

  useEffect(() => {
    if (platformKind() === 'web' || platformKind() === 'electron') return;
    let alive = true;
    async function check() {
      const newer = await checkForNewerAppVersion();
      if (!alive) return;
      if (newer) {
        setLatest(newer);
        return;
      }
      // Also guard against a stale banner after a restart on the new build.
      const local = await localAppVersion();
      setLatest((cur) => (cur && !isVersionNewer(cur.version, local) ? null : cur));
    }
    void check();
    window.addEventListener('online', check);
    return () => {
      alive = false;
      window.removeEventListener('online', check);
    };
  }, []);

  if (!latest) return null;
  return (
    <div className="no-print flex flex-wrap items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-center text-xs font-semibold text-white">
      <span>📦 New version v{latest.version} of CGPA Pilot is available.</span>
      <a
        href={latest.url ?? 'https://github.com/g2code33/CGPA-pilot/releases/latest'}
        target="_blank"
        rel="noreferrer"
        className="rounded-lg bg-white/20 px-2.5 py-1 font-bold hover:bg-white/30"
      >
        Download
      </a>
    </div>
  );
}
