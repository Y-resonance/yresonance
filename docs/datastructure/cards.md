# Cards

## Common card fields

```yaml
CardBase:
  title: string
  dataSourceId: string
  dateRangeFieldId: string # date field the dashboard date range applies to
  filter?: Filter
  styling?: Styling
```

## Scorecard

```yaml
Scorecard:
  type: scorecard
  # CardBase
  metric: Metric
  comparison?: Comparison
```

## Gauge card

```yaml
GaugeCard:
  type: gauge
  # CardBase
  metric: Metric
  comparison?: Comparison
  upperLimit?: GaugeLimit

GaugeLimit:
  oneOf:
    - kind: manual
      value: number
    - kind: library
      libraryMetricId: string
```

A manual limit wins if a renderer receives both.

## Line card

```yaml
LineCard:
  type: line
  # CardBase
  dimension: Dimension # usually a date field
  metrics: Metric[]
  comparison?: Comparison
```

Axis assignment derives from `Metric.dataType`: numbers and currency on the left axis, percents on the right. No override yet.

## Bar card

```yaml
BarCard:
  type: bar
  # CardBase
  metric: Metric
  dimension: Dimension
  breakdownDimension?: BreakdownDimension
  comparison?: Comparison
  sort?: Sort[]
  limit?: integer
```

## Pie card

```yaml
PieCard:
  type: pie
  # CardBase
  metric: Metric
  dimension: Dimension
  breakdownDimension?: BreakdownDimension
  sort?: Sort[]
  limit?: integer
```

## Table

```yaml
Table:
  type: table
  # CardBase
  dimensions: Dimension[]
  metrics: Metric[]
  comparison?: Comparison
  resultLimit: ResultLimit
  showSummaryRow?: boolean
  sort?: Sort[]

ResultLimit:
  mode: pagination | top
  amount: integer # page size in pagination mode, X in top mode
```

## Card union

```yaml
Card:
  oneOf:
    - Scorecard
    - GaugeCard
    - LineCard
    - BarCard
    - PieCard
    - Table
```

## Compiled query

Every card compiles to one query of this shape, with control state applied. The client never sees or sends it; `explainWidget` returns it for inspection.

```sql
SELECT <dimensions>, <metric expressions>
FROM read_parquet(['http://r2.yresonance.internal/capability/<token>', ...])
WHERE <dateRangeFieldId> BETWEEN ? AND ?
  AND <card filter>
  AND <matching control values>
GROUP BY <dimensions>
ORDER BY <sort>
LIMIT <limit>
```

Calculated fields are inlined as expressions. A comparison runs the same query with the shifted range.
