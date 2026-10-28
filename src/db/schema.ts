import type { DatasourceCachePolicy } from '#/domain/schema';
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const workspaces = sqliteTable(
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

export const dataSources = sqliteTable(
  'data_sources',
  {
    id: text().primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    connectorType: text('connector_type').notNull().default('duckdb-file'),
    location: text({ mode: 'json' }).notNull(),
    cachePolicy: text('cache_policy', { mode: 'json' }).$type<DatasourceCachePolicy>(),
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
export const datasourceConnections = sqliteTable('datasource_connections', {
  datasourceId: text('datasource_id')
    .primaryKey()
    .references(() => dataSources.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  encryptedConfig: text('encrypted_config').notNull(),
});

// OAuth grants are reusable within one workspace. Tokens stay outside datasource metadata.
export const datasourceAuthorizations = sqliteTable(
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

export const datasourceUploads = sqliteTable(
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

export const ingestionTokens = sqliteTable(
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

export const queryReadBudgets = sqliteTable(
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

export const fields = sqliteTable(
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
    hidden: integer({ mode: 'boolean' }).notNull().default(false),
    castTo: text('cast_to'),
    sampleValues: text('sample_values', { mode: 'json' }),
    cardinality: integer(),
  },
  (table) => [
    index('fields_data_source_id_idx').on(table.dataSourceId),
    uniqueIndex('fields_data_source_column_unique').on(table.dataSourceId, table.columnName),
    uniqueIndex('fields_data_source_canonical_unique').on(table.dataSourceId, table.canonicalName),
  ],
);

export const calculatedFields = sqliteTable(
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

export const libraryMetrics = sqliteTable(
  'library_metrics',
  {
    id: text().primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    canonicalName: text('canonical_name').notNull(),
    expression: text().notNull(),
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

export const dashboards = sqliteTable(
  'dashboards',
  {
    id: text().primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    document: text({ mode: 'json' }).notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('dashboards_workspace_id_idx').on(table.workspaceId)],
);

export const dashboardGrants = sqliteTable(
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

export const shareLinks = sqliteTable(
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

// Clerk IDs in the existing tables remain stable. Keycloak users receive local IDs;
// their workspace key uses the reserved local: prefix in clerk_organization_id.
export const authUsers = sqliteTable(
  'auth_users',
  {
    id: text().primaryKey(),
    issuer: text().notNull(),
    subject: text().notNull(),
    email: text().notNull(),
    name: text().notNull(),
  },
  (table) => [uniqueIndex('auth_users_identity_unique').on(table.issuer, table.subject)],
);

export const workspaceMembers = sqliteTable(
  'workspace_members',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    role: text({ enum: ['admin', 'member'] }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId] }),
    index('workspace_members_user_idx').on(table.userId),
  ],
);

export const workspaceInvitations = sqliteTable(
  'workspace_invitations',
  {
    id: text().primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    email: text().notNull(),
    role: text({ enum: ['admin', 'member'] }).notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => [uniqueIndex('workspace_invitations_email_unique').on(table.workspaceId, table.email)],
);

export const authSessions = sqliteTable(
  'auth_sessions',
  {
    id: text().primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
    expiresAt: integer('expires_at').notNull(),
    encryptedIdToken: text('encrypted_id_token').notNull(),
  },
  (table) => [index('auth_sessions_expiry_idx').on(table.expiresAt)],
);

export const authLoginStates = sqliteTable('auth_login_states', {
  id: text().primaryKey(),
  verifier: text().notNull(),
  nonce: text().notNull(),
  returnTo: text('return_to').notNull(),
  expiresAt: integer('expires_at').notNull(),
});
