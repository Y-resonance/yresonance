import { requireSession, type SessionContext } from './auth.server';
import { eq, count, and, or, inArray, lt } from 'drizzle-orm';
import {
  dataSources,
  fields,
  calculatedFields,
  datasourceUploads,
  ingestionTokens,
} from '#/db/schema';
import { loadDataSource, loadQueryMetadata } from './records.server';
import { ApiError } from './errors';
import { scopedR2Prefix, isWorkspaceR2Key } from '#/domain/tenancy';
import {
  listSourceObjects,
  prepareSourceUpload,
  deleteSourceObject,
  localSourceUrl,
} from '#/data/source.server';
import { type ApiRequest } from '#/api/contracts';
import {
  createDatasourceUploadCleanupToken,
  isManagedDatasourceUpload,
  verifyDatasourceUploadCleanupToken,
  datasourcePrefixOverlapsManagedUploads,
  MAX_DATASOURCE_FILE_BYTES,
  dataSourceLocationReferencesKey,
} from '#/domain/datasource-upload';
import { DUCKDB_FILE_CONNECTOR } from '#/data/connectors/contract';
import { type DataSourceRecord } from '#/query/types';
import { env } from 'cloudflare:workers';
import { createR2Capability, capabilityUrl } from '#/data/internal-r2';
import { ingestCsv } from '#/query/duckdb.server';
import { canUpdateFieldMetadata } from '#/domain/field-metadata';
import { seedPreviewWorkspace } from './preview-seed.server';
import { database, UPLOAD_CLAIM_LEASE_MS } from './database.server';
import {
  datasourceOperation,
  libraryMetricApplies,
  connectorFor,
  seedField,
} from './datasource-operations.server';
import { authorizeDashboard, dashboardUsesDataSource } from './dashboard-access.server';

export async function listDataSources() {
  const session = await requireSession();
  await seedPreviewWorkspace(session);
  const db = database();
  const workspace = eq(dataSources.workspaceId, session.workspace.id);
  const [sourceRows, rawCounts, calculatedCounts] = await Promise.all([
    db.select().from(dataSources).where(workspace),
    // Hidden fields are excluded so the count matches what the detail page lists.
    db
      .select({ dataSourceId: fields.dataSourceId, total: count() })
      .from(fields)
      .where(and(eq(fields.workspaceId, session.workspace.id), eq(fields.hidden, false)))
      .groupBy(fields.dataSourceId),
    db
      .select({ dataSourceId: calculatedFields.dataSourceId, total: count() })
      .from(calculatedFields)
      .where(eq(calculatedFields.workspaceId, session.workspace.id))
      .groupBy(calculatedFields.dataSourceId),
  ]);
  const totals = new Map<string, number>();
  for (const row of [...rawCounts, ...calculatedCounts])
    totals.set(row.dataSourceId, (totals.get(row.dataSourceId) ?? 0) + row.total);
  return sourceRows.map((row) => ({ ...row, fieldCount: totals.get(row.id) ?? 0 }));
}

export async function describeDatasource(
  dataSourceId: string,
  dashboardId?: string,
  shareToken?: string,
) {
  const workspaceId = shareToken
    ? await sharedDatasourceWorkspace(dataSourceId, dashboardId, shareToken)
    : (await requireSession()).workspace.id;
  const dataSource = await loadDataSource(dataSourceId, workspaceId);
  const metadata = await loadQueryMetadata(dataSource.id, workspaceId);
  const applicableMetrics = [];
  for (const metric of metadata.libraryMetrics) {
    if (
      await datasourceOperation(() =>
        libraryMetricApplies(dataSource, {
          kind: 'libraryMetric',
          expression: metric.expression,
          semanticType: metric.semanticType,
          metadata,
        }),
      )
    )
      applicableMetrics.push(metric);
  }
  return {
    ...dataSource,
    fields: metadata.fields.filter((field) => !field.hidden),
    calculatedFields: metadata.calculatedFields,
    libraryMetrics: applicableMetrics,
  };
}

async function sharedDatasourceWorkspace(
  dataSourceId: string,
  dashboardId: string | undefined,
  shareToken: string,
) {
  if (!dashboardId)
    throw new ApiError(400, 'dashboard_required', 'Shared datasource access needs a dashboard.');
  const access = await authorizeDashboard(dashboardId, 'viewer', shareToken);
  const referenced = access.document.widgets.some(
    (widget) =>
      'dataSourceId' in widget.definition && widget.definition.dataSourceId === dataSourceId,
  );
  if (!referenced)
    throw new ApiError(
      403,
      'datasource_access_denied',
      'The datasource is not used by this dashboard.',
    );
  return access.document.workspaceId;
}

export async function listR2Objects(prefix?: string, cursor?: string) {
  const session = await requireSession();
  const safePrefix = scopedR2Prefix(session.workspace.r2Prefix, prefix);
  if (!safePrefix)
    throw new ApiError(400, 'invalid_r2_prefix', 'R2 prefixes cannot contain traversal segments.');
  return listSourceObjects(safePrefix, cursor);
}

export async function prepareDatasourceUpload(
  request: Extract<ApiRequest, { action: 'prepareDatasourceUpload' }>,
) {
  const session = await requireSession();
  const upload = await prepareSourceUpload(session.workspace.r2Prefix, request.format);
  const cleanupToken = await createDatasourceUploadCleanupToken(
    upload.key,
    session.userId,
    uploadCleanupSecret(),
  );
  const now = new Date().toISOString();
  await database().insert(datasourceUploads).values({
    key: upload.key,
    workspaceId: session.workspace.id,
    clerkUserId: session.userId,
    status: 'pending',
    claimId: null,
    createdAt: now,
    updatedAt: now,
  });
  return {
    ...upload,
    cleanupToken,
  };
}

export async function removeDatasourceUpload(
  request: Extract<ApiRequest, { action: 'removeDatasourceUpload' }>,
) {
  const session = await requireSession();
  if (!isManagedDatasourceUpload(session.workspace.r2Prefix, request.key))
    throw new ApiError(400, 'invalid_upload_key', 'Only yresonance uploads can be removed here.');
  if (
    !(await verifyDatasourceUploadCleanupToken(
      request.cleanupToken,
      request.key,
      session.userId,
      uploadCleanupSecret(),
    ))
  )
    throw new ApiError(403, 'invalid_cleanup_token', 'This upload cannot be removed by this user.');
  const claimId = crypto.randomUUID();
  const claimedRemoval = await database()
    .update(datasourceUploads)
    .set({ status: 'removing', claimId, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(datasourceUploads.key, request.key),
        eq(datasourceUploads.workspaceId, session.workspace.id),
        eq(datasourceUploads.clerkUserId, session.userId),
        claimableUploadStatus(),
      ),
    )
    .returning({ key: datasourceUploads.key });
  if (!claimedRemoval.length)
    throw new ApiError(409, 'upload_not_pending', 'This upload is not available for removal.');
  try {
    if (await isDatasourceObjectRegistered(session.workspace.id, request.key)) {
      await deleteUploadState(session, request.key, 'removing', claimId);
      throw new ApiError(
        409,
        'upload_in_use',
        'This file belongs to a registered datasource and cannot be removed.',
      );
    }
    await renewUploadClaim(session, request.key, 'removing', claimId);
    await deleteSourceObject(request.key);
    await deleteUploadState(session, request.key, 'removing', claimId);
  } catch (error) {
    await restorePendingUpload(session, request.key, 'removing', claimId);
    throw error;
  }
  return { removed: true };
}

export async function trackDatasourceUpload(
  request: Extract<ApiRequest, { action: 'trackDatasourceUpload' }>,
) {
  const session = await requireSession();
  console.info('yresonance.datasource_upload', {
    event: request.event,
    fileSize: request.fileSize,
    format: request.format,
    durationMs: request.durationMs,
    role: session.isAdmin ? 'admin' : 'editor',
  });
  return { tracked: true };
}

export async function registerDatasource(
  request: Extract<ApiRequest, { action: 'registerDatasource' }>,
) {
  const session = await requireSession();
  if (!isWorkspaceR2Key(session.workspace.r2Prefix, request.location.key))
    throw new ApiError(
      400,
      'invalid_r2_prefix',
      `Datasource keys must start with ${session.workspace.r2Prefix}.`,
    );
  if (
    request.location.kind === 'prefix' &&
    datasourcePrefixOverlapsManagedUploads(session.workspace.r2Prefix, request.location.key)
  )
    throw new ApiError(
      400,
      'managed_upload_prefix_not_allowed',
      'Prefixes cannot include yresonance-managed uploads.',
    );
  const managedUploadKey =
    request.location.kind === 'object' &&
    isManagedDatasourceUpload(session.workspace.r2Prefix, request.location.key)
      ? request.location.key
      : undefined;
  if (
    managedUploadKey &&
    !managedUploadKey.toLocaleLowerCase('en-US').endsWith(`.${request.location.format}`)
  )
    throw new ApiError(
      400,
      'invalid_upload_format',
      `Managed ${request.location.format} uploads need a .${request.location.format} key.`,
    );
  const claimId = managedUploadKey
    ? await claimPendingUpload(session, managedUploadKey, request.cleanupToken)
    : undefined;
  let convertedKey: string | undefined;
  try {
    const connector = connectorFor(DUCKDB_FILE_CONNECTOR);
    const location =
      managedUploadKey && request.location.format === 'csv'
        ? await ingestManagedCsvUpload(session, managedUploadKey).then((converted) => {
            convertedKey = converted.key;
            return converted.location;
          })
        : request.location;
    const pendingDataSource: Omit<DataSourceRecord, 'version'> = {
      id: `ds_${crypto.randomUUID()}`,
      workspaceId: session.workspace.id,
      name: request.name,
      connectorType: connector.type,
      location,
    };
    const inspection = await datasourceOperation(() =>
      connector.inspect(pendingDataSource, {
        ...(managedUploadKey ? { maximumObjectBytes: MAX_DATASOURCE_FILE_BYTES } : {}),
      }),
    );
    const dataSource: DataSourceRecord = {
      ...pendingDataSource,
      version: inspection.version,
    };
    const discovered = inspection.description.map((column) =>
      seedField(dataSource.id, column, inspection.samples),
    );
    const now = new Date().toISOString();
    const db = database();
    if (managedUploadKey && claimId)
      await renewUploadClaim(session, managedUploadKey, 'registering', claimId);
    const uploadCompletion =
      managedUploadKey && claimId
        ? [
            db
              .delete(datasourceUploads)
              .where(
                and(
                  eq(datasourceUploads.key, managedUploadKey),
                  eq(datasourceUploads.claimId, claimId),
                  eq(datasourceUploads.status, 'registering'),
                ),
              ),
          ]
        : [];
    await db.batch([
      db.insert(dataSources).values({
        id: dataSource.id,
        workspaceId: dataSource.workspaceId,
        name: dataSource.name,
        connectorType: dataSource.connectorType,
        location: dataSource.location,
        version: dataSource.version,
        createdAt: now,
        updatedAt: now,
      }),
      ...discovered.map((field) =>
        db.insert(fields).values({ ...field, workspaceId: session.workspace.id }),
      ),
      ...uploadCompletion,
    ]);
    if (convertedKey && managedUploadKey)
      await deleteSourceObject(managedUploadKey).catch((error: unknown) => {
        console.warn('yresonance.datasource_ingestion_cleanup_failed', {
          workspaceId: session.workspace.id,
          sourceKey: managedUploadKey,
          error: error instanceof Error ? error.message : 'Unknown cleanup error.',
        });
      });
    return { ...dataSource, fields: discovered };
  } catch (error) {
    if (convertedKey) await deleteSourceObject(convertedKey).catch(() => undefined);
    if (managedUploadKey && claimId)
      await restorePendingUpload(session, managedUploadKey, 'registering', claimId);
    throw error;
  }
}

async function ingestManagedCsvUpload(session: SessionContext, sourceKey: string) {
  const destinationKey = sourceKey.replace(/\.csv$/iu, '.parquet');
  const tokenId = `ingest_${crypto.randomUUID()}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000);
  await database().insert(ingestionTokens).values({
    id: tokenId,
    workspaceId: session.workspace.id,
    sourceKey,
    destinationKey,
    expiresAt: expiresAt.toISOString(),
    usedAt: null,
    createdAt: now.toISOString(),
  });
  let sourceUrl: string;
  let destinationUrl: string;
  if (env.DATA_SOURCE_BASE_URL.startsWith('r2://')) {
    const token = await createR2Capability(
      {
        kind: 'ingestion',
        tokenId,
        sourceKey,
        destinationKey,
        expiresAt: Math.floor(expiresAt.getTime() / 1000),
      },
      env.INTERNAL_R2_SIGNING_SECRET,
    );
    sourceUrl = capabilityUrl(token);
    // The ingestion capability selects its read and write object from the HTTP method.
    destinationUrl = sourceUrl;
  } else {
    sourceUrl = localSourceUrl(sourceKey);
    destinationUrl = localSourceUrl(destinationKey);
  }
  await ingestCsv(session.workspace.id, tokenId, sourceUrl, destinationUrl);
  return {
    key: destinationKey,
    location: { kind: 'object' as const, key: destinationKey, format: 'parquet' as const },
  };
}

function uploadCleanupSecret() {
  return env.UPLOAD_SIGNING_SECRET;
}

async function isDatasourceObjectRegistered(workspaceId: string, key: string) {
  const registeredSources = await database()
    .select({ location: dataSources.location })
    .from(dataSources)
    .where(eq(dataSources.workspaceId, workspaceId));
  return registeredSources.some(({ location }) => dataSourceLocationReferencesKey(location, key));
}

async function claimPendingUpload(
  session: SessionContext,
  key: string,
  cleanupToken: string | undefined,
) {
  if (
    !cleanupToken ||
    !(await verifyDatasourceUploadCleanupToken(
      cleanupToken,
      key,
      session.userId,
      uploadCleanupSecret(),
    ))
  )
    throw new ApiError(403, 'invalid_cleanup_token', 'This upload belongs to another user.');
  const claimId = crypto.randomUUID();
  const claimed = await database()
    .update(datasourceUploads)
    .set({ status: 'registering', claimId, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(datasourceUploads.key, key),
        eq(datasourceUploads.workspaceId, session.workspace.id),
        eq(datasourceUploads.clerkUserId, session.userId),
        claimableUploadStatus(),
      ),
    )
    .returning({ key: datasourceUploads.key });
  if (!claimed.length)
    throw new ApiError(409, 'upload_not_pending', 'This upload is already being processed.');
  return claimId;
}

function claimableUploadStatus() {
  return or(
    eq(datasourceUploads.status, 'pending'),
    and(
      inArray(datasourceUploads.status, ['registering', 'removing']),
      lt(datasourceUploads.updatedAt, new Date(Date.now() - UPLOAD_CLAIM_LEASE_MS).toISOString()),
    ),
  );
}

async function restorePendingUpload(
  session: SessionContext,
  key: string,
  fromStatus: 'registering' | 'removing',
  claimId: string,
) {
  await database()
    .update(datasourceUploads)
    .set({ status: 'pending', claimId: null, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(datasourceUploads.key, key),
        eq(datasourceUploads.workspaceId, session.workspace.id),
        eq(datasourceUploads.clerkUserId, session.userId),
        eq(datasourceUploads.status, fromStatus),
        eq(datasourceUploads.claimId, claimId),
      ),
    );
}

async function deleteUploadState(
  session: SessionContext,
  key: string,
  status: 'registering' | 'removing',
  claimId: string,
) {
  await database()
    .delete(datasourceUploads)
    .where(
      and(
        eq(datasourceUploads.key, key),
        eq(datasourceUploads.workspaceId, session.workspace.id),
        eq(datasourceUploads.clerkUserId, session.userId),
        eq(datasourceUploads.status, status),
        eq(datasourceUploads.claimId, claimId),
      ),
    );
}

async function renewUploadClaim(
  session: SessionContext,
  key: string,
  status: 'registering' | 'removing',
  claimId: string,
) {
  const renewed = await database()
    .update(datasourceUploads)
    .set({ updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(datasourceUploads.key, key),
        eq(datasourceUploads.workspaceId, session.workspace.id),
        eq(datasourceUploads.clerkUserId, session.userId),
        eq(datasourceUploads.status, status),
        eq(datasourceUploads.claimId, claimId),
      ),
    )
    .returning({ key: datasourceUploads.key });
  if (!renewed.length)
    throw new ApiError(409, 'upload_claim_lost', 'This upload operation was superseded.');
}

export async function updateFieldMetadata(
  request: Extract<ApiRequest, { action: 'updateFieldMetadata' }>,
) {
  const session = await requireSession();
  await loadDataSource(request.dataSourceId, session.workspace.id);
  let hasEditorAccess = false;
  let usesSource = false;
  if (request.dashboardId) {
    const access = await authorizeDashboard(request.dashboardId, 'editor');
    hasEditorAccess = access.role === 'admin' || access.role === 'editor';
    usesSource = dashboardUsesDataSource(access.document, request.dataSourceId);
  }
  if (!canUpdateFieldMetadata(session.isAdmin, hasEditorAccess, usesSource, request.patch))
    throw new ApiError(
      403,
      'field_metadata_access_denied',
      'Editors may update visible field metadata only for datasources used by their dashboard.',
    );
  const row = await database().query.fields.findFirst({
    where: and(
      eq(fields.dataSourceId, request.dataSourceId),
      eq(fields.columnName, request.columnName),
    ),
  });
  if (!row) throw new ApiError(404, 'field_not_found', 'Field not found.');
  await database().update(fields).set(request.patch).where(eq(fields.id, row.id));
  return database().query.fields.findFirst({ where: eq(fields.id, row.id) });
}
