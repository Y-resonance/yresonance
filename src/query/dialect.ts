export type SqlDialect = 'duckdb' | 'clickhouse';

export function quoteSqlIdentifier(value: string, dialect: SqlDialect = 'duckdb') {
  const escaped = dialect === 'clickhouse' ? value.replaceAll('\\', '\\\\') : value;
  return `"${escaped.replaceAll('"', '""')}"`;
}

export function sqlLiteral(value: string, dialect: SqlDialect = 'duckdb') {
  const escaped = dialect === 'clickhouse' ? value.replaceAll('\\', '\\\\') : value;
  return `'${escaped.replaceAll("'", "''")}'`;
}

// Managed imports keep nullable scalar types. Reject unsupported file types before creating a table.
export function clickhouseColumnType(type: string): string {
  const normalized = type.toUpperCase();
  const types: Record<string, string> = {
    BOOLEAN: 'Bool',
    TINYINT: 'Int8',
    SMALLINT: 'Int16',
    INTEGER: 'Int32',
    BIGINT: 'Int64',
    HUGEINT: 'Int128',
    UTINYINT: 'UInt8',
    USMALLINT: 'UInt16',
    UINTEGER: 'UInt32',
    UBIGINT: 'UInt64',
    UHUGEINT: 'UInt128',
    FLOAT: 'Float32',
    REAL: 'Float32',
    DOUBLE: 'Float64',
    VARCHAR: 'String',
    TEXT: 'String',
    DATE: 'Date32',
    TIMESTAMP: 'DateTime64(6)',
    TIMESTAMP_MS: 'DateTime64(3)',
    TIMESTAMP_NS: 'DateTime64(9)',
    'TIMESTAMP WITH TIME ZONE': "DateTime64(6, 'UTC')",
  };
  if (types[normalized]) return `Nullable(${types[normalized]})`;
  const decimal = normalized.match(/^DECIMAL\((\d+),\s*(\d+)\)$/u);
  if (decimal) return `Nullable(Decimal(${decimal[1]}, ${decimal[2]}))`;
  throw new Error(`Unsupported ClickHouse import type ${type}.`);
}
