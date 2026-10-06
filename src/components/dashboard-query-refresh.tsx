import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from './ui/button';

const RefreshContext = createContext({
  revision: 0,
  inputsRevision: 0,
  changePending: (_delta: number) => {},
  pending: 0,
  refresh: () => {},
});

// `inputsRevision` re-runs widget queries without bypassing the result cache. Bump it when
// something widgets cannot see in their own definition changed, such as the dashboard timezone
// or datasource fields.
export function DashboardQueryRefresh({
  children,
  inputsRevision = 0,
}: {
  children: ReactNode;
  inputsRevision?: number;
}) {
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState(0);
  const changePending = useCallback((delta: number) => setPending((count) => count + delta), []);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  return (
    <RefreshContext.Provider value={{ revision, inputsRevision, pending, changePending, refresh }}>
      {children}
    </RefreshContext.Provider>
  );
}

export function DashboardRefreshButton() {
  const { pending, refresh } = useContext(RefreshContext);
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Fetch fresh data"
      title="Fetch fresh data"
      disabled={pending > 0}
      onClick={refresh}
    >
      <RefreshCw className={pending > 0 ? 'motion-safe:animate-spin' : undefined} />
    </Button>
  );
}

export function useDashboardQueryRefresh() {
  return useContext(RefreshContext);
}
