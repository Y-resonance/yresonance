import { describe, expect, it } from 'vitest';
import { drilledQuery } from './drill-down';
import type { WidgetDefinition } from './schema';

const metric = {
  source: { kind: 'field' as const, fieldId: 'spend', aggregation: 'sum' as const },
  dataType: 'currency' as const,
};

const bar: WidgetDefinition = {
  type: 'bar',
  title: 'Spend by campaign',
  dataSourceId: 'source',
  dateRangeFieldId: 'date',
  metric,
  dimension: { fieldId: 'campaign' },
  drillDimensions: [{ fieldId: 'ad_group' }, { fieldId: 'ad' }],
  sort: [{ target: { kind: 'dimension', fieldId: 'campaign' }, direction: 'asc' }],
};

describe('drilledQuery', () => {
  it('groups by the next level, filters every clicked level and keeps sorting along the axis', () => {
    const drilled = drilledQuery(bar, ['Spring sale', 'Prospecting']);
    expect(drilled?.definition).toMatchObject({
      dimension: { fieldId: 'ad' },
      sort: [{ target: { kind: 'dimension', fieldId: 'ad' }, direction: 'asc' }],
    });
    expect(drilled?.filters).toEqual([
      { fieldId: 'campaign', values: ['Spring sale'] },
      { fieldId: 'ad_group', values: ['Prospecting'] },
    ]);
  });

  it('refuses paths deeper than the defined levels and paths on tables', () => {
    expect(drilledQuery(bar, ['a', 'b', 'c'])).toBeUndefined();
    expect(
      drilledQuery(
        {
          type: 'table',
          title: 'Campaigns',
          dataSourceId: 'source',
          dateRangeFieldId: 'date',
          dimensions: [{ fieldId: 'campaign' }],
          metrics: [metric],
          resultLimit: { mode: 'top', amount: 10 },
        },
        ['Spring sale'],
      ),
    ).toBeUndefined();
  });
});
