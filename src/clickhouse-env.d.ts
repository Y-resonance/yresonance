declare namespace Cloudflare {
  interface Env {
    CLICKHOUSE_URL?: string;
    CLICKHOUSE_USER?: string;
    CLICKHOUSE_PASSWORD?: string;
    CLICKHOUSE_ACCESS_CLIENT_ID?: string;
    CLICKHOUSE_ACCESS_CLIENT_SECRET?: string;
    CLICKHOUSE_EXTERNAL_TABLES?: string;
  }
}
