import type { ReactNode } from 'react';
import { Skeleton } from '#/components/ui/skeleton';
import { WorkspaceSetup, useAuth, useAuthCapabilities } from '#/platform/index.ui';

/** Holds private routes back until a signed-in user has an active workspace. */
export function WorkspaceGate({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, orgId } = useAuth();
  const { workspaces } = useAuthCapabilities();

  if (!isLoaded) return <WorkspaceGateLoading />;
  // A single-workspace provider always supplies its workspace, so there is nothing to choose.
  if (!isSignedIn || orgId || workspaces === 'single' || !WorkspaceSetup) return children;
  return <WorkspaceSetup fallback={<WorkspaceGateLoading />} />;
}

function WorkspaceGateLoading() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-12 sm:px-6 sm:py-20">
      <div className="flex flex-col gap-4" aria-label="Loading workspaces">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    </main>
  );
}
