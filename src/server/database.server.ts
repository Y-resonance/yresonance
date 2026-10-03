import { createDatabase } from '#/db/client';
import { env } from 'cloudflare:workers';

export const database = () => createDatabase(env.DB);

export const UPLOAD_CLAIM_LEASE_MS = 60 * 60 * 1000;
