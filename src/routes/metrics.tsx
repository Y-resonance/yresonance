import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { callApi } from '#/api/client';
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
import { Textarea } from '#/components/ui/textarea';
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
  const [metrics, setMetrics] = useState<MetricRecord[]>();
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState<string>();
  const [form, setForm] = useState({
    name: '',
    expression: '',
    semanticType: 'ratio' as SemanticType,
    description: '',
  });
  const refresh = useCallback(async () => {
    try {
      const [records, bootstrap] = await Promise.all([
        callApi<MetricRecord[]>({ action: 'listLibraryMetrics' }),
        callApi<{ isAdmin: boolean }>({ action: 'bootstrap' }),
      ]);
      setMetrics(records);
      setIsAdmin(bootstrap.isAdmin);
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);
  useEffect(() => void refresh(), [refresh]);
  useWebMcpTools({ isAdmin, onMutation: refresh });
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await callApi({
        action: 'upsertLibraryMetric',
        name: form.name,
        expression: form.expression,
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
      {error ? (
        <ErrorState error={error} />
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
            <form className="max-w-2xl" onSubmit={submit}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="metric-name">Name</FieldLabel>
                  <Input
                    id="metric-name"
                    value={form.name}
                    onChange={(event) => setForm({ ...form, name: event.target.value })}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="metric-expression">Aggregate formula</FieldLabel>
                  <Textarea
                    id="metric-expression"
                    value={form.expression}
                    onChange={(event) => setForm({ ...form, expression: event.target.value })}
                  />
                </Field>
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
                <Field>
                  <FieldLabel htmlFor="metric-description">Description</FieldLabel>
                  <Input
                    id="metric-description"
                    value={form.description}
                    onChange={(event) => setForm({ ...form, description: event.target.value })}
                  />
                </Field>
                <Button type="submit" disabled={!form.name.trim() || !form.expression.trim()}>
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
