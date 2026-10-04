import { useState, type FormEvent } from 'react';
import { callApi } from '#/api/client';
import type { DatasourceCachePolicy } from '#/domain/schema';
import { DatasourceCacheFields } from './datasource-cache-fields';
import { Button } from './ui/button';

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
  const [policy, setPolicy] = useState(initialPolicy);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [savedPolicy, setSavedPolicy] = useState(initialPolicy);
  const changed = JSON.stringify(policy) !== JSON.stringify(savedPolicy);
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await callApi({ action: 'updateDatasource', dataSourceId, cachePolicy: policy });
      setSavedPolicy(policy);
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save} className="flex flex-col items-start gap-3">
      <DatasourceCacheFields
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
  );
}
