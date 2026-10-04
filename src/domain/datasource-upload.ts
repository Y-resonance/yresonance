import { z } from 'zod';
import { dataSourceLocationSchema } from './schema.ts';

export const MAX_DATASOURCE_FILE_BYTES = 100_000_000;
const MAX_CLEANUP_TOKEN_AGE_SECONDS = 24 * 60 * 60;
export const datasourceUploadFormatSchema = z.enum(['csv', 'parquet']);

export const prepareDatasourceUploadSchema = z
  .object({
    fileName: z.string().trim().min(1),
    fileSize: z.number().int().positive().max(MAX_DATASOURCE_FILE_BYTES),
    format: datasourceUploadFormatSchema,
  })
  .superRefine(({ fileName, format }, context) => {
    if (datasourceUploadFormat(fileName) !== format)
      context.addIssue({
        code: 'custom',
        path: ['fileName'],
        message: 'Choose a CSV or Parquet file.',
      });
  });

export const datasourceUploadEventSchema = z.object({
  event: z.enum([
    'started',
    'cancelled',
    'failed',
    'completed',
    'inspection_failed',
    'file_removed',
    'datasource_registered',
  ]),
  fileSize: z.number().int().nonnegative().max(MAX_DATASOURCE_FILE_BYTES),
  format: datasourceUploadFormatSchema,
  durationMs: z.number().int().nonnegative(),
});

export type DatasourceUploadFormat = z.infer<typeof datasourceUploadFormatSchema>;
export type DatasourceUploadEvent = z.infer<typeof datasourceUploadEventSchema>;

export function datasourceUploadFormat(fileName: string): DatasourceUploadFormat | undefined {
  const extension = fileName.split('.').pop()?.toLocaleLowerCase('en-US');
  return extension === 'csv' || extension === 'parquet' ? extension : undefined;
}

export function datasourceNameFromFileName(fileName: string) {
  return fileName.replace(/\.(csv|parquet)$/iu, '');
}

export function datasourceUploadKey(
  workspacePrefix: string,
  format: DatasourceUploadFormat,
  id: string = crypto.randomUUID(),
  date = new Date(),
) {
  return `${workspacePrefix}uploads/${date.toISOString().slice(0, 10)}/${id}.${format}`;
}

export function isManagedDatasourceUpload(workspacePrefix: string, key: string) {
  if (!key.startsWith(`${workspacePrefix}uploads/`) || key.includes('..')) return false;
  const relativeKey = key.slice(`${workspacePrefix}uploads/`.length);
  return /^\d{4}-\d{2}-\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(csv|parquet)$/iu.test(
    relativeKey,
  );
}

export function dataSourceLocationReferencesKey(location: unknown, key: string) {
  const parsed = dataSourceLocationSchema.safeParse(location);
  if (!parsed.success || parsed.data.kind === 'clickhouse') return false;
  return parsed.data.kind === 'object' ? parsed.data.key === key : key.startsWith(parsed.data.key);
}

export function datasourcePrefixOverlapsManagedUploads(workspacePrefix: string, prefix: string) {
  const uploadPrefix = `${workspacePrefix}uploads/`;
  return uploadPrefix.startsWith(prefix) || prefix.startsWith(uploadPrefix);
}

export async function createDatasourceUploadCleanupToken(
  key: string,
  userId: string,
  secret: string,
  issuedAt = Math.floor(Date.now() / 1000),
) {
  const signature = await signCleanupToken(key, userId, secret, issuedAt);
  return `${issuedAt}.${base64UrlEncode(signature)}`;
}

export async function verifyDatasourceUploadCleanupToken(
  token: string,
  key: string,
  userId: string,
  secret: string,
  now = Math.floor(Date.now() / 1000),
) {
  const [issuedAtValue, signatureValue, extra] = token.split('.');
  const issuedAt = Number(issuedAtValue);
  if (
    extra !== undefined ||
    !signatureValue ||
    !Number.isSafeInteger(issuedAt) ||
    issuedAt > now + 300 ||
    now - issuedAt > MAX_CLEANUP_TOKEN_AGE_SECONDS
  )
    return false;
  try {
    const keyMaterial = await cleanupSigningKey(secret, ['verify']);
    return crypto.subtle.verify(
      'HMAC',
      keyMaterial,
      base64UrlDecode(signatureValue),
      cleanupTokenPayload(key, userId, issuedAt),
    );
  } catch {
    return false;
  }
}

async function signCleanupToken(key: string, userId: string, secret: string, issuedAt: number) {
  const keyMaterial = await cleanupSigningKey(secret, ['sign']);
  return new Uint8Array(
    await crypto.subtle.sign('HMAC', keyMaterial, cleanupTokenPayload(key, userId, issuedAt)),
  );
}

function cleanupSigningKey(secret: string, usages: KeyUsage[]) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usages,
  );
}

function cleanupTokenPayload(key: string, userId: string, issuedAt: number) {
  return new TextEncoder().encode(`${issuedAt}\n${userId}\n${key}`);
}

function base64UrlEncode(value: Uint8Array) {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function base64UrlDecode(value: string) {
  const base64 = value
    .replaceAll('-', '+')
    .replaceAll('_', '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}
