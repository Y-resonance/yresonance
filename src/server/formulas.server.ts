import { requireSession, type SessionContext } from './auth.server';
import { libraryMetrics, calculatedFields, dataSources } from '#/db/schema';
import { eq, and } from 'drizzle-orm';
import { type ApiRequest } from '#/api/contracts';
import { ApiError } from './errors';
import {
  validateAggregateFormula,
  assertCalculatedFieldNameAvailable,
  validateRowFormula,
} from '#/query/compiler';
import { loadDataSource, loadQueryMetadata } from './records.server';
import { database } from './database.server';
import {
  datasourceOperation,
  connectorFor,
  normalize,
  slug,
  libraryMetricApplies,
} from './datasource-operations.server';
import { authorizeDashboard, dashboardUsesDataSource } from './dashboard-access.server';

export async function listLibraryMetrics() {
  const session = await requireSession();
  return database()
    .select()
    .from(libraryMetrics)
    .where(eq(libraryMetrics.workspaceId, session.workspace.id));
}

export async function upsertCalculatedField(
  request: Extract<ApiRequest, { action: 'upsertCalculatedField' }>,
) {
  const { session, dataSource, metadata, canonicalName } = await calculatedFieldContext(request);
  validateCalculatedFieldExpression(request, metadata, canonicalName);
  await datasourceOperation(() =>
    connectorFor(dataSource).validateExpression(dataSource, {
      kind: 'calculatedField',
      id: request.id,
      canonicalName,
      expression: request.expression,
      semanticType: request.semanticType,
      metadata,
    }),
  );
  const mutableValues = {
    canonicalName,
    label: request.name,
    expression: request.expression,
    role: request.role,
    semanticType: request.semanticType,
    defaultAggregation: request.defaultAggregation ?? null,
    description: request.description ?? null,
    updatedAt: new Date().toISOString(),
  };
  const db = database();
  if (request.id) {
    const [updated] = await db
      .update(calculatedFields)
      .set(mutableValues)
      .where(
        and(
          eq(calculatedFields.id, request.id),
          eq(calculatedFields.workspaceId, session.workspace.id),
          eq(calculatedFields.dataSourceId, dataSource.id),
        ),
      )
      .returning();
    if (!updated)
      throw new ApiError(404, 'calculated_field_not_found', 'Calculated field not found.');
    return updated;
  }
  const values = {
    id: `calc_${crypto.randomUUID()}`,
    workspaceId: session.workspace.id,
    dataSourceId: dataSource.id,
    ...mutableValues,
  };
  const [created] = await db.insert(calculatedFields).values(values).returning();
  return created;
}

export async function validateCalculatedField(
  request: Extract<ApiRequest, { action: 'validateCalculatedField' }>,
) {
  const { metadata, canonicalName } = await calculatedFieldContext(request);
  try {
    const compiled = validateCalculatedFieldExpression(request, metadata, canonicalName);
    return { valid: true as const, type: compiled.type, identifiers: compiled.identifiers };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const position = formulaErrorPosition(message, request.expression);
    return { valid: false as const, error: { message, ...position } };
  }
}

export async function previewCalculatedFieldValues(
  request: Extract<ApiRequest, { action: 'previewCalculatedFieldValues' }>,
) {
  const { dataSource, metadata, canonicalName } = await calculatedFieldContext(request);
  validateCalculatedFieldExpression(request, metadata, canonicalName);
  const field = {
    id: request.id ?? '__preview__',
    dataSourceId: request.dataSourceId,
    canonicalName,
    label: request.name,
    expression: request.expression,
    role: 'dimension' as const,
    semanticType: request.semanticType,
    description: null,
  };
  const rows = await datasourceOperation(() =>
    connectorFor(dataSource).executeQuery<{ value: unknown }>(dataSource, {
      kind: 'controlOptions',
      field,
      metadata,
      direction: 'ASC',
    }),
  );
  return { values: rows.slice(0, 10).map((row) => normalize(row.value)) };
}

/**
 * Checks a custom metric formula without saving it. Aggregate formulas must wrap every
 * field reference in an aggregate function, which is the mistake this surfaces early.
 */
export async function validateMetricExpression(
  request: Extract<ApiRequest, { action: 'validateMetricExpression' }>,
) {
  const { metadata } = await datasourceFormulaContext(request);
  try {
    if (!request.expression.trim()) throw new Error('A formula is required.');
    const compiled = validateAggregateFormula(request.expression, metadata);
    return { valid: true as const, type: compiled.type, identifiers: compiled.identifiers };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const position = formulaErrorPosition(message, request.expression);
    return { valid: false as const, error: { message, ...position } };
  }
}

/**
 * Writing a formula against a datasource needs workspace admin rights, or editor access
 * to a dashboard that actually uses that datasource.
 */
async function datasourceFormulaContext(request: { dashboardId?: string; dataSourceId: string }) {
  const session = await requireSession();
  if (!session.isAdmin) {
    if (!request.dashboardId)
      throw new ApiError(
        403,
        'dashboard_editor_required',
        'Formulas require editor access to a dashboard.',
      );
    const access = await authorizeDashboard(request.dashboardId, 'editor');
    if (!dashboardUsesDataSource(access.document, request.dataSourceId))
      throw new ApiError(
        403,
        'dashboard_datasource_required',
        'The authorized dashboard does not use this datasource.',
      );
  }
  const dataSource = await loadDataSource(request.dataSourceId, session.workspace.id);
  const metadata = await loadQueryMetadata(dataSource.id, session.workspace.id);
  return { session, dataSource, metadata };
}

async function calculatedFieldContext(
  request: Extract<
    ApiRequest,
    { action: 'upsertCalculatedField' | 'validateCalculatedField' | 'previewCalculatedFieldValues' }
  >,
) {
  const { session, dataSource, metadata } = await datasourceFormulaContext(request);
  const existing = request.id
    ? metadata.calculatedFields.find((field) => field.id === request.id)
    : undefined;
  const canonicalName = existing?.canonicalName ?? request.canonicalName ?? slug(request.name);
  if (!canonicalName)
    throw new ApiError(
      400,
      'calculated_field_name_invalid',
      'The field name must contain a letter or number.',
    );
  return { session, dataSource, metadata, canonicalName };
}

function validateCalculatedFieldExpression(
  request: Extract<
    ApiRequest,
    { action: 'upsertCalculatedField' | 'validateCalculatedField' | 'previewCalculatedFieldValues' }
  >,
  metadata: Awaited<ReturnType<typeof loadQueryMetadata>>,
  canonicalName: string,
) {
  assertCalculatedFieldNameAvailable(canonicalName, metadata, request.id);
  const semanticType = request.semanticType;
  const calculatedFields = [
    ...metadata.calculatedFields.filter((field) => field.id !== request.id),
    {
      id: request.id ?? '__candidate__',
      dataSourceId: request.dataSourceId,
      canonicalName,
      label: request.name,
      expression: request.expression,
      role: 'dimension' as const,
      semanticType: semanticType ?? 'text',
      description: null,
    },
  ];
  return validateRowFormula(
    request.expression,
    { fields: metadata.fields, calculatedFields },
    semanticType,
  );
}

function formulaErrorPosition(message: string, expression: string) {
  const match = message.match(/position (\d+)/iu);
  const from = match ? Math.max(0, Number(match[1]) - 1) : 0;
  return { from: Math.min(from, expression.length), to: Math.min(from + 1, expression.length) };
}

export async function upsertLibraryMetric(
  request: Extract<ApiRequest, { action: 'upsertLibraryMetric' }>,
) {
  const session = await requireSession();
  if (!session.isAdmin) {
    if (request.id)
      throw new ApiError(
        403,
        'library_metric_admin_required',
        'Only workspace admins can update library metrics.',
      );
    if (!request.dashboardId)
      throw new ApiError(
        403,
        'dashboard_editor_required',
        'Library metrics require editor access to a dashboard.',
      );
    await authorizeDashboard(request.dashboardId, 'editor');
  }
  await validateLibraryMetricInput(request, session);
  const mutableValues = {
    name: request.name,
    canonicalName: request.canonicalName ?? slug(request.name),
    expression: request.expression,
    semanticType: request.semanticType,
    description: request.description ?? null,
    updatedAt: new Date().toISOString(),
  };
  const db = database();
  if (request.id) {
    const [updated] = await db
      .update(libraryMetrics)
      .set(mutableValues)
      .where(
        and(
          eq(libraryMetrics.id, request.id),
          eq(libraryMetrics.workspaceId, session.workspace.id),
        ),
      )
      .returning();
    if (!updated) throw new ApiError(404, 'library_metric_not_found', 'Library metric not found.');
    return updated;
  }
  const values = newLibraryMetricValues(request, session.workspace.id);
  const [created] = await db.insert(libraryMetrics).values(values).returning();
  return created;
}

type LibraryMetricInput = NonNullable<
  Extract<ApiRequest, { action: 'updateWidget' }>['libraryMetric']
>;

export async function validateLibraryMetricInput(
  input: LibraryMetricInput,
  session: SessionContext,
) {
  const sourceRows = await database()
    .select()
    .from(dataSources)
    .where(eq(dataSources.workspaceId, session.workspace.id));
  let validated = false;
  for (const row of sourceRows) {
    const dataSource = await loadDataSource(row.id, session.workspace.id);
    const metadata = await loadQueryMetadata(row.id, session.workspace.id);
    if (
      await datasourceOperation(() =>
        libraryMetricApplies(dataSource, {
          kind: 'libraryMetric',
          expression: input.expression,
          semanticType: input.semanticType,
          metadata,
        }),
      )
    ) {
      validated = true;
      break;
    }
  }
  if (!validated)
    throw new ApiError(
      400,
      'metric_not_applicable',
      'No datasource contains every canonical field referenced by this metric.',
    );
}

export function newLibraryMetricValues(input: LibraryMetricInput, workspaceId: string) {
  return {
    id: `metric_${crypto.randomUUID()}`,
    workspaceId,
    name: input.name,
    canonicalName: input.canonicalName ?? slug(input.name),
    expression: input.expression,
    semanticType: input.semanticType,
    description: input.description ?? null,
    updatedAt: new Date().toISOString(),
  };
}
