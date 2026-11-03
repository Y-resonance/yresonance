import { z } from 'zod';
import { DASHBOARD_GRID } from './layout';

/**
 * Widths the Worker resizes images to. The widget's `srcset` and the asset route's allowlist both
 * read this list, so every viewer gets one of a few stored variants and stray widths never create
 * new (billed) transformations.
 */
export const IMAGE_WIDTHS = [320, 640, 960, 1280, 1920, 2560] as const;

// The Cloudflare Images binding rejects larger inputs, so deployments may lower this but never
// raise it.
export const MAX_IMAGE_UPLOAD_BYTES = 20_000_000;

export const imageFormatSchema = z.enum(['png', 'jpeg', 'webp', 'gif', 'avif']);
export type ImageFormat = z.infer<typeof imageFormatSchema>;

export const imageContentTypes = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
} as const satisfies Record<ImageFormat, string>;

export const svgUploadMessage =
  "SVG files aren't supported yet. Export the image as PNG or WebP and upload it again.";
export const unsupportedImageMessage = 'Upload a PNG, JPEG, WebP, GIF or AVIF image.';

export function imageTooLargeMessage(limitBytes: number) {
  return `Images can be at most ${formatMegabytes(limitBytes)}.`;
}

export function formatMegabytes(bytes: number) {
  return `${Math.floor(bytes / 100_000) / 10} MB`;
}

/** Workspace image metadata as returned by `listAssets` and `getDashboard`. */
export interface ImageAsset {
  id: string;
  name: string;
  contentType: string;
  size: number;
  width: number;
  height: number;
  createdAt: string;
}

export type ImageUploadRejection = 'svg' | 'too_large' | 'unsupported_format';

/**
 * Checks a file the editor picked before any byte is sent. The server checks the real signature
 * again; this only spares the editor a pointless upload.
 */
export function imageUploadRejection(
  file: { name: string; type: string; size: number },
  limitBytes: number,
): { reason: ImageUploadRejection; message: string } | undefined {
  if (file.type === 'image/svg+xml' || /\.svgz?$/iu.test(file.name))
    return { reason: 'svg', message: svgUploadMessage };
  if (file.size > limitBytes)
    return { reason: 'too_large', message: imageTooLargeMessage(limitBytes) };
  if (file.type && !Object.values(imageContentTypes).includes(file.type as never))
    return { reason: 'unsupported_format', message: unsupportedImageMessage };
  return undefined;
}

/** Reads the format from the file's first bytes. Extensions and browser MIME types are not trusted. */
export function detectImageFormat(bytes: Uint8Array): ImageFormat | 'svg' | undefined {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return 'gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  if (ascii(4, 8) === 'ftyp') {
    // The major brand and the compatible brands that follow it all live in the ftyp box.
    const boxSize = new DataView(bytes.buffer, bytes.byteOffset).getUint32(0);
    const brands = ascii(8, Math.min(boxSize, bytes.length));
    if (/avif|avis/u.test(brands)) return 'avif';
  }
  if (/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg/iu.test(new TextDecoder().decode(bytes)))
    return 'svg';
  return undefined;
}

function startsWith(bytes: Uint8Array, prefix: number[]) {
  return prefix.every((byte, index) => bytes[index] === byte);
}

/**
 * Width and height from an AVIF header's `ispe` property. Used when the Images binding cannot read
 * AVIF, which needs an Enterprise plan.
 */
export function avifDimensions(bytes: Uint8Array) {
  for (let index = 4; index + 16 <= bytes.length; index++) {
    if (
      bytes[index] === 0x69 &&
      bytes[index + 1] === 0x73 &&
      bytes[index + 2] === 0x70 &&
      bytes[index + 3] === 0x65
    ) {
      const view = new DataView(bytes.buffer, bytes.byteOffset + index + 8, 8);
      const width = view.getUint32(0);
      const height = view.getUint32(4);
      return width && height ? { width, height } : undefined;
    }
  }
  return undefined;
}

/**
 * The stored variant width for a requested width, or undefined when the original is served:
 * widths outside IMAGE_WIDTHS, widths at or above the original's, and AVIF sources.
 */
export function variantWidth(requested: number, asset: { width: number; contentType: string }) {
  if (asset.contentType === imageContentTypes.avif) return undefined;
  if (!IMAGE_WIDTHS.includes(requested as never)) return undefined;
  return requested < asset.width ? requested : undefined;
}

/** AVIF or WebP when the browser accepts it, otherwise the original's format. */
export function variantFormat(accept: string | null, originalFormat: ImageFormat): ImageFormat {
  const accepted = (accept ?? '').toLowerCase();
  if (accepted.includes('image/avif')) return 'avif';
  if (accepted.includes('image/webp')) return 'webp';
  return originalFormat;
}

export function imageFormatFromContentType(contentType: string) {
  return (Object.entries(imageContentTypes) as Array<[ImageFormat, string]>).find(
    ([, type]) => type === contentType,
  )?.[0];
}

export function imageAssetKey(workspacePrefix: string, assetId: string, variant = 'original') {
  return `${workspacePrefix}assets/${assetId}/${variant}`;
}

export function imageAssetUrl(
  dashboardId: string,
  assetId: string,
  options: { width?: number; shareToken?: string } = {},
) {
  const search = new URLSearchParams();
  if (options.width) search.set('w', String(options.width));
  if (options.shareToken) search.set('share', options.shareToken);
  const query = search.toString();
  return `/api/dashboards/${encodeURIComponent(dashboardId)}/assets/${encodeURIComponent(assetId)}${query ? `?${query}` : ''}`;
}

/** Every IMAGE_WIDTHS entry below the original's width, plus the original itself. */
export function imageSrcSet(originalWidth: number, url: (width?: number) => string) {
  return [
    ...IMAGE_WIDTHS.filter((width) => width < originalWidth).map(
      (width) => `${url(width)} ${width}w`,
    ),
    `${url()} ${originalWidth}w`,
  ].join(', ');
}

/**
 * The rendered width the browser should pick a variant for. It follows the dashboard grid: one
 * column below `md`, 12 columns inside the 100rem page from `md` up. A cropped (`cover`) image is
 * wider than its box when it is wider in aspect, so it asks for a proportionally larger variant.
 */
export function imageSizes(
  layout: { width: number; height: number },
  image: { width: number; height: number },
  fit: 'contain' | 'cover',
) {
  const span = Math.min(layout.width, DASHBOARD_GRID.cols);
  const [gap] = DASHBOARD_GRID.margin;
  const boxWidth = ((1600 - 48) * span) / DASHBOARD_GRID.cols;
  const boxHeight = layout.height * DASHBOARD_GRID.rowHeight + (layout.height - 1) * gap;
  const scale =
    fit === 'cover' ? Math.max(1, image.width / image.height / (boxWidth / boxHeight)) : 1;
  const factor = scale === 1 ? '' : ` * ${Math.round(scale * 100) / 100}`;
  const mobile = factor ? `calc((100vw - 32px)${factor})` : 'calc(100vw - 32px)';
  return `(max-width: 767px) ${mobile}, calc((min(100vw, 100rem) - 48px) * ${span} / 12${factor})`;
}
