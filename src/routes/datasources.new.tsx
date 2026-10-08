import { ClientOnly, createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeftIcon } from 'lucide-react';
import { AppShell } from '#/components/app-shell';
import { DatasourceRegisterForm } from '#/components/datasource-register-form';
import { LoadingState } from '#/components/request-state';
import { pageTitle } from '#/lib/page-title';
import { useWebMcpTools } from '#/webmcp/use-webmcp-tools';

export const Route = createFileRoute('/datasources/new')({
  component: NewDatasourcePage,
  head: () => ({
    meta: [
      { title: pageTitle('New datasource') },
      {
        name: 'description',
        content:
          'Upload CSV or Parquet data or connect an existing data source for yresonance reporting.',
      },
    ],
  }),
});

function NewDatasourcePage() {
  return (
    <AppShell requireWorkspace>
      <NewDatasourceContent />
    </AppShell>
  );
}

function NewDatasourceContent() {
  const navigate = useNavigate();
  useWebMcpTools({ canManageDataSources: true });

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <div className="flex max-w-xl flex-col gap-6">
        <Link className="flex w-fit items-center gap-2 text-sm hover:underline" to="/datasources">
          <ArrowLeftIcon className="size-4" />
          Datasources
        </Link>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">New datasource</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload a CSV or Parquet file, or register data already in this workspace.
          </p>
        </div>
        <ClientOnly fallback={<LoadingState />}>
          <DatasourceRegisterForm
            onRegistered={(dataSource) => {
              void navigate({
                to: '/datasources/$datasourceId',
                params: { datasourceId: dataSource.id },
              });
            }}
          />
        </ClientOnly>
      </div>
    </main>
  );
}
