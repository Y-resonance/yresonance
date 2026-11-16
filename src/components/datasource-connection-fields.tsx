import { useEffect, useState } from 'react';
import { EllipsisIcon } from 'lucide-react';
import { GoogleIcon } from './icons/google-icon';
import { useApi, useApiQuery } from '#/api/query';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { FieldDescription, FieldError, FieldLegend, FieldSet } from './ui/field';

interface Connections {
  configured: boolean;
  canReplaceConnection?: boolean;
  connectionUnavailable?: boolean;
  currentConnectionId?: string;
  canManageCurrentConnection?: boolean;
  currentConnectionOwnerName?: string;
  connections: Array<{ id: string; account: string; status: string }>;
}

// Shows the Google account a datasource queries through. Connected accounts collapse to one line;
// switching, reconnecting and disconnecting live in a menu. Without an account, only the connect
// button and the reason it matters are shown. Admins can replace a datasource reference even when
// its saved connection cannot be opened.
export function DatasourceConnectionFields({
  provider,
  value,
  onChange,
  dataSourceId,
  heading = { text: 'Google connection', variant: 'legend' },
}: {
  provider: string;
  value?: string;
  onChange?: (id: string) => void;
  dataSourceId?: string;
  heading?: { text: string; variant: 'legend' | 'label' };
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
      ? 'Google authorization failed or was declined. Connect again using your Google Workspace account.'
      : undefined,
  );
  const [chosenId, setChosenId] = useState<string>();
  const connections = query.data?.connections ?? [];
  const selectedId =
    query.data?.currentConnectionId ??
    chosenId ??
    value ??
    connections.find((entry) => entry.status === 'connected')?.id ??
    connections[0]?.id;
  const selected = connections.find(
    (entry) => entry.id === (dataSourceId ? query.data?.currentConnectionId : selectedId),
  );
  const connected = selected?.status === 'connected';
  const others = connections.filter((entry) => entry.id !== selectedId);
  useEffect(() => {
    if (onChange) onChange(connected ? (selectedId ?? '') : '');
  }, [onChange, selectedId, connected]);

  async function connect(connectionId?: string, replace?: boolean) {
    if (
      replace &&
      !window.confirm(
        'Replace this datasource’s Google connection? All dashboard viewers will query through the account you authorize. Other datasources keep their connections.',
      )
    )
      return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await callApi<{ authorizationUrl: string }>({
        action: 'beginDatasourceConnection',
        provider,
        connectionId,
        dataSourceId,
        ...(replace ? { replace: true } : {}),
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
  const configured = Boolean(query.data?.configured);
  const replaceButton = query.data?.canReplaceConnection ? (
    <Button
      type="button"
      variant="outline"
      className="w-fit"
      disabled={busy || !configured}
      onClick={() => void connect(undefined, true)}
    >
      <GoogleIcon data-icon="inline-start" />
      {busy ? 'Connecting...' : 'Replace connection'}
    </Button>
  ) : null;
  if (dataSourceId && query.data?.canManageCurrentConnection === false)
    return (
      <FieldSet>
        <FieldLegend variant={heading.variant}>{heading.text}</FieldLegend>
        <FieldDescription>
          {query.data.connectionUnavailable
            ? query.data.canReplaceConnection
              ? 'The saved Google connection cannot be opened. Replace it to restore queries.'
              : 'The saved Google connection cannot be opened. Ask a workspace admin to replace it.'
            : `Connected by ${query.data.currentConnectionOwnerName ?? 'a workspace member'}`}
        </FieldDescription>
        {replaceButton}
        {!configured ? (
          <FieldDescription>
            Google connection is not configured for this environment.
          </FieldDescription>
        ) : null}
        <FieldError>{error ?? query.error?.message}</FieldError>
      </FieldSet>
    );
  return (
    <FieldSet>
      <FieldLegend variant={heading.variant}>{heading.text}</FieldLegend>
      {selected ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <GoogleIcon className="size-4" />
          <span>{selected.account}</span>
          {!connected ? (
            <>
              <span className="text-muted-foreground">reconnect required</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || !configured}
                onClick={() => void connect(selectedId)}
              >
                {busy ? 'Connecting...' : 'Reconnect Google account'}
              </Button>
            </>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon-sm" />}
              aria-label="Google account actions"
              disabled={busy}
            >
              <EllipsisIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="min-w-56">
              {others.length && !dataSourceId ? (
                <>
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Switch account</DropdownMenuLabel>
                    {others.map((entry) => (
                      <DropdownMenuItem key={entry.id} onClick={() => setChosenId(entry.id)}>
                        {entry.account}
                        {entry.status === 'connected' ? '' : ' (reconnect required)'}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                </>
              ) : null}
              <DropdownMenuItem disabled={!configured} onClick={() => void connect(selectedId)}>
                Reconnect Google account
              </DropdownMenuItem>
              {!dataSourceId ? (
                <DropdownMenuItem disabled={!configured} onClick={() => void connect()}>
                  Connect another account
                </DropdownMenuItem>
              ) : null}
              {connected ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="font-normal text-muted-foreground">
                      Dashboard viewers query through this account.
                    </DropdownMenuLabel>
                    <DropdownMenuItem variant="destructive" onClick={() => void disconnect()}>
                      Disconnect account
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : (
        <>
          <FieldDescription>
            All permitted dashboard viewers query through this account, including shared links.
          </FieldDescription>
          {query.data && !configured ? (
            <p className="text-sm text-muted-foreground">
              Google connection is not configured for this environment.
            </p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className="w-fit"
            disabled={busy || !configured}
            onClick={() => void connect()}
          >
            <GoogleIcon data-icon="inline-start" />
            {busy ? 'Connecting...' : 'Connect Google account'}
          </Button>
        </>
      )}
      {replaceButton}
      <FieldError>{error ?? query.error?.message}</FieldError>
    </FieldSet>
  );
}
