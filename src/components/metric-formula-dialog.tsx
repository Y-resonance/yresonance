import { FormulaModeSelect } from './formula-mode';
import { datasourceDialect, type SqlDialect } from '#/query/dialect';
import { useDebouncedValue } from '#/lib/use-debounced-value';
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useApiQuery } from '#/api/query';
import {
  errorRange,
  formulaContext,
  FormulaFieldList,
  FormulaInput,
  insertFieldReference,
  validateAggregateLocally,
  type FormulaValidation,
} from '#/components/formula-editor';
import { Alert, AlertDescription } from '#/components/ui/alert';
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
import type { DatasourceDescription } from '#/domain/datasource-fields';
import type { WidgetMetric } from '#/domain/schema';

export interface LibraryMetricDraft {
  name: string;
  expression: string;
  semanticType: 'count';
  formulaDialect?: SqlDialect;
}

/**
 * Formula editor for a widget's custom metric. Unlike a calculated field this expression is
 * aggregate-level, lives on the widget, and is optionally copied into the workspace library.
 */
export function MetricFormulaDialog({
  open,
  onOpenChange,
  dashboardId,
  source,
  metric,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dashboardId: string;
  source?: DatasourceDescription;
  /** Set when an existing expression metric is edited; absent when a new one is added. */
  metric?: WidgetMetric;
  onSave: (metric: WidgetMetric, libraryMetric?: LibraryMetricDraft) => Promise<boolean>;
}) {
  const editing = metric?.source.kind === 'expression' ? metric.source : undefined;
  const [name, setName] = useState('');
  const [expression, setExpression] = useState('');
  const [native, setNative] = useState(false);
  const dialect = source ? datasourceDialect(source) : 'duckdb';
  const formulaDialect = native ? (editing?.formulaDialect ?? dialect) : undefined;
  const [saveLibrary, setSaveLibrary] = useState(false);
  const [dialogError, setDialogError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const editor = useRef<ReactCodeMirrorRef>(null);
  const submittingRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    setName(metric?.userDefinedName ?? 'Custom metric');
    setExpression(metric?.source.kind === 'expression' ? metric.source.expression : '');
    setNative(Boolean(metric?.source.kind === 'expression' && metric.source.formulaDialect));
    setSaveLibrary(false);
    setDialogError(undefined);
  }, [open, metric]);

  const context = useMemo(() => (source ? formulaContext(source) : undefined), [source]);
  const localValidation = useMemo<FormulaValidation>(
    () =>
      context
        ? validateAggregateLocally(expression, context, formulaDialect)
        : {
            valid: false,
            error: { message: 'Datasource fields are still loading.', from: 0, to: 0 },
          },
    [context, expression, formulaDialect],
  );

  const debouncedExpression = useDebouncedValue(expression);
  const validationQuery = useApiQuery<FormulaValidation>(
    {
      action: 'validateMetricExpression',
      dashboardId,
      dataSourceId: source?.id ?? '',
      expression: debouncedExpression,
      formulaDialect,
    },
    {
      enabled:
        open && Boolean(source) && localValidation.valid && expression === debouncedExpression,
    },
  );
  const remoteValidation =
    expression !== debouncedExpression
      ? undefined
      : validationQuery.error
        ? { valid: false as const, error: errorRange(validationQuery.error.message, expression) }
        : validationQuery.data;

  const validationError = !localValidation.valid
    ? localValidation.error.message
    : remoteValidation && !remoteValidation.valid
      ? remoteValidation.error.message
      : undefined;
  const canSave =
    !submitting &&
    Boolean(name.trim()) &&
    localValidation.valid &&
    remoteValidation?.valid === true;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSave || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setDialogError(undefined);
    try {
      const saved = await onSave(
        {
          dataType: 'number' as const,
          ...metric,
          userDefinedName: name,
          source: { kind: 'expression', expression, formulaDialect },
        },
        saveLibrary ? { name, expression, semanticType: 'count', formulaDialect } : undefined,
      );
      if (!saved) {
        setDialogError('The metric could not be saved.');
        return;
      }
      onOpenChange(false);
    } catch (caught) {
      setDialogError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!inset-2 !h-auto !w-auto !max-w-none !translate-x-0 !translate-y-0 grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:!max-w-none">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>{editing ? 'Edit custom metric' : 'Add custom metric'}</DialogTitle>
          <DialogDescription>
            Write an aggregate expression using fields from the selected datasource.
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[18rem_minmax(0,1fr)]">
          <aside className="hidden min-h-0 border-r md:flex md:flex-col">
            {source ? (
              <FormulaFieldList
                datasource={source}
                onInsert={(canonical) =>
                  insertFieldReference(editor.current?.view, canonical, formulaDialect)
                }
              />
            ) : null}
          </aside>
          <form className="min-h-0 overflow-y-auto" onSubmit={submit}>
            <div className="mx-auto grid max-w-5xl gap-5 p-5">
              {dialogError ? (
                <Alert variant="destructive">
                  <AlertDescription>{dialogError}</AlertDescription>
                </Alert>
              ) : null}
              <Field>
                <FieldLabel htmlFor="metric-formula-name">Name</FieldLabel>
                <Input
                  id="metric-formula-name"
                  value={name}
                  required
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
              <FormulaModeSelect dialect={dialect} native={native} onChange={setNative} />
              <Field>
                <FieldLabel>Aggregate formula</FieldLabel>
                {source ? (
                  <FormulaInput
                    editorRef={editor}
                    datasource={source}
                    mode="aggregate"
                    formulaDialect={formulaDialect}
                    value={expression}
                    onChange={setExpression}
                    validation={remoteValidation ?? localValidation}
                  />
                ) : null}
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
              {editing ? null : (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={saveLibrary}
                    onChange={(event) => setSaveLibrary(event.target.checked)}
                  />
                  Save to workspace library
                </label>
              )}
              <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={!canSave}>
                  {submitting ? 'Saving...' : editing ? 'Save metric' : 'Add metric'}
                </Button>
              </div>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
