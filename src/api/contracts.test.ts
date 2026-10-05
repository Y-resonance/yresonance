import { describe, expect, it } from 'vitest';
import { apiRequestSchema } from './contracts';

describe('dashboard timezone contracts', () => {
  it.each(['Europe/Berlin', 'America/New_York', 'UTC'])(
    'accepts the IANA timezone %s',
    (timezone) => {
      expect(
        apiRequestSchema.safeParse({
          action: 'createDashboard',
          name: 'Performance',
          timezone,
        }).success,
      ).toBe(true);
    },
  );

  it.each([
    { action: 'createDashboard', name: 'Performance', timezone: 'Berlin' },
    { action: 'createDashboard', name: 'Performance', timezone: '+01:00' },
    { action: 'createDashboard', name: 'Performance', timezone: '+0100' },
    { action: 'createDashboard', name: 'Performance', timezone: '-05:30' },
    { action: 'createDashboard', name: 'Performance', timezone: '-0530' },
    { action: 'updateDashboard', dashboardId: 'dashboard-1', timezone: 'Not/A_Timezone' },
  ])('rejects an invalid timezone for $action', (request) => {
    expect(apiRequestSchema.safeParse(request).success).toBe(false);
  });
});

describe('datasource upload API contracts', () => {
  it('keeps filename and format validation in the action union', () => {
    expect(
      apiRequestSchema.safeParse({
        action: 'prepareDatasourceUpload',
        fileName: 'report.csv',
        fileSize: 1,
        format: 'csv',
      }).success,
    ).toBe(true);
    expect(
      apiRequestSchema.safeParse({
        action: 'prepareDatasourceUpload',
        fileName: 'report.parquet',
        fileSize: 1,
        format: 'csv',
      }).success,
    ).toBe(false);
  });
});

describe('calculated field API contracts', () => {
  it('allows type inference for validation but requires a type for saving and previews', () => {
    const validation = {
      action: 'validateCalculatedField',
      dataSourceId: 'source-1',
      name: 'Net cost',
      expression: 'cost * 0.8',
    };
    expect(apiRequestSchema.safeParse(validation).success).toBe(true);
    expect(
      apiRequestSchema.safeParse({ ...validation, action: 'previewCalculatedFieldValues' }).success,
    ).toBe(false);
    expect(
      apiRequestSchema.safeParse({ ...validation, action: 'upsertCalculatedField' }).success,
    ).toBe(false);
  });
});

describe('metric expression API contracts', () => {
  it('accepts an empty aggregate formula so the editor can check as you type', () => {
    const request = {
      action: 'validateMetricExpression',
      dataSourceId: 'source-1',
      expression: '',
    };
    expect(apiRequestSchema.safeParse(request).success).toBe(true);
    expect(apiRequestSchema.safeParse({ ...request, dataSourceId: '' }).success).toBe(false);
  });
});

describe('dashboard layout API contracts', () => {
  it('updates placements and canvas height in one request', () => {
    expect(
      apiRequestSchema.safeParse({
        action: 'updateLayout',
        pageId: 'page',
        dashboardId: 'dashboard-1',
        canvasRows: 12,
        placements: [],
      }).success,
    ).toBe(true);
    expect(
      apiRequestSchema.safeParse({
        action: 'updateLayout',
        pageId: 'page',
        dashboardId: 'dashboard-1',
        canvasRows: 9,
        placements: [],
      }).success,
    ).toBe(false);
  });
});
