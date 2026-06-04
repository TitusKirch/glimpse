import { describe, expect, it } from 'vitest';
import { isImageFile } from './isImageFile';

describe('isImageFile', () => {
  it('detects the supported image extensions (case-insensitive)', () => {
    for (const n of [
      'a.png',
      'b.JPG',
      'c.jpeg',
      'd.gif',
      'e.webp',
      'f.avif',
      'g.bmp',
      'h.ico',
      'i.svg'
    ]) {
      expect(isImageFile(n)).toBe(true);
    }
  });

  it('is false for non-images and extensionless names', () => {
    for (const n of ['a.ts', 'readme', 'LICENSE', 'a.txt', 'noext']) {
      expect(isImageFile(n)).toBe(false);
    }
  });

  it('uses only the final extension', () => {
    expect(isImageFile('archive.png.txt')).toBe(false);
    expect(isImageFile('photo.final.png')).toBe(true);
  });
});
