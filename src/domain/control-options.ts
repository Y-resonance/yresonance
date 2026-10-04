import type { SqlDialect } from '#/query/dialect';
export function controlOptionsQuery(
  expression: string,
  search: string | undefined,
  direction: string,
  sourceTable = 'yresonance_source',
  dialect?: SqlDialect,
) {
  const parameters: unknown[] = [];
  const text =
    dialect === 'clickhouse' ? `toString(${expression})` : `CAST(${expression} AS VARCHAR)`;
  const where = search
    ? dialect === 'clickhouse'
      ? ` WHERE positionCaseInsensitiveUTF8(${text}, ?) > 0`
      : ` WHERE ${text} ILIKE ? ESCAPE '!'`
    : ` WHERE ${expression} IS NOT NULL`;
  if (search)
    parameters.push(
      dialect === 'clickhouse'
        ? search
        : `%${search.replace(/[!%_]/g, (character) => `!${character}`)}%`,
    );
  const exactFirst = search ? `MIN(CASE WHEN ${text} = ? THEN 0 ELSE 1 END), ` : '';
  if (search) parameters.push(search);
  return {
    sql: `SELECT ${expression} AS value FROM ${sourceTable}${where} GROUP BY 1 ORDER BY ${exactFirst}1 ${direction} LIMIT 100`,
    parameters,
  };
}
