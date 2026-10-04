import { describe, expect, it } from 'vitest';
import { dashboardDocumentSchema, defaultDateRange } from './schema';

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

    expect(dashboard.schemaVersion).toBe(3);
    expect(dashboard.pages[0]).toMatchObject({
      id: 'dashboard_page',
      name: 'Overview',
      hidden: false,
      canvasRows: 16,
    });
    expect(dashboard.pages[0].widgets[0]).toMatchObject({
      id: 'widget',
      layout: { x: 0, y: 12, width: 6, height: 2 },
      definitionHash: 'hash',
    });
    expect(dashboardDocumentSchema.parse(dashboard)).toEqual(dashboard);
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
});
