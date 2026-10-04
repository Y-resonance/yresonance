import { Show } from '@clerk/tanstack-react-start';
import { Link, createFileRoute } from '@tanstack/react-router';
import { PlusIcon } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { callApi } from '#/api/client';
import { AppShell } from '#/components/app-shell';
import { DashboardOverviewActions } from '#/components/dashboard-overview-actions';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog';
import { LandingPage } from '#/components/landing-page';
import { ErrorState, LoadingState } from '#/components/request-state';
import { Button } from '#/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '#/components/ui/empty';
import { Field, FieldGroup, FieldLabel } from '#/components/ui/field';
import { Input } from '#/components/ui/input';
import { usePageTitle } from '#/lib/page-title';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table';
import { useWebMcpTools } from '#/webmcp/use-webmcp-tools';

export const Route = createFileRoute('/')({ component: Home });

interface Bootstrap {
  workspace: { id: string; name: string };
  isAdmin: boolean;
  dashboards: Array<{
    id: string;
    name: string;
    canEdit: boolean;
    dataSourceIds: string[];
    updatedAt: string;
  }>;
  dataSources: Array<{ id: string; name: string }>;
}

function Home() {
  return (
    <AppShell requireWorkspace>
      <Show when="signed-out">
        <LandingPage />
      </Show>
      <Show when="signed-in">
        <DashboardIndex />
      </Show>
    </AppShell>
  );
}

function DashboardIndex() {
  const [data, setData] = useState<Bootstrap>();
  const [error, setError] = useState<string>();
  const [createError, setCreateError] = useState<string>();
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  usePageTitle('Dashboards');
  const refresh = useCallback(async () => {
    try {
      setData(await callApi<Bootstrap>({ action: 'bootstrap' }));
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useWebMcpTools({ canCreate: Boolean(data), isAdmin: data?.isAdmin, onMutation: refresh });
  async function create(event: FormEvent) {
    event.preventDefault();
    if (creating || !name.trim()) return;
    setCreating(true);
    setCreateError(undefined);
    try {
      const dashboard = await callApi<{ id: string }>({
        action: 'createDashboard',
        name: name.trim(),
        dataSourceIds: [],
        timezone: 'Europe/Berlin',
      });
      window.location.assign(`/dashboards/${dashboard.id}`);
    } catch (caught) {
      setCreateError(caught instanceof Error ? caught.message : String(caught));
      setCreating(false);
    }
  }
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      {error ? (
        <ErrorState error={error} />
      ) : !data ? (
        <LoadingState />
      ) : (
        <div className="flex flex-col gap-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm text-muted-foreground">{data.workspace.name}</p>
              <h1 className="text-3xl font-semibold tracking-tight">Dashboards</h1>
            </div>
            <Dialog
              open={createOpen}
              onOpenChange={(open) => {
                if (creating) return;
                setCreateOpen(open);
                setName('');
                setCreateError(undefined);
              }}
            >
              <DialogTrigger render={<Button className="ml-auto" />}>
                <PlusIcon data-icon="inline-start" />
                New dashboard
              </DialogTrigger>
              <DialogContent showCloseButton={!creating}>
                <DialogHeader>
                  <DialogTitle>New dashboard</DialogTitle>
                  <DialogDescription>Start with an empty dashboard.</DialogDescription>
                </DialogHeader>
                <form onSubmit={create}>
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="dashboard-name">Name</FieldLabel>
                      <Input
                        id="dashboard-name"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        placeholder="Campaign overview"
                        required
                        disabled={creating}
                      />
                    </Field>
                    {createError ? (
                      <p role="alert" className="text-sm text-destructive">
                        {createError}
                      </p>
                    ) : null}
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={creating}
                        onClick={() => setCreateOpen(false)}
                      >
                        Cancel
                      </Button>
                      <Button type="submit" disabled={creating || !name.trim()}>
                        {creating ? 'Creating…' : 'Create'}
                      </Button>
                    </div>
                  </FieldGroup>
                </form>
              </DialogContent>
            </Dialog>
          </div>
          {data.dashboards.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.dashboards.map((dashboard) => (
                    <TableRow key={dashboard.id}>
                      <TableCell>
                        <Link
                          className="font-medium hover:underline"
                          to="/dashboards/$dashboardId"
                          params={{ dashboardId: dashboard.id }}
                        >
                          {dashboard.name}
                        </Link>
                      </TableCell>
                      <TableCell>{new Date(dashboard.updatedAt).toLocaleString()}</TableCell>
                      <TableCell>
                        {dashboard.canEdit ? (
                          <DashboardOverviewActions
                            dashboard={dashboard}
                            dataSources={data.dataSources}
                            onMutation={refresh}
                          />
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No dashboards yet</EmptyTitle>
                <EmptyDescription>
                  Create one here or ask an agent to build it through the site tools.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent />
            </Empty>
          )}
        </div>
      )}
    </main>
  );
}
