// ─────────────────────────────────────────────────────────────────────────
// Config API base resolution (shared by the student sync client and the
// admin API client).
//
//   • Default: SAME-ORIGIN — when the app is hosted by the Cloudflare
//     Worker (static assets + /api on one origin) this just works, with no
//     configuration and no CORS.
//   • Production split-hosting: the site lives on Cloudflare Pages
//     (cgpapilot.pages.dev) while the configuration API is the API-only
//     Worker. On that origin the production API address below is used, so
//     NO build-time env var is required (a mis-set variable can't break it).
//   • Override: VITE_CONFIG_API_BASE build env (full URL) always wins when
//     present — for other deployments or a future API move.
//
// On file:// (Electron) or offline the sync simply reports "unavailable"
// and the app keeps using its local cache / bundled seed.
// ─────────────────────────────────────────────────────────────────────────

/** Production configuration API (API-only Cloudflare Worker + D1). */
const PRODUCTION_API_BASE = 'https://cgpa-pilot.calcitoninpay.workers.dev';
const PAGES_HOST = 'cgpapilot.pages.dev';

/**
 * Normalize a base URL. A secure (https) page can never reach an http://
 * API — browsers block it as mixed content — so upgrade instead of failing
 * silently (a pasted `http://…workers.dev` must not break the console).
 */
function normalizeBase(base: string): string {
  let b = base.trim().replace(/\/+$/, '');
  try {
    if (
      typeof window !== 'undefined' &&
      window.location?.protocol === 'https:' &&
      b.startsWith('http://')
    ) {
      b = `https://${b.slice('http://'.length)}`;
    }
  } catch {
    /* non-browser context */
  }
  return b;
}

/** The API base: '' means same-origin (/api/...). */
export function configApiBase(): string {
  try {
    const meta = import.meta as unknown as {
      env?: Record<string, string | boolean | undefined>;
    };
    const v = meta.env?.VITE_CONFIG_API_BASE;
    if (typeof v === 'string' && v.trim().length > 0) {
      return normalizeBase(v);
    }
  } catch {
    /* non-Vite context (tests / bundlers) */
  }
  // Split-hosting production: Pages site → API-only Worker.
  try {
    if (typeof window !== 'undefined' && window.location?.hostname === PAGES_HOST) {
      return PRODUCTION_API_BASE;
    }
  } catch {
    /* non-browser context */
  }
  return '';
}

/** Absolute or root-relative URL for a /api path. */
export function configApiUrl(path: string): string {
  const base = configApiBase();
  if (!base) return path; // same-origin: keep it root-relative
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}
