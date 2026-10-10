import { CopyIcon } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useApi } from '#/api/query';
import { Button } from '#/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '#/components/ui/field';
import { Input } from '#/components/ui/input';
import { NativeSelect, NativeSelectOption } from '#/components/ui/native-select';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';

/**
 * Copies a dashboard under a new name and optionally swaps each datasource it uses for another
 * one in the workspace. Opens the copy when it is stored. `compact` renders an icon trigger for
 * the dashboard list.
 */
export function DuplicateDashboard({
  dashboard,
  dataSources,
  compact = false,
  disabled = false,
}: {
  dashboard: { id: string; name: string; dataSourceIds: string[] };
  dataSources: Array<{ id: string; name: string }>;
  compact?: boolean;
  // The server copies the stored version, so the builder blocks this while edits are unsaved.
  disabled?: boolean;
}) {
  const callApi = useApi();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const sourceName = (id: string) => dataSources.find((source) => source.id === id)?.name ?? id;

  function changeOpen(next: boolean) {
    if (pending) return;
    setOpen(next);
    setName(`${dashboard.name} copy`);
    setMapping({});
    setError(undefined);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending || !name.trim()) return;
    setPending(true);
    setError(undefined);
    try {
      const copy = await callApi<{ id: string }>({
        action: 'duplicateDashboard',
        dashboardId: dashboard.id,
        name: name.trim(),
        dataSourceMapping: mapping,
      });
      window.location.assign(`/dashboards/${copy.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      {compact ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <DialogTrigger
                render={<Button variant="ghost" size="icon-sm" aria-label="Duplicate" />}
              />
            }
          >
            <CopyIcon aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent>Duplicate</TooltipContent>
        </Tooltip>
      ) : (
        <DialogTrigger render={<Button variant="outline" disabled={disabled} />}>
          Duplicate
        </DialogTrigger>
      )}
      <DialogContent showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>Duplicate dashboard</DialogTitle>
          <DialogDescription>
            Fields are matched by canonical name. Share links and access are not copied.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`duplicate-name-${dashboard.id}`}>Name</FieldLabel>
              <Input
                id={`duplicate-name-${dashboard.id}`}
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                disabled={pending}
              />
            </Field>
            {dashboard.dataSourceIds.map((sourceId) => (
              <Field key={sourceId}>
                <FieldLabel htmlFor={`duplicate-source-${dashboard.id}-${sourceId}`}>
                  {sourceName(sourceId)}
                </FieldLabel>
                <NativeSelect
                  id={`duplicate-source-${dashboard.id}-${sourceId}`}
                  className="w-full"
                  value={mapping[sourceId] ?? sourceId}
                  disabled={pending}
                  onChange={(event) =>
                    setMapping((current) => ({ ...current, [sourceId]: event.target.value }))
                  }
                >
                  {dataSources.map((source) => (
                    <NativeSelectOption key={source.id} value={source.id}>
                      {source.id === sourceId ? `${source.name} (keep)` : source.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            ))}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => changeOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !name.trim()}>
                {pending ? 'Duplicating…' : 'Duplicate'}
              </Button>
            </div>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
