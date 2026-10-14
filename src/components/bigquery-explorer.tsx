import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Command } from 'cmdk';
import {
  CameraIcon,
  CheckIcon,
  CloudIcon,
  EyeIcon,
  LayersIcon,
  SearchIcon,
  TableIcon,
} from 'lucide-react';
import { useDatasourceCatalog } from '#/api/query';
import type { ApiRequest, DatasourceCatalogPage } from '#/api/contracts';
import { cn } from '#/lib/utils';
import { Button } from './ui/button';
import { FieldError } from './ui/field';
import { Skeleton } from './ui/skeleton';

type Entry = DatasourceCatalogPage['entries'][number];
type BrowseRequest = Omit<Extract<ApiRequest, { action: 'browseDatasource' }>, 'cursor'>;

export interface BigQuerySelection {
  project: string;
  dataset: string;
  table: string;
  location: string;
}

const projectIdPattern = /^[a-z][a-z0-9-]{4,61}[a-z0-9]$/u;

// Three linked columns, like a file browser: choosing a project loads its datasets, choosing a
// dataset loads its tables. Projects the account cannot list can still be used by typing their ID
// into the project search. Each column is a cmdk list: Up and Down move the highlight, Enter
// chooses and moves on to the next column, Left and Right switch columns.
export function BigQueryExplorer({
  connectionId,
  value,
  onChange,
  disabled,
}: {
  connectionId: string;
  value: BigQuerySelection;
  onChange: (value: BigQuerySelection) => void;
  disabled: boolean;
}) {
  const request: BrowseRequest = { action: 'browseDatasource', provider: 'bigquery', connectionId };
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const pendingFocus = useRef<number | undefined>(undefined);
  // Selecting a project or dataset remounts the following column, so focus it after rendering.
  useEffect(() => {
    if (pendingFocus.current === undefined) return;
    inputs.current[pendingFocus.current]?.focus();
    pendingFocus.current = undefined;
  }, [value]);
  function columnProps(index: number) {
    return {
      inputRef: (element: HTMLInputElement | null) => {
        inputs.current[index] = element;
      },
      onMoveColumn: (direction: -1 | 1) => inputs.current[index + direction]?.focus(),
      onSelectByKeyboard: () => {
        pendingFocus.current = index + 1;
      },
    };
  }
  return (
    <div
      className="grid divide-y overflow-hidden rounded-lg border md:grid-cols-3 md:divide-x md:divide-y-0"
      aria-label="BigQuery datasource explorer"
    >
      <CatalogColumn
        title="Projects"
        request={request}
        enabled={Boolean(connectionId)}
        disabled={disabled}
        selected={value.project}
        allowTypedId
        onSelect={(entry) => onChange({ project: entry.id, dataset: '', table: '', location: '' })}
        prompt="Connect a Google account to browse projects."
        {...columnProps(0)}
      />
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
        {...columnProps(1)}
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
        {...columnProps(2)}
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
  allowTypedId = false,
  inputRef,
  onMoveColumn,
  onSelectByKeyboard,
}: {
  title: string;
  request: BrowseRequest;
  enabled: boolean;
  disabled: boolean;
  selected?: string;
  onSelect: (entry: Entry) => void;
  prompt: string;
  allowTypedId?: boolean;
  inputRef: (element: HTMLInputElement | null) => void;
  onMoveColumn: (direction: -1 | 1) => void;
  onSelectByKeyboard: () => void;
}) {
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
  const loaded = query.data?.pages.flatMap((page) => page.entries) ?? [];
  // A typed project ID is not in the listing. Keep it visible as the selected row.
  const entries =
    selected && !loaded.some((entry) => entry.id === selected)
      ? [{ id: selected, label: selected }, ...loaded]
      : loaded;
  const filtered = entries.filter((entry) =>
    `${entry.id} ${entry.label}`.toLowerCase().includes(searchTerm),
  );
  // Pages load lazily, so the count is a lower bound until the last page is in.
  const total = `${entries.length}${query.hasNextPage ? '+' : ''}`;
  // Offer the typed project ID only when the listing has nothing matching it.
  const typedId =
    allowTypedId && !filtered.length && projectIdPattern.test(searchTerm) ? searchTerm : undefined;
  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      const input = event.target as HTMLInputElement;
      // Keep the caret keys inside the text while there is something to move through.
      if (input.value && input.selectionStart !== input.selectionEnd) return;
      if (event.key === 'ArrowRight' && input.selectionEnd !== input.value.length) return;
      if (event.key === 'ArrowLeft' && input.selectionStart !== 0) return;
      event.preventDefault();
      onMoveColumn(event.key === 'ArrowRight' ? 1 : -1);
    } else if (event.key === 'Enter') {
      onSelectByKeyboard();
    }
  }
  return (
    <section className="flex min-w-0 flex-col" aria-label={title}>
      <div className="flex h-10 items-center gap-2 border-b px-3">
        <h3 className="flex-1 text-sm font-medium">{title}</h3>
        {enabled && query.data ? (
          <span className="text-xs tabular-nums text-muted-foreground">
            {searchTerm ? `${filtered.length} of ${total}` : total}
          </span>
        ) : null}
      </div>
      <Command
        // Filtering is ours: cmdk only handles highlight and keyboard selection here.
        shouldFilter={false}
        label={`Search ${title.toLowerCase()}`}
        className="flex min-h-0 flex-1 flex-col"
        onKeyDown={onKeyDown}
      >
        <div className="relative border-b">
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Command.Input
            ref={inputRef}
            className="h-9 w-full bg-transparent pl-8 pr-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
            placeholder={
              allowTypedId
                ? `Search ${title.toLowerCase()} or type a project ID`
                : `Search ${title.toLowerCase()}`
            }
            value={search}
            disabled={disabled || !enabled}
            autoComplete="off"
            spellCheck={false}
            onValueChange={setSearch}
          />
        </div>
        <Command.List
          className="flex h-72 flex-col overflow-y-auto p-1 outline-none"
          aria-busy={query.isFetching}
        >
          {!enabled ? (
            <ColumnNote>{prompt}</ColumnNote>
          ) : query.isPending ? (
            <div className="flex flex-col gap-1 p-1">
              <Skeleton className="h-7 w-3/4" />
              <Skeleton className="h-7 w-1/2" />
              <Skeleton className="h-7 w-2/3" />
            </div>
          ) : (
            <>
              {filtered.map((entry) => (
                <CatalogRow
                  key={entry.id}
                  entry={entry}
                  selected={selected === entry.id}
                  disabled={disabled}
                  onSelect={onSelect}
                />
              ))}
              {typedId ? (
                <Command.Item
                  value={`use:${typedId}`}
                  className={rowClassName}
                  disabled={disabled}
                  onSelect={() => {
                    onSelect({ id: typedId, label: typedId });
                    setSearch('');
                  }}
                >
                  <span className="text-muted-foreground">Use project ID</span>
                  <span className="truncate font-mono text-xs">{typedId}</span>
                </Command.Item>
              ) : null}
              {!filtered.length && !typedId && !query.error && !searching ? (
                <ColumnNote>{searchTerm ? 'No matches.' : 'No accessible items.'}</ColumnNote>
              ) : null}
              {searching && !query.error ? (
                <p role="status" className="px-2 py-1.5 text-xs text-muted-foreground">
                  Searching all pages...
                </p>
              ) : null}
              {query.hasNextPage && !searchTerm ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="justify-start text-muted-foreground"
                  disabled={disabled || query.isFetching}
                  onClick={() => void query.fetchNextPage()}
                >
                  {query.isFetchingNextPage ? 'Loading...' : 'Show more items'}
                </Button>
              ) : null}
              {query.error ? (
                <div className="flex flex-col gap-2 p-2">
                  <FieldError>{query.error.message}</FieldError>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-fit"
                    disabled={disabled || query.isFetching}
                    onClick={() => void query.refetch()}
                  >
                    Retry
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </Command.List>
      </Command>
    </section>
  );
}

const rowClassName =
  'flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm select-none outline-none data-[selected=true]:bg-accent data-[disabled=true]:opacity-50 data-[checked=true]:bg-accent/60';

function CatalogRow({
  entry,
  selected,
  disabled,
  onSelect,
}: {
  entry: Entry;
  selected: boolean;
  disabled: boolean;
  onSelect: (entry: Entry) => void;
}) {
  return (
    <Command.Item
      value={entry.id}
      className={cn(rowClassName)}
      data-checked={selected}
      aria-checked={selected}
      disabled={disabled}
      title={entry.id}
      onSelect={() => onSelect(entry)}
    >
      <span className="min-w-0 flex-1">
        <MiddleTruncated text={entry.label} />
        {entry.label !== entry.id ? (
          <MiddleTruncated text={entry.id} className="text-xs text-muted-foreground" />
        ) : null}
      </span>
      {entry.type ? <EntryType type={entry.type} /> : null}
      {selected ? <CheckIcon aria-hidden="true" className="size-4 shrink-0" /> : null}
    </Command.Item>
  );
}

// BigQuery table types as returned by its listing API. Unknown types fall back to their label.
const entryTypes: Record<string, { icon: typeof TableIcon; label: string }> = {
  TABLE: { icon: TableIcon, label: 'Table' },
  VIEW: { icon: EyeIcon, label: 'View' },
  MATERIALIZED_VIEW: { icon: LayersIcon, label: 'Materialized view' },
  EXTERNAL: { icon: CloudIcon, label: 'External table' },
  SNAPSHOT: { icon: CameraIcon, label: 'Snapshot' },
};

function EntryType({ type }: { type: string }) {
  const known = entryTypes[type];
  if (!known) return <span className="shrink-0 text-xs text-muted-foreground">{type}</span>;
  return (
    <span className="shrink-0 text-muted-foreground" title={known.label}>
      <known.icon aria-hidden="true" className="size-3.5" />
      <span className="sr-only">{type}</span>
    </span>
  );
}

// Finder-style truncation: the ellipsis lands in the middle so the distinguishing suffix stays
// readable. CSS can only cut at the end, so the tail is a separate span that never shrinks.
// Assistive tech reads the unsplit text instead.
function MiddleTruncated({ text, className }: { text: string; className?: string }) {
  const tailLength = 8;
  const head = text.slice(0, -tailLength);
  const tail = text.slice(-tailLength);
  return (
    <span className={cn('block', className)} title={text}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true" className="flex min-w-0">
        <span className="truncate">{head}</span>
        <span className="shrink-0 whitespace-pre">{tail}</span>
      </span>
    </span>
  );
}

function ColumnNote({ children }: { children: string }) {
  return <p className="m-auto px-4 text-center text-sm text-muted-foreground">{children}</p>;
}
