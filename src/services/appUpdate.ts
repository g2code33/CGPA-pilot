// ─────────────────────────────────────────────────────────────────────────
// appUpdate — "is there a newer app version?" for clients that cannot
// self-update (Android APK / iOS).
//
// Each platform's update path:
//   • Electron (deb / Windows)  → built-in auto-updater (electron-updater,
//     reads latest.yml from GitHub Releases) — handled by UpdateButton/Banner.
//   • Web / PWA                 → service-worker shell update (network-first
//     navigation + waiting-worker reload) — handled by UpdateButton.
//   • Android / iOS             → NO self-update. This module asks the
//     configuration Worker (GET /api/app/latest → the latest GitHub Release
//     of this repo, where CI uploads the new APK) and the AppUpdateBanner
//     then offers a download link.
//
// Best-effort by design: offline (or any failure) → null → no banner.
// Student data is never involved.
// ─────────────────────────────────────────────────────────────────────────

import { configApiUrl } from '../config/apiBase';
import { platformKind } from '../platform';

export interface NewerApp {
  version: string;
  /** GitHub Release page (the new APK is attached there). */
  url: string | null;
}

function verParts(v: string): number[] {
  return v.split('.').map((n) => parseInt(n, 10) || 0);
}

/** True when `remote` is strictly newer than `local` (numeric x.y.z compare). */
export function isVersionNewer(remote: string, local: string): boolean {
  const r = verParts(remote);
  const l = verParts(local);
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    const a = r[i] ?? 0;
    const b = l[i] ?? 0;
    if (a !== b) return a > b;
  }
  return false;
}

/** This build's version (Electron: from the shell; everywhere: build-time). */
export async function localAppVersion(): Promise<string> {
  if (window.cgpaPilot) {
    try {
      return await window.cgpaPilot.getVersion();
    } catch {
      /* fall through to the build-time value */
    }
  }
  return import.meta.env.VITE_APP_VERSION || '0.0.0';
}

/**
 * The newer app version, or null when up-to-date / not applicable (web,
 * Electron) / offline / any failure.
 */
export async function checkForNewerAppVersion(): Promise<NewerApp | null> {
  const kind = platformKind();
  if (kind === 'web' || kind === 'electron') return null;
  let doc: { ok?: boolean; version?: string; url?: string | null };
  try {
    const res = await fetch(configApiUrl('/api/app/latest'), {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    doc = await res.json();
  } catch {
    return null; // offline — stay silent
  }
  if (!doc.ok || !doc.version) return null;
  const local = await localAppVersion();
  return isVersionNewer(doc.version, local)
    ? { version: doc.version, url: doc.url ?? null }
    : null;
}
