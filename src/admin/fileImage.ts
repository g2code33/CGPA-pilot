// Small browser helper to turn an uploaded image file into a data URL so it can
// be stored on the catalog (non-personal branding/logo) without a server.

export const ACCEPT_IMAGE = 'image/png,image/jpeg,image/jpg,image/webp';

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // ~2 MB
/** Branding images are displayed small; this keeps them tiny and publish-safe. */
export const MAX_IMAGE_DIMENSION = 512;

export function isImageFile(f: File): boolean {
  return /^image\/(png|jpe?g|webp)$/i.test(f.type) || /\.(png|jpe?g|webp)$/i.test(f.name);
}

export type ImageFileErrorCode = 'not-an-image' | 'too-large' | 'unreadable';

/** Typed error so the caller can keep the old machine-readable result codes. */
export class ImageFileError extends Error {
  readonly code: ImageFileErrorCode;
  constructor(code: ImageFileErrorCode, message: string) {
    super(message);
    this.name = 'ImageFileError';
    this.code = code;
  }
}

export function fileToDataUrl(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read that image.'));
    reader.readAsDataURL(f);
  });
}

/**
 * Result of preparing an uploaded image. When the original was larger than the
 * app's limit (or extremely large in dimensions) it is downscaled to a
 * publish-safe file before the upload/R2 step.
 */
export interface PreparedImage {
  /** The file that should actually be stored/uploaded. */
  file: File;
  /** True when the original was resized/re-encoded. */
  resized: boolean;
  /** Human-readable original size (for a friendly "resized for you" note). */
  originalBytes: number;
}

/**
 * Load an image file and downscale it to a publish-safe max dimension/byte
 * size. A small file that is already within limits is returned unchanged.
 * This is what removes the old "This image is 2.1 MB — keep it under 2.1 MB"
 * wall: the admin can pick a large logo/icon and the app quietly makes it fit.
 */
export async function prepareImageForCatalog(file: File): Promise<PreparedImage> {
  if (!isImageFile(file)) {
    throw new ImageFileError('not-an-image', 'Please choose a PNG, JPEG or WebP image.');
  }
  // Small file: no resize needed. Do this BEFORE touching the DOM so the
  // helper also works in unit tests/Node where there is no Image/canvas.
  if (file.size <= MAX_IMAGE_BYTES) {
    return { file, resized: false, originalBytes: file.size };
  }

  // From here we must downscale. If this environment cannot decode/re-encode
  // (Node test runner), keep the historical hard-too-large behaviour.
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    throw new ImageFileError(
      'too-large',
      `This image is ${(file.size / 1_000_000).toFixed(1)} MB — keep it under ${(MAX_IMAGE_BYTES / 1_000_000).toFixed(1)} MB.`
    );
  }

  const url = URL.createObjectURL(file);
  let img: HTMLImageElement;
  try {
    img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new ImageFileError('unreadable', 'Could not read that image.'));
      el.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }

  const scale512 = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(img.width, img.height));
  // Already small enough in bytes AND dimensions → no re-encode.
  if (file.size <= MAX_IMAGE_BYTES && scale512 >= 1) {
    return { file, resized: false, originalBytes: file.size };
  }

  const attempts: { max: number; quality: number; forceJpeg?: boolean }[] = [
    { max: MAX_IMAGE_DIMENSION, quality: 0.86 },
    { max: 384, quality: 0.82 },
    { max: 256, quality: 0.78 },
  ];
  const outType =
    file.type === 'image/png' ? 'image/png' : file.type === 'image/webp' ? 'image/webp' : 'image/jpeg';

  for (const a of attempts) {
    const blob = await renderScaled(file, a.max, a.quality, outType);
    if (blob && blob.size <= MAX_IMAGE_BYTES) {
      return {
        file: new File([blob], replaceExt(file.name, extFor(outType)), { type: outType }),
        resized: true,
        originalBytes: file.size,
      };
    }
  }

  throw new ImageFileError(
    'too-large',
    `That image is ${(file.size / 1_000_000).toFixed(1)} MB and could not be compressed to the app's ~2 MB limit. Resize it to about 512×512 (JPEG/PNG) and try again.`
  );
}

function renderScaled(
  file: File,
  max: number,
  quality: number,
  outType: string
): Promise<Blob | null> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not resize this image.');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(resolve, outType, quality);
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image.'));
    };
    img.src = url;
  });
}

function extFor(type: string): string {
  if (type === 'image/png') return 'png';
  if (type === 'image/webp') return 'webp';
  return 'jpg';
}

function replaceExt(name: string, ext: string): string {
  const base = name.replace(/\.[a-z0-9]+$/i, '');
  return `${base}.${ext}`;
}
