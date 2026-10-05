import { env } from 'cloudflare:workers';
import { describe, expect, test } from 'vitest';
import { signOut } from './doubles/clerk';
import { queryEngine } from './doubles/query-engine';
import {
  addWidget,
  callService,
  createDashboard,
  expectApiError,
  regionControlDefinition,
  scorecardDefinition,
  seedDataSource,
  signInToNewWorkspace,
  withR2Storage,
  type SeededDataSource,
  type TestWorkspace,
} from './fixtures';

interface QueryResult {
  rows: Array<Record<string, unknown>>;
  columns: unknown[];
  cache: 'hit' | 'miss';
  controlState: { values?: Record<string, unknown[]> };
  page?: number;
  hasMore?: boolean;
  scaleBounds?: Record<string, { min: number; max: number }>;
}

async function seedScorecardDashboard() {
  const workspace = await signInToNewWorkspace();
  const source = await seedDataSource(workspace);
  const dashboard = await createDashboard();
  const widget = await addWidget(dashboard.id, scorecardDefinition(source));
  return { workspace, source, dashboardId: dashboard.id, widgetId: widget.id };
}

async function addRegionControl(
  dashboardId: string,
  source: SeededDataSource,
  options?: { allowMultiple?: boolean },
) {
  return addWidget(dashboardId, regionControlDefinition(source, options));
}

describe('widget queries', () => {
  test('the compiled query reaches the engine and its rows come back', async () => {
    const { dashboardId, widgetId } = await seedScorecardDashboard();
    queryEngine.returnRows([{ revenue: 4200 }]);

    const result = (await callService({
      action: 'queryWidget',
      dashboardId,
      widgetId,
    })) as QueryResult;

    expect(result.rows).toEqual([{ revenue: 4200 }]);
    expect(queryEngine.queryCalls).toHaveLength(1);
    const [call] = queryEngine.queryCalls;
    expect(call.sql).toContain('/__dev-data/');
    expect(call).not.toHaveProperty('requiresR2Credentials');
  });

  test('date dimensions rebucket when a widget crosses a width tier', async () => {
    const workspace = await signInToNewWorkspace();
    const source = await seedDataSource(workspace);
    const dashboard = await createDashboard();
    const widget = await addWidget(dashboard.id, {
      type: 'line',
      title: 'Revenue by date',
      dataSourceId: source.id,
      dateRangeFieldId: source.fieldIds.day,
      dimension: { fieldId: source.fieldIds.day, dateGranularity: 'auto' },
      metrics: [
        {
          source: { kind: 'field', fieldId: source.fieldIds.revenue, aggregation: 'sum' },
          dataType: 'currency',
        },
      ],
    });
    const controlState = {
      dateRange: {
        startDate: { fixed: '2026-01-01' as const },
        endDate: { fixed: '2026-12-31' as const },
      },
    };

    await callService({
      action: 'queryWidget',
      dashboardId: dashboard.id,
      widgetId: widget.id,
      controlState,
    });
    expect(queryEngine.queryCalls.at(-1)?.sql).toContain(`DATE_TRUNC('month', "day")`);

    await callService({
      action: 'moveWidget',
      dashboardId: dashboard.id,
      widgetId: widget.id,
      placement: { x: 0, y: 0, width: 8, height: 3 },
    });
    await callService({
      action: 'queryWidget',
      dashboardId: dashboard.id,
      widgetId: widget.id,
      controlState,
    });
    expect(queryEngine.queryCalls.at(-1)?.sql).toContain(`DATE_TRUNC('week', "day")`);
  });

  test('an identical query is served from KV and a changed control is not', async () => {
    const { source, dashboardId, widgetId } = await seedScorecardDashboard();
    const control = await addRegionControl(dashboardId, source);
    queryEngine.returnRows([{ revenue: 1 }]);

    const first = (await callService({
      action: 'queryWidget',
      dashboardId,
      widgetId,
      controlState: { values: { [control.id]: ['north'] } },
    })) as QueryResult;
    expect(first.cache).toBe('miss');
    expect(queryEngine.queryCalls).toHaveLength(1);

    const second = (await callService({
      action: 'queryWidget',
      dashboardId,
      widgetId,
      controlState: { values: { [control.id]: ['north'] } },
    })) as QueryResult;
    expect(second.cache).toBe('hit');
    expect(second.rows).toEqual([{ revenue: 1 }]);
    // A hit must not reach the engine again.
    expect(queryEngine.queryCalls).toHaveLength(1);

    const narrowed = (await callService({
      action: 'queryWidget',
      dashboardId,
      widgetId,
      controlState: { values: { [control.id]: ['south'] } },
    })) as QueryResult;
    expect(narrowed.cache).toBe('miss');
    expect(queryEngine.queryCalls).toHaveLength(2);

    // One cached entry per distinct control selection.
    expect((await env.QUERY_CACHE.list()).keys).toHaveLength(2);
  });

  test('a datasource version change invalidates the cached result', async () => {
    const { source, dashboardId, widgetId } = await seedScorecardDashboard();
    queryEngine.returnRows([{ revenue: 1 }]);
    await callService({ action: 'queryWidget', dashboardId, widgetId });
    expect(
      ((await callService({ action: 'queryWidget', dashboardId, widgetId })) as QueryResult).cache,
    ).toBe('hit');

    const { createDatabase } = await import('#/db/client');
    const { dataSources } = await import('#/db/schema');
    const { eq } = await import('drizzle-orm');
    await createDatabase(env.DB)
      .update(dataSources)
      .set({ version: 'source-v2' })
      .where(eq(dataSources.id, source.id));

    expect(
      ((await callService({ action: 'queryWidget', dashboardId, widgetId })) as QueryResult).cache,
    ).toBe('miss');
  });

  test('a paged table reads color scale bounds over the whole result', async () => {
    const workspace = await signInToNewWorkspace();
    const source = await seedDataSource(workspace);
    const dashboard = await createDashboard();
    const revenue = {
      source: {
        kind: 'field' as const,
        fieldId: source.fieldIds.revenue,
        aggregation: 'sum' as const,
      },
      dataType: 'currency' as const,
    };
    const widget = await addWidget(dashboard.id, {
      type: 'table',
      title: 'Revenue by region',
      dataSourceId: source.id,
      dateRangeFieldId: source.fieldIds.day,
      dimensions: [{ fieldId: source.fieldIds.region }],
      metrics: [
        revenue,
        { ...revenue, colorScale: { style: 'heatmap', color: 'positive' } },
        { ...revenue, colorScale: { style: 'bar', color: 'neutral' } },
      ],
      resultLimit: { mode: 'pagination', amount: 1 },
    });
    queryEngine.answerWith((request) => ({
      body: {
        ok: true,
        data:
          request.operation !== 'query'
            ? []
            : request.sql.includes('AS scaled')
              ? [{ min_1: 1, max_1: 2, min_2: 5, max_2: 900, min_3: null, max_3: null }]
              : [{ dimension_1: 'north', metric_1: 50, metric_2: 50 }],
        metrics: { queryDurationMs: 1, queueDurationMs: 0, resultBytes: 2 },
      },
    }));

    const result = (await callService({
      action: 'queryWidget',
      dashboardId: dashboard.id,
      widgetId: widget.id,
      page: 1,
    })) as QueryResult;

    expect(result.scaleBounds).toEqual({ metric_2: { min: 5, max: 900 } });
    const boundsQuery = queryEngine.queryCalls.find((call) => call.sql.includes('AS scaled'));
    expect(boundsQuery?.sql).not.toContain('LIMIT');
  });

  test('a share link can run the widget query without a session', async () => {
    const { dashboardId, widgetId } = await seedScorecardDashboard();
    const link = (await callService({
      action: 'shareDashboard',
      dashboardId,
      operation: { kind: 'createLink' },
    })) as { token: string };
    queryEngine.returnRows([{ revenue: 7 }]);

    signOut();
    const result = (await callService({
      action: 'queryWidget',
      dashboardId,
      widgetId,
      shareToken: link.token,
    })) as QueryResult;
    expect(result.rows).toEqual([{ revenue: 7 }]);
  });
});

describe('drill-down', () => {
  async function seedDrillableBar() {
    const workspace = await signInToNewWorkspace();
    const source = await seedDataSource(workspace);
    const dashboard = await createDashboard();
    const widget = await addWidget(dashboard.id, {
      type: 'bar',
      title: 'Revenue by region',
      dataSourceId: source.id,
      dateRangeFieldId: source.fieldIds.day,
      metric: {
        source: { kind: 'field', fieldId: source.fieldIds.revenue, aggregation: 'sum' },
        dataType: 'currency',
      },
      dimension: { fieldId: source.fieldIds.region },
      drillDimensions: [{ fieldId: source.fieldIds.day, dateGranularity: 'month' }],
    });
    return { source, dashboardId: dashboard.id, widgetId: widget.id };
  }

  test('a drill path groups by the next level and filters by the clicked value', async () => {
    const { dashboardId, widgetId } = await seedDrillableBar();

    const top = (await callService({
      action: 'queryWidget',
      dashboardId,
      widgetId,
    })) as QueryResult;
    expect(queryEngine.queryCalls.at(-1)?.sql).toContain('"region" AS "dimension_1"');
    expect(top.columns[0]).toMatchObject({ label: 'Region' });

    const drilled = (await callService({
      action: 'queryWidget',
      dashboardId,
      widgetId,
      drillPath: ['north'],
    })) as QueryResult;
    const call = queryEngine.queryCalls.at(-1)!;
    expect(call.sql).toContain(`DATE_TRUNC('month', "day") AS "dimension_1"`);
    expect(call.sql).toContain('"region" IN (?)');
    expect(call.parameters).toContain('north');
    expect(drilled.columns[0]).toMatchObject({ label: 'Day' });
    // Each level and clicked value is its own cache entry.
    expect(drilled.cache).toBe('miss');
    expect(
      (
        (await callService({
          action: 'queryWidget',
          dashboardId,
          widgetId,
          drillPath: ['south'],
        })) as QueryResult
      ).cache,
    ).toBe('miss');
  });

  test('a drill path deeper than the defined levels is rejected', async () => {
    const { dashboardId, widgetId } = await seedDrillableBar();
    await expectApiError(
      callService({ action: 'queryWidget', dashboardId, widgetId, drillPath: ['north', 'x'] }),
      { status: 400, code: 'invalid_drill_path' },
    );
  });

  test('only the last drill level can be a date', async () => {
    const workspace = await signInToNewWorkspace();
    const source = await seedDataSource(workspace);
    const dashboard = await createDashboard();
    await expectApiError(
      callService({
        action: 'addWidget',
        pageId: `${dashboard.id}_page`,
        dashboardId: dashboard.id,
        definition: {
          type: 'line',
          title: 'Revenue over time',
          dataSourceId: source.id,
          dateRangeFieldId: source.fieldIds.day,
          metrics: [
            {
              source: { kind: 'field', fieldId: source.fieldIds.revenue, aggregation: 'sum' },
              dataType: 'currency',
            },
          ],
          dimension: { fieldId: source.fieldIds.day },
          drillDimensions: [{ fieldId: source.fieldIds.region }],
        },
        width: 6,
        height: 4,
      }),
      { status: 400, code: 'invalid_drill_dimension' },
    );
  });
});

describe('control validation', () => {
  test('a control the dashboard does not have is rejected', async () => {
    const { dashboardId, widgetId } = await seedScorecardDashboard();

    await expectApiError(
      callService({
        action: 'queryWidget',
        dashboardId,
        widgetId,
        controlState: { values: { widget_does_not_exist: ['north'] } },
      }),
      { status: 400, code: 'unknown_control' },
    );
    expect(queryEngine.queryCalls).toHaveLength(0);
  });

  test('a single-select control refuses several selections', async () => {
    const { source, dashboardId, widgetId } = await seedScorecardDashboard();
    const control = await addRegionControl(dashboardId, source, { allowMultiple: false });

    await expectApiError(
      callService({
        action: 'queryWidget',
        dashboardId,
        widgetId,
        controlState: { values: { [control.id]: ['north', 'south'] } },
      }),
      { status: 400, code: 'multiple_values_not_allowed' },
    );

    const accepted = (await callService({
      action: 'queryWidget',
      dashboardId,
      widgetId,
      controlState: { values: { [control.id]: ['north'] } },
    })) as QueryResult;
    expect(accepted.controlState.values?.[control.id]).toEqual(['north']);
  });

  test('a single-select control refuses several default values', async () => {
    const { source, dashboardId } = await seedScorecardDashboard();

    await expectApiError(
      callService({
        action: 'addWidget',
        pageId: `${dashboardId}_page`,
        dashboardId,
        definition: regionControlDefinition(source, {
          allowMultiple: false,
          defaultValues: ['north', 'south'],
        }),
        width: 3,
        height: 1,
      }),
      { status: 400, code: 'multiple_default_values_not_allowed' },
    );
  });

  test('control defaults seed the state the query runs with', async () => {
    const { source, dashboardId, widgetId } = await seedScorecardDashboard();
    const control = await addWidget(
      dashboardId,
      regionControlDefinition(source, { defaultValues: ['north'] }),
    );

    const opened = (await callService({ action: 'getDashboard', dashboardId })) as {
      controlState: { values?: Record<string, unknown[]> };
    };
    expect(opened.controlState.values?.[control.id]).toEqual(['north']);

    const result = (await callService({
      action: 'queryWidget',
      dashboardId,
      widgetId,
    })) as QueryResult;
    expect(result.controlState.values?.[control.id]).toEqual(['north']);
  });
});

describe('query engine failures', () => {
  test('a missing R2 source returns the typed not-found error', async () => {
    const { dashboardId, widgetId } = await seedScorecardDashboard();

    await withR2Storage(() =>
      expectApiError(callService({ action: 'queryWidget', dashboardId, widgetId }), {
        status: 404,
        code: 'datasource_source_not_found',
      }),
    );
    expect(queryEngine.calls).toHaveLength(0);
  });

  test('a rejected query surfaces as an invalid query error', async () => {
    const { dashboardId, widgetId } = await seedScorecardDashboard();
    queryEngine.rejectQueries(400, 'Binder Error: Referenced column "missing" not found');

    const error = await expectApiError(
      callService({ action: 'queryWidget', dashboardId, widgetId }),
      { status: 400, code: 'invalid_query' },
    );
    expect(error.message).toContain('Binder Error');
    // A failed query must not be cached.
    expect((await env.QUERY_CACHE.list()).keys).toEqual([]);
    expect(queryEngine.queryCalls).toHaveLength(1);
  });

  test('an engine outage reports an upstream failure without the transport detail', async () => {
    const { dashboardId, widgetId } = await seedScorecardDashboard();
    queryEngine.rejectQueries(503, 'container 10.0.0.4 refused the connection');

    const error = await expectApiError(
      callService({ action: 'queryWidget', dashboardId, widgetId }),
      { status: 502, code: 'datasource_connector_failed' },
    );
    expect(error.message).not.toContain('10.0.0.4');
  });

  test('saving a valid widget never waits for the query engine', async () => {
    const workspace = await signInToNewWorkspace();
    const source = await seedDataSource(workspace);
    const dashboard = await createDashboard();
    queryEngine.answerWith(() => ({
      status: 400,
      body: { ok: false, error: 'Binder Error: unknown aggregate' },
    }));

    await callService({
      action: 'addWidget',
      pageId: `${dashboard.id}_page`,
      dashboardId: dashboard.id,
      definition: scorecardDefinition(source),
      width: 4,
      height: 3,
    });
    expect(queryEngine.calls).toHaveLength(0);

    queryEngine.reset();
    const opened = (await callService({ action: 'getDashboard', dashboardId: dashboard.id })) as {
      dashboard: { pages: Array<{ widgets: unknown[] }> };
    };
    expect(opened.dashboard.pages[0].widgets).toHaveLength(1);
  });

  test('saving rejects invalid formula syntax without calling the query engine', async () => {
    const workspace = await signInToNewWorkspace();
    const source = await seedDataSource(workspace);
    const dashboard = await createDashboard();

    await expectApiError(
      callService({
        action: 'addWidget',
        pageId: `${dashboard.id}_page`,
        dashboardId: dashboard.id,
        definition: {
          ...scorecardDefinition(source),
          metric: {
            source: {
              kind: 'expression',
              expression: `read_parquet('https://example.com/other.parquet')`,
            },
            dataType: 'currency',
          },
        },
        width: 4,
        height: 3,
      }),
      { status: 400, code: 'invalid_query' },
    );
    expect(queryEngine.calls).toHaveLength(0);
  });

  test.each(['sum', 'min', 'max'] as const)(
    'saving rejects %s over a text field without querying',
    async (aggregation) => {
      const workspace = await signInToNewWorkspace();
      const source = await seedDataSource(workspace);
      const dashboard = await createDashboard();

      await expectApiError(
        callService({
          action: 'addWidget',
          pageId: `${dashboard.id}_page`,
          dashboardId: dashboard.id,
          definition: {
            ...scorecardDefinition(source),
            metric: {
              source: { kind: 'field', fieldId: source.fieldIds.region, aggregation },
              dataType: 'number',
            },
          },
          width: 4,
          height: 3,
        }),
        { status: 400, code: 'invalid_query' },
      );
      expect(queryEngine.calls).toHaveLength(0);
    },
  );

  test('saving rejects a text widget expression without querying', async () => {
    const workspace = await signInToNewWorkspace();
    const source = await seedDataSource(workspace);
    const dashboard = await createDashboard();

    await expectApiError(
      callService({
        action: 'addWidget',
        pageId: `${dashboard.id}_page`,
        dashboardId: dashboard.id,
        definition: {
          ...scorecardDefinition(source),
          metric: {
            source: { kind: 'expression', expression: "'not a number'" },
            dataType: 'currency',
          },
        },
        width: 4,
        height: 3,
      }),
      { status: 400, code: 'invalid_query' },
    );
    expect(queryEngine.calls).toHaveLength(0);
  });

  test('saving rejects a legacy text library metric without querying', async () => {
    const workspace = await signInToNewWorkspace();
    const source = await seedDataSource(workspace);
    const dashboard = await createDashboard();
    const { createDatabase } = await import('#/db/client');
    const { libraryMetrics } = await import('#/db/schema');
    const metricId = `legacy-text-metric-${crypto.randomUUID().slice(0, 8)}`;
    await createDatabase(env.DB).insert(libraryMetrics).values({
      id: metricId,
      workspaceId: workspace.workspaceId,
      name: 'Legacy text metric',
      canonicalName: 'legacy_text_metric',
      expression: "'not a number'",
      semanticType: 'text',
      description: null,
      updatedAt: new Date().toISOString(),
    });

    await expectApiError(
      callService({
        action: 'addWidget',
        pageId: `${dashboard.id}_page`,
        dashboardId: dashboard.id,
        definition: {
          ...scorecardDefinition(source),
          metric: {
            source: { kind: 'library', libraryMetricId: metricId },
            dataType: 'number',
          },
        },
        width: 4,
        height: 3,
      }),
      { status: 400, code: 'invalid_query' },
    );
    expect(queryEngine.calls).toHaveLength(0);
  });

  test('a filter control answers every compiler entry point without a query', async () => {
    const workspace = await signInToNewWorkspace();
    const source = await seedDataSource(workspace);
    const dashboard = await createDashboard();
    const control = await addWidget(dashboard.id, regionControlDefinition(source));

    expect(
      await callService({
        action: 'queryWidget',
        dashboardId: dashboard.id,
        widgetId: control.id,
      }),
    ).toMatchObject({ rows: [] });
    expect(
      await callService({
        action: 'explainWidget',
        dashboardId: dashboard.id,
        widgetId: control.id,
      }),
    ).toEqual({ sql: null, definitions: [] });
    expect(
      await callService({
        action: 'previewWidget',
        dashboardId: dashboard.id,
        definition: regionControlDefinition(source),
        width: 4,
      }),
    ).toMatchObject({ rows: [] });
    // None of them reach the query engine.
    expect(queryEngine.calls).toEqual([]);
  });

  test('a widget cannot reference a field from another datasource', async () => {
    const workspace: TestWorkspace = await signInToNewWorkspace();
    const source = await seedDataSource(workspace);
    const other = await seedDataSource(workspace);
    const dashboard = await createDashboard();

    await expectApiError(
      callService({
        action: 'addWidget',
        pageId: `${dashboard.id}_page`,
        dashboardId: dashboard.id,
        definition: {
          ...scorecardDefinition(source),
          metric: {
            source: { kind: 'field', fieldId: other.fieldIds.revenue, aggregation: 'sum' },
            dataType: 'currency',
          },
        },
        width: 4,
        height: 3,
      }),
      { status: 400, code: 'unknown_field' },
    );
  });
});
