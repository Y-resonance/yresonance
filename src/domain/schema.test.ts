import { describe, expect, it } from 'vitest';
import { dashboardDocumentSchema, defaultDateRange, widgetDefinitionSchema } from './schema';

describe('dashboard document schema', () => {
  it('derives canvas rows for documents saved before the field existed', () => {
    const dashboard = dashboardDocumentSchema.parse({
      id: 'dashboard',
      workspaceId: 'workspace',
      name: 'Legacy dashboard',
      schemaVersion: 2,
      timezone: 'Europe/Berlin',
      defaultDateRange,
      columns: 12,
      widgets: [
        {
          id: 'widget',
          layout: { x: 0, y: 12, width: 6, height: 2 },
          definition: {
            type: 'text',
            content: { schemaVersion: 'plain', document: 'Hello' },
          },
          definitionHash: 'hash',
        },
      ],
      createdBy: 'user',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    });

    expect(dashboard.canvasRows).toBe(16);
  });

  it('rejects a stored canvas that does not contain its widgets', () => {
    const result = dashboardDocumentSchema.safeParse({
      id: 'dashboard',
      workspaceId: 'workspace',
      name: 'Invalid dashboard',
      schemaVersion: 2,
      timezone: 'Europe/Berlin',
      defaultDateRange,
      columns: 12,
      canvasRows: 10,
      widgets: [
        {
          id: 'widget',
          layout: { x: 0, y: 9, width: 6, height: 2 },
          definition: {
            type: 'text',
            content: { schemaVersion: 'plain', document: 'Hello' },
          },
          definitionHash: 'hash',
        },
      ],
      createdBy: 'user',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    });

    expect(result.success).toBe(false);
  });

  it('accepts one data type per combo axis and rejects mixed units on one axis', () => {
    const combo = {
      type: 'combo',
      title: 'Spend and CTR',
      dataSourceId: 'source',
      dateRangeFieldId: 'date',
      dimension: { fieldId: 'date' },
      metrics: [
        {
          source: { kind: 'field', fieldId: 'spend', aggregation: 'sum' },
          dataType: 'currency',
          mark: 'bar',
          axis: 'left',
        },
        {
          source: { kind: 'field', fieldId: 'ctr', aggregation: 'average' },
          dataType: 'percent',
          mark: 'line',
          axis: 'right',
        },
        {
          source: { kind: 'field', fieldId: 'budget', aggregation: 'sum' },
          dataType: 'currency',
          mark: 'line',
          axis: 'left',
        },
      ],
    };

    expect(widgetDefinitionSchema.safeParse(combo).success).toBe(true);
    const mixed = structuredClone(combo);
    mixed.metrics[2]!.axis = 'right';
    expect(widgetDefinitionSchema.safeParse(mixed).error?.issues[0]?.message).toBe(
      'Metrics on the same axis must share a data type.',
    );
  });

  it('rejects a table metric with both threshold rules and a color scale', () => {
    const table = (metric: Record<string, unknown>) =>
      widgetDefinitionSchema.safeParse({
        type: 'table',
        title: 'Campaigns',
        dataSourceId: 'source',
        dateRangeFieldId: 'date',
        dimensions: [],
        metrics: [
          {
            source: { kind: 'field', fieldId: 'cost', aggregation: 'sum' },
            dataType: 'currency',
            ...metric,
          },
        ],
        resultLimit: { mode: 'top', amount: 10 },
      }).success;
    const colorScale = { style: 'heatmap', color: 'negative', invert: true };

    expect(table({ colorScale })).toBe(true);
    expect(
      table({ colorScale, conditionalFormat: [{ comparator: 'gt', value: 1, color: 'positive' }] }),
    ).toBe(false);
  });
});
