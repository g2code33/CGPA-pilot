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

import { fileToDataUrl, isImageFile, MAX_IMAGE_BYTES } from './fileImage';
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
  if (!isImageFile(file)) {
    return { ok: false, error: 'not-an-image', message: 'Please choose a PNG, JPEG or WebP image.' };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      error: 'too-large',
      message: `This image is ${humanBytes(file.size)} — keep it under ${humanBytes(MAX_IMAGE_BYTES)}.`,
    };
  }

  const uploaded = await uploadAdminAsset(file, deps);
  if (uploaded.ok) {
    return {
      ok: true,
      image: { value: uploaded.ref, isDataUrl: false, bytes: uploaded.bytes },
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
    const dataUrl = await fileToDataUrl(file);
    return {
      ok: true,
      image: {
        value: dataUrl,
        isDataUrl: true,
        bytes: file.size,
        r2NotConfigured: uploaded.error === 'r2-not-configured',
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
