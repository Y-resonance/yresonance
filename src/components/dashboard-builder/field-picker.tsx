import { type Aggregation, type SemanticType, type WidgetDefinition } from '#/domain/schema';
import {
  type LucideIcon,
  SigmaIcon,
  CircleDivideIcon,
  HashIcon,
  FingerprintIcon,
  ArrowDownToLineIcon,
  ArrowUpToLineIcon,
  AlignCenterVerticalIcon,
  ActivityIcon,
  ChartScatterIcon,
  SquareFunctionIcon,
  PlusIcon,
} from 'lucide-react';
import { type SourceField } from './shared';
import { Tooltip, TooltipTrigger, TooltipContent } from '#/components/ui/tooltip';
import { Button } from '#/components/ui/button';
import { useState } from 'react';
import { Field, FieldLabel } from '#/components/ui/field';
import { cn } from '#/lib/utils';
import { Popover, PopoverTrigger, PopoverContent } from '#/components/ui/popover';
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from '#/components/ui/command';

const aggregationLabels: Record<Aggregation, string> = {
  sum: 'SUM',
  average: 'AVG',
  count: 'COUNT',
  countDistinct: 'COUNTD',
  min: 'MIN',
  max: 'MAX',
  median: 'MEDIAN',
  standardDeviation: 'STDDEV',
  variance: 'VAR',
};

export const aggregationIcons: Record<Aggregation, LucideIcon> = {
  sum: SigmaIcon,
  average: CircleDivideIcon,
  count: HashIcon,
  countDistinct: FingerprintIcon,
  min: ArrowDownToLineIcon,
  max: ArrowUpToLineIcon,
  median: AlignCenterVerticalIcon,
  standardDeviation: ActivityIcon,
  variance: ChartScatterIcon,
};

export const aggregationDescriptions: Record<Aggregation, string> = {
  sum: 'Adds all non-null values in each group.',
  average: 'Returns the arithmetic mean of all non-null values.',
  count: 'Counts rows where this field is not null.',
  countDistinct: 'Counts unique non-null values.',
  min: 'Returns the smallest non-null value.',
  max: 'Returns the largest non-null value.',
  median: 'Returns the middle non-null value after sorting.',
  standardDeviation: 'Measures spread using the sample standard deviation.',
  variance: 'Measures squared spread using the sample variance.',
};

export function aggregationLabel(aggregation: Aggregation) {
  return aggregationLabels[aggregation];
}

function fieldTypePrefix(type: SemanticType) {
  if (type === 'date') return 'DATE';
  if (type === 'text') return 'ABC';
  if (type === 'id') return 'ID';
  return '123';
}

/** Calculated fields carry a formula, so they read as fx instead of their value type. */
function fieldPrefix(field: SourceField) {
  return 'expression' in field ? 'fx' : fieldTypePrefix(field.semanticType);
}

export function fieldChoices(fields: SourceField[], group?: string) {
  return fields.map((field) => ({
    id: field.id,
    label: field.label,
    group,
    prefix: fieldPrefix(field),
  }));
}

/** Returns the id back when it points at a calculated field, so callers can offer an edit. */
export function formulaFieldId(fields: SourceField[], fieldId: string) {
  const field = fields.find((item) => item.id === fieldId);
  return field && 'expression' in field ? field.id : undefined;
}

export function EditFormulaButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label={label} onClick={onClick} />}
      >
        <SquareFunctionIcon />
      </TooltipTrigger>
      <TooltipContent>Edit formula</TooltipContent>
    </Tooltip>
  );
}

export function axisLabel(
  role: 'dimension' | 'metric',
  type: WidgetDefinition['type'],
  plural: boolean,
) {
  const label = `${role === 'dimension' ? 'Dimension' : 'Metric'}${plural ? 's' : ''}`;
  if (type === 'line' || type === 'bar')
    return `${label} · ${role === 'dimension' ? 'X' : 'Y'} axis`;
  // Combo metrics pick their own axis per row.
  if (type === 'combo' && role === 'dimension') return `${label} · X axis`;
  return label;
}

export function FieldPicker({
  label,
  value,
  fields,
  onChange,
  appearance = 'default',
  tone,
  prefix,
  onCreate,
}: {
  label: string;
  value: string;
  fields: Array<{ id: string; label: string; group?: string; prefix?: string }>;
  onChange: (value: string) => void;
  appearance?: 'default' | 'assignment' | 'embedded' | 'add';
  tone?: 'dimension' | 'metric';
  prefix?: string;
  onCreate?: { label: string; action: () => void };
}) {
  const [open, setOpen] = useState(false);
  const selected = fields.find((field) => field.id === value);
  const groups = [...new Set(fields.map((field) => field.group ?? ''))];
  const compact = appearance !== 'default';
  return (
    <Field className={cn(compact && 'min-w-0 gap-0', appearance === 'embedded' && 'flex-1')}>
      <FieldLabel className={cn(compact && 'sr-only')}>{label}</FieldLabel>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant={appearance === 'default' || appearance === 'add' ? 'outline' : 'ghost'}
              className={cn(
                'w-full font-normal',
                appearance === 'default' && 'justify-between',
                appearance === 'assignment' && 'h-8 justify-start overflow-hidden rounded-full p-0',
                appearance === 'assignment' &&
                  tone === 'dimension' &&
                  'border border-dimension/40 bg-dimension/10 hover:bg-dimension/15',
                appearance === 'assignment' &&
                  tone === 'metric' &&
                  'border border-metric/40 bg-metric/10 hover:bg-metric/15',
                appearance === 'embedded' &&
                  'h-full min-w-0 justify-start rounded-none bg-transparent px-2 hover:bg-metric/10',
                appearance === 'add' &&
                  'h-8 justify-start rounded-full border-dashed text-muted-foreground',
              )}
            />
          }
        >
          {appearance === 'add' ? (
            <>
              <PlusIcon data-icon="inline-start" />
              {label}
            </>
          ) : (
            <>
              {appearance === 'assignment' && prefix ? (
                <span
                  className={cn(
                    'flex h-full shrink-0 items-center border-r px-2 font-mono text-xs font-semibold text-muted-foreground',
                    tone === 'dimension' ? 'border-dimension/30' : 'border-metric/30',
                  )}
                >
                  {prefix}
                </span>
              ) : null}
              <span className={cn('truncate', appearance === 'assignment' && 'px-2')}>
                {selected?.label ?? `Select ${label.toLocaleLowerCase()}`}
              </span>
            </>
          )}
        </PopoverTrigger>
        <PopoverContent className="w-(--anchor-width) p-0" align="start">
          <Command label={label}>
            <CommandInput placeholder={`Search ${label.toLocaleLowerCase()}...`} />
            <CommandList>
              <CommandEmpty>No matching field.</CommandEmpty>
              {groups.map((group) => (
                <CommandGroup key={group || 'fields'} heading={group || undefined}>
                  {fields
                    .filter((field) => (field.group ?? '') === group)
                    .map((field) => (
                      <CommandItem
                        key={field.id || 'empty'}
                        value={`${field.label} ${field.id}`}
                        className={cn(
                          tone && 'my-1 rounded-full border',
                          tone === 'dimension' &&
                            'border-dimension/30 bg-dimension/10 data-selected:bg-dimension/20',
                          tone === 'metric' &&
                            'border-metric/30 bg-metric/10 data-selected:bg-metric/20',
                        )}
                        data-checked={field.id === value}
                        onSelect={() => {
                          onChange(field.id);
                          setOpen(false);
                        }}
                      >
                        {field.prefix ? (
                          <span className="w-10 shrink-0 font-mono text-xs font-semibold text-muted-foreground">
                            {field.prefix}
                          </span>
                        ) : null}
                        <span className="truncate">{field.label}</span>
                      </CommandItem>
                    ))}
                </CommandGroup>
              ))}
              {onCreate ? (
                <>
                  <CommandSeparator />
                  <CommandGroup>
                    <CommandItem
                      value={onCreate.label}
                      onSelect={() => {
                        setOpen(false);
                        onCreate.action();
                      }}
                    >
                      <PlusIcon />
                      {onCreate.label}
                    </CommandItem>
                  </CommandGroup>
                </>
              ) : null}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </Field>
  );
}
