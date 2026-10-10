import { readResponseText } from './http-response';
import { AwsClient } from 'aws4fetch';
import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import type { S3Connection } from './providers/config';
import { DatasourceError } from './connectors/contract';

const listingSchema = z.object({
  ListBucketResult: z.object({
    Contents: z
      .array(
        z.object({
          Key: z.string(),
          Size: z.coerce.number().nonnegative(),
          ETag: z.string(),
          LastModified: z.coerce.date(),
        }),
      )
      .default([]),
    IsTruncated: z.coerce.string().default('false'),
    NextContinuationToken: z.string().optional(),
  }),
});

export function s3Storage(config: S3Connection) {
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    sessionToken: config.sessionToken || undefined,
    service: 's3',
    region: config.region,
  });
  function objectUrl(key: string) {
    const url = new URL(config.endpoint);
    url.pathname = `/${[config.bucket, ...key.split('/')].map(encodeURIComponent).join('/')}`;
    return url;
  }
  async function sign(key: string, method: 'GET' | 'HEAD') {
    const url = objectUrl(key);
    url.searchParams.set('X-Amz-Expires', '300');
    return (await client.sign(url.toString(), { method, aws: { signQuery: true } })).url;
  }
  async function request(url: URL, method: 'GET' | 'HEAD') {
    const signed = await client.sign(url.toString(), { method });
    try {
      const response = await fetch(signed, {
        redirect: 'manual',
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new DatasourceError(
          response.status === 404 ? 'datasource_source_not_found' : 'datasource_connector_failed',
          'S3 could not read this source. Check the connection and read permissions.',
        );
      }
      return response;
    } catch (error) {
      if (error instanceof DatasourceError) throw error;
      throw new DatasourceError('datasource_connector_failed', 'S3 could not read this source.');
    }
  }
  return {
    sign,
    async head(key: string) {
      const response = await request(objectUrl(key), 'HEAD');
      const size = Number(response.headers.get('content-length'));
      if (
        !response.headers.has('content-length') ||
        !Number.isSafeInteger(size) ||
        size < 0 ||
        !response.headers.get('etag')
      )
        throw new DatasourceError(
          'datasource_inspection_failed',
          'S3 returned invalid object metadata.',
        );
      return {
        key,
        size,
        etag: response.headers.get('etag')!,
        uploaded: new Date(response.headers.get('last-modified') ?? 0),
      };
    },
    async list(prefix: string, cursor?: string) {
      const url = objectUrl('');
      url.searchParams.set('list-type', '2');
      url.searchParams.set('prefix', prefix);
      url.searchParams.set('max-keys', '1000');
      if (cursor) url.searchParams.set('continuation-token', cursor);
      const response = await request(url, 'GET');
      // S3 pages are bounded to 1000 objects; never parse entity declarations from remote XML.
      const xml = await readResponseText(response, 2_000_000);
      if (xml.length > 2_000_000 || /<!DOCTYPE|<!ENTITY/iu.test(xml))
        throw new DatasourceError(
          'datasource_inspection_failed',
          'S3 returned an invalid file listing.',
        );
      const parser = new XMLParser({
        parseTagValue: false,
        isArray: (name) => name === 'Contents',
      });
      const page = listingSchema.parse(parser.parse(xml)).ListBucketResult;
      return {
        objects: page.Contents.map((object) => ({
          key: object.Key,
          size: object.Size,
          etag: object.ETag,
          uploaded: object.LastModified,
        })),
        truncated: page.IsTruncated === 'true',
        cursor: page.NextContinuationToken,
      };
    },
  };
}
