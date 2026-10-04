import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

const migrationDirectory = new URL('../../drizzle/', import.meta.url);
const migrationFiles = readdirSync(migrationDirectory)
  .filter((name) => name.endsWith('.sql'))
  .sort();
const foreignKeyMigration = '0010_cascading-foreign-keys.sql';
const migrationSql = readFileSync(new URL(foreignKeyMigration, migrationDirectory), 'utf8');
const orphanSql = readFileSync(
  new URL('../../scripts/check-d1-orphans.sql', import.meta.url),
  'utf8',
);

// Two complete workspaces let migration and cascade checks detect collateral data loss.
function seedWorkspace(db: DatabaseSync, id: string) {
  db.exec(`
    INSERT INTO workspaces (id, clerk_organization_id, name, r2_prefix, created_at)
      VALUES ('ws_${id}', 'org_${id}', 'Workspace ${id}', 'ws/${id}/', '2026-10-03');
    INSERT INTO data_sources (id, workspace_id, name, location, version, created_at, updated_at)
      VALUES ('ds_${id}', 'ws_${id}', 'Sales', '{"kind":"object","key":"sales.parquet"}', 'v1', '2026-10-03', '2026-10-03');
    INSERT INTO fields (id, workspace_id, data_source_id, column_name, canonical_name, label, role, semantic_type)
      VALUES ('field_${id}', 'ws_${id}', 'ds_${id}', 'sales', 'sales', 'Sales', 'metric', 'currency');
    INSERT INTO calculated_fields (id, workspace_id, data_source_id, canonical_name, label, expression, role, semantic_type, updated_at)
      VALUES ('calc_${id}', 'ws_${id}', 'ds_${id}', 'double_sales', 'Double sales', 'sales * 2', 'metric', 'currency', '2026-10-03');
    INSERT INTO library_metrics (id, workspace_id, name, canonical_name, expression, semantic_type, updated_at)
      VALUES ('metric_${id}', 'ws_${id}', 'Total sales', 'total_sales', 'sum(sales)', 'currency', '2026-10-03');
    INSERT INTO dashboards (id, workspace_id, name, document, created_by, created_at, updated_at)
      VALUES ('dash_${id}', 'ws_${id}', 'Sales report', '{"widgets":[]}', 'user_${id}', '2026-10-03', '2026-10-03');
    INSERT INTO dashboard_grants (dashboard_id, clerk_user_id, role, granted_by, granted_at)
      VALUES ('dash_${id}', 'user_${id}', 'editor', 'user_${id}', '2026-10-03');
    INSERT INTO share_links (token, dashboard_id, created_by, created_at)
      VALUES ('link_${id}', 'dash_${id}', 'user_${id}', '2026-10-03');
    INSERT INTO datasource_uploads (key, workspace_id, clerk_user_id, status, created_at, updated_at)
      VALUES ('upload_${id}', 'ws_${id}', 'user_${id}', 'pending', '2026-10-03', '2026-10-03');
    INSERT INTO ingestion_tokens (id, workspace_id, source_key, destination_key, expires_at, created_at)
      VALUES ('token_${id}', 'ws_${id}', 'source', 'destination', '2026-10-04', '2026-10-03');
    INSERT INTO query_read_budgets (id, workspace_id, maximum_bytes, expires_at, created_at)
      VALUES ('budget_${id}', 'ws_${id}', 1000, '2026-10-04', '2026-10-03');
  `);
}

function rows(db: DatabaseSync) {
  const tables = db
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
    .all();
  return Object.fromEntries(
    tables.map(({ name }) => [
      String(name),
      db.prepare(`SELECT * FROM "${name}" ORDER BY 1`).all(),
    ]),
  );
}

function migrate(db: DatabaseSync) {
  // D1 runs each migration in a transaction with foreign keys always enabled.
  db.exec('BEGIN');
  try {
    db.exec(migrationSql);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

let db: DatabaseSync;
beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const name of migrationFiles) {
    if (name === foreignKeyMigration) break;
    db.exec(readFileSync(new URL(name, migrationDirectory), 'utf8'));
  }
  seedWorkspace(db, 'a');
  seedWorkspace(db, 'b');
});
afterEach(() => db.close());

describe('cascading foreign key migration', () => {
  test('preserves every existing row while enforcing foreign keys', () => {
    const before = rows(db);
    migrate(db);
    expect(rows(db)).toEqual(before);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  const relations = [
    ['data_sources', 'workspace_id'],
    ['fields', 'workspace_id'],
    ['calculated_fields', 'workspace_id'],
    ['library_metrics', 'workspace_id'],
    ['dashboards', 'workspace_id'],
    ['datasource_uploads', 'workspace_id'],
    ['ingestion_tokens', 'workspace_id'],
    ['query_read_budgets', 'workspace_id'],
    ['fields', 'data_source_id'],
    ['calculated_fields', 'data_source_id'],
    ['dashboard_grants', 'dashboard_id'],
    ['share_links', 'dashboard_id'],
  ];
  test.each(relations)(
    'detects and refuses existing orphans in %s.%s without losing data',
    (table, column) => {
      db.exec(`UPDATE ${table} SET ${column} = 'missing' WHERE rowid = 1`);
      const before = rows(db);
      const checks = orphanSql
        .split(';')
        .filter((sql) => sql.trim())
        .flatMap((sql) => db.prepare(sql).all());
      expect(checks.filter((row) => Number(row.orphan_count) > 0)).toEqual([
        { relation: `${table}.${column}`, orphan_count: 1 },
      ]);
      expect(() => migrate(db)).toThrow(/FOREIGN KEY constraint failed/);
      expect(rows(db)).toEqual(before);
    },
  );

  test.each([
    ['data_sources', 'ds_a', ['data_sources', 'fields', 'calculated_fields']],
    ['dashboards', 'dash_a', ['dashboards', 'dashboard_grants', 'share_links']],
    [
      'workspaces',
      'ws_a',
      [
        'workspaces',
        'data_sources',
        'fields',
        'calculated_fields',
        'library_metrics',
        'dashboards',
        'dashboard_grants',
        'share_links',
        'datasource_uploads',
        'ingestion_tokens',
        'query_read_budgets',
      ],
    ],
  ] as const)('deleting %s cascades only to its children', (parent, id, removedTables) => {
    migrate(db);
    const before = rows(db);
    db.prepare(`DELETE FROM ${parent} WHERE id = ?`).run(id);
    const after = rows(db);
    for (const [table, records] of Object.entries(before)) {
      expect(after[table]).toEqual(
        removedTables.some((removed) => removed === table) ? records.slice(1) : records,
      );
    }
  });
});
