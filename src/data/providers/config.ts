import { z } from 'zod';

// Customer endpoints must be public HTTPS origins. Redirects are rejected by the transports.
export const publicHostSchema = z
  .string()
  .trim()
  .toLowerCase()
  .refine((host) => {
    return (
      /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/u.test(host) &&
      !/(?:^|\.)(?:localhost|local|internal|test|invalid)$/u.test(host)
    );
  }, 'Use a public hostname.');
export const publicEndpointSchema = z.url().refine((value) => {
  const url = new URL(value);
  return (
    url.protocol === 'https:' &&
    publicHostSchema.safeParse(url.hostname).success &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    url.pathname === '/'
  );
}, 'Use a public HTTPS endpoint without a path or credentials.');

export const s3ConnectionSchema = z.object({
  endpoint: publicEndpointSchema,
  region: z.string().trim().min(1).max(100),
  bucket: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u),
  accessKeyId: z.string().min(1).max(256),
  secretAccessKey: z.string().min(1).max(4096),
  sessionToken: z.string().max(16384).optional(),
});
export const clickhouseConnectionSchema = z.object({
  host: publicHostSchema,
  port: z.coerce.number().int().min(1).max(65535),
  user: z.string().min(1).max(256),
  password: z.string().max(4096).default(''),
});
export type S3Connection = z.infer<typeof s3ConnectionSchema>;
