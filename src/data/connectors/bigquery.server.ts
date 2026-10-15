import { dataSourceLocationSchema } from '#/domain/schema';
import { hashJson } from '#/domain/hash';
import { quoteSqlIdentifier } from '#/query/dialect';
import type { AnalyticsDataBackend } from '../analytics-data-backend';
import {
  compileDatasourceQuery,
  compileDatasourceWidget,
  datasourceExpressionSql,
} from '../backend-query';
import { authorizationReferenceSchema, googleAccessToken } from '../google-oauth.server';
import { loadConnection } from '../connection-store.server';
import {
  bigqueryRequest,
  bigqueryTablePath,
  executeBigquery,
  tableSchema,
} from '../bigquery.server';
import { DatasourceError, type DatasourceQuery } from './contract';
import type { DataSourceRecord } from '#/query/types';

function location(source: Pick<DataSourceRecord, 'location'>) {
  const parsed = dataSourceLocationSchema.parse(source.location);
  if (parsed.kind !== 'bigquery')
    throw new DatasourceError('invalid_query', 'Choose a BigQuery table or view.');
  return parsed;
}
function table(source: Pick<DataSourceRecord, 'location'>) {
  const config = location(source);
  return quoteSqlIdentifier(`${config.project}.${config.dataset}.${config.table}`, 'bigquery');
}

export function bigqueryBackend(connection = loadConnection): AnalyticsDataBackend {
  async function token(source: Omit<DataSourceRecord, 'version'>) {
    const reference = authorizationReferenceSchema.parse(await connection(source));
    return googleAccessToken(source.workspaceId, reference.authorizationId);
  }
  return {
    type: 'bigquery',
    defaultCacheTtlSeconds: () => 300,
    async cacheIdentity(source) {
      // Revoked/disconnected grants must fail before even an application cache hit.
      const authorization = await token(source);
      return { source: source.location, revision: authorization.revision };
    },
    async inspect(source) {
      const config = location(source);
      const { accessToken } = await token(source);
      const metadata = tableSchema.parse(
        await bigqueryRequest(accessToken, bigqueryTablePath(config)),
      );
      if (metadata.location.toLowerCase() !== config.location.toLowerCase())
        throw new DatasourceError(
          'invalid_query',
          `This dataset is in ${metadata.location}. Use that location.`,
        );
      if (!['TABLE', 'VIEW', 'MATERIALIZED_VIEW'].includes(metadata.type))
        throw new DatasourceError('invalid_query', 'Choose a BigQuery table or view.');
      const supported = new Set([
        'STRING',
        'INTEGER',
        'INT64',
        'FLOAT',
        'FLOAT64',
        'NUMERIC',
        'BIGNUMERIC',
        'BOOLEAN',
        'BOOL',
        'DATE',
        'DATETIME',
        'TIMESTAMP',
      ]);
      const columns = metadata.schema.fields;
      if (columns.some((field) => field.mode === 'REPEATED' || !supported.has(field.type)))
        throw new DatasourceError(
          'datasource_inspection_failed',
          'Use a BigQuery view exposing scalar text, numeric, boolean, and date fields. Nested and repeated fields are not supported.',
        );
      const comparisonTypes: Record<string, string> = {
        INTEGER: 'INT64',
        INT64: 'INT64',
        FLOAT: 'FLOAT64',
        FLOAT64: 'FLOAT64',
        NUMERIC: 'NUMERIC',
        BIGNUMERIC: 'BIGNUMERIC',
        BOOLEAN: 'STRING',
        BOOL: 'STRING',
      };
      const description = columns.map((field) => ({
        column_name: field.name,
        // Persist numeric comparison types. Booleans use the app's text dimension model.
        cast_to: comparisonTypes[field.type],
        column_type:
          field.type === 'NUMERIC'
            ? 'DECIMAL(38,9)'
            : field.type === 'BIGNUMERIC'
              ? 'DECIMAL(76,38)'
              : field.type,
      }));
      // Metadata inspection does not scan customer data or create a billable query job.
      return {
        version: await hashJson({ location: source.location, description }),
        description,
        samples: [],
      };
    },
    async executeQuery<T extends Record<string, unknown>>(
      source: DataSourceRecord,
      query: DatasourceQuery,
    ) {
      const config = location(source);
      const compiled = compileDatasourceQuery(source, query, table(source), 'bigquery');
      return (await executeBigquery(
        (await token(source)).accessToken,
        config,
        compiled,
        source.workspaceId,
      )) as T[];
    },
    async validateQuery(source, query) {
      try {
        compileDatasourceWidget(source, query, table(source), 'bigquery');
      } catch (error) {
        throw new DatasourceError(
          'invalid_query',
          error instanceof Error ? error.message : 'Invalid query.',
        );
      }
    },
    explainQuery(source, query) {
      const compiled = compileDatasourceWidget(source, query, table(source), 'bigquery');
      return { sql: compiled.sql, definitions: compiled.definitions };
    },
    async validateExpression(source, expression) {
      location(source);
      try {
        datasourceExpressionSql(expression, 'bigquery');
      } catch (error) {
        throw new DatasourceError(
          'invalid_query',
          error instanceof Error ? error.message : 'Invalid formula.',
        );
      }
    },
  };
}
