import type { DatasourceCachePolicy } from '#/domain/schema';
import {
  boolean,
  jsonb,
  index,
  integer,
  primaryKey,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const workspaces = pgTable(
  'workspaces',
  {
    id: text().primaryKey(),
    clerkOrganizationId: text('clerk_organization_id').notNull(),
    name: text().notNull(),
    r2Prefix: text('r2_prefix').notNull(),
    previewSeededAt: text('preview_seeded_at'),
    previewSeedClaimedAt: text('preview_seed_claimed_at'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('workspaces_clerk_organization_id_unique').on(table.clerkOrganizationId),
    uniqueIndex('workspaces_r2_prefix_unique').on(table.r2Prefix),
  ],
);

// People who signed in through an OIDC provider. This is that deployment's user directory;
// Clerk deployments read Clerk's directory and leave it empty.
export const users = pgTable(
  'users',
  {
    id: text().primaryKey(),
    // Stored in lower case so sharing by email matches regardless of spelling. At most one
    // user holds an address; users without one are not limited.
    email: text(),
    name: text(),
    imageUrl: text('image_url'),
    lastSeenAt: text('last_seen_at').notNull(),
  },
  (table) => [uniqueIndex('users_email_unique').on(table.email)],
);

export const dataSources = pgTable(
  'data_sources',
  {
    id: text().primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    connectorType: text('connector_type').notNull().default('duckdb-file'),
    location: jsonb().notNull(),
    cachePolicy: jsonb('cache_policy').$type<DatasourceCachePolicy>(),
    version: text().notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('data_sources_workspace_id_idx').on(table.workspaceId),
    uniqueIndex('data_sources_workspace_name_unique').on(table.workspaceId, table.name),
  ],
);

// Kept outside datasource records so API responses cannot include encrypted credentials.
export const datasourceConnections = pgTable('datasource_connections', {
  datasourceId: text('datasource_id')
    .primaryKey()
    .references(() => dataSources.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  encryptedConfig: text('encrypted_config').notNull(),
});

// OAuth grants belong to their recorded creator within a workspace. Tokens stay outside datasource metadata.
export const datasourceAuthorizations = pgTable(
  'datasource_authorizations',
  {
    id: text().primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    provider: text().notNull(),
    createdBy: text('created_by').notNull(),
    account: text(),
    status: text().notNull(),
    encryptedConfig: text('encrypted_config'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('datasource_authorizations_workspace_idx').on(table.workspaceId)],
);

export const datasourceUploads = pgTable(
  'datasource_uploads',
  {
    key: text().primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    clerkUserId: text('clerk_user_id').notNull(),
    status: text({ enum: ['pending', 'registering', 'removing'] }).notNull(),
    claimId: text('claim_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('datasource_uploads_workspace_id_idx').on(table.workspaceId)],
);

export const ingestionTokens = pgTable(
  'ingestion_tokens',
  {
    id: text().primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    sourceKey: text('source_key').notNull(),
    destinationKey: text('destination_key').notNull(),
    expiresAt: text('expires_at').notNull(),
    usedAt: text('used_at'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('ingestion_tokens_workspace_id_idx').on(table.workspaceId)],
);

export const queryReadBudgets = pgTable(
  'query_read_budgets',
  {
    id: text().primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    scannedBytes: integer('scanned_bytes').notNull().default(0),
    maximumBytes: integer('maximum_bytes').notNull(),
    expiresAt: text('expires_at').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('query_read_budgets_workspace_id_idx').on(table.workspaceId)],
);

export const fields = pgTable(
  'fields',
  {
    id: text().primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    dataSourceId: text('data_source_id')
      .notNull()
      .references(() => dataSources.id, { onDelete: 'cascade' }),
    columnName: text('column_name').notNull(),
    canonicalName: text('canonical_name').notNull(),
    label: text().notNull(),
    role: text().notNull(),
    semanticType: text('semantic_type').notNull(),
    defaultAggregation: text('default_aggregation'),
    description: text(),
    hidden: boolean().notNull().default(false),
    castTo: text('cast_to'),
    sampleValues: jsonb('sample_values'),
    cardinality: integer(),
  },
  (table) => [
    index('fields_data_source_id_idx').on(table.dataSourceId),
    uniqueIndex('fields_data_source_column_unique').on(table.dataSourceId, table.columnName),
    uniqueIndex('fields_data_source_canonical_unique').on(table.dataSourceId, table.canonicalName),
  ],
);

export const calculatedFields = pgTable(
  'calculated_fields',
  {
    id: text().primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    dataSourceId: text('data_source_id')
      .notNull()
      .references(() => dataSources.id, { onDelete: 'cascade' }),
    canonicalName: text('canonical_name').notNull(),
    label: text().notNull(),
    expression: text().notNull(),
    formulaDialect: text('formula_dialect').$type<'duckdb' | 'clickhouse' | 'bigquery'>(),
    role: text().notNull(),
    semanticType: text('semantic_type').notNull(),
    defaultAggregation: text('default_aggregation'),
    description: text(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('calculated_fields_data_source_id_idx').on(table.dataSourceId),
    uniqueIndex('calculated_fields_data_source_canonical_unique').on(
      table.dataSourceId,
      table.canonicalName,
    ),
  ],
);

export const libraryMetrics = pgTable(
  'library_metrics',
  {
    id: text().primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    canonicalName: text('canonical_name').notNull(),
    expression: text().notNull(),
    formulaDialect: text('formula_dialect').$type<'duckdb' | 'clickhouse' | 'bigquery'>(),
    semanticType: text('semantic_type').notNull(),
    description: text(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('library_metrics_workspace_canonical_unique').on(
      table.workspaceId,
      table.canonicalName,
    ),
  ],
);

export const dashboards = pgTable(
  'dashboards',
  {
    id: text().primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    document: jsonb().notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('dashboards_workspace_id_idx').on(table.workspaceId)],
);

export const dashboardGrants = pgTable(
  'dashboard_grants',
  {
    dashboardId: text('dashboard_id')
      .notNull()
      .references(() => dashboards.id, { onDelete: 'cascade' }),
    clerkUserId: text('clerk_user_id').notNull(),
    role: text().notNull(),
    grantedBy: text('granted_by').notNull(),
    grantedAt: text('granted_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.dashboardId, table.clerkUserId] }),
    index('dashboard_grants_user_id_idx').on(table.clerkUserId),
  ],
);

export const shareLinks = pgTable(
  'share_links',
  {
    token: text().primaryKey(),
    dashboardId: text('dashboard_id')
      .notNull()
      .references(() => dashboards.id, { onDelete: 'cascade' }),
    createdBy: text('created_by').notNull(),
    createdAt: text('created_at').notNull(),
    revokedAt: text('revoked_at'),
  },
  (table) => [index('share_links_dashboard_id_idx').on(table.dashboardId)],
);

// Uploaded dashboard images. The original and its resized variants live in R2 under
// `ws/<workspaceId>/assets/<id>/`. Rows stay while any dashboard may reference them.
export const dashboardAssets = pgTable(
  'dashboard_assets',
  {
    id: text().primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    uploadedBy: text('uploaded_by').notNull(),
    name: text().notNull(),
    contentType: text('content_type').notNull(),
    size: integer().notNull(),
    width: integer().notNull(),
    height: integer().notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('dashboard_assets_workspace_id_idx').on(table.workspaceId)],
);
