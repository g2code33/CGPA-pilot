// Admin-only helpers to read an uploaded image file into a data URL so it can
// be stored on the non-personal catalog (appearance / logos) without a server.

import { fileToDataUrl, prepareImageForCatalog } from './fileImage';

/**
 * Validate + read an uploaded image file into a data URL. Large/oversized
 * images are automatically resized to a publish-safe size, so adding a logo
 * never bounces on the old ~2 MB wall.
 */
export async function readImageFile(f: File): Promise<string> {
  const prepared = await prepareImageForCatalog(f);
  return fileToDataUrl(prepared.file);
}
