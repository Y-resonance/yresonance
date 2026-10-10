import { useState, useRef } from 'react';
import { type DatasourceFieldRow, type DatasourceDescription } from '#/domain/datasource-fields';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '#/components/ui/dialog';
import { Button } from '#/components/ui/button';
import { PlusIcon } from 'lucide-react';
import { cn } from '#/lib/utils';
import { CalculatedFieldDialog } from '#/components/calculated-field-dialog';
import { useApi } from '#/api/query';
import { Field, FieldLabel } from '#/components/ui/field';
import { Input } from '#/components/ui/input';
import { NativeSelect, NativeSelectOption } from '#/components/ui/native-select';
import {
  type FieldRole,
  fieldRoleSchema,
  type SemanticType,
  type Aggregation,
} from '#/domain/schema';
import { type SourceDescription, type SourceField, message, aggregations } from './shared';

export function DatasourceDialog({
  open,
  onOpenChange,
  dashboardId,
  source,
  onRefresh,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dashboardId: string;
  source: SourceDescription;
  onRefresh: () => Promise<void>;
}) {
  const [newFieldOpen, setNewFieldOpen] = useState(false);
  const [editingField, setEditingField] = useState<DatasourceFieldRow>();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{source.name} fields</DialogTitle>
          <DialogDescription>
            Editors can change labels, roles, types, and descriptions. Hiding, casting, and
            canonical names remain admin-only.
          </DialogDescription>
        </DialogHeader>
        <Button
          className="justify-self-start"
          variant="outline"
          size="sm"
          onClick={() => setNewFieldOpen(true)}
        >
          <PlusIcon data-icon="inline-start" /> New field
        </Button>
        <div className="flex flex-col gap-2">
          {source.fields.map((field) => (
            <DatasourceFieldRow
              key={field.id}
              field={field}
              sourceId={source.id}
              dashboardId={dashboardId}
              onSaved={onRefresh}
            />
          ))}
          {source.calculatedFields.map((field) => (
            <div
              key={field.id}
              className={cn(
                'flex items-center gap-3 border-l-4 bg-muted/60 p-3',
                fieldRoleStyles[field.role],
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium">{field.label}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {field.expression}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditingField(calculatedFieldRow(field))}
              >
                Edit
              </Button>
            </div>
          ))}
        </div>
        {source.libraryMetrics.length ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Library metrics</h3>
            {source.libraryMetrics.map((metric) => (
              <div
                key={metric.id}
                className="grid gap-1 rounded-lg bg-muted p-3 sm:grid-cols-[12rem_1fr]"
              >
                <span className="font-medium">{metric.name}</span>
                <code className="text-xs">{metric.expression}</code>
              </div>
            ))}
          </div>
        ) : null}
        <CalculatedFieldDialog
          open={newFieldOpen}
          onOpenChange={setNewFieldOpen}
          dashboardId={dashboardId}
          datasource={source}
          onSaved={onRefresh}
        />
        <CalculatedFieldDialog
          open={Boolean(editingField)}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setEditingField(undefined);
          }}
          dashboardId={dashboardId}
          datasource={source}
          field={editingField}
          onSaved={onRefresh}
        />
      </DialogContent>
    </Dialog>
  );
}

export function DatasourceFieldRow({
  field,
  sourceId,
  dashboardId,
  onSaved,
}: {
  field: SourceField;
  sourceId: string;
  dashboardId: string;
  onSaved: () => Promise<void>;
}) {
  const callApi = useApi();
  const [value, setValue] = useState(field);
  const [saveError, setSaveError] = useState<string>();
  const [savingField, setSavingField] = useState(false);
  const savingRef = useRef(false);
  async function save() {
    if (savingRef.current) return;
    savingRef.current = true;
    setSavingField(true);
    setSaveError(undefined);
    try {
      if ('columnName' in field)
        await callApi({
          action: 'updateFieldMetadata',
          dashboardId,
          dataSourceId: sourceId,
          columnName: field.columnName,
          patch: {
            label: value.label,
            role: value.role,
            semanticType: value.semanticType,
            defaultAggregation: value.defaultAggregation ?? null,
            description: value.description ?? null,
          },
        });
      else
        await callApi({
          action: 'upsertCalculatedField',
          dashboardId,
          dataSourceId: sourceId,
          id: field.id,
          name: value.label,
          canonicalName: value.canonicalName,
          expression: field.expression,
          role: value.role,
          semanticType: value.semanticType,
          defaultAggregation: value.defaultAggregation ?? null,
          description: value.description ?? undefined,
        });
      await onSaved();
    } catch (caught) {
      setSaveError(message(caught));
    } finally {
      savingRef.current = false;
      setSavingField(false);
    }
  }
  return (
    <div
      className={cn(
        'grid items-end gap-2 border-l-4 bg-muted/60 p-3 sm:grid-cols-[minmax(8rem,1fr)_8rem_9rem_9rem_minmax(10rem,1fr)_auto]',
        fieldRoleStyles[value.role],
      )}
    >
      <Field>
        <FieldLabel>Name</FieldLabel>
        <Input
          value={value.label}
          onChange={(event) => setValue({ ...value, label: event.target.value })}
        />
      </Field>
      <Field>
        <FieldLabel>Role</FieldLabel>
        <NativeSelect
          value={value.role}
          onChange={(event) => setValue({ ...value, role: event.target.value as FieldRole })}
        >
          {fieldRoleSchema.options.map((item) => (
            <NativeSelectOption key={item} value={item}>
              {item}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      <Field>
        <FieldLabel>Type</FieldLabel>
        <NativeSelect
          value={value.semanticType}
          onChange={(event) =>
            setValue({ ...value, semanticType: event.target.value as SemanticType })
          }
        >
          {['currency', 'count', 'ratio', 'text', 'date', 'id'].map((item) => (
            <NativeSelectOption key={item} value={item}>
              {item}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      <Field>
        <FieldLabel>Aggregation</FieldLabel>
        <NativeSelect
          disabled={value.role !== 'metric'}
          value={value.defaultAggregation ?? ''}
          onChange={(event) =>
            setValue({
              ...value,
              defaultAggregation: event.target.value ? (event.target.value as Aggregation) : null,
            })
          }
        >
          <NativeSelectOption value="">None</NativeSelectOption>
          {aggregations.map((item) => (
            <NativeSelectOption key={item} value={item}>
              {item}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      <Field>
        <FieldLabel>Description</FieldLabel>
        <Input
          value={value.description ?? ''}
          onChange={(event) => setValue({ ...value, description: event.target.value })}
        />
      </Field>
      <Button variant="outline" size="sm" disabled={savingField} onClick={() => void save()}>
        {savingField ? 'Saving...' : 'Save'}
      </Button>
      {saveError ? <p className="text-sm text-destructive sm:col-span-full">{saveError}</p> : null}
    </div>
  );
}

const fieldRoleStyles: Record<FieldRole, string> = {
  dimension: 'border-l-emerald-500',
  metric: 'border-l-blue-500',
};

export function calculatedFieldRow(
  field: DatasourceDescription['calculatedFields'][number],
): DatasourceFieldRow {
  return {
    ...field,
    key: `calculated:${field.id}`,
    origin: 'calculated',
    description: field.description ?? '',
    editable: true,
  };
}
