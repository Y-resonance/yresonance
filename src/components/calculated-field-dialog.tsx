import { useDebouncedValue } from '#/lib/use-debounced-value';
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useApi, useApiQuery } from '#/api/query';
import {
  displayValue,
  errorRange,
  formulaContext,
  FormulaFieldList,
  FormulaInput,
  insertFieldReference,
  type FormulaValidation,
} from '#/components/formula-editor';
import { Button } from '#/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog';
import { Field, FieldLabel } from '#/components/ui/field';
import { Input } from '#/components/ui/input';
import { NativeSelect, NativeSelectOption } from '#/components/ui/native-select';
import { Textarea } from '#/components/ui/textarea';
import type { DatasourceDescription, DatasourceFieldRow } from '#/domain/datasource-fields';
import {
  aggregationSchema,
  fieldRoleSchema,
  type Aggregation,
  type FieldRole,
  type SemanticType,
} from '#/domain/schema';
import { assertCalculatedFieldNameAvailable, validateRowFormula } from '#/query/compiler';
import type { FormulaType } from '#/query/formula';

interface CalculatedFieldDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dashboardId?: string;
  datasource: DatasourceDescription;
  field?: DatasourceFieldRow;
  onSaved: () => Promise<void>;
}

export function CalculatedFieldDialog({
  open,
  onOpenChange,
  dashboardId,
  datasource,
  field,
  onSaved,
}: CalculatedFieldDialogProps) {
  const callApi = useApi();
  const initial = useMemo(() => initialValues(field), [field]);
  const [name, setName] = useState(initial.name);
  const [expression, setExpression] = useState(initial.expression);
  const [role, setRole] = useState<FieldRole>(initial.role);
  const [semanticType, setSemanticType] = useState<SemanticType>(initial.semanticType);
  const [aggregation, setAggregation] = useState<Aggregation | ''>(initial.aggregation);
  const [description, setDescription] = useState(initial.description);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const [previewValues, setPreviewValues] = useState<unknown[]>();
  const [previewing, setPreviewing] = useState(false);
  const editor = useRef<ReactCodeMirrorRef>(null);
  const allowClose = useRef(false);
  const typeWasChanged = useRef(false);
  const roleWasChanged = useRef(false);
  const preserveLoadedDefaults = useRef(Boolean(field));

  useEffect(() => {
    if (!open) return;
    const values = initialValues(field);
    setName(values.name);
    setExpression(values.expression);
    setRole(values.role);
    setSemanticType(values.semanticType);
    setAggregation(values.aggregation);
    setDescription(values.description);
    setSaving(false);
    setSaveError(undefined);
    setPreviewValues(undefined);
    typeWasChanged.current = false;
    roleWasChanged.current = false;
    preserveLoadedDefaults.current = Boolean(field);
    allowClose.current = false;
  }, [open, field]);

  const canonicalName = field?.canonicalName ?? slug(name);
  const context = useMemo(() => formulaContext(datasource), [datasource]);
  const localValidation = useMemo(
    () => validateLocally(name, canonicalName, expression, field, context),
    [name, canonicalName, expression, field, context],
  );
  const compatibleTypes = useMemo(
    () => (localValidation.valid ? semanticTypesForFormulaType(localValidation.type) : []),
    [localValidation],
  );

  useEffect(() => {
    if (!localValidation.valid) return;
    const types = semanticTypesForFormulaType(localValidation.type);
    if (!types.length) return;
    if (preserveLoadedDefaults.current) {
      preserveLoadedDefaults.current = false;
      return;
    }
    if (!typeWasChanged.current || !types.includes(semanticType)) setSemanticType(types[0]);
    if (!roleWasChanged.current) {
      const nextRole = localValidation.type === 'number' ? 'metric' : 'dimension';
      setRole(nextRole);
      setAggregation(nextRole === 'metric' ? 'sum' : '');
    }
  }, [localValidation, semanticType]);

  const validationRequest = useMemo(
    () => ({
      action: 'validateCalculatedField' as const,
      dashboardId,
      dataSourceId: datasource.id,
      id: field?.id,
      name,
      canonicalName: field?.canonicalName,
      expression,
      semanticType,
    }),
    [dashboardId, datasource.id, field?.id, field?.canonicalName, name, expression, semanticType],
  );
  const debouncedRequest = useDebouncedValue(validationRequest);
  const validationQuery = useApiQuery<FormulaValidation>(debouncedRequest, {
    enabled:
      open &&
      localValidation.valid &&
      compatibleTypes.includes(semanticType) &&
      validationRequest === debouncedRequest,
  });
  const remoteValidation =
    validationRequest !== debouncedRequest
      ? undefined
      : validationQuery.error
        ? { valid: false as const, error: errorRange(validationQuery.error.message, expression) }
        : validationQuery.data;
  useEffect(() => setPreviewValues(undefined), [validationRequest]);

  const dirty =
    name !== initial.name ||
    expression !== initial.expression ||
    role !== initial.role ||
    semanticType !== initial.semanticType ||
    aggregation !== initial.aggregation ||
    description !== initial.description;
  const validationError = !localValidation.valid
    ? localValidation.error.message
    : !compatibleTypes.length
      ? `Formulas returning ${localValidation.type} cannot be saved as calculated fields.`
      : !compatibleTypes.includes(semanticType)
        ? `${semanticType} is not compatible with a ${localValidation.type} formula.`
        : remoteValidation && !remoteValidation.valid
          ? remoteValidation.error.message
          : undefined;
  const canSave =
    !saving &&
    localValidation.valid &&
    compatibleTypes.includes(semanticType) &&
    remoteValidation?.valid === true;

  function changeOpen(nextOpen: boolean) {
    if (!nextOpen && dirty && !allowClose.current) {
      if (!window.confirm('Discard your unsaved calculated field changes?')) return;
    }
    onOpenChange(nextOpen);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setSaveError(undefined);
    try {
      await callApi({
        action: 'upsertCalculatedField',
        dashboardId,
        dataSourceId: datasource.id,
        id: field?.id,
        name,
        canonicalName: field?.canonicalName,
        expression,
        role,
        semanticType,
        defaultAggregation: role === 'metric' ? aggregation || null : null,
        description: description || undefined,
      });
      await onSaved();
      allowClose.current = true;
      onOpenChange(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  async function preview() {
    if (!canSave || previewing) return;
    setPreviewing(true);
    setSaveError(undefined);
    try {
      const result = await callApi<{ values: unknown[] }>({
        action: 'previewCalculatedFieldValues',
        dashboardId,
        dataSourceId: datasource.id,
        id: field?.id,
        name,
        canonicalName: field?.canonicalName,
        expression,
        semanticType,
      });
      setPreviewValues(result.values);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setPreviewing(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="!inset-2 !h-auto !w-auto !max-w-none !translate-x-0 !translate-y-0 grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:!max-w-none">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>{field ? `Edit ${field.label}` : 'Create calculated field'}</DialogTitle>
          <DialogDescription>
            Build a row-level formula with raw or calculated fields from {datasource.name}.
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[18rem_minmax(0,1fr)]">
          <aside className="hidden min-h-0 border-r md:flex md:flex-col">
            <FormulaFieldList
              datasource={datasource}
              excludedFieldId={field?.id}
              onInsert={(canonical) => insertFieldReference(editor.current?.view, canonical)}
            />
          </aside>
          <form className="min-h-0 overflow-y-auto" onSubmit={submit}>
            <div className="mx-auto grid max-w-5xl gap-5 p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="calculated-field-name">Name</FieldLabel>
                  <Input
                    id="calculated-field-name"
                    value={name}
                    required
                    onChange={(event) => setName(event.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="calculated-field-id">Field ID</FieldLabel>
                  <Input id="calculated-field-id" value={canonicalName} readOnly />
                </Field>
              </div>
              <Field>
                <FieldLabel>Formula</FieldLabel>
                <FormulaInput
                  editorRef={editor}
                  datasource={datasource}
                  mode="row"
                  excludedFieldId={field?.id}
                  value={expression}
                  onChange={setExpression}
                  validation={localValidation}
                />
                <p
                  className={
                    validationError ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'
                  }
                >
                  {validationError ??
                    (remoteValidation?.valid
                      ? `${remoteValidation.type} formula using ${remoteValidation.identifiers.length} field${remoteValidation.identifiers.length === 1 ? '' : 's'}.`
                      : 'Checking formula...')}
                </p>
              </Field>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field>
                  <FieldLabel htmlFor="calculated-field-role">Role</FieldLabel>
                  <NativeSelect
                    id="calculated-field-role"
                    value={role}
                    onChange={(event) => {
                      roleWasChanged.current = true;
                      const next = event.target.value as FieldRole;
                      setRole(next);
                      if (next === 'dimension') setAggregation('');
                    }}
                  >
                    {fieldRoleSchema.options.map((item) => (
                      <NativeSelectOption key={item} value={item}>
                        {item}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
                <Field>
                  <FieldLabel htmlFor="calculated-field-type">Type</FieldLabel>
                  <NativeSelect
                    id="calculated-field-type"
                    value={semanticType}
                    disabled={!compatibleTypes.length}
                    onChange={(event) => {
                      typeWasChanged.current = true;
                      setSemanticType(event.target.value as SemanticType);
                    }}
                  >
                    {(compatibleTypes.length ? compatibleTypes : [semanticType]).map((item) => (
                      <NativeSelectOption key={item} value={item}>
                        {item}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
                <Field>
                  <FieldLabel htmlFor="calculated-field-aggregation">
                    Default aggregation
                  </FieldLabel>
                  <NativeSelect
                    id="calculated-field-aggregation"
                    value={aggregation}
                    disabled={role !== 'metric'}
                    onChange={(event) => setAggregation(event.target.value as Aggregation | '')}
                  >
                    <NativeSelectOption value="">None</NativeSelectOption>
                    {aggregationSchema.options.map((item) => (
                      <NativeSelectOption key={item} value={item}>
                        {item}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="calculated-field-description">Description</FieldLabel>
                <Textarea
                  id="calculated-field-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </Field>
              {previewValues ? (
                <div className="text-sm">
                  <p className="font-medium">Preview values</p>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {previewValues.length
                      ? previewValues.map(displayValue).join(', ')
                      : 'No values returned.'}
                  </p>
                </div>
              ) : null}
              {saveError ? <p className="text-sm text-destructive">{saveError}</p> : null}
              <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
                <Button type="button" variant="outline" onClick={() => changeOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!canSave || previewing}
                  onClick={() => void preview()}
                >
                  {previewing ? 'Loading...' : 'Preview values'}
                </Button>
                <Button type="submit" disabled={!canSave}>
                  {saving ? 'Saving...' : field ? 'Save field' : 'Create field'}
                </Button>
              </div>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function initialValues(field?: DatasourceFieldRow) {
  return {
    name: field?.label ?? '',
    expression: field?.expression ?? '',
    role: field?.role ?? ('dimension' as const),
    semanticType: field?.semanticType ?? ('text' as const),
    aggregation: field?.defaultAggregation ?? ('' as const),
    description: field?.description ?? '',
  };
}

function validateLocally(
  name: string,
  canonicalName: string,
  expression: string,
  field: DatasourceFieldRow | undefined,
  context: ReturnType<typeof formulaContext>,
): FormulaValidation {
  try {
    if (!name.trim()) throw new Error('Name is required.');
    if (!canonicalName) throw new Error('Name must contain a letter or number.');
    assertCalculatedFieldNameAvailable(canonicalName, context, field?.id);
    const calculatedFields = [
      ...context.calculatedFields.filter((item) => item.id !== field?.id),
      {
        id: field?.id ?? '__candidate__',
        dataSourceId: '',
        canonicalName,
        label: name,
        expression,
        role: 'dimension' as const,
        semanticType: 'text' as const,
        description: null,
      },
    ];
    const compiled = validateRowFormula(expression, {
      fields: context.fields,
      calculatedFields,
    });
    return { valid: true, type: compiled.type, identifiers: compiled.identifiers };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { valid: false, error: errorRange(message, expression) };
  }
}

function semanticTypesForFormulaType(type: FormulaType): SemanticType[] {
  if (type === 'number') return ['count', 'currency', 'ratio'];
  if (type === 'text') return ['text', 'id'];
  if (type === 'date') return ['date'];
  return [];
}

function slug(value: string) {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/gu, '$1_$2')
    .replace(/[^A-Za-z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .toLowerCase();
}
