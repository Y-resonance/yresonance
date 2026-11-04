import { describe, expect, it } from 'vitest';
import { inputSchemaFor } from './use-webmcp-tools';

describe('WebMCP input schemas', () => {
  it('keeps the dashboard editor tool schemas below the WebMCP descriptor budget', () => {
    const dashboardId = { dashboardId: 'dashboard' };
    const schemas = [
      inputSchemaFor('listDashboards'),
      inputSchemaFor('listLibraryMetrics'),
      inputSchemaFor('getDashboard', dashboardId),
      inputSchemaFor('queryWidget', dashboardId),
      inputSchemaFor('explainWidget', dashboardId),
      inputSchemaFor('getControlOptions', dashboardId),
      inputSchemaFor('describeDatasource', dashboardId),
      inputSchemaFor('updateDashboard', dashboardId),
      inputSchemaFor('addWidget', dashboardId),
      inputSchemaFor('updateWidget', dashboardId),
      inputSchemaFor('removeWidget', dashboardId),
      inputSchemaFor('moveWidget', dashboardId),
      inputSchemaFor('updateLayout', dashboardId),
      inputSchemaFor('copyWidget', dashboardId),
      inputSchemaFor('duplicateDashboard', dashboardId),
      inputSchemaFor('previewWidget', dashboardId),
      inputSchemaFor('validateCalculatedField', dashboardId),
      inputSchemaFor('upsertCalculatedField', dashboardId),
      inputSchemaFor('updateFieldMetadata', dashboardId),
      inputSchemaFor('upsertLibraryMetric', dashboardId),
      inputSchemaFor('shareDashboard', dashboardId),
      inputSchemaFor('createDashboard'),
    ];
    const bytes = new TextEncoder().encode(JSON.stringify(schemas)).byteLength;

    // Leave room for tool names, descriptions, annotations, and browser-added metadata.
    expect(bytes).toBeLessThan(48 * 1024);
  });

  it('keeps schema shapes while compacting descriptor noise', () => {
    const widget = JSON.stringify(inputSchemaFor('addWidget', { dashboardId: 'dashboard' }));
    const { definitions } = JSON.parse(widget) as { definitions: Record<string, unknown> };
    for (const [, name] of widget.matchAll(/"\$ref":"#\/definitions\/([^"]+)"/g))
      expect(definitions).toHaveProperty([name!]);
    expect(widget).toContain('"format":"date"');
    expect(widget).not.toContain('"pattern":"^(?:(?:');
    expect(widget).toContain('"pattern":"^#[0-9a-f]{6}$"');
    const location = inputSchemaFor('registerDatasource').properties as Record<string, unknown>;
    expect(JSON.stringify(location.location)).toContain('"format":{"type":"string"');
  });

  it('derives viewer query inputs without exposing SQL or datasource locations', () => {
    const schema = inputSchemaFor('queryWidget', {
      dashboardId: 'dashboard',
      shareToken: 'token',
    });
    expect(schema.properties).toHaveProperty('widgetId');
    expect(schema.properties).toHaveProperty('controlState');
    expect(schema.properties).not.toHaveProperty('dashboardId');
    expect(schema.properties).not.toHaveProperty('shareToken');
    expect(schema.properties).not.toHaveProperty('sql');
    expect(schema.properties).not.toHaveProperty('dataSourceId');
  });

  it('keeps consequential mutation fields in schemas', () => {
    const schema = inputSchemaFor('shareDashboard', { dashboardId: 'dashboard' });
    expect(schema.properties).toHaveProperty('operation');
    expect(schema.required).toContain('operation');
  });

  it('exposes batch placements without asking for the open dashboard id', () => {
    const schema = inputSchemaFor('updateLayout', { dashboardId: 'dashboard' });
    expect(schema.properties).toHaveProperty('placements');
    expect(schema.properties).toHaveProperty('canvasRows');
    expect(schema.required).toContain('canvasRows');
    expect(schema.properties).not.toHaveProperty('dashboardId');
  });

  it('fixes the dashboard id for editor field metadata updates', () => {
    const schema = inputSchemaFor('updateFieldMetadata', { dashboardId: 'dashboard' });
    expect(schema.properties).toHaveProperty('dataSourceId');
    expect(schema.properties).toHaveProperty('patch');
    expect(schema.properties).not.toHaveProperty('dashboardId');
  });

  it('exposes the new rolling date anchors through generic widget tools', () => {
    const schema = inputSchemaFor('addWidget', { dashboardId: 'dashboard' });
    expect(JSON.stringify(schema)).toContain('startOfYear');
    expect(JSON.stringify(schema)).toContain('startOfQuarter');
  });

  it('reuses repeated widget schema fragments through local references', () => {
    const schema = inputSchemaFor('addWidget', { dashboardId: 'dashboard' });
    expect(schema).toHaveProperty('definitions');
    expect(JSON.stringify(schema)).toContain('"$ref":"#/definitions/');
  });
});
