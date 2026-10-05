import { createColumnHelper, useTable } from '@tanstack/react-table';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeftIcon, PlusIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { callApi } from '#/api/client';
import { DatasourceCacheSettings } from '#/components/datasource-cache-settings';
import { AppShell } from '#/components/app-shell';
import { CalculatedFieldDialog } from '#/components/calculated-field-dialog';
import {
  DataTable,
  DataTableSearch,
  dataTableFeatures,
  type DataTableFeatures,
} from '#/components/data-table';
import { ErrorState, LoadingState } from '#/components/request-state';
import { Badge } from '#/components/ui/badge';
import { Button } from '#/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '#/components/ui/field';
import { Input } from '#/components/ui/input';
import { NativeSelect, NativeSelectOption } from '#/components/ui/native-select';
import {
  datasourceFieldOriginLabels,
  datasourceFieldRows,
  type DatasourceDescription,
  type DatasourceFieldRow,
} from '#/domain/datasource-fields';
import {
  aggregationSchema,
  fieldRoleSchema,
  semanticTypeSchema,
  type Aggregation,
  type DataSourceLocation,
  type DatasourceCachePolicy,
  type FieldRole,
  type SemanticType,
} from '#/domain/schema';
import { useWebMcpTools } from '#/webmcp/use-webmcp-tools';
import { pageTitle, usePageTitle } from '#/lib/page-title';

export const Route = createFileRoute('/datasources/$datasourceId')({
  component: DatasourcePage,
  head: () => ({ meta: [{ title: pageTitle('Datasource') }] }),
});

interface Description extends DatasourceDescription {
  location: DataSourceLocation;
  cachePolicy?: DatasourceCachePolicy;
}

// Emerald dimensions and blue metrics match the builder's field colour coding.
const roleBadgeStyles: Record<FieldRole, string> = {
  dimension: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  metric: 'border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300',
};

const helper = createColumnHelper<DataTableFeatures, DatasourceFieldRow>();

function fieldColumns(onEdit?: (row: DatasourceFieldRow) => void) {
  return helper.columns([
    helper.accessor('canonicalName', {
      header: 'Column',
      cell: (context) => <span className="font-mono text-xs">{context.getValue()}</span>,
    }),
    helper.accessor('label', {
      header: 'Label',
      cell: (context) => <span className="font-medium">{context.getValue()}</span>,
    }),
    helper.accessor((row) => datasourceFieldOriginLabels[row.origin], {
      id: 'origin',
      header: 'Source',
      cell: (context) => <Badge variant="outline">{context.getValue()}</Badge>,
    }),
    helper.accessor('role', {
      header: 'Role',
      cell: (context) => (
        <Badge variant="outline" className={roleBadgeStyles[context.getValue()]}>
          {context.getValue()}
        </Badge>
      ),
    }),
    helper.accessor('semanticType', { header: 'Type' }),
    helper.accessor('description', {
      header: 'Description',
      cell: (context) => <span className="text-muted-foreground">{context.getValue() || '—'}</span>,
    }),
    helper.display({
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      cell: (context) =>
        onEdit && context.row.original.editable ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onEdit(context.row.original)}
            aria-label={`Edit ${context.row.original.label}`}
          >
            Edit
          </Button>
        ) : null,
    }),
  ]);
}

function DatasourcePage() {
  return (
    <AppShell requireWorkspace>
      <DatasourceContent />
    </AppShell>
  );
}

function DatasourceContent() {
  const { datasourceId } = Route.useParams();
  // The loaded payload carries the datasource it describes, so a response that
  // arrives after the route moved on is never rendered and never reaches the
  // edit dialog, whichever load or in-flight save produced it.
  const [loaded, setLoaded] = useState<{
    datasourceId: string;
    description: Description;
    isAdmin: boolean;
  }>();
  const [error, setError] = useState<string>();
  const [search, setSearch] = useState('');
  // The session counter remounts the dialog per opening without swapping its
  // contents while the close animation is still running.
  const [dialog, setDialog] = useState<{ session: number; field?: DatasourceFieldRow }>({
    session: 0,
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const openDialog = useCallback((field?: DatasourceFieldRow) => {
    setDialog((current) => ({ session: current.session + 1, field }));
    setDialogOpen(true);
  }, []);
  // Two loads for the same datasource can still settle out of order, so only
  // the newest one writes.
  const load = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++load.current;
    try {
      const [source, bootstrap] = await Promise.all([
        callApi<Description>({ action: 'describeDatasource', dataSourceId: datasourceId }),
        callApi<{ isAdmin: boolean }>({ action: 'bootstrap' }),
      ]);
      if (load.current !== current) return;
      setLoaded({ datasourceId, description: source, isAdmin: bootstrap.isAdmin });
      setError(undefined);
    } catch (caught) {
      if (load.current !== current) return;
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [datasourceId]);
  useEffect(() => void refresh(), [refresh]);
  const description = loaded?.datasourceId === datasourceId ? loaded.description : undefined;
  const isAdmin = loaded?.datasourceId === datasourceId ? loaded.isAdmin : false;
  usePageTitle(description?.name ?? 'Datasource');
  useWebMcpTools({
    canManageDataSources: Boolean(description),
    isAdmin,
    onMutation: refresh,
  });
  const rows = useMemo(() => (description ? datasourceFieldRows(description) : []), [description]);
  const columns = useMemo(
    () => fieldColumns(isAdmin ? openDialog : undefined),
    [isAdmin, openDialog],
  );
  const table = useTable({
    features: dataTableFeatures,
    columns,
    data: rows,
    state: { globalFilter: search },
    onGlobalFilterChange: setSearch,
  });
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      {error ? (
        <ErrorState error={error} />
      ) : !description ? (
        <LoadingState />
      ) : (
        <div className="flex flex-col gap-6">
          <div>
            <Button
              nativeButton={false}
              variant="ghost"
              size="sm"
              className="-ml-2"
              render={<Link to="/datasources" />}
            >
              <ArrowLeftIcon />
              Datasources
            </Button>
            <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-3xl font-semibold tracking-tight">{description.name}</h1>
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  {description.location.kind === 'clickhouse'
                    ? `ClickHouse · ${description.location.database}.${description.location.table}`
                    : `${description.location.kind === 'prefix' ? 'Prefix' : 'Object'} ${description.location.key} · ${description.location.format.toUpperCase()}`}
                </p>
              </div>
              {isAdmin ? (
                <Button onClick={() => openDialog()}>
                  <PlusIcon />
                  Create calculated field
                </Button>
              ) : null}
            </div>
          </div>
          <div
            role="toolbar"
            aria-label="Datasource settings"
            className="flex flex-wrap items-center justify-between gap-4"
          >
            <DatasourceCacheSettings
              key={`${datasourceId}:${JSON.stringify(description.cachePolicy)}`}
              dataSourceId={datasourceId}
              defaultTtlSeconds={
                description.location.kind === 'clickhouse' &&
                description.location.ownership === 'external'
                  ? description.location.cacheTtlSeconds
                  : 86_400
              }
              initialPolicy={description.cachePolicy ?? { mode: 'default' }}
              onSaved={refresh}
            />
            <DataTableSearch
              value={search}
              onChange={setSearch}
              label="Search fields"
              placeholder="Search fields"
            />
          </div>
          <DataTable
            table={table}
            sortLabel="Sort fields by"
            emptyMessage={
              rows.length ? 'No field matches this search.' : 'This datasource has no fields.'
            }
            renderCard={(row) => (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{row.label}</p>
                    <p className="font-mono text-xs break-all text-muted-foreground">
                      {row.canonicalName}
                    </p>
                  </div>
                  <Badge variant="outline" className={roleBadgeStyles[row.role]}>
                    {row.role}
                  </Badge>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    {datasourceFieldOriginLabels[row.origin]} · {row.semanticType}
                    {row.description ? ` · ${row.description}` : ''}
                  </p>
                  {isAdmin && row.editable ? (
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`Edit ${row.label}`}
                      onClick={() => openDialog(row)}
                    >
                      Edit
                    </Button>
                  ) : null}
                </div>
              </div>
            )}
          />
          <p className="text-sm text-muted-foreground">
            Column names come from the database and stay fixed so dashboards keep resolving them.
          </p>
          {/* Inside the loaded branch so a route change unmounts the dialog
              instead of leaving one datasource's field over another's page. */}
          {dialog.field?.origin === 'raw' ? (
            <RawFieldDialog
              key={dialog.session}
              dataSourceId={datasourceId}
              field={dialog.field}
              open={dialogOpen}
              onOpenChange={setDialogOpen}
              onSaved={refresh}
            />
          ) : (
            <CalculatedFieldDialog
              key={dialog.session}
              datasource={description}
              field={dialog.field}
              open={dialogOpen}
              onOpenChange={setDialogOpen}
              onSaved={refresh}
            />
          )}
        </div>
      )}
    </main>
  );
}

function RawFieldDialog({
  dataSourceId,
  field,
  open,
  onOpenChange,
  onSaved,
}: {
  dataSourceId: string;
  field: DatasourceFieldRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const [label, setLabel] = useState(field.label);
  const [role, setRole] = useState<FieldRole>(field.role);
  const [semanticType, setSemanticType] = useState<SemanticType>(field.semanticType);
  const [aggregation, setAggregation] = useState<Aggregation | ''>(field.defaultAggregation ?? '');
  const [description, setDescription] = useState(field.description);
  const [saveError, setSaveError] = useState<string>();
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setSaveError(undefined);
    try {
      await callApi({
        action: 'updateFieldMetadata',
        dataSourceId,
        columnName: field.columnName ?? field.canonicalName,
        patch: {
          label,
          role,
          semanticType,
          defaultAggregation: aggregation || null,
          description: description || null,
        },
      });
      await onSaved();
      onOpenChange(false);
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{`Edit ${field.label}`}</DialogTitle>
          <DialogDescription>
            {`Column ${field.canonicalName} is fixed. Rename the field with its label.`}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="field-label">Label</FieldLabel>
              <Input
                id="field-label"
                value={label}
                required
                onChange={(event) => setLabel(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="field-role">Role</FieldLabel>
              <NativeSelect
                id="field-role"
                value={role}
                onChange={(event) => setRole(event.target.value as FieldRole)}
              >
                {fieldRoleSchema.options.map((item) => (
                  <NativeSelectOption key={item} value={item}>
                    {item}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="field-semantic-type">Type</FieldLabel>
              <NativeSelect
                id="field-semantic-type"
                value={semanticType}
                onChange={(event) => setSemanticType(event.target.value as SemanticType)}
              >
                {semanticTypeSchema.options.map((item) => (
                  <NativeSelectOption key={item} value={item}>
                    {item}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="field-aggregation">Default aggregation</FieldLabel>
              <NativeSelect
                id="field-aggregation"
                value={aggregation}
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
            <Field>
              <FieldLabel htmlFor="field-description">Description</FieldLabel>
              <Input
                id="field-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field>
            {saveError ? <p className="text-sm text-destructive">{saveError}</p> : null}
            <div className="flex gap-2">
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save field'}
              </Button>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
            </div>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
