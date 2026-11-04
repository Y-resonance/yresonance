import { CloudAlertIcon, CloudCheckIcon, LoaderCircleIcon } from 'lucide-react';
import type { DashboardSaveStatus } from '#/components/dashboard-builder';

export function SaveStatusIndicator({ status }: { status: DashboardSaveStatus }) {
  const label =
    status === 'saving'
      ? 'Saving changes'
      : status === 'error'
        ? 'Changes could not be saved'
        : 'Changes saved';

  return (
    <span
      className="grid size-8 place-items-center text-muted-foreground"
      role="status"
      aria-label={label}
      title={label}
    >
      {status === 'saving' ? (
        <LoaderCircleIcon className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
      ) : status === 'error' ? (
        <CloudAlertIcon className="size-4 text-destructive" aria-hidden />
      ) : (
        <CloudCheckIcon className="size-4" aria-hidden />
      )}
    </span>
  );
}
