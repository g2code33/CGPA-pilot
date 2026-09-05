/// <reference types="@cloudflare/workers-types" />
// ─────────────────────────────────────────────────────────────────────────
// CGPA Pilot configuration Worker — Cloudflare Worker + D1.
//
// Roles:
//   1. HOSTS the static app (student + admin) when deployed with the
//      `assets` binding — one origin, same-origin /api, no CORS setup.
//   2. Serves the PUBLIC configuration API used by student devices:
//        GET /api/config/meta    — { version, updatedAt } (cheap probe)
//        GET /api/config/latest  — the full published document
//   3. Serves the AUTHORIZED admin API (token via Authorization: Bearer or
//      x-admin-token; the token is the ADMIN_TOKEN Worker secret):
//        GET  /api/admin/status   — what is stored on the backend
//        GET  /api/admin/catalog  — the authoritative admin catalog
//        POST /api/admin/publish  — persist catalog + publish student config
//
// Security model:
//   • Admin writes require a token that is compared in constant time.
//   • When no ADMIN_TOKEN secret is set, admin endpoints are 503 (fail
//     closed — never an open write endpoint).
//   • Every publish is re-validated on the server (same shared validation
//     module as the client); only validated documents ever reach D1, and
//     the derived student document is validated before it is stored.
//   • Public endpoints only ever return the PUBLISHED, non-personal
//     configuration. Student academic data has no place in this service.
// ─────────────────────────────────────────────────────────────────────────

import type { D1Database, Fetcher } from '@cloudflare/workers-types';
import type { AdminCatalog } from '../../src/admin/catalogTypes';
import {
  validateAdminCatalogForPublish,
  validateDistributionDocument,
} from '../../src/admin/catalogValidation';
import {
  bytesToHex,
  createCredential,
  passcodePolicy,
  timingSafeEqualHex,
  verifyPasscode,
} from '../../src/admin/passcodeCrypto';
import {
  createAdminCredential,
  readAdminCatalogDoc,
  readAdminCredential,
  readPublished,
  readPublishedMeta,
  publishAll,
  rotateAdminCredential,
} from './db';

export interface Env {
  /** D1 database holding the authoritative configuration. */
  CONFIG_DB?: D1Database;
  /**
   * Secret: the operator token. Gates first-time passcode SETUP and remains
   * a valid API credential (automation). Everyday admin sign-in uses the
   * single passcode (→ server-signed session token).
   */
  ADMIN_TOKEN?: string;
  /** Static site binding (dist/) when the Worker also hosts the app. */
  ASSETS?: Fetcher;
  /** Test hook: session lifetime in ms (default 30 days). */
  SESSION_TTL_MS?: string;
}

const MAX_BODY_BYTES = 15 * 1024 * 1024; // generous: full catalogs are < 5 MB
const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function sessionTtlMs(env: Env): number {
  const v = Number(env.SESSION_TTL_MS);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_SESSION_TTL_MS;
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization, x-admin-token',
  'access-control-max-age': '86400',
} as const;

type ParsedBody = { ok: true; value: Record<string, unknown> } | { ok: false; response: Response };

/** Parse a JSON object body; 400 on invalid JSON / non-object. */
async function parseJsonBody(req: Request): Promise<ParsedBody> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { ok: false, response: json({ ok: false, error: 'invalid-json', message: 'Body must be valid JSON.' }, 400) };
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, response: json({ ok: false, error: 'invalid-body', message: 'Body must be a JSON object.' }, 400) };
  }
  return { ok: true, value: body as Record<string, unknown> };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...CORS,
    },
  });
}

// ── Auth ──────────────────────────────────────────────────────────────────
// Two valid credentials for admin routes:
//   1. A SESSION TOKEN — issued by POST /api/admin/login after the single
//      admin passcode verifies. Format `cps1.<expMs>.<hmac>` where the HMAC
//      is keyed by the ADMIN_TOKEN secret: forgery is impossible without the
//      server secret, and the expiry is embedded + enforced.
//   2. The raw ADMIN_TOKEN secret — for first-run setup, automation, and
//      tooling (what the previous design used exclusively).
// The passcode itself is only ever sent to /login, /setup, /passcode and is
// never stored or echoed back (only its PBKDF2 digest lives in D1).

function bearerToken(req: Request): string | null {
  const auth = req.headers.get('authorization');
  if (auth && /^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, '').trim() || null;
  const x = req.headers.get('x-admin-token');
  return x && x.trim() ? x.trim() : null;
}

/** Sign a session payload with the operator secret (HMAC-SHA256). */
async function hmacHex(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return bytesToHex(new Uint8Array(sig));
}

/** Issue a session token valid for the configured TTL. */
async function signSession(env: Env): Promise<{ token: string; expiresAt: string }> {
  const exp = Date.now() + sessionTtlMs(env);
  const data = `cps1.${exp}`;
  const sig = await hmacHex(env.ADMIN_TOKEN ?? '', data);
  return { token: `${data}.${sig}`, expiresAt: new Date(exp).toISOString() };
}

/** Verify a session token (format, expiry, constant-time HMAC). */
async function verifySession(env: Env, provided: string): Promise<boolean> {
  const parts = provided.split('.');
  if (parts.length !== 3 || parts[0] !== 'cps1') return false;
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const data = `cps1.${exp}`;
  const expected = await hmacHex(env.ADMIN_TOKEN ?? '', data);
  return timingSafeEqualHex(expected, parts[2] ?? '');
}

/** Constant-time token comparison (SHA-256 both, XOR the digests). */
async function tokenMatches(provided: string, expected: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(provided)),
    crypto.subtle.digest('SHA-256', enc.encode(expected)),
  ]);
  const ab = new Uint8Array(a);
  const bb = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

/**
 * Guard for admin routes (status/catalog/publish/passcode). Accepts a valid
 * session token OR the raw operator token.
 */
async function guardAdmin(req: Request, env: Env): Promise<true | Response> {
  if (!env.ADMIN_TOKEN) {
    return json(
      {
        ok: false,
        error: 'not-configured',
        message: 'Admin endpoints are disabled until the ADMIN_TOKEN secret is set on the Worker (see docs/DEPLOYMENT.md).',
      },
      503
    );
  }
  const credential = bearerToken(req);
  if (!credential) {
    return json(
      { ok: false, error: 'token-missing', message: 'Sign in (passcode session) or present the admin API token (Authorization: Bearer …).' },
      401
    );
  }
  if (await verifySession(env, credential)) return true;
  if (await tokenMatches(credential, env.ADMIN_TOKEN)) return true;
  return json(
    { ok: false, error: 'invalid-credential', message: 'The session is invalid or expired, or the API token was rejected.' },
    401
  );
}

/** login needs only a configured Worker (the passcode IS the credential). */
async function guardAdminBase(req: Request, env: Env): Promise<true | Response> {
  if (!env.ADMIN_TOKEN) {
    return json(
      { ok: false, error: 'not-configured', message: 'Admin endpoints are disabled until the ADMIN_TOKEN secret is set on the Worker.' },
      503
    );
  }
  if (!env.CONFIG_DB) {
    return json({ ok: false, error: 'not-configured', message: 'D1 database is not configured on this Worker.' }, 503);
  }
  return true;
}

/** Setup is special: only the RAW operator token counts (no session exists yet). */
async function guardOperator(req: Request, env: Env): Promise<true | Response> {
  if (!env.ADMIN_TOKEN) {
    return json(
      { ok: false, error: 'not-configured', message: 'Set the ADMIN_TOKEN secret on the Worker first (see docs/DEPLOYMENT.md).' },
      503
    );
  }
  const credential = bearerToken(req);
  if (!credential || !(await tokenMatches(credential, env.ADMIN_TOKEN))) {
    return json(
      { ok: false, error: 'unauthorized', message: 'First-time setup requires the operator API token.' },
      401
    );
  }
  return true;
}

// ── API routing ───────────────────────────────────────────────────────────

async function handleApi(req: Request, url: URL, env: Env): Promise<Response> {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method;

  // Liveness probe.
  if (path === '/api/health') {
    return json({ ok: true, service: 'cgpa-pilot-config', time: new Date().toISOString() });
  }

  // ── Public: student configuration (read-only, non-personal) ────────────
  if (method === 'GET' && path === '/api/config/meta') {
    if (!env.CONFIG_DB) {
      return json(
        { format: 'cgpa-pilot-config-meta', error: 'not-configured', message: 'D1 database is not configured on this Worker.' },
        503
      );
    }
    const meta = await readPublishedMeta(env.CONFIG_DB);
    if (!meta) {
      return json({ format: 'cgpa-pilot-config-meta', error: 'no-config-published' }, 404);
    }
    return json({ format: 'cgpa-pilot-config-meta', version: meta.version, updatedAt: meta.updatedAt });
  }

  if (method === 'GET' && path === '/api/config/latest') {
    if (!env.CONFIG_DB) {
      return json(
        { format: 'cgpa-pilot-config', error: 'not-configured', message: 'D1 database is not configured on this Worker.' },
        503
      );
    }
    const doc = await readPublished(env.CONFIG_DB);
    if (!doc) {
      return json({ format: 'cgpa-pilot-config', error: 'no-config-published' }, 404);
    }
    return json({
      format: 'cgpa-pilot-config',
      version: doc.version,
      updatedAt: doc.updatedAt,
      payload: doc.payload,
    });
  }

  // ── Admin: single-passcode authentication ──────────────────────────────
  // Minimal, unauthenticated state probe so the login screen can show
  // "sign in" vs "first-time setup" (discloses nothing else).
  if (method === 'GET' && path === '/api/admin/auth-state') {
    if (!env.ADMIN_TOKEN || !env.CONFIG_DB) {
      return json({ format: 'cgpa-pilot-auth-state', hasCredential: false, configured: false }, 503);
    }
    const cred = await readAdminCredential(env.CONFIG_DB);
    return json({ format: 'cgpa-pilot-auth-state', hasCredential: !!cred, configured: true });
  }

  // Sign in with the ONE admin passcode → server-signed session token.
  if (method === 'POST' && path === '/api/admin/login') {
    const guarded = await guardAdminBase(req, env);
    if (guarded !== true) return guarded;
    const cred = await readAdminCredential(env.CONFIG_DB!);
    if (!cred) {
      return json({ ok: false, error: 'no-credential', message: 'No admin passcode has been set. Use first-time setup.' }, 404);
    }
    const body = await parseJsonBody(req);
    if (!body.ok) return body.response;
    const passcode = body.value.passcode;
    if (typeof passcode !== 'string') {
      return json({ ok: false, error: 'invalid-body', message: 'Expected { passcode: string }.' }, 400);
    }
    const valid = await verifyPasscode(passcode, cred);
    if (!valid) {
      return json({ ok: false, error: 'invalid-passcode', message: 'Incorrect admin passcode.' }, 401);
    }
    const session = await signSession(env);
    return json({
      ok: true,
      session: session.token,
      expiresAt: session.expiresAt,
      credential: cred, // digest params (NOT the passcode) — cached for offline sign-in
    });
  }

  // First-time setup: create the single passcode. Operator token required.
  if (method === 'POST' && path === '/api/admin/setup') {
    const guarded = await guardOperator(req, env);
    if (guarded !== true) return guarded;
    if (await readAdminCredential(env.CONFIG_DB!)) {
      return json({ ok: false, error: 'credential-exists', message: 'The admin passcode is already set — sign in instead.' }, 409);
    }
    const body = await parseJsonBody(req);
    if (!body.ok) return body.response;
    const passcode = body.value.passcode;
    if (typeof passcode !== 'string') {
      return json({ ok: false, error: 'invalid-body', message: 'Expected { passcode: string }.' }, 400);
    }
    const policy = passcodePolicy(passcode);
    if (policy) return json({ ok: false, error: 'weak-passcode', message: policy }, 400);
    const cred = await createCredential(passcode);
    const created = await createAdminCredential(env.CONFIG_DB!, cred, new Date().toISOString());
    if (!created) {
      return json({ ok: false, error: 'credential-exists', message: 'The admin passcode is already set — sign in instead.' }, 409);
    }
    const session = await signSession(env);
    return json({ ok: true, session: session.token, expiresAt: session.expiresAt, credential: cred });
  }

  // Change the passcode (requires a current valid credential + new one).
  if (method === 'POST' && path === '/api/admin/passcode') {
    const guarded = await guardAdmin(req, env);
    if (guarded !== true) return guarded;
    const current = await readAdminCredential(env.CONFIG_DB!);
    if (!current) return json({ ok: false, error: 'no-credential', message: 'No admin passcode has been set. Use first-time setup.' }, 404);
    const body = await parseJsonBody(req);
    if (!body.ok) return body.response;
    const cur = body.value.current;
    const next = body.value.next;
    if (typeof cur !== 'string' || typeof next !== 'string') {
      return json({ ok: false, error: 'invalid-body', message: 'Expected { current: string, next: string }.' }, 400);
    }
    if (!(await verifyPasscode(cur, current))) {
      return json({ ok: false, error: 'invalid-current', message: 'The current passcode is incorrect.' }, 401);
    }
    const policy = passcodePolicy(next);
    if (policy) return json({ ok: false, error: 'weak-passcode', message: policy }, 400);
    const rotated = await createCredential(next, current.version + 1);
    await rotateAdminCredential(env.CONFIG_DB!, rotated, new Date().toISOString());
    return json({ ok: true, credential: rotated });
  }

  // ── Admin: authorized write/read endpoints ─────────────────────────────
  const ADMIN_PATHS = ['status', 'catalog', 'publish'] as const;
  const adminName = ADMIN_PATHS.find((n) => path === `/api/admin/${n}`);
  if (adminName) {
    const guarded = await guardAdmin(req, env);
    if (guarded !== true) return guarded;
    if (!env.CONFIG_DB) {
      return json({ ok: false, error: 'not-configured', message: 'D1 database is not configured on this Worker.' }, 503);
    }

    if (adminName === 'status' && method === 'GET') {
      const [pub, adm] = await Promise.all([
        readPublishedMeta(env.CONFIG_DB),
        readAdminCatalogDoc(env.CONFIG_DB),
      ]);
      return json({
        format: 'cgpa-pilot-admin-status',
        hasCatalog: !!adm,
        adminVersion: adm?.version ?? null,
        hasPublished: !!pub,
        publishedVersion: pub?.version ?? null,
        updatedAt: pub?.updatedAt ?? adm?.updatedAt ?? null,
      });
    }

    if (adminName === 'catalog' && method === 'GET') {
      const adm = await readAdminCatalogDoc(env.CONFIG_DB);
      if (!adm) {
        return json({ format: 'cgpa-pilot-admin-catalog', error: 'no-catalog' }, 404);
      }
      return json({
        format: 'cgpa-pilot-admin-catalog',
        version: adm.version,
        updatedAt: adm.updatedAt,
        catalog: adm.catalog,
      });
    }

    if (adminName === 'publish' && method === 'POST') {
      const len = Number(req.headers.get('content-length') ?? 0);
      if (Number.isFinite(len) && len > MAX_BODY_BYTES) {
        return json(
          { ok: false, error: 'payload-too-large', message: `Request body exceeds the ${Math.round(MAX_BODY_BYTES / 1024 / 1024)} MB limit.` },
          413
        );
      }

      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return json({ ok: false, error: 'invalid-json', message: 'Body must be valid JSON.' }, 400);
      }
      const doc = body as { catalog?: unknown; note?: unknown } | null;
      if (!doc || typeof doc !== 'object' || !doc.catalog || typeof doc.catalog !== 'object') {
        return json(
          { ok: false, error: 'invalid-body', message: 'Expected { catalog: <AdminCatalog>, note?: string }.' },
          400
        );
      }

      // Server-side validation (same shared rules as the client).
      const validation = validateAdminCatalogForPublish(doc.catalog);
      if (!validation.ok) {
        return json({ ok: false, error: 'validation', issues: validation.issues }, 400);
      }

      const note =
        typeof doc.note === 'string' && doc.note.trim() ? doc.note.trim().slice(0, 200) : null;
      const catalog = doc.catalog as AdminCatalog;

      const result = await publishAll(env.CONFIG_DB, catalog, note);

      // Defense in depth: the derived student document must itself validate
      // before it is allowed to be served (should never trigger on a
      // validated catalog — but we never serve invalid student config).
      const distCheck = validateDistributionDocument(result.distribution);
      if (!distCheck.ok) {
        return json({ ok: false, error: 'derivation-failed', issues: distCheck.issues }, 500);
      }

      return json({
        ok: true,
        adminVersion: result.adminVersion,
        publishedVersion: result.publishedVersion,
        updatedAt: result.updatedAt,
      });
    }

    return json({ ok: false, error: 'method-not-allowed' }, 405);
  }

  return json({ error: 'not-found', message: `Unknown API path: ${path}` }, 404);
}

// ── PWA identity (dynamic manifest + app icon) ───────────────────────────
// The app logo the admin sets must be reflected EVERYWHERE the app identity
// appears — including the browser tab icon and the installed PWA icon (the
// desktop shortcut / standalone window). Those come from the manifest + an
// icon file, so both are served from the PUBLISHED catalog: the admin's logo
// when set, the bundled icon-512.png otherwise.

/** Parse a `data:image/png|jpeg;base64,...` URL into mime + bytes. */
function dataUrlInfo(dataUrl: string | undefined): { mime: string; bytes: Uint8Array } | null {
  if (!dataUrl || !dataUrl.startsWith('data:image/')) return null;
  const semi = dataUrl.indexOf(';');
  const comma = dataUrl.indexOf(',');
  if (semi === -1 || comma === -1 || comma < semi) return null;
  const mime = dataUrl.slice(5, semi);
  if (!mime.endsWith('png') && !mime.endsWith('jpeg')) return null;
  try {
    const bin = atob(dataUrl.slice(comma + 1));
    if (!bin.length) return null;
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { mime, bytes };
  } catch {
    return null;
  }
}

/** The published catalog's appearance block (null until first publish). */
async function publishedAppearance(env: Env): Promise<{ logo?: string; appName?: string; tagline?: string } | null> {
  if (!env.CONFIG_DB) return null;
  try {
    const doc = await readPublished(env.CONFIG_DB);
    return (doc?.payload.appearance as { logo?: string; appName?: string; tagline?: string } | undefined) ?? null;
  } catch {
    return null;
  }
}

async function handlePwaIdentity(url: URL, req: Request, env: Env): Promise<Response> {
  const appearance = await publishedAppearance(env);
  const logoInfo = dataUrlInfo(appearance?.logo);

  if (url.pathname === '/app-icon') {
    if (logoInfo) {
      return new Response(logoInfo.bytes, {
        status: 200,
        headers: { 'content-type': logoInfo.mime, 'cache-control': 'public, max-age=300' },
      });
    }
    // No custom logo → the bundled default icon (static asset).
    if (env.ASSETS) {
      const res = await env.ASSETS.fetch(new Request(new URL('icon-512.png', url.href).href));
      return new Response(res.body, {
        status: res.ok ? 200 : 404,
        headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=300' },
      });
    }
    return new Response(null, { status: 404 });
  }

  // manifest.webmanifest — app name follows the admin branding, and the
  // icons point at /app-icon (admin logo) or the bundled default.
  const appName = appearance?.appName?.trim() || 'CGPA Pilot';
  const manifest = {
    name: appearance?.appName?.trim()
      ? `${appName} — Navigate Your Academic Future`
      : 'CGPA Pilot — Navigate Your Academic Future',
    short_name: appName,
    description:
      appearance?.tagline?.trim() ||
      'Offline-first CGPA calculator, target planner and flight-path tool. No account, no tracking, nothing stored.',
    start_url: './',
    scope: './',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#eef2f7',
    theme_color: '#4f46e5',
    icons: logoInfo
      ? [
          { src: '/app-icon', sizes: 'any', type: logoInfo.mime, purpose: 'any' },
          { src: '/app-icon', sizes: 'any', type: logoInfo.mime, purpose: 'maskable' },
        ]
      : [
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
  };
  return new Response(JSON.stringify(manifest), {
    status: 200,
    headers: { 'content-type': 'application/manifest+json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

// ── Handler ───────────────────────────────────────────────────────────────

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    let url: URL;
    try {
      url = new URL(req.url);
    } catch {
      return json({ error: 'bad-url' }, 400);
    }

    // CORS preflight for the API (the app is same-origin by default; this
    // keeps separate-origin dev setups and mobile webviews working).
    if (req.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
      return new Response(null, { status: 204, headers: { ...CORS } });
    }

    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(req, url, env);
      } catch {
        return json({ ok: false, error: 'internal', message: 'Unexpected server error.' }, 500);
      }
    }

    // PWA identity: dynamic manifest + app icon (admin branding).
    if (url.pathname === '/manifest.webmanifest' || url.pathname === '/app-icon') {
      try {
        return await handlePwaIdentity(url, req, env);
      } catch {
        return json({ ok: false, error: 'internal', message: 'Unexpected server error.' }, 500);
      }
    }

    // Static site (student + admin) when the Worker hosts the assets.
    if (env.ASSETS) return env.ASSETS.fetch(req);

    return json({ error: 'not-found', message: 'This Worker serves the configuration API only.' }, 404);
  },
} as const;
