import type { DataSourceLocation } from '#/domain/schema';

export interface DatasourceListEntry {
  id: string;
  name: string;
  location: DataSourceLocation;
  fieldCount: number;
  updatedAt: string;
}

export interface DatasourceOverviewRow {
  id: string;
  name: string;
  sourceType: string;
  format: string;
  fieldCount: number;
  updatedAt: string;
}

const sourceTypeLabels: Record<DataSourceLocation['kind'], string> = {
  object: 'Single object',
  prefix: 'Partition prefix',
  clickhouse: 'ClickHouse',
};

const formatLabels: Record<'csv' | 'parquet', string> = {
  csv: 'CSV',
  parquet: 'Parquet',
};

export function datasourceOverviewRows(entries: DatasourceListEntry[]): DatasourceOverviewRow[] {
  return entries.map((entry) => ({
    id: entry.id,
    name: entry.name,
    sourceType: sourceTypeLabels[entry.location.kind] ?? entry.location.kind,
    format:
      entry.location.kind === 'clickhouse'
        ? entry.location.ownership === 'managed'
          ? 'Managed table'
          : 'External table'
        : formatLabels[entry.location.format],
    fieldCount: entry.fieldCount,
    updatedAt: entry.updatedAt,
  }));
}

const relativeUnits: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 60 * 60 * 1000],
  ['month', 30 * 24 * 60 * 60 * 1000],
  ['week', 7 * 24 * 60 * 60 * 1000],
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
];

/** Renders an ISO timestamp as a coarse "3 days ago", or an empty string when unparseable. */
export function formatRelativeTime(timestamp: string, now = new Date()) {
  const value = Date.parse(timestamp);
  if (Number.isNaN(value)) return '';
  const elapsed = value - now.getTime();
  const format = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const [unit, span] of relativeUnits) {
    if (Math.abs(elapsed) >= span) return format.format(Math.round(elapsed / span), unit);
  }
  return format.format(0, 'day');
}
