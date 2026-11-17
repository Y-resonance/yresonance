import type { AnyRequestMiddleware } from '@tanstack/react-start';
import type { DatasourceProvider } from '#/data/providers/contract';
import type { BrowserSession } from './ui';

export type StorageRange =
  | { offset: number; length?: number }
  | { offset?: number; length: number }
  | { suffix: number };
export interface StoredObject {
  key: string;
  size: number;
  etag: string;
  httpEtag: string;
  uploaded: Date;
  httpMetadata?: { contentType?: string };
  range?: StorageRange;
  writeHttpMetadata(headers: Headers): void;
}
export interface StoredBody extends StoredObject {
  body: ReadableStream<Uint8Array>;
  arrayBuffer(): Promise<ArrayBuffer>;
}
export interface Storage {
  get(key: string, options?: { range?: Headers | StorageRange }): Promise<StoredBody | null>;
  head(key: string): Promise<StoredObject | null>;
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string,
    options?: {
      createOnly?: boolean;
      contentType?: string;
    },
  ): Promise<StoredObject | null>;
  list(options: { prefix?: string; cursor?: string; limit?: number }): Promise<{
    objects: StoredObject[];
    truncated: boolean;
    cursor?: string;
  }>;
  delete(keys: string | string[]): Promise<void>;
}
export interface Cache {
  get<T = string>(key: string, type?: 'json'): Promise<T | null>;
  put(key: string, value: string, options: { expirationTtl: number }): Promise<void>;
  delete(key: string): Promise<void>;
  // Environment reset needs an inventory, in addition to ordinary query-cache operations.
  list(options: { cursor?: string; limit: number }): Promise<{
    keys: { name: string }[];
    list_complete: boolean;
    cursor?: string;
  }>;
}
export interface DirectoryUser {
  id: string;
  email: string | null;
  name: string | null;
  imageUrl: string | null;
}
export interface PlatformConfig {
  database: { connectionString(): string };
  storage: Storage;
  cache: Cache;
  images: {
    dimensions(
      body: ReadableStream<Uint8Array>,
    ): Promise<{ width: number; height: number } | undefined>;
    resize(body: ReadableStream<Uint8Array>, width: number, format: string): Promise<Response>;
  };
  productAnalytics?: {
    writeDataPoint(point: { blobs: string[]; doubles?: number[]; indexes?: string[] }): void;
  };
  auth: {
    // A signed-out request has no userId. A signed-in user without a workspace has no orgId.
    requestIdentity(): Promise<{
      userId: string | null;
      orgId: string | null;
      orgSlug: string | null;
      isAdmin: boolean;
    }>;
    directory: {
      /** Looks users up by id or by email address. Unknown ones are left out. */
      users(query: { userIds: string[] } | { emails: string[] }): Promise<DirectoryUser[]>;
      /** Returns the given user ids that belong to the organization. */
      memberships(query: { orgId: string; userIds: string[] }): Promise<string[]>;
    };
    middleware(): AnyRequestMiddleware;
    /** Identity for the browser, from providers that keep the session on the server. */
    browserSession?(): Promise<BrowserSession | null>;
  };
  datasources: readonly DatasourceProvider[];
  queryEngine: { url(): string; fetch(workspaceId: string, request: Request): Promise<Response> };
  background: { waitUntil(promise: Promise<unknown>): void };
}
export function defineConfig(config: PlatformConfig): PlatformConfig {
  return config;
}
