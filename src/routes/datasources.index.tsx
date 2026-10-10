import { createColumnHelper, useTable } from '@tanstack/react-table';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { PlusIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { callApi } from '#/api/client';
import { AppShell } from '#/components/app-shell';
import {
  DataTable,
  DataTableSearch,
  dataTableFeatures,
  type DataTableFeatures,
} from '#/components/data-table';
import { ErrorState, LoadingState } from '#/components/request-state';
import { buttonVariants } from '#/components/ui/button';
import {
  datasourceOverviewRows,
  formatRelativeTime,
  type DatasourceListEntry,
  type DatasourceOverviewRow,
} from '#/domain/datasource-overview';
import { useWebMcpTools } from '#/webmcp/use-webmcp-tools';
import { pageTitle } from '#/lib/page-title';

export const Route = createFileRoute('/datasources/')({
  component: DatasourcesPage,
  head: () => ({
    meta: [
      { title: pageTitle('Datasources') },
      {
        name: 'description',
        content: 'Manage the data sources used by your yresonance reporting dashboards.',
      },
    ],
  }),
});

const helper = createColumnHelper<DataTableFeatures, DatasourceOverviewRow>();
const columns = helper.columns([
  helper.accessor('name', {
    header: 'Name',
    cell: (context) => (
      <Link
        className="font-medium hover:underline"
        to="/datasources/$datasourceId"
        params={{ datasourceId: context.row.original.id }}
      >
        {context.getValue()}
      </Link>
    ),
  }),
  helper.accessor('sourceType', { header: 'Source' }),
  helper.accessor('format', { header: 'Format' }),
  helper.accessor('fieldCount', { header: 'Fields', enableGlobalFilter: false }),
  helper.accessor('updatedAt', {
    header: 'Last updated',
    enableGlobalFilter: false,
    cell: (context) => (
      <span className="text-muted-foreground">{formatRelativeTime(context.getValue())}</span>
    ),
  }),
]);

function DatasourcesPage() {
  return (
    <AppShell requireWorkspace>
      <DatasourcesContent />
    </AppShell>
  );
}

function DatasourcesContent() {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<DatasourceListEntry[]>();
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState<string>();
  const [search, setSearch] = useState('');
  const refresh = useCallback(async () => {
    try {
      const [sources, bootstrap] = await Promise.all([
        callApi<DatasourceListEntry[]>({ action: 'listDataSources' }),
        callApi<{ isAdmin: boolean }>({ action: 'bootstrap' }),
      ]);
      setEntries(sources);
      setIsAdmin(bootstrap.isAdmin);
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);
  useEffect(() => void refresh(), [refresh]);
  useWebMcpTools({ canManageDataSources: Boolean(entries), isAdmin, onMutation: refresh });
  const rows = useMemo(() => datasourceOverviewRows(entries ?? []), [entries]);
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
      ) : !entries ? (
        <LoadingState />
      ) : (
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">Datasources</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Every dataset registered in this workspace. Open one to manage its fields.
              </p>
            </div>
            <Link to="/datasources/new" className={buttonVariants()}>
              <PlusIcon />
              New datasource
            </Link>
          </div>
          <DataTableSearch
            value={search}
            onChange={setSearch}
            label="Search datasources"
            placeholder="Search datasources"
          />
          <DataTable
            table={table}
            sortLabel="Sort datasources by"
            emptyMessage={
              entries.length
                ? 'No datasource matches this search.'
                : 'No datasources yet. Register one to get started.'
            }
            renderCard={(row) => (
              <div className="flex flex-col gap-1">
                <Link
                  className="font-medium"
                  to="/datasources/$datasourceId"
                  params={{ datasourceId: row.id }}
                >
                  {row.name}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {row.sourceType} · {row.format} · {row.fieldCount}{' '}
                  {row.fieldCount === 1 ? 'field' : 'fields'} · {formatRelativeTime(row.updatedAt)}
                </p>
              </div>
            )}
            rowProps={(row) => ({
              className: 'cursor-pointer',
              // The name cell is already a link, so let its own navigation stand.
              onClick: (event) => {
                if ((event.target as HTMLElement).closest('a, button')) return;
                void navigate({
                  to: '/datasources/$datasourceId',
                  params: { datasourceId: row.id },
                });
              },
            })}
          />
        </div>
      )}
    </main>
  );
}
