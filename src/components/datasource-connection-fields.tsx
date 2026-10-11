import { useEffect, useState } from 'react';
import { useApi, useApiQuery } from '#/api/query';
import { Button } from './ui/button';
import { Field, FieldDescription, FieldError, FieldLabel, FieldSet, FieldLegend } from './ui/field';
import { NativeSelect, NativeSelectOption } from './ui/native-select';

interface Connections {
  configured: boolean;
  currentConnectionId?: string;
  connections: Array<{ id: string; account: string; status: string }>;
}

export function DatasourceConnectionFields({
  provider,
  value,
  onChange,
  dataSourceId,
}: {
  provider: string;
  value?: string;
  onChange?: (id: string) => void;
  dataSourceId?: string;
}) {
  const callApi = useApi();
  const query = useApiQuery<Connections>({
    action: 'listDatasourceConnections',
    provider,
    dataSourceId,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(() =>
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).has('connectionError')
      ? 'Google authorization failed or was declined. Connect again using your esome account.'
      : undefined,
  );
  const [chosenId, setChosenId] = useState<string>();
  const selectedId =
    query.data?.currentConnectionId ??
    chosenId ??
    value ??
    query.data?.connections.find((entry) => entry.status === 'connected')?.id ??
    query.data?.connections[0]?.id;
  const selected = query.data?.connections.find((entry) => entry.id === selectedId);
  useEffect(() => {
    if (onChange) onChange(selected?.status === 'connected' ? (selectedId ?? '') : '');
  }, [onChange, selectedId, selected?.status]);

  async function connect(connectionId?: string) {
    setBusy(true);
    setError(undefined);
    try {
      const result = await callApi<{ authorizationUrl: string }>({
        action: 'beginDatasourceConnection',
        provider,
        connectionId,
        dataSourceId,
      });
      window.location.assign(result.authorizationUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not connect.');
      setBusy(false);
    }
  }
  async function disconnect() {
    if (
      !selectedId ||
      !window.confirm(
        'Disconnect this account for every datasource using it? Dashboard queries will stop until it is reconnected.',
      )
    )
      return;
    setBusy(true);
    setError(undefined);
    try {
      await callApi({ action: 'disconnectDatasourceConnection', connectionId: selectedId });
      await query.refetch();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not disconnect.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <FieldSet>
      <FieldLegend>Google connection</FieldLegend>
      <FieldDescription>
        All permitted dashboard viewers query through this account, including shared links.
      </FieldDescription>
      {query.data?.connections.length ? (
        <Field>
          <FieldLabel htmlFor="oauth-account">Google account</FieldLabel>
          <NativeSelect
            id="oauth-account"
            value={selectedId ?? ''}
            disabled={busy || Boolean(dataSourceId)}
            onChange={(event) => setChosenId(event.target.value)}
          >
            <NativeSelectOption value="">Choose an account</NativeSelectOption>
            {query.data.connections.map((entry) => (
              <NativeSelectOption key={entry.id} value={entry.id}>
                {entry.account}
                {entry.status === 'connected' ? '' : ' (reconnect required)'}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
      ) : null}
      {query.data && !query.data.configured ? (
        <p className="text-sm text-muted-foreground">
          Google connection is not configured for this environment.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={busy || !query.data?.configured}
          onClick={() => void connect(selectedId)}
        >
          {busy
            ? 'Connecting...'
            : selected
              ? 'Reconnect Google account'
              : 'Connect Google account'}
        </Button>
        {selected?.status === 'connected' ? (
          <Button type="button" variant="ghost" disabled={busy} onClick={() => void disconnect()}>
            Disconnect account
          </Button>
        ) : null}
        {selected && !dataSourceId ? (
          <Button
            type="button"
            variant="ghost"
            disabled={busy || !query.data?.configured}
            onClick={() => void connect()}
          >
            Connect another account
          </Button>
        ) : null}
      </div>
      <FieldError>{error ?? query.error?.message}</FieldError>
    </FieldSet>
  );
}
