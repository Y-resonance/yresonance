import { useAuth } from '@clerk/tanstack-react-start';
import { useNavigate } from '@tanstack/react-router';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DatabaseIcon,
  LayoutDashboardIcon,
  SearchIcon,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useApiQuery } from '#/api/query';
import { browserAnalytics } from '#/analytics/browser';
import { Button } from '#/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '#/components/ui/command';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog';
import { Pagination, PaginationContent, PaginationItem } from '#/components/ui/pagination';

interface SearchData {
  dashboards: Array<{ id: string; name: string }>;
  dataSources: Array<{ id: string; name: string }>;
}

const pageSize = 10;

export function GlobalSearch() {
  const { isLoaded, isSignedIn, orgId, userId } = useAuth();
  if (!isLoaded || !isSignedIn || !orgId) return null;
  // Remount on account or workspace changes so results never cross sessions.
  return <WorkspaceSearch key={`${userId}:${orgId}`} />;
}

function WorkspaceSearch() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const {
    data,
    error: queryError,
    refetch,
  } = useApiQuery<SearchData>({ action: 'bootstrap' }, { enabled: open, staleTime: 0 });
  const error = queryError?.message;

  const changeOpen = useCallback((nextOpen: boolean, source = 'navbar') => {
    if (nextOpen) {
      setQuery('');
      setPage(1);
      browserAnalytics()?.capture('global_search_opened', { source });
    }
    setOpen(nextOpen);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'k'
      ) {
        event.preventDefault();
        if (!event.repeat) changeOpen(!open, 'keyboard');
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, changeOpen]);

  const search = query.trim().toLocaleLowerCase();
  const results = [
    ...(data?.dashboards ?? []).map((item) => ({ ...item, kind: 'dashboard' as const })),
    ...(data?.dataSources ?? []).map((item) => ({ ...item, kind: 'datasource' as const })),
  ].filter((item) => item.name.toLocaleLowerCase().includes(search));
  const pageCount = Math.max(1, Math.ceil(results.length / pageSize));
  const visible = results.slice((page - 1) * pageSize, page * pageSize);

  function select(item: (typeof results)[number]) {
    browserAnalytics()?.capture('global_search_selected', {
      resource_type: item.kind,
      resource_id: item.id,
      query_length: query.trim().length,
      result_count: results.length,
      page,
    });
    setOpen(false);
    if (item.kind === 'dashboard') {
      void navigate({ to: '/dashboards/$dashboardId', params: { dashboardId: item.id } });
    } else {
      void navigate({ to: '/datasources/$datasourceId', params: { datasourceId: item.id } });
    }
  }

  function changePage(nextPage: number) {
    setPage(nextPage);
    browserAnalytics()?.capture('global_search_page_changed', {
      page: nextPage,
      result_count: results.length,
    });
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => changeOpen(nextOpen)}>
      <DialogTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            aria-label="Search dashboards and datasources"
            className="sm:w-52 sm:justify-start"
          />
        }
      >
        <SearchIcon data-icon="inline-start" />
        <span className="hidden sm:inline">Search...</span>
        <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">⌘K</span>
      </DialogTrigger>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg" showCloseButton={false}>
        <DialogTitle className="sr-only">Search dashboards and datasources</DialogTitle>
        <DialogDescription className="sr-only">
          Search your workspace. Use arrow keys to select a result and Enter to open it.
        </DialogDescription>
        <Command shouldFilter={false}>
          <CommandInput
            autoFocus
            placeholder="Search dashboards and datasources..."
            value={query}
            onValueChange={(value) => {
              setQuery(value);
              setPage(1);
            }}
          />
          <CommandList key={`${query}:${page}`} aria-busy={!data && !error}>
            {error ? (
              <div className="flex flex-col items-center gap-2 p-4" role="alert">
                <p>{error}</p>
                <Button variant="outline" size="sm" onClick={() => void refetch()}>
                  Retry
                </Button>
              </div>
            ) : !data ? (
              <p className="p-4 text-sm text-muted-foreground" role="status">
                Loading...
              </p>
            ) : (
              <>
                <CommandEmpty>No results found.</CommandEmpty>
                {(['dashboard', 'datasource'] as const).map((kind) => {
                  const items = visible.filter((item) => item.kind === kind);
                  if (!items.length) return null;
                  const Icon = kind === 'dashboard' ? LayoutDashboardIcon : DatabaseIcon;
                  return (
                    <CommandGroup
                      key={kind}
                      heading={kind === 'dashboard' ? 'Dashboards' : 'Datasources'}
                    >
                      {items.map((item) => (
                        <CommandItem
                          key={item.id}
                          value={`${kind}:${item.id}`}
                          onSelect={() => select(item)}
                        >
                          <Icon />
                          <span className="truncate">{item.name}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  );
                })}
              </>
            )}
          </CommandList>
        </Command>
        {data && pageCount > 1 ? (
          <Pagination aria-label="Search results pages" className="p-2">
            <PaginationContent>
              <PaginationItem>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={page === 1}
                  onClick={() => changePage(page - 1)}
                  aria-label="Previous results page"
                >
                  <ChevronLeftIcon data-icon="inline-start" />
                  Previous
                </Button>
              </PaginationItem>
              <PaginationItem>
                <span className="px-2 text-xs text-muted-foreground" role="status">
                  Page {page} of {pageCount}
                </span>
              </PaginationItem>
              <PaginationItem>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={page === pageCount}
                  onClick={() => changePage(page + 1)}
                  aria-label="Next results page"
                >
                  Next
                  <ChevronRightIcon data-icon="inline-end" />
                </Button>
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
