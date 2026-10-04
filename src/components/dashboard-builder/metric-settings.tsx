import { type SourceDescription, aggregations } from './shared';
import {
  type WidgetDefinition,
  type WidgetMetric,
  type ComboMetric,
  type Aggregation,
} from '#/domain/schema';
import { comboAxisFor } from '#/domain/widget-editing';
import { type LibraryMetricDraft, MetricFormulaDialog } from '#/components/metric-formula-dialog';
import { useState } from 'react';
import { Field, FieldLabel } from '#/components/ui/field';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from '#/components/ui/select';
import { Tooltip, TooltipTrigger, TooltipContent } from '#/components/ui/tooltip';
import { CircleHelpIcon, Trash2Icon, PlusIcon } from 'lucide-react';
import { Button } from '#/components/ui/button';
import { NativeSelect, NativeSelectOption } from '#/components/ui/native-select';
import { Input } from '#/components/ui/input';
import { type QuerySettingsProps } from './shared';
import {
  fieldChoices,
  axisLabel,
  aggregationIcons,
  aggregationLabel,
  aggregationDescriptions,
  FieldPicker,
  EditFormulaButton,
  formulaFieldId,
} from './field-picker';

export function MetricSettings({
  definition,
  fields,
  source,
  commit,
  dashboardId,
  onEditCalculatedField,
}: Omit<QuerySettingsProps, 'commit'> & {
  dashboardId: string;
  source?: SourceDescription;
  commit: (definition: WidgetDefinition, libraryMetric?: LibraryMetricDraft) => Promise<boolean>;
  onEditCalculatedField: (fieldId: string) => void;
}) {
  const [formulaOpen, setFormulaOpen] = useState(false);
  const [editedIndex, setEditedIndex] = useState<number>();
  const choices = [
    ...fieldChoices(
      fields.filter((field) => field.role === 'metric'),
      'Fields',
    ),
    ...(source?.libraryMetrics ?? []).map((item) => ({
      id: item.id,
      label: item.name,
      group: 'Metric library',
      prefix: 'fx',
    })),
  ];
  const metrics =
    'metric' in definition
      ? [definition.metric]
      : 'metrics' in definition
        ? definition.metrics
        : [];
  if (!metrics.length) return null;
  function update(index: number, nextMetric: WidgetMetric) {
    if ('metric' in definition) return commit({ ...definition, metric: nextMetric });
    if (definition.type === 'combo')
      return commit({
        ...definition,
        metrics: definition.metrics.map((item, itemIndex) => {
          if (itemIndex !== index) return item;
          const others = definition.metrics.filter((_, otherIndex) => otherIndex !== index);
          // A new field can change the unit, so the metric moves to an axis that still fits it.
          return {
            mark: item.mark,
            ...nextMetric,
            axis: comboAxisFor(others, nextMetric.dataType, item.axis),
          };
        }),
      });
    if ('metrics' in definition)
      return commit({
        ...definition,
        metrics: definition.metrics.map((item, itemIndex) =>
          itemIndex === index ? nextMetric : item,
        ),
      });
    return Promise.resolve(false);
  }
  function addMetric(next: WidgetMetric, libraryMetric?: LibraryMetricDraft) {
    if ('metric' in definition) return commit({ ...definition, metric: next }, libraryMetric);
    if (definition.type === 'combo')
      return commit(
        {
          ...definition,
          metrics: [
            ...definition.metrics,
            { ...next, mark: 'line', axis: comboAxisFor(definition.metrics, next.dataType) },
          ],
        },
        libraryMetric,
      );
    if ('metrics' in definition)
      return commit({ ...definition, metrics: [...definition.metrics, next] }, libraryMetric);
    return Promise.resolve(false);
  }
  function removeMetric(index: number) {
    const keep = (_: unknown, itemIndex: number) => itemIndex !== index;
    if (definition.type === 'combo')
      return commit({ ...definition, metrics: definition.metrics.filter(keep) });
    if ('metrics' in definition)
      return commit({ ...definition, metrics: definition.metrics.filter(keep) });
    return Promise.resolve(false);
  }
  function metricFor(id: string): WidgetMetric {
    const library = source?.libraryMetrics.find((item) => item.id === id);
    const field = fields.find((item) => item.id === id);
    return {
      source: library
        ? { kind: 'library', libraryMetricId: id }
        : {
            kind: 'field',
            fieldId: id,
            aggregation: field?.defaultAggregation ?? 'sum',
          },
      dataType:
        (field?.semanticType ?? library?.semanticType) === 'currency'
          ? 'currency'
          : (field?.semanticType ?? library?.semanticType) === 'ratio'
            ? 'percent'
            : 'number',
    };
  }
  return (
    <>
      <Field>
        <FieldLabel>{axisLabel('metric', definition.type, metrics.length > 1)}</FieldLabel>
        <div className="flex flex-col gap-1.5">
          {metrics.map((metric, index) => {
            const value =
              metric.source.kind === 'field'
                ? metric.source.fieldId
                : metric.source.kind === 'library'
                  ? metric.source.libraryMetricId
                  : `expression:${index}`;
            const metricChoices =
              metric.source.kind === 'expression'
                ? [
                    {
                      id: value,
                      label: metric.userDefinedName ?? 'Custom expression',
                      group: 'Chart metrics',
                      prefix: 'fx',
                    },
                    ...choices,
                  ]
                : choices;
            return (
              <div key={`${value}-${index}`} className="flex flex-col gap-2">
                <div className="flex items-center gap-1">
                  <div className="flex h-8 min-w-0 flex-1 overflow-hidden rounded-full border border-metric/40 bg-metric/10">
                    {metric.source.kind === 'field' ? (
                      <Select
                        value={metric.source.aggregation}
                        onValueChange={(aggregation) => {
                          if (!aggregation) return;
                          void update(index, {
                            ...metric,
                            source: {
                              kind: 'field',
                              fieldId: metric.source.kind === 'field' ? metric.source.fieldId : '',
                              aggregation,
                            },
                          });
                        }}
                      >
                        <SelectTrigger
                          aria-label={`Aggregation for metric ${index + 1}`}
                          className="w-28 shrink-0"
                          variant="embedded"
                        >
                          <SelectValue>
                            {(aggregation: Aggregation | null) => {
                              if (!aggregation) return null;
                              const Icon = aggregationIcons[aggregation];
                              return (
                                <>
                                  <Icon />
                                  {aggregationLabel(aggregation)}
                                </>
                              );
                            }}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent
                          className="min-w-40"
                          align="start"
                          alignItemWithTrigger={false}
                        >
                          <SelectGroup>
                            {aggregations.map((item) => {
                              const Icon = aggregationIcons[item];
                              return (
                                <Tooltip key={item}>
                                  <TooltipTrigger
                                    render={<SelectItem className="pr-16" value={item} />}
                                  >
                                    <Icon />
                                    <span>{aggregationLabel(item)}</span>
                                    <CircleHelpIcon
                                      data-slot="aggregation-help"
                                      className="absolute right-8"
                                      aria-hidden="true"
                                    />
                                  </TooltipTrigger>
                                  <TooltipContent side="right">
                                    {aggregationDescriptions[item]}
                                  </TooltipContent>
                                </Tooltip>
                              );
                            })}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="flex w-12 shrink-0 items-center justify-center border-r border-metric/30 font-mono text-xs font-semibold text-muted-foreground">
                        fx
                      </span>
                    )}
                    <FieldPicker
                      appearance="embedded"
                      label={`Metric${metrics.length > 1 ? ` ${index + 1}` : ''}`}
                      tone="metric"
                      value={value}
                      fields={metricChoices}
                      onCreate={{ label: 'Add custom metric', action: () => setFormulaOpen(true) }}
                      onChange={(id) => {
                        if (id !== value) void update(index, metricFor(id));
                      }}
                    />
                  </div>
                  {metric.source.kind === 'expression' ? (
                    <EditFormulaButton
                      label={`Edit formula for metric ${index + 1}`}
                      onClick={() => setEditedIndex(index)}
                    />
                  ) : formulaFieldId(fields, value) ? (
                    <EditFormulaButton
                      label={`Edit formula for metric ${index + 1}`}
                      onClick={() => onEditCalculatedField(value)}
                    />
                  ) : null}
                  {'metrics' in definition && definition.metrics.length > 1 ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove metric ${index + 1}`}
                      onClick={() => void removeMetric(index)}
                    >
                      <Trash2Icon />
                    </Button>
                  ) : null}
                </div>
                {definition.type === 'combo' ? (
                  <ComboMetricSettings
                    index={index}
                    metric={definition.metrics[index]!}
                    onChange={(next) =>
                      void commit({
                        ...definition,
                        metrics: definition.metrics.map((item, itemIndex) =>
                          itemIndex === index ? next : item,
                        ),
                      })
                    }
                  />
                ) : null}
                {definition.type === 'table' ? (
                  <ConditionalFormatSettings
                    metric={metric}
                    onChange={async (conditionalFormat) => {
                      await update(index, { ...metric, conditionalFormat });
                    }}
                  />
                ) : null}
              </div>
            );
          })}
          {'metrics' in definition ? (
            <FieldPicker
              appearance="add"
              label="Add metric"
              tone="metric"
              value=""
              fields={choices}
              onCreate={{ label: 'Add custom metric', action: () => setFormulaOpen(true) }}
              onChange={(id) => void addMetric(metricFor(id))}
            />
          ) : null}
        </div>
      </Field>
      <MetricFormulaDialog
        open={formulaOpen || editedIndex !== undefined}
        onOpenChange={(next) => {
          if (next) return;
          setFormulaOpen(false);
          setEditedIndex(undefined);
        }}
        dashboardId={dashboardId}
        source={source}
        metric={editedIndex === undefined ? undefined : metrics[editedIndex]}
        onSave={(next, libraryMetric) =>
          editedIndex === undefined ? addMetric(next, libraryMetric) : update(editedIndex, next)
        }
      />
    </>
  );
}

function ComboMetricSettings({
  index,
  metric,
  onChange,
}: {
  index: number;
  metric: ComboMetric;
  onChange: (metric: ComboMetric) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-1 pl-2">
      <NativeSelect
        className="w-full"
        size="sm"
        aria-label={`Chart type for metric ${index + 1}`}
        value={metric.mark}
        onChange={(event) =>
          onChange({ ...metric, mark: event.target.value as ComboMetric['mark'] })
        }
      >
        <NativeSelectOption value="bar">Bars</NativeSelectOption>
        <NativeSelectOption value="line">Line</NativeSelectOption>
      </NativeSelect>
      <NativeSelect
        className="w-full"
        size="sm"
        aria-label={`Axis for metric ${index + 1}`}
        value={metric.axis}
        onChange={(event) =>
          onChange({ ...metric, axis: event.target.value as ComboMetric['axis'] })
        }
      >
        <NativeSelectOption value="left">Left axis</NativeSelectOption>
        <NativeSelectOption value="right">Right axis</NativeSelectOption>
      </NativeSelect>
    </div>
  );
}

type ConditionalFormat = NonNullable<WidgetMetric['conditionalFormat']>;

function ConditionalFormatSettings({
  metric,
  onChange,
}: {
  metric: WidgetMetric;
  onChange: (rules: ConditionalFormat | undefined) => Promise<void>;
}) {
  const rules = metric.conditionalFormat ?? [];
  const update = (index: number, rule: ConditionalFormat[number]) =>
    onChange(rules.map((item, itemIndex) => (itemIndex === index ? rule : item)));
  return (
    <div className="grid gap-2 pl-2">
      <div className="flex items-center justify-between gap-2">
        <FieldLabel>Conditional formatting</FieldLabel>
        <Button
          variant="ghost"
          size="xs"
          onClick={() =>
            void onChange([...rules, { comparator: 'gte', value: 0, color: 'positive' }])
          }
        >
          <PlusIcon data-icon="inline-start" /> Add rule
        </Button>
      </div>
      {rules.map((rule, index) => (
        <div key={index} className="grid grid-cols-[1fr_5rem_6rem_auto] items-center gap-1">
          <NativeSelect
            aria-label={`Rule ${index + 1} comparator`}
            value={rule.comparator}
            onChange={(event) => {
              const comparator = event.target.value;
              void update(
                index,
                comparator === 'between'
                  ? { comparator, min: 0, max: 100, color: rule.color }
                  : {
                      comparator: comparator as 'gt' | 'lt' | 'gte' | 'lte',
                      value: 'value' in rule ? rule.value : rule.min,
                      color: rule.color,
                    },
              );
            }}
          >
            <NativeSelectOption value="gt">Greater than</NativeSelectOption>
            <NativeSelectOption value="gte">At least</NativeSelectOption>
            <NativeSelectOption value="lt">Less than</NativeSelectOption>
            <NativeSelectOption value="lte">At most</NativeSelectOption>
            <NativeSelectOption value="between">Between</NativeSelectOption>
          </NativeSelect>
          <ThresholdInputs rule={rule} onChange={(next) => update(index, next)} />
          <NativeSelect
            aria-label={`Rule ${index + 1} color`}
            value={rule.color}
            onChange={(event) =>
              void update(index, {
                ...rule,
                color: event.target.value as ConditionalFormat[number]['color'],
              })
            }
          >
            <NativeSelectOption value="positive">Positive</NativeSelectOption>
            <NativeSelectOption value="warning">Warning</NativeSelectOption>
            <NativeSelectOption value="negative">Negative</NativeSelectOption>
            <NativeSelectOption value="neutral">Neutral</NativeSelectOption>
          </NativeSelect>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove rule ${index + 1}`}
            onClick={() => {
              const next = rules.filter((_, itemIndex) => itemIndex !== index);
              void onChange(next.length ? next : undefined);
            }}
          >
            <Trash2Icon />
          </Button>
        </div>
      ))}
    </div>
  );
}

function ThresholdInputs({
  rule,
  onChange,
}: {
  rule: ConditionalFormat[number];
  onChange: (rule: ConditionalFormat[number]) => Promise<void>;
}) {
  if (rule.comparator === 'between')
    return (
      <div className="flex gap-1">
        <Input
          aria-label="Minimum"
          type="number"
          defaultValue={rule.min}
          onBlur={(event) => void onChange({ ...rule, min: Number(event.currentTarget.value) })}
        />
        <Input
          aria-label="Maximum"
          type="number"
          defaultValue={rule.max}
          onBlur={(event) => void onChange({ ...rule, max: Number(event.currentTarget.value) })}
        />
      </div>
    );
  return (
    <Input
      aria-label="Threshold"
      type="number"
      defaultValue={rule.value}
      onBlur={(event) => void onChange({ ...rule, value: Number(event.currentTarget.value) })}
    />
  );
}
