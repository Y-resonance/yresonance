import { useCallback, useState, type FormEvent } from 'react';
import { useApi } from '#/api/query';
import type { DatasourceProviderDefinition } from '#/data/providers/catalog';
import { dataSourceLocationSchema, type DatasourceCachePolicy } from '#/domain/schema';
import { BigQueryExplorer, type BigQuerySelection } from './bigquery-explorer';
import { DatasourceCacheFields } from './datasource-cache-fields';
import { DatasourceConnectionFields } from './datasource-connection-fields';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { Button } from './ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from './ui/field';
import { Input } from './ui/input';
import { Switch } from './ui/switch';

const emptySelection: BigQuerySelection = { project: '', dataset: '', table: '', location: '' };
const manualSourceFields = [
  { name: 'project', label: 'Project ID' },
  { name: 'dataset', label: 'Dataset' },
  { name: 'table', label: 'Table or view' },
  { name: 'location', label: 'Dataset location' },
] as const;

// BigQuery setup: authorize a Google account, then name the datasource and pick a table or view
// in the browser or enter its location manually. Setup stays inactive until an account is connected.
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
  const [manualEntry, setManualEntry] = useState(false);
  const [maximumBytesBilled, setMaximumBytesBilled] = useState(
    () =>
      provider.sourceFields?.find((field) => field.name === 'maximumBytesBilled')?.defaultValue ??
      '1000000000',
  );
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
  const tableChosen = Boolean(
    selection.project && selection.dataset && selection.table && selection.location,
  );

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
        location: dataSourceLocationSchema.parse({
          ...provider.sourceDefaults,
          ...selection,
          maximumBytesBilled,
        }),
      });
      onRegistered(registered);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <FieldGroup>
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
        <Field orientation="horizontal" className="max-w-md">
          <FieldLabel htmlFor="manual-source">Enter source manually</FieldLabel>
          <Switch
            id="manual-source"
            checked={manualEntry}
            onCheckedChange={setManualEntry}
            disabled={!accountReady || submitting}
          />
        </Field>
        {manualEntry ? (
          <FieldGroup className="grid grid-cols-1 sm:grid-cols-2">
            {manualSourceFields.map((field) => (
              <Field key={field.name}>
                <FieldLabel htmlFor={`source-${field.name}`}>{field.label}</FieldLabel>
                <Input
                  id={`source-${field.name}`}
                  value={selection[field.name]}
                  required
                  disabled={!accountReady || submitting}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) =>
                    chooseTable({ ...selection, [field.name]: event.target.value })
                  }
                />
              </Field>
            ))}
          </FieldGroup>
        ) : (
          <BigQueryExplorer
            key={authorizationId}
            connectionId={authorizationId}
            value={selection}
            onChange={chooseTable}
            disabled={submitting}
          />
        )}
        <Field className="max-w-md">
          <FieldLabel htmlFor="maximum-bytes-billed">Maximum bytes billed per query</FieldLabel>
          <Input
            id="maximum-bytes-billed"
            type="number"
            min="1"
            max="9999999999999"
            step="1"
            value={maximumBytesBilled}
            required
            disabled={!accountReady || submitting}
            onChange={(event) => setMaximumBytesBilled(event.target.value)}
          />
          <FieldDescription>Per-query limit in bytes. Default: 1 GB.</FieldDescription>
        </Field>
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
        <Button
          type="submit"
          className="w-fit"
          disabled={submitting || !accountReady || !tableChosen || !name}
        >
          {submitting ? 'Connecting...' : 'Connect datasource'}
        </Button>
      </FieldGroup>
    </form>
  );
}
