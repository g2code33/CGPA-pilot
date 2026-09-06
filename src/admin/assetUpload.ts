// ─────────────────────────────────────────────────────────────────────────
// assetUpload — how the admin console stores an uploaded image (v1.0.20).
//
//   1. R2 mode — the image goes to the Worker's R2 bucket and the catalog
//      keeps only a tiny `asset:<key>` reference (the catalog no longer
//      bloats — this removes the ~2 MB publish-limit pressure).
//   2. Legacy fallback — when the Worker has no R2 binding (503
//      `r2-not-configured`) or is unreachable (offline / not yet deployed),
//      the image is stored as a base64 data URL exactly like before, so the
//      console keeps working end-to-end until R2 is set up.
//
// The `r2NotConfigured` flag lets the UI show the one-line setup hint
// (and the full guide lives in the Storage view).
// ─────────────────────────────────────────────────────────────────────────

import { fileToDataUrl, prepareImageForCatalog, ImageFileError, MAX_IMAGE_BYTES } from './fileImage';
import { humanBytes } from './catalogSize';
import { uploadAdminAsset, type AdminApiDeps } from './adminApi';

/** The value that goes into the catalog for an uploaded image. */
export interface StoredImage {
  /** `asset:<key>` (R2) or `data:image/…` (legacy fallback). */
  value: string;
  /** True when the image lives inside the catalog as base64. */
  isDataUrl: boolean;
  /** Decoded image bytes. */
  bytes: number;
  /** Set when the fallback happened because R2 is not configured yet. */
  r2NotConfigured?: boolean;
  /** Set when the original was larger than the safe limit and resized. */
  resized?: boolean;
  /** Original file bytes before any resize. */
  originalBytes?: number;
}

export type ImageUploadOutcome =
  | { ok: true; image: StoredImage }
  | { ok: false; error: string; message: string };

/**
 * Upload the chosen image and return what should be stored in the catalog.
 * Never rejects: every failure (wrong file type, oversize, offline, sign-in
 * required) is returned as a structured result the caller can toast.
 */
export async function uploadImageForCatalog(file: File, deps: AdminApiDeps = {}): Promise<ImageUploadOutcome> {
  // Auto-resize a large/oversized image BEFORE the size gate: the admin should
  // be able to pick a 2 MB+ logo/icon and have the app make it publish-safe
  // (instead of a hard "keep it under 2.1 MB" system prompt). A small file is
  // returned unchanged.
  let prepared;
  try {
    prepared = await prepareImageForCatalog(file);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof ImageFileError ? e.code : 'unreadable',
      message: e instanceof Error ? e.message : 'Could not read that image.',
    };
  }
  const fileToStore = prepared.file;
  const originalBytes = prepared.originalBytes;
  if (fileToStore.size > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      error: 'too-large',
      message: `This image is ${humanBytes(fileToStore.size)} — keep it under ${humanBytes(MAX_IMAGE_BYTES)}.`,
    };
  }

  const uploaded = await uploadAdminAsset(fileToStore, deps);
  if (uploaded.ok) {
    return {
      ok: true,
      image: {
        value: uploaded.ref,
        isDataUrl: false,
        bytes: uploaded.bytes,
        resized: prepared.resized,
        originalBytes,
      },
    };
  }

  // Not signed in → nothing we can store without the session.
  if (uploaded.error === 'unauthorized') {
    return { ok: false, error: 'unauthorized', message: uploaded.message ?? 'Sign in first.' };
  }

  // R2 not configured (503) or backend unreachable → legacy data-URL
  // storage, exactly as before this version. The catalog stays a valid
  // document either way.
  try {
    const dataUrl = await fileToDataUrl(fileToStore);
    return {
      ok: true,
      image: {
        value: dataUrl,
        isDataUrl: true,
        bytes: fileToStore.size,
        r2NotConfigured: uploaded.error === 'r2-not-configured',
        resized: prepared.resized,
        originalBytes,
      },
    };
  } catch {
    return { ok: false, error: 'read-failed', message: 'Could not read that image.' };
  }
}

/**
 * The admin-facing note when an upload fell back to in-catalog storage
 * because R2 is not set up yet.
 */
export function r2FallbackNote(): string {
  return 'R2 is not set up yet — this image was stored inside the catalog. Finish the 3-step setup in the Storage view.';
}
