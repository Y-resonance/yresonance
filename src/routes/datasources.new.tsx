import { ClientOnly, createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { datasourceProviders } from '#/data/providers/catalog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card';
import { ArrowRightIcon, ArrowLeftIcon, CloudIcon, KeyRoundIcon } from 'lucide-react';
import { AppShell } from '#/components/app-shell';
import { BigQueryRegisterForm } from '#/components/bigquery-register-form';
import { DatasourceRegisterForm } from '#/components/datasource-register-form';
import { LoadingState } from '#/components/request-state';
import { pageTitle } from '#/lib/page-title';
import { cn } from '#/lib/utils';
import { useWebMcpTools } from '#/webmcp/use-webmcp-tools';

export const Route = createFileRoute('/datasources/new')({
  validateSearch: (search: Record<string, unknown>): { provider?: string } => ({
    provider:
      typeof search.provider === 'string' &&
      datasourceProviders.some((provider) => provider.id === search.provider)
        ? search.provider
        : undefined,
  }),
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
  const search = Route.useSearch();
  const provider = datasourceProviders.find((candidate) => candidate.id === search.provider);
  useWebMcpTools({ canManageDataSources: true });
  function openDatasource(dataSource: { id: string }) {
    void navigate({ to: '/datasources/$datasourceId', params: { datasourceId: dataSource.id } });
  }

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <div
        className={cn(
          'flex flex-col gap-6',
          provider?.connectionMethod === 'oauth' || !provider ? 'max-w-4xl' : 'max-w-2xl',
        )}
      >
        {provider ? (
          <Link
            className="flex w-fit items-center gap-2 text-sm hover:underline"
            to="/datasources/new"
            search={{}}
          >
            <ArrowLeftIcon className="size-4" />
            Change provider
          </Link>
        ) : (
          <Link className="flex w-fit items-center gap-2 text-sm hover:underline" to="/datasources">
            <ArrowLeftIcon className="size-4" />
            Datasources
          </Link>
        )}
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            {provider ? `Connect ${provider.name}` : 'New datasource'}
          </h1>
          {provider && <p className="mt-1 text-sm text-muted-foreground">{provider.description}</p>}
        </div>
        {provider ? (
          <>
            <ClientOnly fallback={<LoadingState />}>
              {provider.connectionMethod === 'oauth' ? (
                <BigQueryRegisterForm provider={provider} onRegistered={openDatasource} />
              ) : (
                <DatasourceRegisterForm
                  key={provider.id}
                  provider={provider}
                  onRegistered={openDatasource}
                />
              )}
            </ClientOnly>
          </>
        ) : (
          <div className="grid gap-8 md:grid-cols-2 md:gap-12">
            {(['managed', 'bring-your-own'] as const).map((group) => (
              <section
                key={group}
                className="flex flex-col gap-3"
                aria-labelledby={`provider-${group}`}
              >
                <div>
                  <h2
                    id={`provider-${group}`}
                    className="mb-1 flex items-center gap-2 text-lg font-medium"
                  >
                    {group === 'managed' ? (
                      <CloudIcon aria-hidden="true" className="size-5" />
                    ) : (
                      <KeyRoundIcon aria-hidden="true" className="size-5" />
                    )}
                    {group === 'managed' ? 'Managed' : 'Bring your own'}
                  </h2>
                  <p className="text-sm text-muted-foreground md:min-h-10">
                    {group === 'managed'
                      ? 'Use our managed storage providers and upload your data to our servers.'
                      : 'Connect your own datasources.'}
                  </p>
                </div>
                <div className="grid gap-3">
                  {datasourceProviders
                    .filter((candidate) => candidate.group === group)
                    .map((candidate) => (
                      <Link
                        key={candidate.id}
                        to="/datasources/new"
                        search={{ provider: candidate.id }}
                        className="group rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      >
                        <Card size="sm" className="h-full gap-2 group-hover:ring-foreground/30">
                          <CardHeader>
                            <div className="flex items-center gap-2">
                              <img
                                src={`/analytics-backends/${candidate.engine}.svg`}
                                alt=""
                                className="size-6 shrink-0"
                              />
                              <CardTitle className="flex-1">{candidate.name}</CardTitle>
                              <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground" />
                            </div>
                          </CardHeader>
                          <CardContent>
                            <CardDescription>{candidate.description}</CardDescription>
                          </CardContent>
                        </Card>
                      </Link>
                    ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
