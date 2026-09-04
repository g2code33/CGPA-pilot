// ─────────────────────────────────────────────────────────────────────────
// Config API base resolution (shared by the student sync client and the
// admin API client).
//
//   • Default: SAME-ORIGIN — when the app is hosted by the Cloudflare
//     Worker (static assets + /api on one origin) this just works, with no
//     configuration and no CORS.
//   • Override: VITE_CONFIG_API_BASE build env (full URL, e.g. a separate
//     API-only Worker) for deployments where the site and the API live on
//     different origins.
//
// On file:// (Electron) or offline the sync simply reports "unavailable"
// and the app keeps using its local cache / bundled seed.
// ─────────────────────────────────────────────────────────────────────────

/** The API base: '' means same-origin (/api/...). */
export function configApiBase(): string {
  try {
    const meta = import.meta as unknown as {
      env?: Record<string, string | boolean | undefined>;
    };
    const v = meta.env?.VITE_CONFIG_API_BASE;
    if (typeof v === 'string' && v.trim().length > 0) {
      return v.trim().replace(/\/+$/, '');
    }
  } catch {
    /* non-Vite context (tests / bundlers) → same-origin */
  }
  return '';
}

/** Absolute or root-relative URL for a /api path. */
export function configApiUrl(path: string): string {
  const base = configApiBase();
  if (!base) return path; // same-origin: keep it root-relative
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}
