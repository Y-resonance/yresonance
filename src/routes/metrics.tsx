import { useDebouncedValue } from '#/lib/use-debounced-value';
import { FormulaModeSelect } from '#/components/formula-mode';
import {
  FormulaInput,
  FormulaFieldList,
  insertFieldReference,
  formulaContext,
  validateAggregateLocally,
  errorRange,
  type FormulaValidation,
} from '#/components/formula-editor';
import { datasourceDialect } from '#/query/dialect';
import type { DatasourceDescription } from '#/domain/datasource-fields';
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { useRef } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useState, type FormEvent } from 'react';
import { useApi, useApiQuery } from '#/api/query';
import { AppShell } from '#/components/app-shell';
import { ErrorState, LoadingState } from '#/components/request-state';
import { Button } from '#/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '#/components/ui/field';
import { Input } from '#/components/ui/input';
import { NativeSelect, NativeSelectOption } from '#/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table';
import type { SemanticType } from '#/domain/schema';
import { useWebMcpTools } from '#/webmcp/use-webmcp-tools';
import { pageTitle } from '#/lib/page-title';

export const Route = createFileRoute('/metrics')({
  component: MetricsPage,
  head: () => ({
    meta: [
      { title: pageTitle('Metric library') },
      {
        name: 'description',
        content: 'Define reusable reporting metrics and formulas for your yresonance workspace.',
      },
    ],
  }),
});

interface MetricRecord {
  id: string;
  name: string;
  canonicalName: string;
  expression: string;
  semanticType: SemanticType;
  description?: string | null;
}

function MetricsPage() {
  return (
    <AppShell requireWorkspace>
      <MetricsContent />
    </AppShell>
  );
}

function MetricsContent() {
  const callApi = useApi();
  const metricsQuery = useApiQuery<MetricRecord[]>({ action: 'listLibraryMetrics' });
  const bootstrapQuery = useApiQuery<{ isAdmin: boolean }>({ action: 'bootstrap' });
  const metrics = metricsQuery.data;
  const isAdmin = bootstrapQuery.data?.isAdmin ?? false;
  const sourcesQuery = useApiQuery<Array<{ id: string; name: string }>>({
    action: 'listDataSources',
  });
  const [selectedSource, setSelectedSource] = useState('');
  const sourceId = selectedSource || sourcesQuery.data?.[0]?.id || '';
  const sourceQuery = useApiQuery<DatasourceDescription>(
    { action: 'describeDatasource', dataSourceId: sourceId },
    { enabled: Boolean(sourceId) },
  );
  const source = sourceQuery.data;
  const editor = useRef<ReactCodeMirrorRef>(null);
  const [native, setNative] = useState(false);
  const dialect = source ? datasourceDialect(source) : 'duckdb';
  const formulaDialect = native ? dialect : undefined;
  const [error, setError] = useState<string>();
  const [form, setForm] = useState({
    name: '',
    expression: '',
    semanticType: 'ratio' as SemanticType,
    description: '',
  });
  const debouncedExpression = useDebouncedValue(form.expression);
  const validationQuery = useApiQuery<FormulaValidation>(
    {
      action: 'validateMetricExpression',
      dataSourceId: sourceId,
      expression: debouncedExpression,
      formulaDialect,
    },
    {
      enabled:
        Boolean(sourceId && form.expression.trim()) && form.expression === debouncedExpression,
    },
  );
  const localValidation = source
    ? validateAggregateLocally(form.expression, formulaContext(source), formulaDialect)
    : undefined;
  const validation =
    form.expression !== debouncedExpression
      ? undefined
      : validationQuery.error
        ? {
            valid: false as const,
            error: errorRange(validationQuery.error.message, form.expression),
          }
        : validationQuery.data;
  const { refetch: refetchMetrics } = metricsQuery;
  const { refetch: refetchBootstrap } = bootstrapQuery;
  const refresh = useCallback(async () => {
    setError(undefined);
    await Promise.all([refetchMetrics(), refetchBootstrap()]);
  }, [refetchMetrics, refetchBootstrap]);
  useWebMcpTools({ isAdmin, onMutation: refresh });
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await callApi({
        action: 'upsertLibraryMetric',
        name: form.name,
        expression: form.expression,
        formulaDialect,
        semanticType: form.semanticType,
        description: form.description,
      });
      setForm({ name: '', expression: '', semanticType: 'ratio', description: '' });
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      {error || metricsQuery.error || bootstrapQuery.error ? (
        <ErrorState
          error={
            error ??
            (metricsQuery.error ?? bootstrapQuery.error)?.message ??
            'Failed to load metrics.'
          }
        />
      ) : !metrics ? (
        <LoadingState />
      ) : (
        <div className="flex flex-col gap-8">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Metric library</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Reusable aggregate formulas available to every compatible datasource.
            </p>
          </div>
          {isAdmin ? (
            <form className="max-w-5xl" onSubmit={submit}>
              <FieldGroup className="grid sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="metric-name">Name</FieldLabel>
                  <Input
                    id="metric-name"
                    value={form.name}
                    onChange={(event) => setForm({ ...form, name: event.target.value })}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="metric-datasource">Validate against datasource</FieldLabel>
                  <NativeSelect
                    id="metric-datasource"
                    value={sourceId}
                    onChange={(event) => setSelectedSource(event.target.value)}
                  >
                    {!sourcesQuery.data?.length ? (
                      <NativeSelectOption value="">No datasources</NativeSelectOption>
                    ) : null}
                    {sourcesQuery.data?.map((item) => (
                      <NativeSelectOption key={item.id} value={item.id}>
                        {item.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
                <FormulaModeSelect dialect={dialect} native={native} onChange={setNative} />
                <Field>
                  <FieldLabel htmlFor="metric-type">Type</FieldLabel>
                  <NativeSelect
                    id="metric-type"
                    value={form.semanticType}
                    onChange={(event) =>
                      setForm({ ...form, semanticType: event.target.value as SemanticType })
                    }
                  >
                    {['currency', 'count', 'ratio'].map((item) => (
                      <NativeSelectOption key={item} value={item}>
                        {item}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
                <Field className="sm:col-span-2">
                  <FieldLabel>Aggregate formula</FieldLabel>
                  {source && localValidation ? (
                    <>
                      <div className="grid overflow-hidden rounded-md border sm:grid-cols-[14rem_minmax(0,1fr)]">
                        <div className="flex max-h-48 min-h-0 flex-col overflow-auto border-r">
                          <FormulaFieldList
                            datasource={source}
                            onInsert={(canonical) =>
                              insertFieldReference(editor.current?.view, canonical, formulaDialect)
                            }
                          />
                        </div>
                        <FormulaInput
                          editorRef={editor}
                          datasource={source}
                          mode="aggregate"
                          formulaDialect={formulaDialect}
                          value={form.expression}
                          onChange={(expression) => setForm({ ...form, expression })}
                          validation={validation ?? localValidation}
                          height="12rem"
                        />
                      </div>
                    </>
                  ) : null}
                  {validation && !validation.valid ? (
                    <p className="text-sm text-destructive">{validation.error.message}</p>
                  ) : null}
                  {sourceQuery.error ? (
                    <p className="text-sm text-destructive">{sourceQuery.error.message}</p>
                  ) : null}
                </Field>
                <Field className="sm:col-span-2">
                  <FieldLabel htmlFor="metric-description">Description</FieldLabel>
                  <Input
                    id="metric-description"
                    value={form.description}
                    onChange={(event) => setForm({ ...form, description: event.target.value })}
                  />
                </Field>
                <Button
                  type="submit"
                  disabled={
                    !form.name.trim() ||
                    !form.expression.trim() ||
                    validation?.valid !== true ||
                    localValidation?.valid !== true
                  }
                >
                  Add metric
                </Button>
              </FieldGroup>
            </form>
          ) : null}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Canonical name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Aggregate formula</TableHead>
                  <TableHead>Description</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {metrics.map((metric) => (
                  <TableRow key={metric.id}>
                    <TableCell className="font-medium">{metric.name}</TableCell>
                    <TableCell>{metric.canonicalName}</TableCell>
                    <TableCell>{metric.semanticType}</TableCell>
                    <TableCell className="font-mono text-xs">{metric.expression}</TableCell>
                    <TableCell>{metric.description}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </main>
  );
}
