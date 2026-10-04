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
