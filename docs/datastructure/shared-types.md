# Shared types

These definitions are reused by controls and cards.

## Field references

A widget keeps `dataSourceId` at the widget level. Nested metrics, dimensions, and filters refer to fields by `fieldId` only. A `fieldId` resolves to a column or a calculated field of that datasource. Cross-datasource references do not exist; blends are out of scope.

## Styling

```yaml
Styling:
  # Renderer-specific keys.
  additionalProperties: unknown
```

Styles belong on the smallest element they affect. A card sets chart-wide styles; a metric or dimension can override its own presentation.

## Metric

A metric is exactly one of three sources.

```yaml
Metric:
  source: MetricSource
  userDefinedName?: string
  dataType: MetricDataType
  displayFormat?: DisplayFormat
  styling?: Styling

MetricSource:
  oneOf:
    - kind: field
      fieldId: string
      aggregation: Aggregation
    - kind: library
      libraryMetricId: string
    - kind: expression
      expression: string # yresonance aggregate formula over canonical field names

Aggregation: sum | average | count | countDistinct | min | max | median | standardDeviation | variance

MetricDataType: number | percent | duration | currency

DisplayFormat:
  radix?: integer
```

`kind: field` uses a stored aggregation. `kind: library` reuses a workspace metric.
`kind: expression` stores a one-off yresonance formula. `dataType` defaults from the field's or library
metric's `semanticType` and can be overridden.

## Dimension

```yaml
Dimension:
  fieldId: string
  userDefinedName?: string
  dateGranularity?: auto | raw | day | week | month | quarter | year
  styling?: Styling

BreakdownDimension:
  fieldId: string
  userDefinedName?: string
  styling?: Styling
```

A breakdown dimension splits each primary dimension value into series. `dateGranularity` only applies
to fields with the `date` semantic type. Charts use `auto` when a date is selected. Tables use `raw`.
Automatic granularity targets 30 buckets for widgets up to four columns wide, 60 through eight
columns, and 90 above eight columns. The compiler picks the finest calendar bucket that fits.

## Date range

```yaml
DateRange:
  startDate: DateValue
  endDate: DateValue

DateValue:
  fixed?: string # ISO 8601 date
  relative?: RelativeDate

RelativeDate:
  amount: integer
  unit: day | week | month | quarter | year
  direction: past | future
  anchor: now | startOfDay | startOfWeek | startOfMonth
```

Exactly one of `fixed` and `relative` is present. Relative dates resolve in the dashboard's `timezone`.

## Comparison

```yaml
Comparison:
  mode: none | previousPeriod | previousYear
```

`previousPeriod` shifts the resolved date range back by its own length. `previousYear` shifts it back one year. Either runs as a second query with the shifted range; the renderer shows the delta. Percent-of-total style calculations are a table calculation feature and are deferred.

## Sort

```yaml
Sort:
  target: SortTarget
  direction: asc | desc

SortTarget:
  oneOf:
    - kind: dimension
      fieldId: string
    - kind: metric
      index: integer # position in the card's metrics list
```

An ordered `sort` list is primary sort first, then secondary. Sort applies after aggregation and before the limit.
