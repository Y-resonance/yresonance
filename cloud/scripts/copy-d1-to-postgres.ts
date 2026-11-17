import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { getTableConfig } from 'drizzle-orm/pg-core';
import * as schema from '../../src/db/schema';
import { stableStringify } from '../../src/domain/hash';
import { openConnection } from '../../src/data/connection-secrets';

// Only an offline D1 SQL export is read. No D1 endpoint or live source is accepted.
const [action, exportPath] = process.argv.slice(2);
if (!['copy', 'verify'].includes(action ?? '') || !exportPath || !process.env.DATABASE_URL)
  throw new Error(
    'Usage: DATABASE_URL=<direct target> bun cloud/scripts/copy-d1-to-postgres.ts copy|verify <d1-export.sql>',
  );
const source = new Database(':memory:');
source.exec(readFileSync(exportPath, 'utf8'));
const target = new Client({ connectionString: process.env.DATABASE_URL });
// Foreign-key order. Read budgets represent in-flight work and intentionally do not survive cutover.
const tables = [
  schema.workspaces,
  schema.dataSources,
  schema.datasourceConnections,
  schema.datasourceAuthorizations,
  schema.datasourceUploads,
  schema.ingestionTokens,
  schema.fields,
  schema.calculatedFields,
  schema.libraryMetrics,
  schema.dashboards,
  schema.dashboardGrants,
  schema.shareLinks,
  schema.dashboardAssets,
  schema.queryReadBudgets,
];
try {
  await target.connect();
  await target.query(
    action === 'copy' ? 'BEGIN' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
  );
  for (const table of tables) {
    const config = getTableConfig(table);
    const columns = config.columns;
    const records = source.query(`SELECT * FROM "${config.name}"`).all() as Record<
      string,
      unknown
    >[];
    for (const column of columns.filter((column) => column.getSQLType() === 'integer')) {
      const [{ maximum, minimum }] = source
        .query(
          `SELECT MAX("${column.name}") AS maximum, MIN("${column.name}") AS minimum FROM "${config.name}"`,
        )
        .all() as { maximum: number | null; minimum: number | null }[];
      if ((maximum !== null && maximum > 2147483647) || (minimum !== null && minimum < -2147483648))
        throw new Error(`${config.name}.${column.name} exceeds Postgres integer range`);
      console.log(`${config.name}.${column.name}: min=${minimum}, max=${maximum}`);
    }
    if (table === schema.queryReadBudgets) {
      console.log('query_read_budgets: integer range checked; in-flight rows skipped');
      continue;
    }
    const decoded = records.map((record) =>
      Object.fromEntries(
        columns.map((column) => {
          let value = record[column.name];
          if (column.getSQLType() === 'jsonb' && value !== null) value = JSON.parse(String(value));
          if (column.getSQLType() === 'boolean') {
            if (value !== 0 && value !== 1)
              throw new Error(`${config.name}.${column.name}: expected 0 or 1`);
            value = value === 1;
          }
          return [column.name, value];
        }),
      ),
    );
    if (action === 'copy') {
      const existing = await target.query(`SELECT 1 FROM "${config.name}" LIMIT 1`);
      if (existing.rowCount)
        throw new Error(`Target ${config.name} is not empty. Refusing to overwrite rows.`);
      for (const row of decoded)
        await target.query(
          `INSERT INTO "${config.name}" (${columns.map((column) => `"${column.name}"`).join(',')}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(',')})`,
          columns.map((column) =>
            column.getSQLType() === 'jsonb' && row[column.name] !== null
              ? JSON.stringify(row[column.name])
              : row[column.name],
          ),
        );
    }
    const stored = await target.query<Record<string, unknown>>(`SELECT * FROM "${config.name}"`);
    const keys = [
      ...columns.filter((column) => column.primary),
      ...config.primaryKeys.flatMap((key) => key.columns),
    ];
    if (!keys.length) throw new Error(`${config.name} has no primary key`);
    const byKey = (rows: Record<string, unknown>[]) =>
      new Map(
        rows.map((row) => [
          stableStringify(keys.map((column) => row[column.name])),
          stableStringify(row),
        ]),
      );
    const expected = byKey(decoded);
    const actual = byKey(stored.rows);
    if (
      expected.size !== actual.size ||
      [...expected].some(([key, row]) => actual.get(key) !== row)
    )
      throw new Error(`Row verification failed for ${config.name}`);
    console.log(`${config.name}: ${expected.size} rows verified by primary key`);
  }
  const connection = await target.query<{
    encrypted_config: string;
    workspace_id: string;
    datasource_id: string;
  }>('SELECT * FROM datasource_connections LIMIT 1');
  if (connection.rows[0]) {
    const row = connection.rows[0];
    if (!process.env.UPLOAD_SIGNING_SECRET)
      throw new Error('UPLOAD_SIGNING_SECRET is required to verify an encrypted connection.');
    await openConnection(
      row.encrypted_config,
      process.env.UPLOAD_SIGNING_SECRET,
      `${row.workspace_id}/${row.datasource_id}`,
    );
    console.log('Encrypted datasource connection verified.');
  }
  await target.query('COMMIT');
} catch {
  await target.query('ROLLBACK').catch(() => undefined);
  // Database errors may include customer sample values or credentials. Do not print them.
  console.error(
    'Copy/verification failed; transaction rolled back. Inspect the offline source and target in a secure session.',
  );
  process.exitCode = 1;
} finally {
  source.close();
  await target.end();
}
