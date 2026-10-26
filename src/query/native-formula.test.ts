import { describe, it, expect } from 'vitest';
import { DuckDBInstance } from '@duckdb/node-api';
import { compileFormula } from './formula';
import { validateRowFormula, validateAggregateFormula } from './compiler';
import { expressionValidationQuery } from '#/data/backend-query';
import type { SqlDialect } from './dialect';
import type { CalculatedFieldRecord, FieldRecord } from './types';

const fields: FieldRecord[] = [
  {
    id: 'cost',
    dataSourceId: 'source',
    canonicalName: 'media_cost',
    columnName: 'Physical Cost',
    label: 'Cost',
    role: 'metric',
    semanticType: 'currency',
    description: null,
    hidden: false,
    castTo: null,
    sampleValues: null,
    cardinality: null,
  },
];
const context = { fields, calculatedFields: [] };
const options = {
  mode: 'aggregate' as const,
  fields: [{ canonicalName: 'media_cost', sql: '"Physical Cost"', type: 'number' as const }],
};

describe('native datasource expressions', () => {
  it('compiles the BigQuery example without portable function translation', () => {
    const compiled = validateAggregateFormula(
      'SAFE_DIVIDE(SUM({{media_cost}}), COUNT(*))',
      { ...context, dialect: 'bigquery' },
      'ratio',
      'bigquery',
    );
    expect(compiled.sql).toBe('(SAFE_DIVIDE(SUM((`Physical Cost`)), COUNT(*)))');
    expect(compiled.identifiers).toEqual(['media_cost']);
    expect(() =>
      validateAggregateFormula('SAFE_DIVIDE(SUM({{media_cost}}), COUNT(*))', context, 'ratio'),
    ).toThrow(Error);
  });

  it.each(['bigquery', 'duckdb', 'clickhouse'] as const)(
    'binds %s formulas to exactly their declared dialect',
    (formulaDialect) => {
      const dialect: SqlDialect = formulaDialect === 'duckdb' ? 'bigquery' : 'duckdb';
      expect(() =>
        compileFormula('SUM({{media_cost}})', { ...options, formulaDialect, dialect }),
      ).toThrow(`requires ${formulaDialect}`);
    },
  );

  it.each(['duckdb', 'bigquery', 'clickhouse'] as const)(
    'resolves references without rewriting strings or comments in %s',
    (dialect) => {
      const compiled = compileFormula(
        "concat('{{missing}}', /* {{missing}} SELECT */ {{media_cost}}) -- {{missing}}",
        { ...options, mode: 'row', dialect, formulaDialect: dialect },
      );
      expect(compiled.identifiers).toEqual(['media_cost']);
      expect(compiled.sql).toContain("'{{missing}}'");
      expect(compiled.sql).not.toContain('SELECT');
      expect(() =>
        compileFormula('SUM({{missing}})', { ...options, dialect, formulaDialect: dialect }),
      ).toThrow('Unknown formula field missing');
    },
  );

  it.each([
    '(SELECT secret FROM other_table)',
    'sum({{media_cost}}); DELETE FROM other_table',
    'sum({{media_cost}}), 42',
    'sum({{media_cost}})) UNION SELECT 1',
    "external_query('connection', 'select secret')",
    "dictGet('other', 'secret', 1)",
    "getenv('TOKEN')",
    "file('/etc/passwd')",
    'project.dataset.fn(1)',
    '`Physical Cost`',
    '"Physical Cost"',
    'sum(PhysicalCost)',
    'sum({{media_cost}}) OVER ()',
    'sum({{media_cost}}) /* unterminated',
    'sum({{media_cost}}) /* nested /* */ SELECT 1 */',
    '([)]',
  ])('rejects unsupported structures and data access: %s', (expression) => {
    expect(() =>
      compileFormula(expression, { ...options, dialect: 'duckdb', formulaDialect: 'duckdb' }),
    ).toThrow(Error);
  });

  it('expands calculated dependencies, preserves canonical portability, and rejects cycles', () => {
    const calculated: CalculatedFieldRecord = {
      id: 'calc',
      dataSourceId: 'source',
      canonicalName: 'rounded_cost',
      label: 'Rounded',
      expression: 'round({{media_cost}}, 1)',
      formulaDialect: 'duckdb',
      role: 'metric',
      semanticType: 'currency',
      description: null,
    };
    const expression = 'sum({{rounded_cost}})';
    const metadata = { fields, calculatedFields: [calculated] };
    const first = validateAggregateFormula(expression, metadata, 'currency', 'duckdb');
    const second = validateAggregateFormula(
      expression,
      { ...metadata, fields: [{ ...fields[0], columnName: 'Different Column' }] },
      'currency',
      'duckdb',
    );
    expect(first.sql).toContain('"Physical Cost"');
    expect(second.sql).toContain('"Different Column"');
    expect(() =>
      validateRowFormula(
        '{{rounded_cost}}',
        { ...metadata, calculatedFields: [{ ...calculated, expression: '{{rounded_cost}} + 1' }] },
        'currency',
        'duckdb',
      ),
    ).toThrow('cycle');
  });

  it('executes native DuckDB functions and lets the binder reject invalid row/aggregate contexts and types', async () => {
    const instance = await DuckDBInstance.create(':memory:');
    const connection = await instance.connect();
    try {
      await connection.run(
        'CREATE TABLE source("Physical Cost" DOUBLE); INSERT INTO source VALUES (1.25), (3.75)',
      );
      const compiled = validateAggregateFormula(
        'quantile_cont({{media_cost}}, 0.5)',
        context,
        'currency',
        'duckdb',
      );
      const rows = await connection.runAndReadAll(`SELECT ${compiled.sql} AS value FROM source`);
      expect(rows.getRowObjectsJson()).toEqual([{ value: 2.5 }]);
      const definition = {
        kind: 'libraryMetric' as const,
        expression: 'SUM({{media_cost}})',
        formulaDialect: 'duckdb' as const,
        semanticType: 'count' as const,
        metadata: context,
      };
      await connection.run(expressionValidationQuery(definition, 'source').sql);
      await expect(
        connection.run(
          expressionValidationQuery({ ...definition, expression: '{{media_cost}}' }, 'source').sql,
        ),
      ).rejects.toThrow(Error);
      await expect(
        connection.run(
          expressionValidationQuery(
            { ...definition, expression: 'nonexistent_function({{media_cost}})' },
            'source',
          ).sql,
        ),
      ).rejects.toThrow(Error);
      await expect(
        connection.run(
          expressionValidationQuery({ ...definition, expression: "'text'" }, 'source').sql,
        ),
      ).rejects.toThrow(Error);
      await expect(
        connection.run(
          expressionValidationQuery(
            {
              ...definition,
              kind: 'calculatedField',
              canonicalName: 'new',
              expression: 'SUM({{media_cost}})',
            },
            'source',
          ).sql,
        ),
      ).rejects.toThrow(Error);
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
  });
});
