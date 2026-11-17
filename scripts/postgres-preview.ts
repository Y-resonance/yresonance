import { Client, escapeLiteral } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { z } from 'zod';
import { previewClickhouseDatabase } from './preview-config';

class PreviewProvisioningError extends Error {}

const failureMetadataSchema = z.object({
  code: z
    .union([
      z.string().regex(/^[0-9A-Z]{5}$/), // PostgreSQL SQLSTATE
      z.enum([
        'ENOENT',
        'EACCES',
        'ENOTFOUND',
        'ECONNREFUSED',
        'ECONNRESET',
        'ETIMEDOUT',
        'EHOSTUNREACH',
        'ENETUNREACH',
        'EAI_AGAIN',
        'CERT_HAS_EXPIRED',
        'DEPTH_ZERO_SELF_SIGNED_CERT',
        'SELF_SIGNED_CERT_IN_CHAIN',
        'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
        'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
        'ERR_TLS_CERT_ALTNAME_INVALID',
      ]),
    ])
    .optional()
    .catch(undefined),
  status: z.number().int().min(100).max(599).optional().catch(undefined),
});

function provisioningFailure(action: string, database: string, operation: string, error: unknown) {
  const parsed = failureMetadataSchema.safeParse(error);
  const code = parsed.success ? parsed.data.code : undefined;
  const status = parsed.success ? parsed.data.status : undefined;
  const diagnostic = [operation, code && `code=${code}`, status && `HTTP ${status}`]
    .filter(Boolean)
    .join('; ');
  // Never include the original message, query, URL, stack or cause: they can contain secrets.
  return new PreviewProvisioningError(
    `Postgres preview ${action} failed for ${database} during ${diagnostic}.`,
  );
}

type CloudflareApi = (path: string, method?: string, body?: unknown) => Promise<unknown>;
const runtimeRole = 'yresonance_preview_runtime';
const configurationsSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    caching: z.object({ disabled: z.boolean() }).optional(),
  }),
);

// A branch database and its Hyperdrive are one lifecycle. The admin URL never reaches a Worker.
export async function managePreviewPostgres(
  action: 'prepare' | 'cleanup' | 'diagnose',
  branch: string,
  api: CloudflareApi,
) {
  const database = previewClickhouseDatabase(branch);
  const name = `yresonance-postgres-${database.slice('yresonance_preview_'.length)}`;
  const url = process.env.POSTGRES_PREVIEW_URL;
  if (!url)
    throw new PreviewProvisioningError(
      'POSTGRES_PREVIEW_URL is required for preview Postgres provisioning and cleanup.',
    );
  let admin: Client | undefined;
  let operation = 'connect to Postgres';
  try {
    admin = new Client({ connectionString: url });
    await admin.connect();
    // Serialize prepare/cleanup across builds, including capacity checks and partial retries.
    if (action !== 'diagnose') {
      operation = 'acquire provisioning lock';
      await admin.query("SELECT pg_advisory_lock(hashtext('yresonance-preview-provisioning'))");
    }
    operation = 'list Hyperdrive configurations';
    const configs: z.infer<typeof configurationsSchema> = [];
    for (let page = 1; ; page++) {
      const batch = configurationsSchema.parse(
        await api(`/hyperdrive/configs?page=${page}&per_page=20`),
      );
      configs.push(...batch);
      if (batch.length < 20) break;
    }
    if (action === 'diagnose') {
      operation = 'inspect preview database ownership';
      await admin.query('BEGIN READ ONLY');
      const databases = await admin.query<{ database: string; canDrop: boolean }>(
        `SELECT datname AS database, pg_has_role(current_user, datdba, 'MEMBER') AS "canDrop"
         FROM pg_database WHERE datname LIKE 'yresonance_preview_%' ORDER BY datname`,
      );
      await admin.query('ROLLBACK');
      console.info('yresonance.postgres_preview_diagnostic', {
        postgres: 'connected',
        databases: databases.rows,
        hyperdrive: 'readable',
        configurations: configs
          .filter((config) => config.name.startsWith('yresonance-postgres-'))
          .map((config) => config.name),
      });
      return;
    }
    const config = configs.find((item) => item.name === name);
    if (action === 'cleanup') {
      // Delete the pool before forcibly closing its origin connections.
      operation = 'delete Hyperdrive configuration';
      if (config) await api(`/hyperdrive/configs/${config.id}`, 'DELETE');
      operation = 'drop preview database';
      await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
      return;
    }
    const password = process.env.POSTGRES_PREVIEW_RUNTIME_PASSWORD;
    if (!password)
      throw new PreviewProvisioningError(
        'POSTGRES_PREVIEW_RUNTIME_PASSWORD is required for the shared preview runtime role.',
      );
    operation = 'inspect preview database capacity';
    const databases = await admin.query<{ datname: string }>(
      "SELECT datname FROM pg_database WHERE datname LIKE 'yresonance_preview_%'",
    );
    const exists = databases.rows.some((row) => row.datname === database);
    if (
      !exists &&
      databases.rows.filter((row) => row.datname !== 'yresonance_preview_shared').length >= 3
    )
      throw new PreviewProvisioningError(
        'Preview limit reached: the 25-connection PlanetScale branch fits the shared preview plus 3 branch previews (5 connections each). Close a preview first.',
      );
    if (!config && configs.length >= 25)
      throw new PreviewProvisioningError(
        'Hyperdrive configuration limit reached (25). Remove an unused preview first.',
      );
    operation = 'configure preview database and runtime role';
    const role = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [runtimeRole]);
    if (!role.rowCount) {
      // Utility statements do not accept bind parameters; escape only this secret literal.
      await admin.query(
        `CREATE ROLE ${runtimeRole} LOGIN NOCREATEDB NOCREATEROLE PASSWORD ${escapeLiteral(password)}`,
      );
    }
    if (!exists) await admin.query(`CREATE DATABASE "${database}"`);
    await admin.query(`GRANT CONNECT ON DATABASE "${database}" TO ${runtimeRole}`);
    const directUrl = new URL(url);
    directUrl.pathname = `/${database}`;
    const direct = new Client({ connectionString: directUrl.toString() });
    try {
      operation = 'connect to preview database';
      await direct.connect();
      operation = 'migrate preview database';
      await migrate(drizzle(direct), { migrationsFolder: './drizzle' });
      operation = 'grant preview runtime permissions';
      await direct.query(`GRANT USAGE ON SCHEMA public TO ${runtimeRole}`);
      await direct.query(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${runtimeRole}`,
      );
      await direct.query(
        `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${runtimeRole}`,
      );
    } finally {
      try {
        await direct.end();
      } catch (error) {
        throw provisioningFailure(action, database, 'disconnect from preview database', error);
      }
    }
    if (config) {
      if (!config.caching?.disabled)
        throw new PreviewProvisioningError('Preview Hyperdrive query caching must be disabled.');
      return config.id;
    }
    operation = 'create Hyperdrive configuration';
    const created = z.object({ id: z.string() }).parse(
      await api('/hyperdrive/configs', 'POST', {
        name,
        origin: {
          scheme: 'postgres',
          host: directUrl.hostname,
          port: Number(directUrl.port || 5432),
          database,
          // PlanetScale routes connections by the branch suffix in the login name.
          user: [runtimeRole, ...decodeURIComponent(directUrl.username).split('.').slice(1)].join(
            '.',
          ),
          password,
        },
        caching: { disabled: true },
        origin_connection_limit: 5,
      }),
    );
    return created.id;
  } catch (error) {
    if (error instanceof PreviewProvisioningError) throw error;
    throw provisioningFailure(action, database, operation, error);
  } finally {
    // Disconnect also releases the advisory lock on every failure path.
    try {
      await admin?.end();
    } catch (error) {
      throw provisioningFailure(action, database, 'disconnect from Postgres', error);
    }
  }
}
