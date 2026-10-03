import { describe, expect, it } from 'vitest';
import { controlOptionsQuery } from './control-options';

describe('control option search', () => {
  it('puts an exact match before substring matches within the 100-row page', () => {
    const query = controlOptionsQuery('"Region"', 'z', 'ASC');
    expect(query.sql).toContain('MIN(CASE WHEN CAST("Region" AS VARCHAR) = ? THEN 0 ELSE 1 END)');
    expect(query.sql).toContain('LIMIT 100');
    expect(query.parameters).toEqual(['%z%', 'z']);
  });

  it('excludes null values that the filter cannot represent', () => {
    expect(controlOptionsQuery('"Region"', undefined, 'ASC').sql).toContain(
      'WHERE "Region" IS NOT NULL',
    );
  });

  it('treats search wildcard characters as literals', () => {
    const query = controlOptionsQuery('"Region"', '100%_!', 'ASC');
    expect(query.sql).toContain("ILIKE ? ESCAPE '!'");
    expect(query.parameters).toEqual(['%100!%!_!!%', '100%_!']);
  });

  it('uses the supplied source without rewriting the field expression', () => {
    const query = controlOptionsQuery("'yresonance_source'", undefined, 'ASC', '"source_1"');
    expect(query.sql).toContain('SELECT \'yresonance_source\' AS value FROM "source_1"');
  });
});
