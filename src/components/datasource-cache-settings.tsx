import { useState, type FormEvent } from 'react';
import { callApi } from '#/api/client';
import type { DatasourceCachePolicy } from '#/domain/schema';
import { DatasourceCacheFields } from './datasource-cache-fields';
import { Button } from './ui/button';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from './ui/popover';

export function DatasourceCacheSettings({
  dataSourceId,
  initialPolicy,
  onSaved,
  defaultTtlSeconds,
}: {
  dataSourceId: string;
  initialPolicy: DatasourceCachePolicy;
  onSaved: () => Promise<void>;
  defaultTtlSeconds: number;
}) {
  const [open, setOpen] = useState(false);
  const [policy, setPolicy] = useState(initialPolicy);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [savedPolicy, setSavedPolicy] = useState(initialPolicy);
  const changed = JSON.stringify(policy) !== JSON.stringify(savedPolicy);
  const lifetime = savedPolicy.mode === 'duration' ? savedPolicy.ttlSeconds : defaultTtlSeconds;
  const unit = lifetime % 3600 === 0 ? 'hour' : lifetime % 60 === 0 ? 'minute' : 'second';
  const amount = lifetime / (unit === 'hour' ? 3600 : unit === 'minute' ? 60 : 1);
  const durationLabel = `${amount} ${unit}${amount === 1 ? '' : 's'}`;
  const label =
    savedPolicy.mode === 'disabled'
      ? 'Disabled'
      : savedPolicy.mode === 'default'
        ? `Default (${durationLabel})`
        : durationLabel;
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await callApi({ action: 'updateDatasource', dataSourceId, cachePolicy: policy });
      setSavedPolicy(policy);
      await onSaved();
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex items-center gap-1 text-sm">
      <span className="text-muted-foreground">Query caching:</span>
      <Popover
        open={open}
        onOpenChange={(nextOpen) => {
          if (busy) return;
          setPolicy(savedPolicy);
          setError(undefined);
          setOpen(nextOpen);
        }}
      >
        <PopoverTrigger
          render={<Button variant="link" size="sm" className="h-auto px-1 py-1" />}
          aria-label={`Query caching: ${label}`}
        >
          {label}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 max-w-[calc(100vw-2rem)] p-4">
          <PopoverTitle>Query caching</PopoverTitle>
          <form onSubmit={save} className="flex flex-col items-start gap-3">
            <DatasourceCacheFields
              key={String(open)}
              policy={policy}
              onChange={setPolicy}
              disabled={busy}
              defaultTtlSeconds={defaultTtlSeconds}
            />
            {changed || error ? (
              <Button type="submit" size="sm" disabled={busy}>
                {busy ? 'Saving…' : 'Save caching'}
              </Button>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </form>
        </PopoverContent>
      </Popover>
    </div>
  );
}
