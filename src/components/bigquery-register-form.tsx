import { useCallback, useState, type FormEvent } from 'react';
import { useApi } from '#/api/query';
import type { DatasourceProviderDefinition } from '#/data/providers/catalog';
import { dataSourceLocationSchema, type DatasourceCachePolicy } from '#/domain/schema';
import { BigQueryExplorer, type BigQuerySelection } from './bigquery-explorer';
import { DatasourceCacheFields } from './datasource-cache-fields';
import { DatasourceConnectionFields } from './datasource-connection-fields';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { Button } from './ui/button';
import { Field, FieldLabel } from './ui/field';
import { Input } from './ui/input';

const emptySelection: BigQuerySelection = { project: '', dataset: '', table: '', location: '' };

// BigQuery setup: authorize a Google account, then name the datasource and pick a table or view
// in the browser. The browser and the name stay inactive until an account is connected.
export function BigQueryRegisterForm({
  provider,
  onRegistered,
}: {
  provider: DatasourceProviderDefinition;
  onRegistered: (dataSource: { id: string; name: string }) => void;
}) {
  const callApi = useApi();
  const [authorizationId, setAuthorizationId] = useState('');
  const [selection, setSelection] = useState(emptySelection);
  const [name, setName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const [cachePolicy, setCachePolicy] = useState<DatasourceCachePolicy>({ mode: 'default' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  const changeAuthorization = useCallback((id: string) => {
    setAuthorizationId((current) => {
      if (current !== id) setSelection(emptySelection);
      return id;
    });
  }, []);
  function chooseTable(next: BigQuerySelection) {
    setSelection(next);
    if (!nameEdited) setName(next.table);
  }

  const accountReady = Boolean(authorizationId);
  const tableChosen = Boolean(selection.table);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    setSubmitting(true);
    try {
      const registered = await callApi<{ id: string; name: string }>({
        action: 'registerDatasource',
        cachePolicy,
        name,
        provider: provider.id,
        connection: { authorizationId },
        location: dataSourceLocationSchema.parse({ ...provider.sourceDefaults, ...selection }),
      });
      onRegistered(registered);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={submit}>
      <DatasourceConnectionFields
        provider={provider.id}
        value={authorizationId || undefined}
        onChange={changeAuthorization}
        heading={{ text: 'Google account', variant: 'label' }}
      />
      <Field className="max-w-md">
        <FieldLabel htmlFor="source-name">Name</FieldLabel>
        <Input
          id="source-name"
          value={name}
          required
          disabled={!accountReady || submitting}
          onChange={(event) => {
            setNameEdited(true);
            setName(event.target.value);
          }}
        />
      </Field>
      <BigQueryExplorer
        key={authorizationId}
        connectionId={authorizationId}
        value={selection}
        onChange={chooseTable}
        disabled={submitting}
      />
      <DatasourceCacheFields
        policy={cachePolicy}
        onChange={setCachePolicy}
        disabled={!accountReady || submitting}
        defaultTtlSeconds={provider.defaultCacheTtlSeconds}
      />
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not connect</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Button type="submit" className="w-fit" disabled={submitting || !tableChosen || !name}>
        {submitting ? 'Connecting...' : 'Connect datasource'}
      </Button>
    </form>
  );
}
