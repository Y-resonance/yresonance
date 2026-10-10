export interface ConnectionField {
  name: string;
  label: string;
  type?: 'password' | 'url' | 'number';
  defaultValue?: string;
  placeholder?: string;
  optional?: boolean;
}

export interface DatasourceProviderDefinition {
  id: string;
  name: string;
  engine: 'duckdb' | 'clickhouse';
  group: 'managed' | 'bring-your-own';
  description: string;
  supportsUploads: boolean;
  supportsWorkspaceFiles: boolean;
  source: 'files' | 'table';
  defaultCacheTtlSeconds: number;
  connectionFields: readonly ConnectionField[];
}

// Shared by provider discovery and the setup form. Secrets never belong in this catalog.
export const datasourceProviders: readonly DatasourceProviderDefinition[] = [
  {
    id: 'duckdb-file',
    name: 'DuckDB',
    engine: 'duckdb',
    group: 'managed',
    description: 'Easiest if you want to work with CSV or Parquet files in an S3 bucket.',
    supportsUploads: true,
    supportsWorkspaceFiles: true,
    source: 'files',
    defaultCacheTtlSeconds: 86400,
    connectionFields: [],
  },
  {
    id: 'clickhouse',
    name: 'ClickHouse',
    engine: 'clickhouse',
    group: 'managed',
    description: 'Columnar database optimized for fast results.',
    supportsUploads: true,
    supportsWorkspaceFiles: false,
    source: 'table',
    defaultCacheTtlSeconds: 86400,
    connectionFields: [],
  },
  {
    id: 'duckdb-s3',
    name: 'DuckDB',
    engine: 'duckdb',
    group: 'bring-your-own',
    description: 'Easiest if you want to work with CSV or Parquet files in an S3 bucket.',
    supportsUploads: false,
    supportsWorkspaceFiles: false,
    source: 'files',
    defaultCacheTtlSeconds: 300,
    connectionFields: [
      {
        name: 'endpoint',
        label: 'S3 endpoint',
        type: 'url',
        placeholder: 'https://s3.eu-central-1.amazonaws.com',
      },
      { name: 'region', label: 'Region', defaultValue: 'eu-central-1' },
      { name: 'bucket', label: 'Bucket' },
      { name: 'accessKeyId', label: 'Access key ID' },
      { name: 'secretAccessKey', label: 'Secret access key', type: 'password' },
      { name: 'sessionToken', label: 'Session token', type: 'password', optional: true },
    ],
  },
  {
    id: 'clickhouse-external',
    name: 'ClickHouse',
    engine: 'clickhouse',
    group: 'bring-your-own',
    description: 'Columnar database optimized for fast results.',
    supportsUploads: false,
    supportsWorkspaceFiles: false,
    source: 'table',
    defaultCacheTtlSeconds: 300,
    connectionFields: [
      { name: 'host', label: 'Host', placeholder: 'analytics.example.com' },
      { name: 'port', label: 'HTTPS port', type: 'number', defaultValue: '8443' },
      { name: 'user', label: 'Username', defaultValue: 'default' },
      { name: 'password', label: 'Password', type: 'password', optional: true },
    ],
  },
];
