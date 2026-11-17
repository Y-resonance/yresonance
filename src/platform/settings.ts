export interface Settings {
  APP_ENV: string;
  CLICKHOUSE_ACCESS_CLIENT_ID: string;
  CLICKHOUSE_ACCESS_CLIENT_SECRET: string;
  CLICKHOUSE_DATABASE: string;
  CLICKHOUSE_EXTERNAL_TABLES: string;
  CLICKHOUSE_PASSWORD: string;
  CLICKHOUSE_URL: string;
  CLICKHOUSE_USER: string;
  DATA_SOURCE_BASE_URL: string;
  GOOGLE_OAUTH_CLIENT_ID: string;
  GOOGLE_OAUTH_CLIENT_SECRET: string;
  GOOGLE_OAUTH_HOSTED_DOMAIN: string;
  GOOGLE_OAUTH_REDIRECT_URI: string;
  IMAGE_UPLOAD_MAX_BYTES: string;
  INTERNAL_R2_SIGNING_SECRET: string;
  MAINTENANCE_MODE: string;
  POSTHOG_ENABLED: string;
  POSTHOG_HOST: string;
  POSTHOG_PROJECT_TOKEN: string;
  QUERY_CACHE_NAME: string;
  QUERY_DATA_SOURCE_BASE_URL: string;
  RESET_ADMIN_TOKEN: string;
  UPLOAD_SIGNING_SECRET: string;
}

// Workers with nodejs_compat and compatibility dates after 2025-04-01 populate process.env.
export function settings(): Settings {
  return process.env as unknown as Settings;
}
