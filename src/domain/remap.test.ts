import { describe, expect, it } from 'vitest';
import { remapWidgetDefinition } from './remap';

const source = {
  fields: [
    { id: 'source_date', canonicalName: 'date', columnName: 'DateStart' },
    { id: 'source_campaign', canonicalName: 'campaign', columnName: 'CampaignName' },
    { id: 'source_spend', canonicalName: 'spend', columnName: 'MediaCost' },
  ],
  calculatedFields: [],
};

describe('widget datasource remapping', () => {
  it('maps every referenced field by canonical name', () => {
    const definition = remapWidgetDefinition(
      {
        type: 'line',
        title: 'Spend by campaign',
        dataSourceId: 'source',
        dateRangeFieldId: 'source_date',
        dimension: { fieldId: 'source_campaign' },
        metrics: [
          {
            source: { kind: 'field', fieldId: 'source_spend', aggregation: 'sum' },
            dataType: 'currency',
          },
        ],
      },
      source,
      'target',
      {
        fields: [
          { id: 'target_date', canonicalName: 'date', columnName: 'day' },
          { id: 'target_campaign', canonicalName: 'campaign', columnName: 'campaign_name' },
          { id: 'target_spend', canonicalName: 'spend', columnName: 'media_cost' },
        ],
        calculatedFields: [],
      },
    );
    expect(definition).toMatchObject({
      dataSourceId: 'target',
      dateRangeFieldId: 'target_date',
      dimension: { fieldId: 'target_campaign' },
      metrics: [{ source: { fieldId: 'target_spend' } }],
    });
  });

  it('rewrites expression identifiers without changing user values', () => {
    const definition = remapWidgetDefinition(
      {
        type: 'scorecard',
        title: 'source_spend',
        dataSourceId: 'source',
        dateRangeFieldId: 'source_date',
        filter: {
          conditions: [{ fieldId: 'source_campaign', operator: 'equals', value: 'source_spend' }],
          connector: 'and',
        },
        metric: {
          source: {
            kind: 'expression',
            expression: `SUM("MediaCost") + SUM(MediaCost) + COUNT('MediaCost')`,
          },
          dataType: 'currency',
        },
      },
      source,
      'target',
      {
        fields: [
          { id: 'target_date', canonicalName: 'date', columnName: 'day' },
          { id: 'target_campaign', canonicalName: 'campaign', columnName: 'campaign_name' },
          { id: 'target_spend', canonicalName: 'spend', columnName: 'media_cost' },
        ],
        calculatedFields: [],
      },
    );
    if (definition.type !== 'scorecard') throw new Error('Expected a scorecard.');
    expect(definition.title).toBe('source_spend');
    expect(definition.filter?.conditions[0]?.value).toBe('source_spend');
    expect(definition.metric.source).toEqual({
      kind: 'expression',
      expression: `SUM("media_cost") + SUM("media_cost") + COUNT('MediaCost')`,
    });
  });

  it('lists every canonical field the target is missing', () => {
    expect(() =>
      remapWidgetDefinition(
        {
          type: 'scorecard',
          title: 'Spend',
          dataSourceId: 'source',
          dateRangeFieldId: 'source_date',
          filter: {
            conditions: [{ fieldId: 'source_campaign', operator: 'isNotEmpty' }],
            connector: 'and',
          },
          metric: {
            source: { kind: 'field', fieldId: 'source_spend', aggregation: 'sum' },
            dataType: 'currency',
          },
        },
        source,
        'target',
        {
          fields: [{ id: 'target_date', canonicalName: 'date', columnName: 'day' }],
          calculatedFields: [],
        },
      ),
    ).toThrow('Target datasource has no canonical field campaign, spend.');
  });

  it('matches expression identifiers using DuckDB casing rules', () => {
    const definition = remapWidgetDefinition(
      {
        type: 'scorecard',
        title: 'Spend',
        dataSourceId: 'source',
        dateRangeFieldId: 'source_date',
        metric: {
          source: { kind: 'expression', expression: 'SUM(mediacost)' },
          dataType: 'currency',
        },
      },
      source,
      'target',
      {
        fields: [
          { id: 'target_date', canonicalName: 'date', columnName: 'day' },
          { id: 'target_spend', canonicalName: 'spend', columnName: 'target_cost' },
        ],
        calculatedFields: [],
      },
    );
    if (definition.type !== 'scorecard' || definition.metric.source.kind !== 'expression')
      throw new Error('Expected an expression scorecard.');
    expect(definition.metric.source.expression).toBe('SUM("target_cost")');
  });

  it('expands an expression field mapped to a target calculated field', () => {
    const definition = remapWidgetDefinition(
      {
        type: 'scorecard',
        title: 'Spend',
        dataSourceId: 'source',
        dateRangeFieldId: 'source_date',
        metric: {
          source: { kind: 'expression', expression: 'SUM("MediaCost")' },
          dataType: 'currency',
        },
      },
      source,
      'target',
      {
        fields: [{ id: 'target_date', canonicalName: 'date', columnName: 'day' }],
        calculatedFields: [
          {
            id: 'target_spend',
            canonicalName: 'spend',
            expression: 'gross_cost - rebate',
          },
        ],
      },
    );
    if (definition.type !== 'scorecard' || definition.metric.source.kind !== 'expression')
      throw new Error('Expected an expression scorecard.');
    expect(definition.metric.source.expression).toBe('SUM((gross_cost - rebate))');
  });

  it('rejects a missing expression mapping even when the raw column exists with other semantics', () => {
    expect(() =>
      remapWidgetDefinition(
        {
          type: 'scorecard',
          title: 'Spend',
          dataSourceId: 'source',
          dateRangeFieldId: 'source_date',
          metric: {
            source: { kind: 'expression', expression: 'SUM("MediaCost")' },
            dataType: 'currency',
          },
        },
        source,
        'target',
        {
          fields: [
            { id: 'target_date', canonicalName: 'date', columnName: 'day' },
            { id: 'target_revenue', canonicalName: 'revenue', columnName: 'MediaCost' },
          ],
          calculatedFields: [],
        },
      ),
    ).toThrow('no canonical field spend');
  });

  it('rejects expression identifiers that are ambiguous under DuckDB casing rules', () => {
    expect(() =>
      remapWidgetDefinition(
        {
          type: 'scorecard',
          title: 'Spend',
          dataSourceId: 'source',
          dateRangeFieldId: 'source_date',
          metric: {
            source: { kind: 'expression', expression: 'SUM(MEDIACOST)' },
            dataType: 'currency',
          },
        },
        {
          ...source,
          fields: [
            ...source.fields,
            { id: 'source_duplicate', canonicalName: 'gross_spend', columnName: 'mediacost' },
          ],
        },
        'target',
        {
          fields: [
            { id: 'target_date', canonicalName: 'date', columnName: 'day' },
            { id: 'target_spend', canonicalName: 'spend', columnName: 'net_cost' },
            { id: 'target_gross', canonicalName: 'gross_spend', columnName: 'gross_cost' },
          ],
          calculatedFields: [],
        },
      ),
    ).toThrow('ambiguous field identifier MEDIACOST');
  });

  it('does not rewrite DATE literals when a source column has the same name', () => {
    const definition = remapWidgetDefinition(
      {
        type: 'scorecard',
        title: 'Recent spend',
        dataSourceId: 'source',
        dateRangeFieldId: 'source_date',
        metric: {
          source: {
            kind: 'expression',
            expression: `SUM(CASE WHEN "DateStart" >= DATE '2024-01-01' THEN "MediaCost" ELSE 0 END)`,
          },
          dataType: 'currency',
        },
      },
      {
        ...source,
        fields: [
          ...source.fields,
          { id: 'source_legacy_date', canonicalName: 'legacy_date', columnName: 'Date' },
        ],
      },
      'target',
      {
        fields: [
          { id: 'target_date', canonicalName: 'date', columnName: 'day' },
          { id: 'target_spend', canonicalName: 'spend', columnName: 'cost' },
          { id: 'target_legacy_date', canonicalName: 'legacy_date', columnName: 'legacy' },
        ],
        calculatedFields: [],
      },
    );
    if (definition.type !== 'scorecard' || definition.metric.source.kind !== 'expression')
      throw new Error('Expected an expression scorecard.');
    expect(definition.metric.source.expression).toBe(
      `SUM(CASE WHEN "day" >= DATE '2024-01-01' THEN "cost" ELSE 0 END)`,
    );
  });

  it('does not rewrite a CAST target type when a source column has the same name', () => {
    const definition = remapWidgetDefinition(
      {
        type: 'scorecard',
        title: 'Dated rows',
        dataSourceId: 'source',
        dateRangeFieldId: 'source_date',
        metric: {
          source: { kind: 'expression', expression: 'COUNT(CAST("DateStart" AS DATE))' },
          dataType: 'number',
        },
      },
      {
        ...source,
        fields: [
          ...source.fields,
          { id: 'source_legacy_date', canonicalName: 'legacy_date', columnName: 'Date' },
        ],
      },
      'target',
      {
        fields: [
          { id: 'target_date', canonicalName: 'date', columnName: 'day' },
          { id: 'target_legacy_date', canonicalName: 'legacy_date', columnName: 'legacy' },
        ],
        calculatedFields: [],
      },
    );
    if (definition.type !== 'scorecard' || definition.metric.source.kind !== 'expression')
      throw new Error('Expected an expression scorecard.');
    expect(definition.metric.source.expression).toBe('COUNT(CAST("day" AS DATE))');
  });

  it('does not rewrite a postfix cast type when a source column has the same name', () => {
    const definition = remapWidgetDefinition(
      {
        type: 'scorecard',
        title: 'Dated rows',
        dataSourceId: 'source',
        dateRangeFieldId: 'source_date',
        metric: {
          source: { kind: 'expression', expression: 'COUNT("DateStart"::DATE)' },
          dataType: 'number',
        },
      },
      {
        ...source,
        fields: [
          ...source.fields,
          { id: 'source_legacy_date', canonicalName: 'legacy_date', columnName: 'Date' },
        ],
      },
      'target',
      {
        fields: [
          { id: 'target_date', canonicalName: 'date', columnName: 'day' },
          { id: 'target_legacy_date', canonicalName: 'legacy_date', columnName: 'legacy' },
        ],
        calculatedFields: [],
      },
    );
    if (definition.type !== 'scorecard' || definition.metric.source.kind !== 'expression')
      throw new Error('Expected an expression scorecard.');
    expect(definition.metric.source.expression).toBe('COUNT("day"::DATE)');
  });

  it('preserves dollar-quoted literals and DuckDB special date values', () => {
    const definition = remapWidgetDefinition(
      {
        type: 'scorecard',
        title: 'Recent spend',
        dataSourceId: 'source',
        dateRangeFieldId: 'source_date',
        metric: {
          source: {
            kind: 'expression',
            expression: `SUM(CASE WHEN "DateStart" <= CURRENT_DATE AND $$MediaCost$$ = $$MediaCost$$ THEN "MediaCost" ELSE 0 END)`,
          },
          dataType: 'currency',
        },
      },
      {
        ...source,
        fields: [
          ...source.fields,
          { id: 'source_current_date', canonicalName: 'today', columnName: 'CURRENT_DATE' },
        ],
      },
      'target',
      {
        fields: [
          { id: 'target_date', canonicalName: 'date', columnName: 'day' },
          { id: 'target_spend', canonicalName: 'spend', columnName: 'cost' },
          { id: 'target_current_date', canonicalName: 'today', columnName: 'today_value' },
        ],
        calculatedFields: [],
      },
    );
    if (definition.type !== 'scorecard' || definition.metric.source.kind !== 'expression')
      throw new Error('Expected an expression scorecard.');
    expect(definition.metric.source.expression).toBe(
      `SUM(CASE WHEN "day" <= CURRENT_DATE AND $$MediaCost$$ = $$MediaCost$$ THEN "cost" ELSE 0 END)`,
    );
  });

  it('preserves interval units and complete cast type names', () => {
    const definition = remapWidgetDefinition(
      {
        type: 'scorecard',
        title: 'Typed spend',
        dataSourceId: 'source',
        dateRangeFieldId: 'source_date',
        metric: {
          source: {
            kind: 'expression',
            expression:
              'SUM("MediaCost"::INT4) + COUNT(CAST("DateStart" AS TIMESTAMP WITH TIME ZONE)) + COUNT("DateStart" + INTERVAL 1 DAY)',
          },
          dataType: 'number',
        },
      },
      {
        ...source,
        fields: [
          ...source.fields,
          { id: 'source_int4', canonicalName: 'int4_value', columnName: 'INT4' },
          { id: 'source_time', canonicalName: 'time_value', columnName: 'TIME' },
          { id: 'source_day', canonicalName: 'day_value', columnName: 'DAY' },
        ],
      },
      'target',
      {
        fields: [
          { id: 'target_date', canonicalName: 'date', columnName: 'day' },
          { id: 'target_spend', canonicalName: 'spend', columnName: 'cost' },
          { id: 'target_int4', canonicalName: 'int4_value', columnName: 'int4_column' },
          { id: 'target_time', canonicalName: 'time_value', columnName: 'time_column' },
          { id: 'target_day', canonicalName: 'day_value', columnName: 'day_column' },
        ],
        calculatedFields: [],
      },
    );
    if (definition.type !== 'scorecard' || definition.metric.source.kind !== 'expression')
      throw new Error('Expected an expression scorecard.');
    expect(definition.metric.source.expression).toBe(
      'SUM("cost"::INT4) + COUNT(CAST("day" AS TIMESTAMP WITH TIME ZONE)) + COUNT("day" + INTERVAL 1 DAY)',
    );
  });

  it('preserves every metric and its display type', () => {
    const definition = remapWidgetDefinition(
      {
        type: 'line',
        title: 'Spend and target',
        dataSourceId: 'source',
        dateRangeFieldId: 'source_date',
        dimension: { fieldId: 'source_campaign' },
        metrics: [
          {
            source: { kind: 'field', fieldId: 'source_spend', aggregation: 'sum' },
            dataType: 'currency',
          },
          {
            source: { kind: 'library', libraryMetricId: 'target_metric' },
            dataType: 'percent',
          },
        ],
      },
      source,
      'target',
      {
        fields: [
          { id: 'target_date', canonicalName: 'date', columnName: 'day' },
          { id: 'target_campaign', canonicalName: 'campaign', columnName: 'campaign' },
          { id: 'target_spend', canonicalName: 'spend', columnName: 'cost' },
        ],
        calculatedFields: [],
      },
    );
    if (definition.type !== 'line') throw new Error('Expected a line chart.');
    expect(definition.metrics).toHaveLength(2);
    expect(definition.metrics[0]).toMatchObject({
      source: { fieldId: 'target_spend' },
      dataType: 'currency',
    });
    expect(definition.metrics[1]).toEqual({
      source: { kind: 'library', libraryMetricId: 'target_metric' },
      dataType: 'percent',
    });
  });

  it('rejects a chart target without its dimension', () => {
    expect(() =>
      remapWidgetDefinition(
        {
          type: 'bar',
          title: 'Spend by campaign',
          dataSourceId: 'source',
          dateRangeFieldId: 'source_date',
          dimension: { fieldId: 'source_campaign' },
          metric: {
            source: { kind: 'field', fieldId: 'source_spend', aggregation: 'sum' },
            dataType: 'currency',
          },
        },
        source,
        'target',
        {
          fields: [
            { id: 'target_date', canonicalName: 'date', columnName: 'day' },
            { id: 'target_spend', canonicalName: 'spend', columnName: 'cost' },
          ],
          calculatedFields: [],
        },
      ),
    ).toThrow('no canonical field campaign.');
  });
});
