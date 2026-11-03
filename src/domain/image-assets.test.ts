import { describe, expect, test } from 'vitest';
import {
  avifDimensions,
  detectImageFormat,
  imageSizes,
  imageSrcSet,
  imageUploadRejection,
  variantFormat,
  variantWidth,
} from './image-assets';

const bytes = (...parts: Array<string | number[]>) =>
  Uint8Array.from(
    parts.flatMap((part) =>
      typeof part === 'string' ? [...part].map((character) => character.charCodeAt(0)) : part,
    ),
  );

describe('image formats', () => {
  test('recognizes formats by signature, not by name', () => {
    expect(detectImageFormat(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    expect(detectImageFormat(bytes('GIF89a'))).toBe('gif');
    expect(detectImageFormat(bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 '))).toBe('webp');
    expect(detectImageFormat(bytes([0, 0, 0, 0x1c], 'ftypmif1', [0, 0, 0, 0], 'avifmiaf'))).toBe(
      'avif',
    );
    expect(detectImageFormat(bytes('<?xml version="1.0"?>\n<svg>'))).toBe('svg');
    expect(detectImageFormat(bytes('%PDF-1.7'))).toBeUndefined();
  });

  test('reads AVIF dimensions from its ispe box', () => {
    const header = bytes(
      [0, 0, 0, 0x14],
      'ispe',
      [0, 0, 0, 0],
      [0, 0, 0x07, 0x80],
      [0, 0, 0x04, 0x38],
    );
    expect(avifDimensions(header)).toEqual({ width: 1920, height: 1080 });
  });

  test('rejects SVG, oversized and unsupported files before upload', () => {
    const limit = 20_000_000;
    expect(imageUploadRejection({ name: 'logo.svg', type: '', size: 10 }, limit)?.reason).toBe(
      'svg',
    );
    expect(
      imageUploadRejection({ name: 'big.png', type: 'image/png', size: limit + 1 }, limit),
    ).toEqual({ reason: 'too_large', message: 'Images can be at most 20 MB.' });
    expect(
      imageUploadRejection({ name: 'a.tiff', type: 'image/tiff', size: 10 }, limit)?.reason,
    ).toBe('unsupported_format');
    expect(
      imageUploadRejection({ name: 'a.webp', type: 'image/webp', size: 10 }, limit),
    ).toBeUndefined();
  });
});

describe('responsive variants', () => {
  test('resizes only to listed widths below the original, never AVIF sources', () => {
    const png = { width: 1500, contentType: 'image/png' };
    expect(variantWidth(960, png)).toBe(960);
    expect(variantWidth(1000, png)).toBeUndefined();
    expect(variantWidth(1920, png)).toBeUndefined();
    expect(variantWidth(640, { width: 1500, contentType: 'image/avif' })).toBeUndefined();
  });

  test('prefers AVIF, then WebP, then the original format', () => {
    expect(variantFormat('image/avif,image/webp,*/*', 'png')).toBe('avif');
    expect(variantFormat('image/webp,*/*', 'jpeg')).toBe('webp');
    expect(variantFormat('*/*', 'gif')).toBe('gif');
  });

  test('srcset lists smaller variants plus the original width', () => {
    expect(imageSrcSet(1000, (width) => (width ? `/a?w=${width}` : '/a'))).toBe(
      '/a?w=320 320w, /a?w=640 640w, /a?w=960 960w, /a 1000w',
    );
  });

  test('sizes follow the grid span and widen for cropped wide images', () => {
    expect(imageSizes({ width: 6, height: 3 }, { width: 400, height: 400 }, 'contain')).toBe(
      '(max-width: 767px) calc(100vw - 32px), calc((min(100vw, 100rem) - 48px) * 6 / 12)',
    );
    // A 4:1 banner cropped into a box of about 388×248 px shows only its middle 39%.
    expect(imageSizes({ width: 3, height: 4 }, { width: 2000, height: 500 }, 'cover')).toBe(
      '(max-width: 767px) calc((100vw - 32px) * 2.56), calc((min(100vw, 100rem) - 48px) * 3 / 12 * 2.56)',
    );
  });
});
