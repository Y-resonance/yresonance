import { Client, escapeLiteral } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { z } from 'zod';
import { previewClickhouseDatabase } from './preview-config';

class PreviewProvisioningError extends Error {}

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
  action: 'prepare' | 'cleanup',
  branch: string,
  api: CloudflareApi,
) {
  const database = previewClickhouseDatabase(branch);
  const name = `yresonance-postgres-${database.slice('yresonance_preview_'.length)}`;
  const configs = configurationsSchema.parse(await api('/hyperdrive/configs'));
  const config = configs.find((item) => item.name === name);
  const url = process.env.POSTGRES_PREVIEW_URL;
  if (!url)
    throw new PreviewProvisioningError(
      'POSTGRES_PREVIEW_URL is required for preview Postgres provisioning and cleanup.',
    );
  const admin = new Client({ connectionString: url });
  try {
    await admin.connect();
    // Serialize prepare/cleanup across builds, including capacity checks and partial retries.
    await admin.query("SELECT pg_advisory_lock(hashtext('yresonance-preview-provisioning'))");
    if (action === 'cleanup') {
      // Delete the pool before forcibly closing its origin connections.
      if (config) await api(`/hyperdrive/configs/${config.id}`, 'DELETE');
      await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
      return;
    }
    const password = process.env.POSTGRES_PREVIEW_RUNTIME_PASSWORD;
    if (!password)
      throw new PreviewProvisioningError(
        'POSTGRES_PREVIEW_RUNTIME_PASSWORD is required for the shared preview runtime role.',
      );
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
      await direct.connect();
      await migrate(drizzle(direct), { migrationsFolder: './drizzle' });
      await direct.query(`GRANT USAGE ON SCHEMA public TO ${runtimeRole}`);
      await direct.query(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${runtimeRole}`,
      );
      await direct.query(
        `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${runtimeRole}`,
      );
    } finally {
      await direct.end();
    }
    if (config) {
      if (!config.caching?.disabled)
        throw new PreviewProvisioningError('Preview Hyperdrive query caching must be disabled.');
      return config.id;
    }
    const created = z.object({ id: z.string() }).parse(
      await api('/hyperdrive/configs', 'POST', {
        name,
        origin: {
          scheme: 'postgres',
          host: directUrl.hostname,
          port: Number(directUrl.port || 5432),
          database,
          user: runtimeRole,
          password,
        },
        caching: { disabled: true },
        origin_connection_limit: 5,
      }),
    );
    return created.id;
  } catch (error) {
    if (error instanceof PreviewProvisioningError) throw error;
    // Query exceptions can include the CREATE ROLE password or an origin connection URL.
    throw new PreviewProvisioningError(
      `Postgres preview ${action} failed for ${database}; check provisioning access, capacity, runtime credentials and migration state in a secure session.`,
    );
  } finally {
    // Disconnect also releases the advisory lock on every failure path.
    await admin.end();
  }
}
