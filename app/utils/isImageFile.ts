// True for paths the image-diff viewer can render visually. Mirrors the
// extensions the backend's `image_mime` recognises.
const IMAGE_EXT = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'avif',
  'bmp',
  'ico',
  'svg'
]);

export function isImageFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_EXT.has(ext);
}
