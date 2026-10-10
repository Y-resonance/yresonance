import { useAuth } from '@clerk/tanstack-react-start';
import {
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  Fragment,
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import { callApi } from './client';
import type { ApiRequest } from './contracts';

// HTTP verbs do not distinguish reads: the application API uses POST for every action.
const reads = new Set<ApiRequest['action']>([
  'bootstrap',
  'listDashboards',
  'getDashboard',
  'getSharedDashboard',
  'previewWidget',
  'queryWidget',
  'explainWidget',
  'getControlOptions',
  'listDataSources',
  'listDatasourceProviders',
  'listLibraryMetrics',
  'describeDatasource',
  'listR2Objects',
  'validateCalculatedField',
  'previewCalculatedFieldValues',
  'validateMetricExpression',
]);
const analyticsReads = new Set<ApiRequest['action']>([
  'queryWidget',
  'previewWidget',
  'getControlOptions',
  'previewCalculatedFieldValues',
]);

const activeScopeContext = createContext<{ current: string } | undefined>(undefined);

type RequestOptions = Parameters<typeof callApi>[1];
export type ApiExecutor = typeof callApi;

export function apiQueryOptions<T>(
  scope: string,
  request: ApiRequest,
  options: RequestOptions = {},
) {
  return queryOptions({
    queryKey: ['api', scope, request] as readonly unknown[],
    queryFn: ({ signal }) =>
      callApi<T>(request, {
        ...options,
        signal: options.signal ? AbortSignal.any([signal, options.signal]) : signal,
      }),
    // The server owns analytics TTLs. Revisited inputs must ask it to check freshness;
    // focus and reconnect refetching stay disabled in the router defaults.
    ...(analyticsReads.has(request.action) ? { staleTime: 0 } : {}),
  });
}

function useApiScope() {
  const { sessionId, userId, orgId, isLoaded } = useAuth();
  return {
    scope: JSON.stringify([sessionId ?? null, userId ?? null, orgId ?? null]),
    ready: isLoaded,
  };
}

export function useApiQuery<T>(
  request: ApiRequest,
  options: {
    enabled?: boolean;
    staleTime?: number;
    revision?: unknown;
    queryFn?: (signal: AbortSignal) => Promise<T>;
  } = {},
) {
  const { scope, ready } = useApiScope();
  const base = apiQueryOptions<T>(scope, request);
  const client = useQueryClient();
  const key = options.revision === undefined ? base.queryKey : [...base.queryKey, options.revision];
  const keyString = JSON.stringify(key);
  const setData = useCallback(
    (updater: (current: T | undefined) => T) =>
      client.setQueryData<T>(JSON.parse(keyString), updater),
    [client, keyString],
  );
  const queryFn = options.queryFn;
  const result = useQuery({
    ...base,
    queryKey: key,
    ...(options.staleTime === undefined ? {} : { staleTime: options.staleTime }),
    ...(queryFn ? { queryFn: ({ signal }: { signal: AbortSignal }) => queryFn(signal) } : {}),
    enabled: typeof window !== 'undefined' && ready && (options.enabled ?? true),
  });
  return { ...result, setData };
}

// Imperative reads support event handlers, ordered builder saves, and WebMCP tools.
// Explicit refresh callers always fetch current data; simultaneous reads still deduplicate.
export function useApi(): ApiExecutor {
  const client = useQueryClient();
  const { scope } = useApiScope();
  const activeScope = useContext(activeScopeContext);
  const { mutateAsync } = useMutation({
    mutationKey: ['api', scope],
    mutationFn: ({ request, options }: { request: ApiRequest; options: RequestOptions }) =>
      callApi(request, options),
    retry: false,
    gcTime: 0,
    onSuccess: (_result, { request }) => {
      if (
        request.action === 'trackPageView' ||
        request.action === 'trackDatasourceUpload' ||
        request.action === 'prepareDatasourceUpload'
      )
        return;
      if (activeScope && activeScope.current !== scope) return;
      void client.invalidateQueries({ queryKey: ['api', scope], refetchType: 'none' });
      return client.invalidateQueries({
        queryKey: ['api', scope],
        predicate: (query) => {
          const input = query.queryKey[2] as ApiRequest;
          // Builder and WebMCP callbacks refresh dashboard documents explicitly, often
          // without sharing. Avoid a second full dashboard/directory read here.
          return !analyticsReads.has(input.action) && input.action !== 'getDashboard';
        },
      });
    },
  });
  return useCallback(
    async <T,>(request: ApiRequest, options: RequestOptions = {}) => {
      if (activeScope && activeScope.current !== scope)
        throw new DOMException('The account or workspace changed.', 'AbortError');
      if (reads.has(request.action)) {
        return client.fetchQuery({ ...apiQueryOptions<T>(scope, request, options), staleTime: 0 });
      }
      return (await mutateAsync({ request, options })) as T;
    },
    [client, scope, mutateAsync, activeScope],
  );
}

// Remount account-owned UI immediately, then cancel and remove its old cache. Pending
// responses cannot populate the new account's keys. No browser cache is persisted.
export function ApiSessionBoundary({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const { scope } = useApiScope();
  const activeScope = useRef(scope);
  activeScope.current = scope;
  useEffect(
    () => () => {
      void client.cancelQueries({ queryKey: ['api', scope] });
      client.removeQueries({ queryKey: ['api', scope] });
    },
    [client, scope],
  );
  return (
    <activeScopeContext.Provider value={activeScope}>
      <Fragment key={scope}>{children}</Fragment>
    </activeScopeContext.Provider>
  );
}

export function useR2Objects(enabled: boolean) {
  const { scope, ready } = useApiScope();
  return useInfiniteQuery({
    queryKey: ['api', scope, { action: 'listR2Objects' }, 'infinite'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      callApi<{ objects: Array<{ key: string }>; cursor?: string }>(
        { action: 'listR2Objects', cursor: pageParam },
        { signal },
      ),
    getNextPageParam: (page) => page.cursor,
    enabled: typeof window !== 'undefined' && ready && enabled,
  });
}
