import type { AnyRequestMiddleware } from '@tanstack/react-start';
import type { DatasourceProvider } from '#/data/providers/contract';

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
  imageUrl?: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  primaryEmailAddress: { emailAddress: string } | null;
  emailAddresses: { emailAddress: string }[];
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
    requestIdentity(): Promise<{
      isAuthenticated: boolean;
      userId: string | null;
      orgId: string | null | undefined;
      orgSlug: string | null | undefined;
      orgRole: string | null | undefined;
    }>;
    directory: {
      users(query: {
        userId?: string[];
        emailAddress?: string[];
        limit: number;
      }): Promise<{ data: DirectoryUser[] }>;
      memberships(query: { organizationId: string; userId: string[]; limit: number }): Promise<{
        data: { publicUserData?: { userId?: string | null } | null }[];
      }>;
    };
    middleware(): AnyRequestMiddleware;
  };
  datasources: readonly DatasourceProvider[];
  queryEngine: { url(): string; fetch(workspaceId: string, request: Request): Promise<Response> };
  background: { waitUntil(promise: Promise<unknown>): void };
}
export function defineConfig(config: PlatformConfig): PlatformConfig {
  return config;
}
