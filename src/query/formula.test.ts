import { describe, expect, it } from 'vitest';
import { compileFormula, type FormulaField } from './formula';

const fields: FormulaField[] = [
  { canonicalName: 'media_cost', sql: '"Media Cost"', type: 'number' },
  { canonicalName: 'impressions', sql: '"Impressions"', type: 'number' },
  { canonicalName: 'campaign', sql: '"Campaign"', type: 'text' },
];

describe('formula compiler', () => {
  it.each([
    { mode: 'row' as const, formula: 'media_cost % 2' },
    { mode: 'row' as const, formula: '(media_cost / impressions) % 2' },
    { mode: 'aggregate' as const, formula: 'sum(media_cost) % 2' },
  ])('rejects unsupported BigQuery remainder formulas: $formula', ({ mode, formula }) => {
    expect(() => compileFormula(formula, { mode, fields, dialect: 'bigquery' })).toThrow(
      'BigQuery does not support remainder (%) formulas.',
    );
  });

  it('compiles aggregate formulas from allowlisted syntax and trusted fields', () => {
    expect(
      compileFormula('sum(media_cost) / sum(impressions) * 1000', {
        mode: 'aggregate',
        fields,
      }),
    ).toMatchObject({
      sql: '((SUM("Media Cost") / SUM("Impressions")) * 1000)',
      type: 'number',
      identifiers: ['media_cost', 'impressions'],
    });
  });

  it('compiles row formulas without exposing SQL syntax', () => {
    expect(
      compileFormula(`if(contains(campaign, 'Brand'), media_cost, 0)`, {
        mode: 'row',
        fields,
      }).sql,
    ).toBe(`CASE WHEN CONTAINS("Campaign", 'Brand') THEN "Media Cost" ELSE 0 END`);
  });

  it.each([
    "read_parquet('https://evil.example/file.parquet')",
    'sum(media_cost); attach database evil',
    'install httpfs',
    'sum(media_cost) over ()',
  ])('rejects SQL escape syntax: %s', (formula) => {
    expect(() => compileFormula(formula, { mode: 'aggregate', fields })).toThrow(
      /Unexpected|not allowed/u,
    );
  });

  it('checks identifiers, types, and aggregate level without DuckDB', () => {
    expect(() => compileFormula('sum(other_cost)', { mode: 'aggregate', fields })).toThrow(
      /Unknown formula field/u,
    );
    expect(() => compileFormula('lower(media_cost)', { mode: 'row', fields })).toThrow(
      /expects text/u,
    );
    expect(() => compileFormula('media_cost + 1', { mode: 'aggregate', fields })).toThrow(
      /must aggregate/u,
    );
    expect(() => compileFormula('sum(media_cost)', { mode: 'row', fields })).toThrow(
      /only allowed in aggregate/u,
    );
  });

  it('binds not around comparisons before boolean connectors', () => {
    expect(
      compileFormula("not campaign = 'Brand' and media_cost > 0", {
        mode: 'row',
        fields,
      }).sql,
    ).toBe(`((NOT ("Campaign" = 'Brand')) AND ("Media Cost" > 0))`);
  });

  it('rejects numeric literals that overflow to infinity', () => {
    expect(() => compileFormula('1e999', { mode: 'row', fields })).toThrow(/must be finite/u);
  });
});
