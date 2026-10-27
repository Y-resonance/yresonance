import type { CompiledFormula, FormulaField, FormulaMode, FormulaType } from './formula';
import type { SqlDialect } from './dialect';

// Only expression tokens enter generated SQL. In particular, identifiers are never copied
// from user input: canonical references are replaced with server-resolved field SQL.
const keywords = new Set(
  `AND OR NOT NULL TRUE FALSE CASE WHEN THEN ELSE END AS DISTINCT IS IN BETWEEN LIKE ILIKE ESCAPE INTERVAL YEAR QUARTER MONTH WEEK DAY HOUR MINUTE SECOND MILLISECOND MICROSECOND DOW DOY EPOCH DATE DATE32 DATETIME DATETIME64 TIMESTAMP TIME ZONE WITH WITHOUT STRING FIXEDSTRING VARCHAR TEXT INT INTEGER BIGINT INT8 INT16 INT32 INT64 INT128 INT256 UINT8 UINT16 UINT32 UINT64 UINT128 UINT256 FLOAT FLOAT32 FLOAT64 DOUBLE DECIMAL DECIMAL32 DECIMAL64 DECIMAL128 DECIMAL256 NUMERIC BIGNUMERIC BOOL BOOLEAN SIGNED UNSIGNED PRECISION IGNORE RESPECT NULLS ASC DESC ORDER BY FILTER WHERE FROM`.split(
    ' ',
  ),
);
const forbidden =
  /^(?:SELECT|FROM|JOIN|UNION|INTERSECT|EXCEPT|INSERT|UPDATE|DELETE|MERGE|CREATE|DROP|ALTER|COPY|ATTACH|DETACH|PRAGMA|SET|RESET|CALL|EXECUTE|INSTALL|LOAD|EXPORT|IMPORT|INTO|FORMAT|SETTINGS|LIMIT|OFFSET|OVER|WINDOW|HAVING|QUALIFY|RETURNING)$/iu;
// These functions access server state, other data, or perform dynamic execution. Native
// computational functions are not restricted to the portable formula function catalog.
const unsafeFunction =
  /^(?:read_|write_|scan_|query|eval|execute|external_|remote|cluster|dict|get|joinGet|file|url|http|s3|azure|hdfs|jdbc|odbc|mysql|postgres|sqlite|delta|iceberg|merge|input|numbers|generateRandom|sleep|throwIf|error|current_query|current_setting|set_config|nextval|currval|version|current_user|session_user|user|current_database|current_schema|database|hostName|addressToLine|addressToSymbol|filesystem|shell|system|connectionId|initialUser|runningAccumulate|finalizeAggregation|catboost|modelEvaluate|hasColumnInTable)/iu;

export interface NativeToken {
  kind: 'text' | 'reference' | 'word' | 'symbol';
  value: string;
}

export function nativeFormulaTokens(source: string, dialect: SqlDialect): NativeToken[] {
  if (!source.trim()) throw new Error('A formula is required.');
  if (source.length > 16_000) throw new Error('Formulas support at most 16000 characters.');
  const tokens: NativeToken[] = [];
  let position = 0;
  while (position < source.length) {
    const rest = source.slice(position);
    const whitespace = rest.match(/^\s+/u)?.[0];
    if (whitespace) {
      tokens.push({ kind: 'text', value: whitespace });
      position += whitespace.length;
      continue;
    }
    if (rest.startsWith('--') || (dialect === 'bigquery' && rest.startsWith('#'))) {
      const end = rest.indexOf('\n');
      position += end < 0 ? rest.length : end;
      tokens.push({ kind: 'text', value: '\n' });
      continue;
    }
    if (rest.startsWith('/*')) {
      const end = rest.indexOf('*/', 2);
      if (end < 0 || rest.slice(2, end).includes('/*')) throw new Error('Invalid SQL comment.');
      position += end + 2;
      tokens.push({ kind: 'text', value: ' ' });
      continue;
    }
    if (rest.startsWith('{{')) {
      const end = rest.indexOf('}}', 2);
      if (end < 0) throw new Error('Close field references with }}.');
      const name = rest.slice(2, end).trim();
      if (!name || /[{}\r\n]/u.test(name)) throw new Error('Invalid canonical field reference.');
      tokens.push({ kind: 'reference', value: name });
      position += end + 2;
      continue;
    }
    const quote = rest[0];
    if (quote === "'" || (quote === '"' && dialect === 'bigquery')) {
      let end = 1;
      for (; end < rest.length; end++) {
        if (rest[end] === '\\' && dialect !== 'duckdb') {
          end++;
          continue;
        }
        if (rest[end] !== quote) continue;
        if (rest[end + 1] === quote) {
          end++;
          continue;
        }
        break;
      }
      if (end >= rest.length) throw new Error('Unterminated SQL string.');
      tokens.push({ kind: 'text', value: rest.slice(0, end + 1) });
      position += end + 1;
      continue;
    }
    const number = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/iu)?.[0];
    if (number) {
      tokens.push({ kind: 'text', value: number });
      position += number.length;
      continue;
    }
    const word = rest.match(/^[A-Za-z_][A-Za-z0-9_]*/u)?.[0];
    if (word) {
      tokens.push({ kind: 'word', value: word });
      position += word.length;
      continue;
    }
    if ('()+-*/%=<>!,[]|&^~:'.includes(quote)) {
      tokens.push({ kind: 'symbol', value: quote });
      position++;
      continue;
    }
    throw new Error(
      `Unsupported SQL token at position ${position + 1}. Use {{canonical_field_name}} for fields and unqualified native functions.`,
    );
  }
  if (tokens.length > 1024) throw new Error('Native formula exceeds the token limit.');
  return tokens;
}

export function nativeFormulaIdentifiers(source: string, dialect: SqlDialect) {
  return nativeFormulaTokens(source, dialect)
    .filter((token) => token.kind === 'reference')
    .map((token) => token.value);
}

export function compileNativeFormula(
  source: string,
  options: {
    mode: FormulaMode;
    fields: FormulaField[];
    dialect?: SqlDialect;
    formulaDialect: SqlDialect;
    type?: FormulaType;
  },
): CompiledFormula {
  const dialect = options.dialect ?? 'duckdb';
  if (options.formulaDialect !== dialect)
    throw new Error(
      `This formula requires ${options.formulaDialect}; the datasource uses ${dialect}.`,
    );
  const tokens = nativeFormulaTokens(source, dialect);
  const significant = tokens.filter((token) => token.kind !== 'text' || token.value.trim());
  const fields = new Map(options.fields.map((field) => [field.canonicalName.toLowerCase(), field]));
  const identifiers = new Set<string>();
  const groups: Array<{ close: string; functionName?: string }> = [];
  for (let i = 0; i < significant.length; i++) {
    const token = significant[i];
    if (token.kind === 'word') {
      const call = significant[i + 1]?.value === '(';
      const extractFrom =
        token.value.toUpperCase() === 'FROM' &&
        ['EXTRACT', 'TRIM', 'SUBSTRING', 'OVERLAY'].includes(groups.at(-1)?.functionName ?? '');
      if (
        (!extractFrom && forbidden.test(token.value)) ||
        (call && unsafeFunction.test(token.value))
      )
        throw new Error(`SQL ${token.value} is not allowed in datasource expressions.`);
      if (!call && !keywords.has(token.value.toUpperCase()))
        throw new Error(`Use {{${token.value}}} to reference a canonical field.`);
    }
    if (token.kind === 'symbol') {
      if (token.value === '(' || token.value === '[')
        groups.push({
          close: token.value === '(' ? ')' : ']',
          functionName:
            significant[i - 1]?.kind === 'word'
              ? significant[i - 1].value.toUpperCase()
              : undefined,
        });
      if ((token.value === ')' || token.value === ']') && groups.pop()?.close !== token.value)
        throw new Error('Unbalanced SQL expression.');
      if (token.value === ',' && groups.length === 0)
        throw new Error('Provide exactly one SQL expression.');
    }
  }
  if (groups.length !== 0) throw new Error('Unbalanced SQL expression.');
  let sqlLength = 2;
  const sql = tokens
    .map((token) => {
      if (token.kind !== 'reference') {
        sqlLength += token.value.length;
        if (sqlLength > 100_000)
          throw new Error('Formula expansion exceeds the SQL complexity limit.');
        return token.value;
      }
      const field = fields.get(token.value.toLowerCase());
      if (!field) throw new Error(`Unknown formula field ${token.value}.`);
      sqlLength += field.sql.length + 2;
      if (sqlLength > 100_000)
        throw new Error('Formula expansion exceeds the SQL complexity limit.');
      identifiers.add(field.canonicalName);
      return `(${field.sql})`;
    })
    .join('');
  return {
    sql: `(${sql})`,
    type: options.type ?? (options.mode === 'aggregate' ? 'number' : 'unknown'),
    identifiers: [...identifiers],
  };
}

export function nativeFunctionNames(source: string, dialect: SqlDialect) {
  const tokens = nativeFormulaTokens(source, dialect).filter(
    (token) => token.kind !== 'text' || token.value.trim(),
  );
  const groups: Array<{ functionName?: string; type: boolean }> = [];
  const names: string[] = [];
  let cases = 0;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    const word = token.value.toUpperCase();
    if (token.kind === 'word') {
      if (word === 'CASE') cases++;
      if (word === 'END') cases--;
      const group = groups.at(-1);
      if (
        word === 'AS' &&
        group &&
        ['CAST', 'TRY_CAST', 'SAFE_CAST'].includes(group.functionName ?? '')
      )
        group.type = true;
      const caseClause = cases > 0 && ['WHEN', 'THEN', 'ELSE'].includes(word);
      if (tokens[index + 1]?.value === '(' && !group?.type && !caseClause) names.push(token.value);
    }
    if (token.value === '(')
      groups.push({
        functionName:
          tokens[index - 1]?.kind === 'word' ? tokens[index - 1].value.toUpperCase() : undefined,
        type: groups.at(-1)?.type ?? false,
      });
    if (token.value === ')') groups.pop();
  }
  return names;
}
