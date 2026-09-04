// ─────────────────────────────────────────────────────────────────────────
// CONFIG-AS-CODE SEED — the single durable home for the admin catalog.
//
// The CGPA PILOT app is offline-first and deliberately has NO backend: the
// only thing that survives every deploy/push and reaches every user is the
// configuration that ships INSIDE the build. This module is that "baked-in"
// seed. It loads the committed `admin-catalog.json` (institutions + curricula
// + branding) and exposes it both to:
//   • the ADMIN console (as the catalog it boots / "resets to"), and
//   • the STUDENT app (as the bundled universities / curricula defaults).
//
// Because the seed is committed to the repository, administrator data becomes
// part of the shipped app: once a published admin catalog is exported and the
// file below is updated + pushed, every user on every device receives it —
// it can no longer be lost to a cleared browser or a fresh deploy origin.
//
// The hand-authored TypeScript seeds in ./institutions and ./curricula remain
// the FALLBACK when the committed JSON is missing or empty, so an incomplete
// checkout never leaves the app without a valid configuration.
// ─────────────────────────────────────────────────────────────────────────

import type { University, CurriculumVersion } from './types';
import type { AdminCatalog } from '../admin/adminStorage';
import committed from './seed/admin-catalog.json';
import { ucc } from './institutions/ucc';
import { uccPharmDCurriculum } from './curricula/ucc-pharmd';

/** The legacy hand-authored catalog used only when no committed JSON is valid. */
export function legacySeedCatalog(): AdminCatalog {
  return {
    universities: [ucc],
    curricula: [uccPharmDCurriculum],
    trash: [],
  };
}

interface JsonCatalog {
  universities?: unknown[];
  curricula?: unknown[];
}

// TypeScript infers the JSON's literal type; validate shape then widen it to
// the typed catalog. An empty/invalid committed file is ignored (fallback).
const json = committed as unknown as JsonCatalog;
const validCommitted =
  Array.isArray(json?.universities) &&
  json.universities.length > 0 &&
  Array.isArray(json?.curricula);

/** The committed catalog, or null when the JSON file is empty/invalid. */
export const COMMITTED_CATALOG: AdminCatalog | null = validCommitted
  ? (committed as unknown as AdminCatalog)
  : null;

/** The bundled configuration actually used (committed JSON, else TS fallback). */
export const SEED_ADMIN_CATALOG: AdminCatalog =
  COMMITTED_CATALOG ?? legacySeedCatalog();

/** Student-app default universities (published institutions to expose). */
export const SEED_UNIVERSITIES: University[] = SEED_ADMIN_CATALOG.universities;

/** Student-app default curricula (all versions bundled for offline use). */
export const SEED_CURRICULA: CurriculumVersion[] = SEED_ADMIN_CATALOG.curricula;

/** Admin-set branding shipped with the bundle (used when no local override). */
export const SEED_APPEARANCE = SEED_ADMIN_CATALOG.appearance;
