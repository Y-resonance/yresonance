import { and, desc, eq, inArray } from 'drizzle-orm';
import { env } from 'cloudflare:workers';
import { dashboardAssets, workspaces } from '#/db/schema';
import { dashboardWidgets, type DashboardDocument } from '#/domain/schema';
import {
  avifDimensions,
  detectImageFormat,
  imageAssetKey,
  imageContentTypes,
  imageFormatFromContentType,
  imageTooLargeMessage,
  MAX_IMAGE_UPLOAD_BYTES,
  svgUploadMessage,
  unsupportedImageMessage,
  variantFormat,
  variantWidth,
  type ImageAsset,
  type ImageFormat,
} from '#/domain/image-assets';
import { recordProductMetric } from '#/observability';
import { authorizeDashboard } from './dashboard-access.server';
import { database } from './database.server';
import { ApiError } from './errors';

// Assets never change: a new upload gets a new id. Responses stay private because every request is
// authorized, and Workers Cache stays off for these routes since its key ignores cookies.
const assetHeaders = {
  'cache-control': 'private, max-age=31536000, immutable',
  vary: 'Accept',
  'x-content-type-options': 'nosniff',
};

// Enough bytes for every supported signature and for an AVIF `ispe` box.
const HEADER_BYTES = 64 * 1024;

const assetColumns = {
  id: dashboardAssets.id,
  name: dashboardAssets.name,
  contentType: dashboardAssets.contentType,
  size: dashboardAssets.size,
  width: dashboardAssets.width,
  height: dashboardAssets.height,
  createdAt: dashboardAssets.createdAt,
};

/** The deployment's upload limit. `IMAGE_UPLOAD_MAX_BYTES` can lower the 20 MB default. */
export function imageUploadLimit() {
  const configured = Number(env.IMAGE_UPLOAD_MAX_BYTES);
  return Number.isSafeInteger(configured) && configured > 0
    ? Math.min(configured, MAX_IMAGE_UPLOAD_BYTES)
    : MAX_IMAGE_UPLOAD_BYTES;
}

export async function listAssets(dashboardId: string) {
  const access = await authorizeDashboard(dashboardId, 'editor');
  const assets: ImageAsset[] = await database()
    .select(assetColumns)
    .from(dashboardAssets)
    .where(eq(dashboardAssets.workspaceId, access.document.workspaceId))
    .orderBy(desc(dashboardAssets.createdAt));
  return { assets, uploadLimitBytes: imageUploadLimit() };
}

function referencedAssetIds(document: DashboardDocument) {
  return new Set(
    dashboardWidgets(document).flatMap((widget) =>
      widget.definition.type === 'image' && widget.definition.assetId
        ? [widget.definition.assetId]
        : [],
    ),
  );
}

/** Dimensions for the images a (possibly viewer-filtered) dashboard document shows. */
export async function dashboardImageAssets(document: DashboardDocument): Promise<ImageAsset[]> {
  const ids = [...referencedAssetIds(document)];
  if (!ids.length) return [];
  return database()
    .select(assetColumns)
    .from(dashboardAssets)
    .where(
      and(eq(dashboardAssets.workspaceId, document.workspaceId), inArray(dashboardAssets.id, ids)),
    );
}

export async function assertWorkspaceAsset(workspaceId: string, assetId: string) {
  const asset = await database().query.dashboardAssets.findFirst({
    columns: { id: true },
    where: and(eq(dashboardAssets.id, assetId), eq(dashboardAssets.workspaceId, workspaceId)),
  });
  if (!asset)
    throw new ApiError(
      400,
      'unknown_asset',
      'The image does not exist in this workspace. Use listAssets to find uploaded images.',
    );
}

/**
 * Streams an editor's upload into R2, then checks the stored bytes: the signature must be one of
 * the supported formats and the Images binding must read its dimensions. Rejected files are
 * deleted again, so nothing is kept for SVGs or files that only look like images.
 */
export async function uploadImageAsset(request: Request, dashboardId: string) {
  const startedAt = Date.now();
  const access = await authorizeDashboard(dashboardId, 'editor');
  const session = access.session!;
  const workspaceId = session.workspace.id;
  const size = Number(request.headers.get('content-length'));
  const limit = imageUploadLimit();
  const reject = (status: number, reason: string, message: string, format?: string) => {
    trackUpload({ result: 'rejected', reason, format, size, dashboardId, startedAt, workspaceId });
    return new ApiError(status, `image_${reason}`, message);
  };
  if (!Number.isSafeInteger(size) || size <= 0)
    throw reject(411, 'length_required', 'A valid Content-Length is required.');
  if (size > limit) throw reject(413, 'too_large', imageTooLargeMessage(limit));
  if (!request.body) throw reject(400, 'empty', 'Upload body is required.');

  const name =
    (new URL(request.url).searchParams.get('name') ?? '').trim().slice(0, 200) || 'Image';
  const assetId = `asset_${crypto.randomUUID()}`;
  const key = imageAssetKey(session.workspace.r2Prefix, assetId);
  await env.DATA.put(key, request.body, { onlyIf: { etagDoesNotMatch: '*' } });
  try {
    const head = await env.DATA.get(key, { range: { offset: 0, length: HEADER_BYTES } });
    const header = new Uint8Array(await head!.arrayBuffer());
    const format = detectImageFormat(header);
    if (format === 'svg') throw reject(415, 'svg', svgUploadMessage, 'svg');
    if (!format) throw reject(415, 'unsupported_format', unsupportedImageMessage);
    const dimensions = await imageDimensions(key, format, header);
    if (!dimensions)
      throw reject(415, 'unreadable', 'This file could not be read as an image.', format);
    const asset: ImageAsset = {
      id: assetId,
      name,
      contentType: imageContentTypes[format],
      size,
      ...dimensions,
      createdAt: new Date().toISOString(),
    };
    await database()
      .insert(dashboardAssets)
      .values({ ...asset, workspaceId, uploadedBy: session.userId });
    trackUpload({ result: 'success', format, size, dashboardId, startedAt, workspaceId });
    return asset;
  } catch (error) {
    await env.DATA.delete(key);
    throw error;
  }
}

async function imageDimensions(key: string, format: ImageFormat, header: Uint8Array) {
  const object = await env.DATA.get(key);
  try {
    const info = await env.IMAGES.info(object!.body);
    if ('width' in info && info.width > 0 && info.height > 0)
      return { width: info.width, height: info.height };
  } catch (error) {
    if (format !== 'avif') {
      console.info('yresonance.image_info_failed', { format, errorCode: imagesErrorCode(error) });
      return undefined;
    }
  }
  // AVIF input needs an Enterprise plan, so its header provides the size instead.
  return format === 'avif' ? avifDimensions(header) : undefined;
}

function trackUpload(event: {
  result: 'success' | 'rejected';
  reason?: string;
  format?: string;
  size: number;
  dashboardId: string;
  workspaceId: string;
  startedAt: number;
}) {
  const durationMs = Date.now() - event.startedAt;
  console.info('yresonance.image_upload', {
    result: event.result,
    reason: event.reason,
    format: event.format,
    sizeBytes: event.size,
    dashboardId: event.dashboardId,
    durationMs,
  });
  recordProductMetric('image_upload', {
    labels: [event.result, event.reason ?? '', event.format ?? ''],
    numbers: [Number.isFinite(event.size) ? event.size : 0, durationMs],
    index: event.workspaceId,
  });
}

/**
 * Serves an image to anyone who can view the dashboard that shows it. Allowed widths get a
 * resized AVIF/WebP variant that is created once and stored next to the original; everything
 * else, including transform failures and the monthly quota (9422), falls back to the original.
 */
export async function serveImageAsset(request: Request, dashboardId: string, assetId: string) {
  const url = new URL(request.url);
  const access = await authorizeDashboard(
    dashboardId,
    'viewer',
    url.searchParams.get('share') ?? undefined,
  );
  const notFound = new ApiError(404, 'asset_not_found', 'Image not found.');
  if (!referencedAssetIds(access.document).has(assetId)) throw notFound;
  const [asset] = await database()
    .select({ ...assetColumns, prefix: workspaces.r2Prefix })
    .from(dashboardAssets)
    .innerJoin(workspaces, eq(workspaces.id, dashboardAssets.workspaceId))
    .where(
      and(
        eq(dashboardAssets.id, assetId),
        eq(dashboardAssets.workspaceId, access.document.workspaceId),
      ),
    )
    .limit(1);
  if (!asset) throw notFound;

  const requestedWidth = Number(url.searchParams.get('w') ?? 0);
  const log = (served: {
    variant: 'stored' | 'created' | 'original';
    bytes: number;
    format: string;
    width: number;
    fallbackReason?: string;
    errorCode?: number;
  }) => {
    console.info('yresonance.image_variant', {
      dashboardId,
      assetId,
      requestedWidth,
      servedWidth: served.width,
      format: served.format,
      variant: served.variant,
      fallbackReason: served.fallbackReason,
      errorCode: served.errorCode,
      originalBytes: asset.size,
      servedBytes: served.bytes,
    });
    recordProductMetric('image_variant', {
      labels: [served.variant, served.fallbackReason ?? '', served.format],
      numbers: [requestedWidth, asset.size, served.bytes],
      index: access.document.workspaceId,
    });
  };
  const originalKey = imageAssetKey(asset.prefix, asset.id);
  const originalFormat = imageFormatFromContentType(asset.contentType)!;
  const serveOriginal = async (fallbackReason: string, errorCode?: number) => {
    const original = await env.DATA.get(originalKey);
    if (!original) throw notFound;
    log({
      variant: 'original',
      bytes: original.size,
      format: originalFormat,
      width: asset.width,
      fallbackReason,
      errorCode,
    });
    return new Response(original.body, {
      headers: {
        ...assetHeaders,
        // A failed transform can recover, for example when the monthly quota resets, so the
        // browser must ask for this width again. The other fallbacks never change.
        ...(fallbackReason === 'transform_failed'
          ? { 'cache-control': 'private, max-age=300' }
          : {}),
        'content-type': asset.contentType,
        'content-length': String(original.size),
      },
    });
  };

  const width = variantWidth(requestedWidth, asset);
  if (!width)
    return serveOriginal(
      !requestedWidth
        ? 'original_requested'
        : originalFormat === 'avif'
          ? 'avif_source'
          : requestedWidth >= asset.width
            ? 'at_or_above_original'
            : 'width_not_allowed',
    );
  const format = variantFormat(request.headers.get('accept'), originalFormat, width);
  const variantKey = imageAssetKey(asset.prefix, asset.id, `w${width}.${format}`);
  const variantHeaders = { ...assetHeaders, 'content-type': imageContentTypes[format] };
  const stored = await env.DATA.get(variantKey);
  if (stored) {
    const storedType = stored.httpMetadata?.contentType ?? variantHeaders['content-type'];
    log({
      variant: 'stored',
      bytes: stored.size,
      format: imageFormatFromContentType(storedType) ?? storedType,
      width,
    });
    return new Response(stored.body, {
      headers: {
        ...variantHeaders,
        'content-type': storedType,
        'content-length': String(stored.size),
      },
    });
  }

  const original = await env.DATA.get(originalKey);
  if (!original) throw notFound;
  let bytes: ArrayBuffer;
  // Cloudflare may encode another format than requested, so the result's own type is stored.
  let contentType: string;
  try {
    const result = await env.IMAGES.input(original.body)
      .transform({ width, fit: 'scale-down' })
      .output({ format: imageContentTypes[format], quality: 80 });
    contentType = result.contentType();
    // Variants are small next to the 20 MB originals; R2 needs their length before storing.
    bytes = await result.response().arrayBuffer();
    await env.DATA.put(variantKey, bytes, { httpMetadata: { contentType } });
  } catch (error) {
    return serveOriginal('transform_failed', imagesErrorCode(error));
  }
  log({
    variant: 'created',
    bytes: bytes.byteLength,
    format: imageFormatFromContentType(contentType) ?? contentType,
    width,
  });
  return new Response(bytes, {
    headers: {
      ...variantHeaders,
      'content-type': contentType,
      'content-length': String(bytes.byteLength),
    },
  });
}

// The Images binding throws ImagesError with a numeric code, for example 9422 when the monthly
// transformation quota is used up.
function imagesErrorCode(error: unknown) {
  const code = (error as Partial<ImagesError> | undefined)?.code;
  return typeof code === 'number' ? code : undefined;
}
