import { z } from 'zod';

export const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .refine(
    (timezone) => {
      if (/^[+-]/.test(timezone)) return false;
      try {
        new Intl.DateTimeFormat('en', { timeZone: timezone });
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Use a valid IANA timezone name.' },
  );

export const fieldRoleSchema = z.enum(['dimension', 'metric']);
export const semanticTypeSchema = z.enum(['currency', 'count', 'ratio', 'text', 'date', 'id']);
export const aggregationSchema = z.enum([
  'sum',
  'average',
  'count',
  'countDistinct',
  'min',
  'max',
  'median',
  'standardDeviation',
  'variance',
]);

const relativeDateSchema = z.object({
  amount: z.number().int().nonnegative(),
  unit: z.enum(['day', 'week', 'month', 'quarter', 'year']),
  direction: z.enum(['past', 'future']),
  anchor: z.enum([
    'now',
    'startOfDay',
    'startOfWeek',
    'startOfMonth',
    'startOfQuarter',
    'startOfYear',
  ]),
});

const dateValueSchema = z.union([
  z.object({ fixed: z.iso.date() }),
  z.object({ relative: relativeDateSchema }),
]);

export const dateRangeSchema = z
  .object({ startDate: dateValueSchema, endDate: dateValueSchema })
  .refine(
    (value) =>
      !('fixed' in value.startDate) ||
      !('fixed' in value.endDate) ||
      value.startDate.fixed <= value.endDate.fixed,
    {
      message: 'The start date must not be after the end date.',
    },
  );

const stylingSchema = z.record(z.string(), z.unknown()).optional();

// Presentation-only text options shared by text widgets and card titles. Unset properties keep the
// element's own default, so a widget that never sets a style still renders like the rest of the app.
export const textStyleSchema = z.object({
  size: z.enum(['xs', 'sm', 'base', 'lg', 'xl', '2xl']).optional(),
  weight: z.enum(['normal', 'medium', 'semibold', 'bold']).optional(),
  transform: z.enum(['none', 'uppercase']).optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  // Only meaningful for elements that own free vertical space, which today is the text widget.
  verticalAlign: z.enum(['top', 'center', 'bottom']).optional(),
  tone: z.enum(['default', 'muted', 'primary']).optional(),
});
// One shared instance so the emitted WebMCP JSON Schema references it instead of inlining a copy
// into every widget variant.
const optionalTextStyle = textStyleSchema.optional();

export const dateGranularitySchema = z.enum([
  'auto',
  'raw',
  'day',
  'week',
  'month',
  'quarter',
  'year',
]);

const semanticColorSchema = z.enum(['positive', 'warning', 'negative', 'neutral']);

const conditionalFormatSchema = z.discriminatedUnion('comparator', [
  z.object({
    comparator: z.enum(['gt', 'lt', 'gte', 'lte']),
    value: z.number(),
    color: semanticColorSchema,
  }),
  z
    .object({
      comparator: z.literal('between'),
      min: z.number(),
      max: z.number(),
      color: semanticColorSchema,
    })
    .refine((rule) => rule.min <= rule.max, {
      message: 'The minimum threshold must not exceed the maximum.',
    }),
]);

// Shades a table metric relative to its own minimum and maximum in the whole result. invert gives
// the lowest value full intensity, for metrics where lower is better such as CPA.
const colorScaleSchema = z.object({
  style: z.enum(['heatmap', 'bar']),
  color: semanticColorSchema,
  invert: z.boolean().optional(),
});

export const filterConditionSchema = z.object({
  fieldId: z.string().min(1),
  operator: z.enum([
    'equals',
    'notEquals',
    'contains',
    'notContains',
    'in',
    'notIn',
    'greaterThan',
    'greaterThanOrEqual',
    'lessThan',
    'lessThanOrEqual',
    'isEmpty',
    'isNotEmpty',
  ]),
  value: z.unknown().optional(),
});

export const filterSchema = z.object({
  conditions: z.array(filterConditionSchema),
  connector: z.enum(['and', 'or']).default('and'),
});

const metricSchema = z
  .object({
    source: z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('field'),
        fieldId: z.string().min(1),
        aggregation: aggregationSchema,
      }),
      z.object({ kind: z.literal('library'), libraryMetricId: z.string().min(1) }),
      z.object({ kind: z.literal('expression'), expression: z.string().min(1) }),
    ]),
    userDefinedName: z.string().trim().min(1).optional(),
    dataType: z.enum(['number', 'percent', 'duration', 'currency']),
    displayFormat: z.object({ radix: z.number().int().min(0).max(10).optional() }).optional(),
    conditionalFormat: z.array(conditionalFormatSchema).optional(),
    colorScale: colorScaleSchema.optional(),
    styling: stylingSchema,
  })
  .refine((metric) => !(metric.colorScale && metric.conditionalFormat?.length), {
    message: 'A metric uses either conditionalFormat threshold rules or a colorScale, not both.',
    path: ['colorScale'],
  });

// A combo chart draws each metric as bars or a line on the left or right axis, so a ratio can sit
// next to a currency value without flattening against its scale.
const comboMetricSchema = metricSchema.extend({
  mark: z.enum(['bar', 'line']),
  axis: z.enum(['left', 'right']),
});

const dimensionSchema = z.object({
  fieldId: z.string().min(1),
  userDefinedName: z.string().trim().min(1).optional(),
  dateGranularity: dateGranularitySchema.optional(),
  styling: stylingSchema,
});

// Recharts paints a colour per series, so a bar chart with a single series draws every bar in the
// same colour. 'category' hands each bar its own palette slot instead.
export const barColorBySchema = z.enum(['series', 'category']);

// Further levels a viewer can drill into from the chart's `dimension`, in order. The editor defines
// the levels; viewers only pick values. Every level they click is filtered by equality, so date
// fields are only allowed as the last level.
const drillDimensionsSchema = z.array(dimensionSchema).optional();

const comparisonSchema = z.object({ mode: z.enum(['none', 'previousPeriod', 'previousYear']) });
const sortSchema = z.object({
  target: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('dimension'), fieldId: z.string().min(1) }),
    z.object({ kind: z.literal('metric'), index: z.number().int().nonnegative() }),
  ]),
  direction: z.enum(['asc', 'desc']),
});

const cardBase = {
  title: z.string().trim().min(1),
  titleStyle: optionalTextStyle,
  dataSourceId: z.string().min(1),
  dateRangeFieldId: z.string().min(1),
  filter: filterSchema.optional(),
  styling: stylingSchema,
};

export const widgetDefinitionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('control'),
    dataSourceId: z.string().min(1),
    fieldId: z.string().min(1),
    userDefinedName: z.string().trim().min(1).optional(),
    defaultValues: z.array(z.unknown()).optional(),
    allowMultiple: z.boolean().default(true),
    filter: filterSchema.optional(),
    optionsSortDirection: z.enum(['asc', 'desc']).optional(),
    styling: stylingSchema,
  }),
  z.object({
    type: z.literal('dateControl'),
    defaultDateRange: dateRangeSchema.optional(),
    styling: stylingSchema,
  }),
  z.object({
    type: z.literal('text'),
    content: z.object({ schemaVersion: z.string().min(1), document: z.unknown() }),
    textStyle: optionalTextStyle,
  }),
  z.object({
    ...cardBase,
    type: z.literal('scorecard'),
    metric: metricSchema,
    comparison: comparisonSchema.optional(),
  }),
  z.object({
    ...cardBase,
    type: z.literal('gauge'),
    metric: metricSchema,
    comparison: comparisonSchema.optional(),
    upperLimit: z
      .discriminatedUnion('kind', [
        z.object({ kind: z.literal('manual'), value: z.number() }),
        z.object({ kind: z.literal('library'), libraryMetricId: z.string().min(1) }),
      ])
      .optional(),
  }),
  z.object({
    ...cardBase,
    type: z.literal('line'),
    dimension: dimensionSchema,
    drillDimensions: drillDimensionsSchema,
    metrics: z.array(metricSchema).min(1),
    comparison: comparisonSchema.optional(),
  }),
  z
    .object({
      ...cardBase,
      type: z.literal('combo'),
      dimension: dimensionSchema,
      metrics: z.array(comboMetricSchema).min(1),
      comparison: comparisonSchema.optional(),
    })
    // One axis has one tick format, so it cannot carry both a currency and a percentage.
    .refine(
      (definition) =>
        (['left', 'right'] as const).every(
          (axis) =>
            new Set(
              definition.metrics
                .filter((metric) => metric.axis === axis)
                .map((metric) => metric.dataType),
            ).size <= 1,
        ),
      { message: 'Metrics on the same axis must share a data type.', path: ['metrics'] },
    ),
  z.object({
    ...cardBase,
    type: z.literal('bar'),
    metric: metricSchema,
    dimension: dimensionSchema,
    drillDimensions: drillDimensionsSchema,
    breakdownDimension: dimensionSchema.optional(),
    comparison: comparisonSchema.optional(),
    colorBy: barColorBySchema.optional(),
    sort: z.array(sortSchema).optional(),
    limit: z.number().int().positive().max(500).optional(),
  }),
  z.object({
    ...cardBase,
    type: z.literal('pie'),
    metric: metricSchema,
    dimension: dimensionSchema,
    drillDimensions: drillDimensionsSchema,
    breakdownDimension: dimensionSchema.optional(),
    sort: z.array(sortSchema).optional(),
    limit: z.number().int().positive().max(500).optional(),
  }),
  z.object({
    ...cardBase,
    type: z.literal('table'),
    dimensions: z.array(dimensionSchema),
    pivotDimension: dimensionSchema.optional(),
    metrics: z.array(metricSchema).min(1),
    comparison: comparisonSchema.optional(),
    resultLimit: z.object({
      mode: z.enum(['pagination', 'top']),
      amount: z.number().int().positive().max(500),
    }),
    showSubtotals: z.boolean().optional(),
    showSummaryRow: z.boolean().optional(),
    sort: z.array(sortSchema).optional(),
  }),
]);

export const gridPlacementSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const dashboardWidgetSchema = z.object({
  id: z.string().min(1),
  layout: gridPlacementSchema,
  definition: widgetDefinitionSchema,
  definitionHash: z.string().min(1),
});

const dashboardFields = {
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  name: z.string().trim().min(1),
  timezone: z.string().min(1).default('Europe/Berlin'),
  defaultDateRange: dateRangeSchema,
  columns: z.number().int().positive().default(12),
  createdBy: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
};

export const dashboardPageSchema = z
  .object({
    hidden: z.boolean().default(false),
    id: z.string().min(1),
    name: z.string().trim().min(1),
    canvasRows: z.number().int().min(10),
    widgets: z.array(dashboardWidgetSchema),
  })
  .refine(
    (page) =>
      page.widgets.every((widget) => widget.layout.y + widget.layout.height <= page.canvasRows),
    {
      message: 'Canvas rows must contain every widget.',
      path: ['canvasRows'],
    },
  );

const currentDashboardSchema = z
  .object({
    ...dashboardFields,
    schemaVersion: z.literal(3),
    pages: z.array(dashboardPageSchema).min(1),
  })
  .refine(
    (document) => new Set(document.pages.map((page) => page.id)).size === document.pages.length,
    {
      message: 'Page IDs must be unique.',
      path: ['pages'],
    },
  )
  .refine(
    (document) => {
      const ids = document.pages.flatMap((page) => page.widgets.map((widget) => widget.id));
      return new Set(ids).size === ids.length;
    },
    { message: 'Widget IDs must be unique across the dashboard.', path: ['pages'] },
  );

const legacyDashboardSchema = z
  .object({
    ...dashboardFields,
    schemaVersion: z.literal(2),
    canvasRows: z.number().int().min(10).optional(),
    widgets: z.array(dashboardWidgetSchema),
  })
  .transform(({ widgets, canvasRows, ...document }) => ({
    ...document,
    schemaVersion: 3 as const,
    // A stable ID keeps old deep links usable before the migrated document is next saved.
    pages: [
      {
        id: `${document.id}_page`,
        name: 'Overview',
        hidden: false,
        widgets,
        canvasRows:
          canvasRows ??
          Math.max(10, ...widgets.map((widget) => widget.layout.y + widget.layout.height + 2)),
      },
    ],
  }));

export const dashboardDocumentSchema = z.preprocess((input) => {
  const legacy = legacyDashboardSchema.safeParse(input);
  return legacy.success ? legacy.data : input;
}, currentDashboardSchema);

export function dashboardWidgets(document: DashboardDocument) {
  return document.pages.flatMap((page) => page.widgets);
}

export function dashboardControlWidgets(document: DashboardDocument) {
  return document.pages.filter((page) => !page.hidden).flatMap((page) => page.widgets);
}

export type DashboardPage = z.infer<typeof dashboardPageSchema>;
// One clicked value per drilled level, starting at the chart's top-level `dimension`.
export const drillPathSchema = z.array(z.union([z.string(), z.number(), z.boolean()]));

export const controlStateSchema = z.object({
  dateRange: dateRangeSchema.optional(),
  values: z.record(z.string(), z.array(z.unknown())).optional(),
});

export const datasourceCachePolicySchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('default') }),
  z.object({ mode: z.literal('disabled') }),
  z.object({ mode: z.literal('duration'), ttlSeconds: z.number().int().min(1).max(86_400) }),
]);
export type DatasourceCachePolicy = z.infer<typeof datasourceCachePolicySchema>;

export const fileDataSourceLocationSchema = z.object({
  kind: z.enum(['object', 'prefix']),
  key: z.string().trim().min(1),
  format: z.enum(['parquet', 'csv']),
});

export const clickhouseLocationSchema = z.object({
  kind: z.literal('clickhouse'),
  database: z.string().trim().min(1).max(255),
  table: z.string().trim().min(1).max(255),
  ownership: z.enum(['managed', 'external']),
  cacheTtlSeconds: z.number().int().min(0).max(86_400).default(300),
});

export const dataSourceLocationSchema = z.union([
  fileDataSourceLocationSchema,
  clickhouseLocationSchema,
]);

export type DashboardDocument = z.infer<typeof dashboardDocumentSchema>;
export type DashboardWidget = z.infer<typeof dashboardWidgetSchema>;
export type WidgetDefinition = z.infer<typeof widgetDefinitionSchema>;
export type WidgetMetric = z.infer<typeof metricSchema>;
export type ComboMetric = z.infer<typeof comboMetricSchema>;
export type DateGranularity = z.infer<typeof dateGranularitySchema>;
export type ControlState = z.infer<typeof controlStateSchema>;
export type DrillPath = z.infer<typeof drillPathSchema>;
export type DateRange = z.infer<typeof dateRangeSchema>;
export type FieldRole = z.infer<typeof fieldRoleSchema>;
export type SemanticType = z.infer<typeof semanticTypeSchema>;
export type Aggregation = z.infer<typeof aggregationSchema>;
export type DataSourceLocation = z.infer<typeof dataSourceLocationSchema>;
export type TextStyle = z.infer<typeof textStyleSchema>;
export type BarColorBy = z.infer<typeof barColorBySchema>;

export const defaultDateRange: DateRange = {
  startDate: { relative: { amount: 30, unit: 'day', direction: 'past', anchor: 'startOfDay' } },
  endDate: { relative: { amount: 0, unit: 'day', direction: 'past', anchor: 'startOfDay' } },
};
