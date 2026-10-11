import { useEffect, useState, type ReactNode } from 'react';
import { useDatasourceCatalog } from '#/api/query';
import type { ApiRequest, DatasourceCatalogPage } from '#/api/contracts';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Field, FieldLabel, FieldError } from './ui/field';
import { Skeleton } from './ui/skeleton';

type Entry = DatasourceCatalogPage['entries'][number];
type BrowseRequest = Omit<Extract<ApiRequest, { action: 'browseDatasource' }>, 'cursor'>;

export function BigQueryExplorer({
  connectionId,
  value,
  onChange,
  disabled,
}: {
  connectionId: string;
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
  disabled: boolean;
}) {
  const [projectId, setProjectId] = useState('');
  const request: BrowseRequest = { action: 'browseDatasource', provider: 'bigquery', connectionId };
  function selectProject(project: string) {
    onChange({ ...value, project, dataset: '', table: '', location: '' });
  }
  return (
    <div className="grid gap-6 md:grid-cols-3" aria-label="BigQuery datasource explorer">
      <CatalogColumn
        title="Projects"
        request={request}
        enabled={Boolean(connectionId)}
        disabled={disabled}
        selected={value.project}
        onSelect={(entry) => selectProject(entry.id)}
        prompt="Connect a Google account to browse projects."
      >
        <Field>
          <FieldLabel htmlFor="manual-project">Project ID</FieldLabel>
          <Input
            id="manual-project"
            placeholder="Enter a project ID"
            value={projectId}
            disabled={disabled || !connectionId}
            onChange={(event) => setProjectId(event.target.value)}
          />
          <Button
            type="button"
            variant="outline"
            disabled={
              disabled || !connectionId || !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/u.test(projectId.trim())
            }
            onClick={() => selectProject(projectId.trim())}
          >
            Use project ID
          </Button>
        </Field>
      </CatalogColumn>
      <CatalogColumn
        key={`datasets-${value.project}`}
        title="Datasets"
        request={{ ...request, project: value.project || undefined }}
        enabled={Boolean(connectionId && value.project)}
        disabled={disabled}
        selected={value.dataset}
        prompt="Choose a project."
        onSelect={(entry) =>
          onChange({ ...value, dataset: entry.id, table: '', location: entry.location ?? '' })
        }
      />
      <CatalogColumn
        key={`tables-${value.project}-${value.dataset}`}
        title="Tables and views"
        request={{
          ...request,
          project: value.project || undefined,
          dataset: value.dataset || undefined,
        }}
        enabled={Boolean(connectionId && value.project && value.dataset)}
        disabled={disabled}
        selected={value.table}
        prompt="Choose a dataset."
        onSelect={(entry) => onChange({ ...value, table: entry.id })}
      />
    </div>
  );
}

function CatalogColumn({
  title,
  request,
  enabled,
  disabled,
  selected,
  onSelect,
  prompt,
  children,
}: {
  title: string;
  request: BrowseRequest;
  enabled: boolean;
  disabled: boolean;
  selected?: string;
  onSelect: (entry: Entry) => void;
  prompt: string;
  children?: ReactNode;
}) {
  const searchId = `search-${title.toLowerCase().replaceAll(' ', '-')}`;
  const [search, setSearch] = useState('');
  const query = useDatasourceCatalog(request, enabled);
  const searchTerm = search.trim().toLowerCase();
  const { hasNextPage, isFetching, error, fetchNextPage } = query;
  const searching = Boolean(searchTerm && (hasNextPage || isFetching));
  useEffect(() => {
    if (!enabled || disabled || !searchTerm || !hasNextPage || isFetching || error) return;
    // BigQuery lists have no name-search parameter. Follow every page, including empty
    // pages and pages with matches, so search results cover the whole catalog.
    const timer = window.setTimeout(() => {
      void fetchNextPage();
    }, 200);
    return () => window.clearTimeout(timer);
  }, [enabled, disabled, searchTerm, hasNextPage, isFetching, error, fetchNextPage]);
  const entries = query.data?.pages.flatMap((page) => page.entries) ?? [];
  const filtered = entries.filter((entry) =>
    `${entry.id} ${entry.label}`.toLowerCase().includes(searchTerm),
  );
  return (
    <section className="flex min-w-0 flex-col gap-3" aria-label={title}>
      <h3 className="text-sm font-medium">{title}</h3>
      <Field>
        <FieldLabel className="sr-only" htmlFor={searchId}>
          Search {title.toLowerCase()}
        </FieldLabel>
        <Input
          id={searchId}
          placeholder={`Search ${title.toLowerCase()}`}
          value={search}
          disabled={disabled || !enabled}
          onChange={(event) => setSearch(event.target.value)}
        />
      </Field>
      {children}
      {!enabled ? (
        <p className="text-sm text-muted-foreground">{prompt}</p>
      ) : query.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <>
          <div
            className="flex max-h-72 flex-col gap-1 overflow-y-auto"
            aria-busy={query.isFetching}
          >
            {filtered.map((entry) => (
              <Button
                key={entry.id}
                type="button"
                variant={selected === entry.id ? 'secondary' : 'ghost'}
                className="h-auto w-full justify-start py-2"
                aria-pressed={selected === entry.id}
                disabled={disabled}
                title={entry.id}
                onClick={() => onSelect(entry)}
              >
                <span className="flex min-w-0 flex-1 flex-col items-start">
                  <span className="w-full truncate text-left">{entry.label}</span>
                  {entry.label !== entry.id ? (
                    <span className="w-full truncate text-left text-xs text-muted-foreground">
                      {entry.id}
                    </span>
                  ) : null}
                </span>
                {entry.location || entry.type ? (
                  <span className="text-xs text-muted-foreground">
                    {entry.location ?? entry.type}
                  </span>
                ) : null}
              </Button>
            ))}
            {!filtered.length && !query.error && !searching ? (
              <p className="text-sm text-muted-foreground">
                {searchTerm ? 'No matches.' : 'No accessible items.'}
              </p>
            ) : null}
          </div>
          {searching && !query.error ? (
            <p role="status" className="text-sm text-muted-foreground">
              Searching...
            </p>
          ) : null}
          {query.hasNextPage && !searchTerm ? (
            <Button
              type="button"
              variant="ghost"
              disabled={disabled || query.isFetching}
              onClick={() => void query.fetchNextPage()}
            >
              {query.isFetchingNextPage ? 'Loading...' : 'Show more items'}
            </Button>
          ) : null}
          <FieldError>{query.error?.message}</FieldError>
          {query.error ? (
            <Button
              type="button"
              variant="outline"
              disabled={disabled || query.isFetching}
              onClick={() => void query.refetch()}
            >
              Retry
            </Button>
          ) : null}
        </>
      )}
    </section>
  );
}
