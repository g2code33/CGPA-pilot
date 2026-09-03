// Small browser helper to turn an uploaded image file into a data URL so it can
// be stored on the catalog (non-personal branding/logo) without a server.

export const ACCEPT_IMAGE = 'image/png,image/jpeg,image/jpg,image/webp';

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // ~2 MB

export function isImageFile(f: File): boolean {
  return /^image\/(png|jpe?g|webp)$/i.test(f.type) || /\.(png|jpe?g|webp)$/i.test(f.name);
}

export function fileToDataUrl(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read that image.'));
    reader.readAsDataURL(f);
  });
}
