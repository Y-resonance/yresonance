import { PencilIcon, Trash2Icon } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { callApi } from '#/api/client';
import { DashboardSharing, type SharingState } from '#/components/dashboard-sharing';
import { Button } from '#/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '#/components/ui/field';
import { Input } from '#/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';

export function DashboardOverviewActions({
  dashboard,
  onMutation,
}: {
  dashboard: { id: string; name: string };
  onMutation: () => Promise<void>;
}) {
  const [action, setAction] = useState<'rename' | 'delete'>();
  const [name, setName] = useState(dashboard.name);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [sharing, setSharing] = useState<SharingState>({ links: [], grants: [] });
  const [loadingSharing, setLoadingSharing] = useState(false);

  async function refreshSharing() {
    const result = await callApi<{ sharing: SharingState }>({
      action: 'getDashboard',
      dashboardId: dashboard.id,
    });
    setSharing(result.sharing);
  }
  async function openSharing(open: boolean) {
    if (!open) return;
    setError(undefined);
    setLoadingSharing(true);
    try {
      await refreshSharing();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoadingSharing(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending || !action || (action === 'rename' && !name.trim())) return;
    setPending(true);
    setError(undefined);
    try {
      await callApi(
        action === 'rename'
          ? { action: 'updateDashboard', dashboardId: dashboard.id, name: name.trim() }
          : { action: 'deleteDashboard', dashboardId: dashboard.id },
      );
      setAction(undefined);
      await onMutation();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPending(false);
    }
  }
  function selectAction(next: 'rename' | 'delete') {
    setName(dashboard.name);
    setError(undefined);
    setAction(next);
  }
  return (
    <>
      <div className="flex justify-end gap-1">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Rename"
                onClick={() => selectAction('rename')}
              />
            }
          >
            <PencilIcon aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent>Rename</TooltipContent>
        </Tooltip>
        <DashboardSharing
          dashboardId={dashboard.id}
          sharing={sharing}
          refresh={refreshSharing}
          linksOnly
          loading={loadingSharing}
          error={error}
          onOpenChange={(open) => void openSharing(open)}
        />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Delete"
                onClick={() => selectAction('delete')}
              />
            }
          >
            <Trash2Icon aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent>Delete</TooltipContent>
        </Tooltip>
      </div>
      <Dialog
        open={Boolean(action)}
        onOpenChange={(open) => {
          if (!open && !pending) setAction(undefined);
        }}
      >
        <DialogContent showCloseButton={!pending}>
          <DialogHeader>
            <DialogTitle>
              {action === 'delete' ? 'Delete dashboard?' : 'Rename dashboard'}
            </DialogTitle>
            <DialogDescription>
              {action === 'delete'
                ? `Delete “${dashboard.name}” and its share links permanently. Datasources will be kept.`
                : `Choose a new name for “${dashboard.name}”.`}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit}>
            <FieldGroup>
              {action === 'rename' ? (
                <Field>
                  <FieldLabel htmlFor={`rename-${dashboard.id}`}>Name</FieldLabel>
                  <Input
                    id={`rename-${dashboard.id}`}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    required
                    disabled={pending}
                  />
                </Field>
              ) : null}
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  type="button"
                  disabled={pending}
                  onClick={() => setAction(undefined)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant={action === 'delete' ? 'destructive' : 'default'}
                  disabled={pending || (action === 'rename' && !name.trim())}
                >
                  {pending ? 'Saving…' : action === 'delete' ? 'Delete dashboard' : 'Save'}
                </Button>
              </div>
            </FieldGroup>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
