import { dashboardWidgets } from '#/domain/schema';
import type { ManagedUploadImport } from '#/data/analytics-data-backend';
import { requireSession, type SessionContext } from './auth.server';
import { eq, count, and, or, inArray, lt } from 'drizzle-orm';
import {
  dataSources,
  fields,
  calculatedFields,
  datasourceUploads,
  datasourceConnections,
} from '#/db/schema';
import { loadDataSource, loadQueryContext } from './records.server';
import { ApiError } from './errors';
import { scopedR2Prefix } from '#/domain/tenancy';
import { listSourceObjects, prepareSourceUpload, deleteSourceObject } from '#/data/source.server';
import { type ApiRequest } from '#/api/contracts';
import {
  createDatasourceUploadCleanupToken,
  isManagedDatasourceUpload,
  verifyDatasourceUploadCleanupToken,
} from '#/domain/datasource-upload';
import { registrationProvider, providers, datasourceProvider } from '#/data/providers/index.server';
import { sealConnection } from '#/data/connection-secrets';
import { type DataSourceRecord } from '#/query/types';
import { env } from 'cloudflare:workers';
import { canUpdateFieldMetadata } from '#/domain/field-metadata';
import { seedPreviewWorkspace } from './preview-seed.server';
import { database, UPLOAD_CLAIM_LEASE_MS } from './database.server';
import {
  datasourceOperation,
  libraryMetricApplies,
  seedField,
} from './datasource-operations.server';
import { authorizeDashboard, dashboardUsesDataSource } from './dashboard-access.server';

export async function listDatasourceProviders() {
  await requireSession();
  return providers.map((provider) => provider.definition);
}

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

export async function updateDatasource(
  request: Extract<ApiRequest, { action: 'updateDatasource' }>,
) {
  const session = await requireSession();
  const source = await loadDataSource(request.dataSourceId, session.workspace.id);
  await database()
    .update(dataSources)
    .set({ cachePolicy: request.cachePolicy, updatedAt: new Date().toISOString() })
    .where(and(eq(dataSources.id, source.id), eq(dataSources.workspaceId, session.workspace.id)));
  console.info('yresonance.datasource_cache_policy', {
    datasourceId: source.id,
    workspaceId: session.workspace.id,
    cachePolicy: request.cachePolicy,
  });
  return { ...source, cachePolicy: request.cachePolicy };
}

export async function describeDatasource(
  dataSourceId: string,
  dashboardId?: string,
  shareToken?: string,
) {
  const workspaceId =
    dashboardId || shareToken
      ? await dashboardDatasourceWorkspace(dataSourceId, dashboardId, shareToken)
      : (await requireSession()).workspace.id;
  const { dataSource, metadata } = await loadQueryContext(dataSourceId, workspaceId);
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
    provider: datasourceProvider(dataSource.connectorType).definition,
    defaultCacheTtlSeconds: datasourceProvider(
      dataSource.connectorType,
    ).backend.defaultCacheTtlSeconds(dataSource),
    fields: metadata.fields.filter((field) => !field.hidden),
    calculatedFields: metadata.calculatedFields,
    libraryMetrics: applicableMetrics,
  };
}

async function dashboardDatasourceWorkspace(
  dataSourceId: string,
  dashboardId: string | undefined,
  shareToken: string | undefined,
) {
  if (!dashboardId)
    throw new ApiError(400, 'dashboard_required', 'Shared datasource access needs a dashboard.');
  const access = await authorizeDashboard(dashboardId, 'viewer', shareToken);
  if (access.role === 'admin' || access.role === 'editor') return access.document.workspaceId;
  const referenced = dashboardWidgets(access.document).some(
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
  const prepared = registrationProvider(request).prepare(request, {
    workspaceId: session.workspace.id,
    workspacePrefix: session.workspace.r2Prefix,
  });
  const { backend: connector, source: pending, managedUploadKey, connection } = prepared;
  const claimId = managedUploadKey
    ? await claimPendingUpload(session, managedUploadKey, request.cleanupToken)
    : undefined;
  let imported: ManagedUploadImport | undefined;
  try {
    if (managedUploadKey) {
      const uploads = connector.managedUploads;
      if (!uploads)
        throw new ApiError(
          400,
          'managed_upload_not_supported',
          'This backend does not support managed uploads.',
        );
      imported = await datasourceOperation(() => uploads.import(pending));
    }
    const inspection =
      imported?.inspection ?? (await datasourceOperation(() => connector.inspect(pending)));
    const dataSource: DataSourceRecord = {
      ...(imported?.dataSource ?? { ...pending, version: inspection.version }),
      cachePolicy: request.cachePolicy,
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
        cachePolicy: dataSource.cachePolicy,
        version: dataSource.version,
        createdAt: now,
        updatedAt: now,
      }),
      ...(connection
        ? [
            db.insert(datasourceConnections).values({
              datasourceId: dataSource.id,
              workspaceId: dataSource.workspaceId,
              encryptedConfig: await sealConnection(
                connection,
                env.UPLOAD_SIGNING_SECRET,
                `${dataSource.workspaceId}/${dataSource.id}`,
              ),
            }),
          ]
        : []),
      ...discovered.map((field) =>
        db.insert(fields).values({ ...field, workspaceId: session.workspace.id }),
      ),
      ...uploadCompletion,
    ]);
    if (imported)
      await imported.cleanup('registered').catch((error: unknown) => {
        console.warn('yresonance.datasource_ingestion_cleanup_failed', {
          workspaceId: session.workspace.id,
          sourceKey: managedUploadKey,
          error: error instanceof Error ? error.message : 'Unknown cleanup error.',
        });
      });
    console.info('yresonance.datasource_registered', {
      workspaceId: session.workspace.id,
      datasourceId: dataSource.id,
      provider: connector.type,
      group: registrationProvider(request).definition.group,
    });
    return { ...dataSource, fields: discovered };
  } catch (error) {
    if (imported) await imported.cleanup('failed').catch(() => undefined);
    if (managedUploadKey && claimId)
      await restorePendingUpload(session, managedUploadKey, 'registering', claimId);
    throw error;
  }
}

function uploadCleanupSecret() {
  return env.UPLOAD_SIGNING_SECRET;
}

async function isDatasourceObjectRegistered(workspaceId: string, key: string) {
  const registeredSources = await database()
    .select({ location: dataSources.location, connectorType: dataSources.connectorType })
    .from(dataSources)
    .where(eq(dataSources.workspaceId, workspaceId));
  return registeredSources.some(({ location, connectorType }) =>
    datasourceProvider(connectorType).backend.managedStorage?.references(location, key),
  );
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
