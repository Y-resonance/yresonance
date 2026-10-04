import {
  type DashboardDocument,
  type DashboardWidget,
  type WidgetDefinition,
  type DateGranularity,
  type TextStyle,
  textStyleSchema,
  type BarColorBy,
} from '#/domain/schema';
import {
  type BuilderDataSource,
  type SourceDescription,
  message,
  type SourceField,
  type QuerySettingsProps,
} from './shared';
import { type LibraryMetricDraft } from '#/components/metric-formula-dialog';
import { useState, useRef, useEffect } from 'react';
import { type DatasourceFieldRow } from '#/domain/datasource-fields';
import { describeSource, changeSource } from './datasource';
import { calculatedFieldRow, DatasourceDialog } from './datasource-dialog';
import { widgetLabel } from '#/domain/widget-label';
import { Button } from '#/components/ui/button';
import { XIcon, MinusIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { Alert, AlertDescription } from '#/components/ui/alert';
import { Field, FieldLabel, FieldDescription } from '#/components/ui/field';
import { Input } from '#/components/ui/input';
import { Textarea } from '#/components/ui/textarea';
import { textDocument, replacePlainTextDocument } from '#/domain/text-content';
import { DateRangePicker } from '#/components/date-range-picker';
import { CalculatedFieldDialog } from '#/components/calculated-field-dialog';
import { textStyleClasses } from '#/domain/text-style';
import { cn } from '#/lib/utils';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from '#/components/ui/select';
import { NativeSelect, NativeSelectOption } from '#/components/ui/native-select';
import {
  patchFilterCondition,
  filterInputValue,
  filterValueFromInput,
} from '#/domain/widget-editing';
import { Switch } from '#/components/ui/switch';
import {
  FieldPicker,
  fieldChoices,
  axisLabel,
  formulaFieldId,
  EditFormulaButton,
} from './field-picker';
import { MetricSettings } from './metric-settings';

export function WidgetSettings({
  dashboardId,
  dashboardDefaultDateRange,
  timezone,
  widget,
  dataSources,
  onClose,
  onChange,
  onRemoveEmptyRowAbove,
  onRemoveEmptyRowBelow,
}: {
  dashboardId: string;
  dashboardDefaultDateRange: DashboardDocument['defaultDateRange'];
  timezone: string;
  widget: DashboardWidget;
  dataSources: BuilderDataSource[];
  onClose: () => void;
  onChange: (definition: WidgetDefinition, libraryMetric?: LibraryMetricDraft) => Promise<boolean>;
  onRemoveEmptyRowAbove?: () => void;
  onRemoveEmptyRowBelow?: () => void;
}) {
  const [definition, setDefinition] = useState(widget.definition);
  const [source, setSource] = useState<SourceDescription>();
  const [sourceOpen, setSourceOpen] = useState(false);
  const [fieldEditorOpen, setFieldEditorOpen] = useState(false);
  const [editedField, setEditedField] = useState<DatasourceFieldRow>();
  const [settingsError, setSettingsError] = useState<string>();
  const sourceRequestRef = useRef(0);
  const definitionRef = useRef(widget.definition);
  const sourceId = 'dataSourceId' in definition ? definition.dataSourceId : undefined;
  useEffect(() => {
    definitionRef.current = widget.definition;
    setDefinition(widget.definition);
  }, [widget.definition]);
  useEffect(() => {
    sourceRequestRef.current += 1;
    setSettingsError(undefined);
  }, [widget.id]);
  useEffect(() => {
    if (!sourceId) return;
    const currentSourceId = sourceId;
    let current = true;
    async function loadSource() {
      try {
        const next = await describeSource(currentSourceId, dashboardId);
        if (current) setSource(next);
      } catch (caught) {
        if (current) setSettingsError(message(caught));
      }
    }
    void loadSource();
    return () => {
      current = false;
    };
  }, [dashboardId, sourceId]);

  async function commit(next: WidgetDefinition) {
    definitionRef.current = next;
    setDefinition(next);
    await onChange(next);
  }

  function commitMetric(next: WidgetDefinition, libraryMetric?: LibraryMetricDraft) {
    definitionRef.current = next;
    setDefinition(next);
    return onChange(next, libraryMetric);
  }

  function setLocalDefinition(next: WidgetDefinition) {
    definitionRef.current = next;
    setDefinition(next);
  }

  async function selectSource(dataSourceId: string) {
    const currentDefinition = definitionRef.current;
    if (!('dataSourceId' in currentDefinition)) return;
    const request = ++sourceRequestRef.current;
    setSettingsError(undefined);
    try {
      const next = await changeSource(
        currentDefinition,
        dataSourceId,
        dashboardId,
        () => definitionRef.current,
      );
      if (request === sourceRequestRef.current) await commit(next);
    } catch (caught) {
      if (request === sourceRequestRef.current) setSettingsError(message(caught));
    }
  }

  const fields = [...(source?.fields ?? []), ...(source?.calculatedFields ?? [])];

  /** Opens the formula editor on an existing calculated field the widget already references. */
  function editCalculatedField(fieldId: string) {
    const calculated = source?.calculatedFields.find((item) => item.id === fieldId);
    if (!calculated) return;
    setEditedField(calculatedFieldRow(calculated));
    setFieldEditorOpen(true);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-medium">{widgetLabel(widget)}</h2>
          <p className="text-xs text-muted-foreground">{definition.type}</p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Close widget settings" onClick={onClose}>
          <XIcon />
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {onRemoveEmptyRowAbove ? (
          <Button variant="outline" size="sm" onClick={onRemoveEmptyRowAbove}>
            <MinusIcon data-icon="inline-start" />
            Remove empty row above
          </Button>
        ) : null}
        {onRemoveEmptyRowBelow ? (
          <Button variant="outline" size="sm" onClick={onRemoveEmptyRowBelow}>
            <MinusIcon data-icon="inline-start" />
            Remove empty row below
          </Button>
        ) : null}
      </div>
      {settingsError ? (
        <Alert variant="destructive">
          <AlertDescription>{settingsError}</AlertDescription>
        </Alert>
      ) : null}
      {'title' in definition ? (
        <>
          <Field>
            <FieldLabel htmlFor={`title-${widget.id}`}>Title</FieldLabel>
            <Input
              id={`title-${widget.id}`}
              value={definition.title}
              onChange={(event) => setLocalDefinition({ ...definition, title: event.target.value })}
              onBlur={() => void commit(definition)}
            />
          </Field>
          <TextStyleSettings
            legend="Title style"
            value={definition.titleStyle}
            onChange={(titleStyle) => void commit({ ...definition, titleStyle })}
          />
        </>
      ) : null}
      {definition.type === 'text' ? (
        <>
          <Field>
            <FieldLabel htmlFor={`text-${widget.id}`}>Text</FieldLabel>
            <Textarea
              id={`text-${widget.id}`}
              value={textDocument(definition.content.document)}
              readOnly={typeof definition.content.document !== 'string'}
              onChange={(event) =>
                typeof definition.content.document === 'string' &&
                setLocalDefinition({
                  ...definition,
                  content: {
                    ...definition.content,
                    document: replacePlainTextDocument(
                      definition.content.document,
                      event.target.value,
                    ),
                  },
                })
              }
              onBlur={() => {
                if (typeof definition.content.document === 'string') void commit(definition);
              }}
            />
            {typeof definition.content.document !== 'string' ? (
              <FieldDescription>
                Structured text is read-only here so its document format stays intact.
              </FieldDescription>
            ) : null}
          </Field>
          <TextStyleSettings
            legend="Text style"
            value={definition.textStyle}
            onChange={(textStyle) => void commit({ ...definition, textStyle })}
            hasFreeHeight
          />
        </>
      ) : null}
      {definition.type === 'dateControl' ? (
        <Field>
          <FieldLabel>Default range</FieldLabel>
          <DateRangePicker
            range={definition.defaultDateRange ?? dashboardDefaultDateRange}
            timezone={timezone}
            onChange={(defaultDateRange) => void commit({ ...definition, defaultDateRange })}
          />
        </Field>
      ) : null}
      {'dataSourceId' in definition ? (
        <>
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <FieldPicker
                label="Source"
                value={definition.dataSourceId}
                fields={dataSources.map((item) => ({ id: item.id, label: item.name }))}
                onChange={(dataSourceId) => void selectSource(dataSourceId)}
              />
            </div>
            <Button
              variant="outline"
              size="icon"
              aria-label="Edit datasource fields"
              onClick={() => setSourceOpen(true)}
            >
              <PencilIcon />
            </Button>
          </div>
          {definition.type === 'control' ? (
            <FieldPicker
              label="Field"
              value={definition.fieldId}
              fields={fieldChoices(fields.filter((field) => field.role !== 'metric'))}
              onChange={(fieldId) =>
                void commit({ ...definition, fieldId, defaultValues: undefined })
              }
            />
          ) : (
            <>
              <FieldPicker
                label="Date field"
                value={definition.dateRangeFieldId}
                fields={fieldChoices(fields.filter((field) => field.semanticType === 'date'))}
                onChange={(dateRangeFieldId) => void commit({ ...definition, dateRangeFieldId })}
              />
              <DimensionSettings
                definition={definition}
                fields={fields}
                commit={commit}
                onEditCalculatedField={editCalculatedField}
              />
              <MetricSettings
                dashboardId={dashboardId}
                definition={definition}
                fields={fields}
                source={source}
                commit={commitMetric}
                onEditCalculatedField={editCalculatedField}
              />
              <FilterSettings definition={definition} fields={fields} commit={commit} />
              <TypeSettings
                definition={definition}
                fields={fields}
                source={source}
                commit={commit}
              />
              <Button
                className="justify-self-start"
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditedField(undefined);
                  setFieldEditorOpen(true);
                }}
              >
                <PlusIcon data-icon="inline-start" /> New field
              </Button>
            </>
          )}
          {source ? (
            <DatasourceDialog
              open={sourceOpen}
              onOpenChange={setSourceOpen}
              dashboardId={dashboardId}
              source={source}
              onRefresh={() => describeSource(source.id, dashboardId).then(setSource)}
            />
          ) : null}
          {source ? (
            <CalculatedFieldDialog
              open={fieldEditorOpen}
              onOpenChange={setFieldEditorOpen}
              dashboardId={dashboardId}
              datasource={source}
              field={editedField}
              onSaved={() => describeSource(definition.dataSourceId, dashboardId).then(setSource)}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function LayoutNumberInput({
  id,
  value,
  min,
  max,
  onCommit,
}: {
  id: string;
  value: number;
  min: number;
  max?: number;
  onCommit: (value: number) => Promise<void>;
}) {
  const [input, setInput] = useState(String(value));
  useEffect(() => setInput(String(value)), [value]);
  return (
    <Input
      id={id}
      type="number"
      min={min}
      max={max}
      value={input}
      onChange={(event) => setInput(event.target.value)}
      onBlur={() => {
        const next = Number(input);
        if (Number.isInteger(next) && next >= min && (max === undefined || next <= max))
          void onCommit(next);
        else setInput(String(value));
      }}
    />
  );
}

function DimensionSettings({
  definition,
  fields,
  commit,
  onEditCalculatedField,
}: QuerySettingsProps & { onEditCalculatedField: (fieldId: string) => void }) {
  const dimensions = fields.filter((field) => field.role === 'dimension');
  const choices = fieldChoices(dimensions, 'Fields');
  if ('dimension' in definition) {
    const date = dimensions.find(
      (field) => field.id === definition.dimension.fieldId && field.semanticType === 'date',
    );
    return (
      <>
        <Field>
          <FieldLabel>{axisLabel('dimension', definition.type, false)}</FieldLabel>
          <div className="flex items-center gap-1">
            <div className="min-w-0 flex-1">
              <FieldPicker
                appearance="assignment"
                label="Dimension"
                prefix={
                  choices.find((field) => field.id === definition.dimension.fieldId)?.prefix ??
                  'ABC'
                }
                tone="dimension"
                value={definition.dimension.fieldId}
                fields={choices}
                onChange={(fieldId) =>
                  void commit({
                    ...definition,
                    dimension: dimensionForField(definition.dimension, fieldId, fields, 'auto'),
                  })
                }
              />
            </div>
            {formulaFieldId(fields, definition.dimension.fieldId) ? (
              <EditFormulaButton
                label="Edit dimension formula"
                onClick={() => onEditCalculatedField(definition.dimension.fieldId)}
              />
            ) : null}
          </div>
        </Field>
        {date ? (
          <DateGranularitySetting
            value={definition.dimension.dateGranularity ?? 'auto'}
            onChange={(dateGranularity) =>
              commit({ ...definition, dimension: { ...definition.dimension, dateGranularity } })
            }
          />
        ) : null}
      </>
    );
  }
  if ('dimensions' in definition)
    return (
      <Field>
        <FieldLabel>{axisLabel('dimension', definition.type, true)}</FieldLabel>
        <div className="flex flex-col gap-1.5">
          {definition.dimensions.map((dimension, index) => (
            <div key={`${dimension.fieldId}-${index}`} className="flex flex-col gap-1">
              <div className="flex items-center gap-1">
                <FieldPicker
                  appearance="assignment"
                  label={`Dimension ${index + 1}`}
                  prefix={choices.find((field) => field.id === dimension.fieldId)?.prefix ?? 'ABC'}
                  tone="dimension"
                  value={dimension.fieldId}
                  fields={choices}
                  onChange={(fieldId) =>
                    void commit({
                      ...definition,
                      dimensions: definition.dimensions.map((item, itemIndex) =>
                        itemIndex === index
                          ? dimensionForField(item, fieldId, fields, 'raw')
                          : item,
                      ),
                    })
                  }
                />
                {formulaFieldId(fields, dimension.fieldId) ? (
                  <EditFormulaButton
                    label={`Edit formula for dimension ${index + 1}`}
                    onClick={() => onEditCalculatedField(dimension.fieldId)}
                  />
                ) : null}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove dimension ${index + 1}`}
                  onClick={() =>
                    void commit({
                      ...definition,
                      dimensions: definition.dimensions.filter(
                        (_, itemIndex) => itemIndex !== index,
                      ),
                    })
                  }
                >
                  <Trash2Icon />
                </Button>
              </div>
              {fields.find(
                (field) => field.id === dimension.fieldId && field.semanticType === 'date',
              ) ? (
                <DateGranularitySetting
                  compact
                  value={dimension.dateGranularity ?? 'raw'}
                  onChange={(dateGranularity) =>
                    commit({
                      ...definition,
                      dimensions: definition.dimensions.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, dateGranularity } : item,
                      ),
                    })
                  }
                />
              ) : null}
            </div>
          ))}
          <FieldPicker
            appearance="add"
            label="Add dimension"
            tone="dimension"
            value=""
            fields={choices}
            onChange={(fieldId) =>
              void commit({
                ...definition,
                dimensions: [
                  ...definition.dimensions,
                  dimensionForField({ fieldId }, fieldId, fields, 'raw'),
                ],
              })
            }
          />
        </div>
      </Field>
    );
  return null;
}

type DimensionDefinition = Extract<WidgetDefinition, { type: 'line' }>['dimension'];

function dimensionForField(
  dimension: DimensionDefinition,
  fieldId: string,
  fields: SourceField[],
  dateDefault: DateGranularity,
): DimensionDefinition {
  const { dateGranularity: _dateGranularity, ...rest } = dimension;
  const date = fields.some((field) => field.id === fieldId && field.semanticType === 'date');
  return date ? { ...rest, fieldId, dateGranularity: dateDefault } : { ...rest, fieldId };
}

const textStyleFields = [
  {
    key: 'size',
    label: 'Size',
    // Short labels because each option renders at its own size, so a long word would overflow the
    // popup at the larger steps. The preview carries the meaning, not the wording.
    options: { xs: 'XS', sm: 'S', base: 'M', lg: 'L', xl: 'XL', '2xl': '2XL' },
  },
  {
    key: 'weight',
    label: 'Weight',
    options: { normal: 'Normal', medium: 'Medium', semibold: 'Semibold', bold: 'Bold' },
  },
  { key: 'transform', label: 'Case', options: { none: 'As typed', uppercase: 'Uppercase' } },
  { key: 'align', label: 'Align', options: { left: 'Left', center: 'Center', right: 'Right' } },
  {
    key: 'verticalAlign',
    label: 'Vertical',
    options: { top: 'Top', center: 'Middle', bottom: 'Bottom' },
    needsFreeHeight: true,
  },
  {
    key: 'tone',
    label: 'Tone',
    options: { default: 'Normal', muted: 'Muted', primary: 'Accent' },
    // A swatch rather than coloured label text: the highlighted option recolours its own text and
    // every descendant, which would hide exactly the preview the user is looking at.
    swatches: { default: 'bg-foreground', muted: 'bg-muted-foreground', primary: 'bg-primary' },
  },
] as const satisfies ReadonlyArray<{
  key: keyof TextStyle;
  label: string;
  options: Record<string, string>;
  swatches?: Record<string, string>;
  // Set on properties that only make sense when the element can grow taller than its text.
  needsFreeHeight?: boolean;
}>;

// The option previews itself by running through the same mapping that styles the real widget, so a
// preview can never drift from the render. Unknown values (the unset "Default") produce no classes.
function textStylePreview(key: keyof TextStyle, option: string) {
  const parsed = textStyleSchema.safeParse({ [key]: option });
  return parsed.success ? textStyleClasses(parsed.data) : undefined;
}

/**
 * Presentation controls for a text widget or a card title. Every property can stay unset, in which
 * case the widget renders with the app defaults, and a style with nothing set is stored as absent.
 */
function TextStyleSettings({
  legend,
  value,
  onChange,
  hasFreeHeight = false,
}: {
  legend: string;
  value: TextStyle | undefined;
  onChange: (style: TextStyle | undefined) => void;
  /** Whether the styled element fills its widget, which is what makes vertical alignment do anything. */
  hasFreeHeight?: boolean;
}) {
  const update = (key: keyof TextStyle, selected: string | null) => {
    const draft: Record<string, string | undefined> = { ...value };
    if (selected) draft[key] = selected;
    else delete draft[key];
    const parsed = textStyleSchema.safeParse(draft);
    onChange(parsed.success && Object.keys(draft).length ? parsed.data : undefined);
  };
  return (
    <Field>
      <FieldLabel>{legend}</FieldLabel>
      <div className="grid grid-cols-2 gap-2">
        {textStyleFields
          .filter((setting) => hasFreeHeight || !('needsFreeHeight' in setting))
          .map((setting) => {
            const options: Record<string, string> = setting.options;
            const swatches: Record<string, string> | undefined =
              'swatches' in setting ? setting.swatches : undefined;
            // `w-full` is what lets the align preview work: the label fills the row, so `text-right`
            // actually moves it. The other properties are unaffected by the extra width.
            const optionContent = (option: string, preview: boolean) => (
              <>
                {/* The empty slot for the unset option keeps every label in the list on one line. */}
                {swatches ? (
                  <span
                    aria-hidden="true"
                    className={cn(
                      'size-2.5 shrink-0 rounded-full',
                      swatches[option] ?? 'bg-transparent',
                    )}
                  />
                ) : null}
                <span className={cn('w-full', preview && textStylePreview(setting.key, option))}>
                  {options[option] ?? 'Default'}
                </span>
              </>
            );
            return (
              <div key={setting.key} className="grid gap-1">
                <span className="text-xs text-muted-foreground">{setting.label}</span>
                <Select
                  value={value?.[setting.key] ?? ''}
                  onValueChange={(selected) => update(setting.key, selected)}
                >
                  <SelectTrigger
                    aria-label={`${legend}: ${setting.label.toLowerCase()}`}
                    className="w-full"
                  >
                    {/* The trigger stays at the control's own size so the two columns keep an even
                      height. Only the options preview themselves. */}
                    <SelectValue>
                      {(selected: string | null) => optionContent(selected ?? '', false)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="min-w-40" align="start" alignItemWithTrigger={false}>
                    <SelectGroup>
                      <SelectItem value="">{optionContent('', false)}</SelectItem>
                      {Object.keys(options).map((option) => (
                        <SelectItem key={option} value={option}>
                          {optionContent(option, true)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            );
          })}
      </div>
    </Field>
  );
}

function DateGranularitySetting({
  value,
  onChange,
  compact = false,
}: {
  value: DateGranularity;
  onChange: (value: DateGranularity) => Promise<void>;
  compact?: boolean;
}) {
  const select = (
    <NativeSelect
      aria-label={compact ? 'Date granularity' : undefined}
      value={value}
      onChange={(event) => void onChange(event.target.value as DateGranularity)}
    >
      <NativeSelectOption value="auto">Automatic</NativeSelectOption>
      <NativeSelectOption value="raw">Raw values</NativeSelectOption>
      <NativeSelectOption value="day">Day</NativeSelectOption>
      <NativeSelectOption value="week">Week</NativeSelectOption>
      <NativeSelectOption value="month">Month</NativeSelectOption>
      <NativeSelectOption value="quarter">Quarter</NativeSelectOption>
      <NativeSelectOption value="year">Year</NativeSelectOption>
    </NativeSelect>
  );
  if (compact) return select;
  return (
    <Field>
      <FieldLabel>Date granularity</FieldLabel>
      {select}
    </Field>
  );
}

function FilterSettings({ definition, fields, commit }: QuerySettingsProps) {
  const filter = definition.filter;
  const conditions = filter?.conditions ?? [];
  function updateCondition(index: number, patch: Partial<(typeof conditions)[number]>) {
    const currentFilter = filter ?? { connector: 'and' as const, conditions };
    return commit({
      ...definition,
      filter: patchFilterCondition(currentFilter, index, patch),
    });
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <FieldLabel>Filters</FieldLabel>
        {conditions.length > 1 ? (
          <NativeSelect
            className="w-24"
            aria-label="Filter connector"
            value={filter?.connector ?? 'and'}
            onChange={(event) =>
              void commit({
                ...definition,
                filter: {
                  connector: event.target.value as 'and' | 'or',
                  conditions,
                },
              })
            }
          >
            <NativeSelectOption value="and">Match all</NativeSelectOption>
            <NativeSelectOption value="or">Match any</NativeSelectOption>
          </NativeSelect>
        ) : null}
      </div>
      {conditions.map((condition, index) => (
        <div key={`${condition.fieldId}-${index}`} className="grid gap-2 border-l-2 pl-3">
          <FieldPicker
            label={`Filter ${index + 1}`}
            value={condition.fieldId}
            fields={fieldChoices(fields)}
            onChange={(fieldId) => void updateCondition(index, { fieldId })}
          />
          <NativeSelect
            aria-label={`Filter ${index + 1} operator`}
            value={condition.operator}
            onChange={(event) =>
              void updateCondition(index, {
                operator: event.target.value as typeof condition.operator,
              })
            }
          >
            {filterOperators.map((item) => (
              <NativeSelectOption key={item} value={item}>
                {item}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {!['isEmpty', 'isNotEmpty'].includes(condition.operator) ? (
            <FilterValueInput
              value={filterInputValue(
                condition.value,
                condition.operator === 'in' || condition.operator === 'notIn',
              )}
              onCommit={(value) =>
                updateCondition(index, {
                  value: filterValueFromInput(
                    value,
                    condition.operator === 'in' || condition.operator === 'notIn',
                  ),
                })
              }
            />
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const next = conditions.filter((_, itemIndex) => itemIndex !== index);
              void commit({
                ...definition,
                filter: next.length
                  ? { connector: filter?.connector ?? 'and', conditions: next }
                  : undefined,
              });
            }}
          >
            Remove filter
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          fields[0] &&
          void commit({
            ...definition,
            filter: {
              connector: filter?.connector ?? 'and',
              conditions: [...conditions, { fieldId: fields[0].id, operator: 'equals', value: '' }],
            },
          })
        }
      >
        <PlusIcon data-icon="inline-start" /> Add filter
      </Button>
    </div>
  );
}

const filterOperators = [
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
] as const;

function FilterValueInput({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (value: string) => Promise<void>;
}) {
  const [input, setInput] = useState(value);
  useEffect(() => setInput(value), [value]);
  return (
    <Input
      value={input}
      placeholder="Value"
      onChange={(event) => setInput(event.target.value)}
      onBlur={() => void onCommit(input)}
    />
  );
}

function TypeSettings({
  definition,
  fields,
  source,
  commit,
}: QuerySettingsProps & { source?: SourceDescription }) {
  const dimensions = fields.filter(
    (field) => field.role === 'dimension' && field.semanticType !== 'date',
  );
  switch (definition.type) {
    case 'scorecard':
    case 'line':
    case 'combo':
      return (
        <ComparisonSetting
          value={definition.comparison?.mode ?? 'none'}
          onChange={(mode) => commit({ ...definition, comparison: { mode } })}
        />
      );
    case 'gauge':
      return (
        <>
          <ComparisonSetting
            value={definition.comparison?.mode ?? 'none'}
            onChange={(mode) => commit({ ...definition, comparison: { mode } })}
          />
          <Field>
            <FieldLabel>Upper limit</FieldLabel>
            <NativeSelect
              value={definition.upperLimit?.kind ?? 'none'}
              onChange={(event) => {
                const kind = event.target.value;
                if (kind === 'manual') {
                  void commit({ ...definition, upperLimit: { kind, value: 100 } });
                  return;
                }
                if (kind === 'library') {
                  const libraryMetricId = source?.libraryMetrics[0]?.id;
                  if (!libraryMetricId) return;
                  void commit({ ...definition, upperLimit: { kind, libraryMetricId } });
                  return;
                }
                void commit({ ...definition, upperLimit: undefined });
              }}
            >
              <NativeSelectOption value="none">Automatic</NativeSelectOption>
              <NativeSelectOption value="manual">Manual</NativeSelectOption>
              {source?.libraryMetrics.length || definition.upperLimit?.kind === 'library' ? (
                <NativeSelectOption value="library">Library metric</NativeSelectOption>
              ) : null}
            </NativeSelect>
          </Field>
          {definition.upperLimit?.kind === 'manual' ? (
            <Field>
              <FieldLabel htmlFor="gauge-upper-limit">Maximum</FieldLabel>
              <LayoutNumberInput
                id="gauge-upper-limit"
                min={1}
                value={definition.upperLimit.value}
                onCommit={(value) =>
                  commit({ ...definition, upperLimit: { kind: 'manual', value } })
                }
              />
            </Field>
          ) : null}
          {definition.upperLimit?.kind === 'library' ? (
            <Field>
              <FieldLabel htmlFor="gauge-upper-limit-metric">Maximum metric</FieldLabel>
              <NativeSelect
                id="gauge-upper-limit-metric"
                value={definition.upperLimit.libraryMetricId}
                onChange={(event) =>
                  void commit({
                    ...definition,
                    upperLimit: {
                      kind: 'library',
                      libraryMetricId: event.target.value,
                    },
                  })
                }
              >
                {source?.libraryMetrics.map((metric) => (
                  <NativeSelectOption key={metric.id} value={metric.id}>
                    {metric.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          ) : null}
        </>
      );
    case 'bar':
      return (
        <>
          <ComparisonSetting
            value={definition.comparison?.mode ?? 'none'}
            onChange={(mode) => commit({ ...definition, comparison: { mode } })}
          />
          <BreakdownSetting
            value={definition.breakdownDimension?.fieldId ?? ''}
            fields={dimensions}
            onChange={(fieldId) =>
              commit({ ...definition, breakdownDimension: fieldId ? { fieldId } : undefined })
            }
          />
          {/* A breakdown or a comparison already spends the palette on series, so the choice is
              only offered while the chart draws a single series. */}
          {!definition.breakdownDimension && (definition.comparison?.mode ?? 'none') === 'none' ? (
            <ColorBySetting
              value={definition.colorBy ?? 'series'}
              onChange={(colorBy) => commit({ ...definition, colorBy })}
            />
          ) : null}
          <LimitSetting
            value={definition.limit ?? 20}
            onChange={(limit) => commit({ ...definition, limit })}
          />
          <SortSetting
            value={definition.sort?.[0]?.direction ?? 'desc'}
            onChange={(direction) =>
              commit({
                ...definition,
                sort: sortWithDirection(definition.sort, direction),
              })
            }
          />
        </>
      );
    case 'pie':
      return (
        <>
          <BreakdownSetting
            value={definition.breakdownDimension?.fieldId ?? ''}
            fields={dimensions}
            onChange={(fieldId) =>
              commit({ ...definition, breakdownDimension: fieldId ? { fieldId } : undefined })
            }
          />
          <LimitSetting
            value={definition.limit ?? 20}
            onChange={(limit) => commit({ ...definition, limit })}
          />
          <SortSetting
            value={definition.sort?.[0]?.direction ?? 'desc'}
            onChange={(direction) =>
              commit({
                ...definition,
                sort: sortWithDirection(definition.sort, direction),
              })
            }
          />
        </>
      );
    case 'table':
      return (
        <>
          <ComparisonSetting
            value={definition.comparison?.mode ?? 'none'}
            onChange={(mode) => commit({ ...definition, comparison: { mode } })}
          />
          <LimitSetting
            label="Result limit"
            value={definition.resultLimit.amount}
            onChange={(amount) =>
              commit({ ...definition, resultLimit: { ...definition.resultLimit, amount } })
            }
          />
          <SortSetting
            value={definition.sort?.[0]?.direction ?? 'desc'}
            onChange={(direction) =>
              commit({
                ...definition,
                sort: sortWithDirection(definition.sort, direction),
              })
            }
          />
          <FieldPicker
            label="Pivot columns"
            value={definition.pivotDimension?.fieldId ?? ''}
            fields={[
              { id: '', label: 'None' },
              ...dimensions.filter(
                (field) => !definition.dimensions.some((item) => item.fieldId === field.id),
              ),
            ]}
            onChange={(fieldId) =>
              void commit({
                ...definition,
                pivotDimension: fieldId ? { fieldId } : undefined,
              })
            }
          />
          <Field orientation="horizontal">
            <FieldLabel>Show subtotals</FieldLabel>
            <Switch
              checked={definition.showSubtotals ?? false}
              disabled={definition.dimensions.length < 2}
              onCheckedChange={(showSubtotals) => void commit({ ...definition, showSubtotals })}
            />
            {definition.dimensions.length < 2 ? (
              <FieldDescription>Add a second dimension to group rows.</FieldDescription>
            ) : null}
          </Field>
        </>
      );
    default:
      return null;
  }
}

type ComparisonMode = 'none' | 'previousPeriod' | 'previousYear';

function ComparisonSetting({
  value,
  onChange,
}: {
  value: ComparisonMode;
  onChange: (value: ComparisonMode) => Promise<void>;
}) {
  return (
    <Field>
      <FieldLabel>Comparison</FieldLabel>
      <NativeSelect
        value={value}
        onChange={(event) => void onChange(event.target.value as ComparisonMode)}
      >
        <NativeSelectOption value="none">None</NativeSelectOption>
        <NativeSelectOption value="previousPeriod">Previous period</NativeSelectOption>
        <NativeSelectOption value="previousYear">Previous year</NativeSelectOption>
      </NativeSelect>
    </Field>
  );
}

function BreakdownSetting({
  value,
  fields,
  onChange,
}: {
  value: string;
  fields: SourceField[];
  onChange: (value: string) => Promise<void>;
}) {
  return (
    <FieldPicker
      label="Breakdown"
      value={value}
      fields={[{ id: '', label: 'None' }, ...fields]}
      onChange={(fieldId) => void onChange(fieldId)}
    />
  );
}

function LimitSetting({
  label = 'Limit',
  value,
  onChange,
}: {
  label?: string;
  value: number;
  onChange: (value: number) => Promise<void>;
}) {
  const id = `type-${label.toLocaleLowerCase().replaceAll(' ', '-')}`;
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <LayoutNumberInput id={id} min={1} max={500} value={value} onCommit={onChange} />
    </Field>
  );
}

/**
 * Bar charts colour per series, which leaves a single-series chart in one colour. This offers the
 * alternative of a palette slot per bar.
 */
function ColorBySetting({
  value,
  onChange,
}: {
  value: BarColorBy;
  onChange: (value: BarColorBy) => Promise<void>;
}) {
  return (
    <Field>
      <FieldLabel htmlFor="bar-color-by">Color by</FieldLabel>
      <NativeSelect
        id="bar-color-by"
        value={value}
        onChange={(event) => void onChange(event.target.value as BarColorBy)}
      >
        <NativeSelectOption value="series">Metric</NativeSelectOption>
        <NativeSelectOption value="category">Bar</NativeSelectOption>
      </NativeSelect>
    </Field>
  );
}

function SortSetting({
  value,
  onChange,
}: {
  value: 'asc' | 'desc';
  onChange: (value: 'asc' | 'desc') => Promise<void>;
}) {
  return (
    <Field>
      <FieldLabel>Sort</FieldLabel>
      <NativeSelect
        value={value}
        onChange={(event) => void onChange(event.target.value as 'asc' | 'desc')}
      >
        <NativeSelectOption value="desc">Highest first</NativeSelectOption>
        <NativeSelectOption value="asc">Lowest first</NativeSelectOption>
      </NativeSelect>
    </Field>
  );
}

type SortDefinition = Extract<WidgetDefinition, { type: 'table' }>['sort'];

function sortWithDirection(sort: SortDefinition, direction: 'asc' | 'desc') {
  return [
    {
      ...(sort?.[0] ?? { target: { kind: 'metric' as const, index: 0 } }),
      direction,
    },
    ...(sort?.slice(1) ?? []),
  ];
}
