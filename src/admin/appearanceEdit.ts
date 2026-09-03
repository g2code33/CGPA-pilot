// Admin-only helpers to read an uploaded image file into a data URL so it can
// be stored on the non-personal catalog (appearance / logos) without a server.

import { fileToDataUrl, isImageFile, MAX_IMAGE_BYTES } from './fileImage';

/** Validate + read an uploaded image file into a data URL (rejects > ~2 MB). */
export async function readImageFile(f: File): Promise<string> {
  if (!isImageFile(f)) {
    throw new Error('Please choose a PNG or JPEG image.');
  }
  if (f.size > MAX_IMAGE_BYTES) {
    throw new Error('That image is too large — keep it under ~2 MB.');
  }
  return fileToDataUrl(f);
}
