import { useMutation } from '@tanstack/react-query';
import { DatasourceCacheFields } from './datasource-cache-fields';
import type { DatasourceCachePolicy } from '#/domain/schema';
import { Toggle } from '@base-ui/react/toggle';
import { ToggleGroup } from '@base-ui/react/toggle-group';
import { CheckIcon } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiClientError } from '#/api/client';
import { useApi, useR2Objects } from '#/api/query';
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert';
import { Button } from '#/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '#/components/ui/field';
import { Input } from '#/components/ui/input';
import { NativeSelect, NativeSelectOption } from '#/components/ui/native-select';
import { Progress, ProgressLabel, ProgressValue } from '#/components/ui/progress';
import { Switch } from '#/components/ui/switch';
import {
  datasourceNameFromFileName,
  datasourceUploadFormat,
  MAX_DATASOURCE_FILE_BYTES,
  type DatasourceUploadEvent,
  type DatasourceUploadFormat,
} from '#/domain/datasource-upload';

interface RegisteredDatasource {
  id: string;
  name: string;
}

const analyticsBackends = [
  { id: 'duckdb', name: 'DuckDB', description: 'CSV and Parquet files' },
  { id: 'clickhouse', name: 'ClickHouse', description: 'Uploads and external tables' },
] as const;

export function DatasourceRegisterForm({
  onRegistered,
}: {
  onRegistered: (dataSource: RegisteredDatasource) => void;
}) {
  const callApi = useApi();
  const [backend, setBackend] = useState<'duckdb' | 'clickhouse'>('duckdb');
  const [database, setDatabase] = useState('');
  const [table, setTable] = useState('');
  const [cachePolicy, setCachePolicy] = useState<DatasourceCachePolicy>({ mode: 'default' });
  const [useExistingData, setUseExistingData] = useState(false);
  const objectsQuery = useR2Objects(useExistingData && backend !== 'clickhouse');
  const objects = objectsQuery.data?.pages.flatMap((page) => page.objects) ?? [];
  const objectsCursor = objectsQuery.hasNextPage;
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [kind, setKind] = useState<'object' | 'prefix'>('object');
  const [format, setFormat] = useState<DatasourceUploadFormat>('csv');
  const [file, setFile] = useState<File>();
  const [fileError, setFileError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<
    'idle' | 'preparing' | 'uploading' | 'registering' | 'inspecting' | 'removing'
  >('idle');
  const [uploadedKey, setUploadedKey] = useState<string>();
  const [cleanupToken, setCleanupToken] = useState<string>();
  const [registrationFailure, setRegistrationFailure] = useState<'inspection' | 'other'>();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const uploadRequest = useRef<XMLHttpRequest | undefined>(undefined);
  const uploadStartedAt = useRef(0);
  useEffect(() => {
    if (!key && objects[0]) setKey(objects[0].key);
  }, [key, objects]);

  const uploadMutation = useMutation({
    mutationFn: ({ file, uploadUrl }: { file: File; uploadUrl: string }) =>
      uploadDatasourceFile(file, uploadUrl, setProgress, (request) => {
        uploadRequest.current = request;
      }),
    retry: false,
    gcTime: 0,
  });
  useEffect(() => () => uploadRequest.current?.abort(), []);
  const inferredExistingFormat = kind === 'object' ? datasourceUploadFormat(key) : undefined;
  async function loadMoreObjects() {
    await objectsQuery.fetchNextPage();
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(undefined);
    setMessage(undefined);
    setRegistrationFailure(undefined);
    if (useExistingData) {
      setPhase('registering');
      try {
        const registered = await callApi<RegisteredDatasource>({
          action: 'registerDatasource',
          cachePolicy,
          name,
          backend,
          location:
            backend === 'clickhouse'
              ? { kind: 'clickhouse', database, table, ownership: 'external', cacheTtlSeconds: 300 }
              : { kind, key, format: inferredExistingFormat ?? format },
        });
        onRegistered(registered);
      } catch (caught) {
        setFormError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setPhase('idle');
      }
      return;
    }
    if (!file) {
      setFileError('Choose a CSV or Parquet file.');
      return;
    }
    const uploadFormat = datasourceUploadFormat(file.name);
    const validationError = validateFile(file, uploadFormat);
    if (!uploadFormat || validationError) {
      setFileError(validationError ?? 'Choose a CSV or Parquet file.');
      return;
    }

    uploadStartedAt.current = Date.now();
    setProgress(0);
    trackUpload(callApi, 'started', file, uploadFormat, 0);
    setPhase('preparing');
    let prepared: { key: string; uploadUrl: string; cleanupToken: string };
    try {
      prepared = await callApi<{ key: string; uploadUrl: string; cleanupToken: string }>({
        action: 'prepareDatasourceUpload',
        fileName: file.name,
        fileSize: file.size,
        format: uploadFormat,
      });
      setPhase('uploading');
      await uploadMutation.mutateAsync({ file, uploadUrl: prepared.uploadUrl });
      setUploadedKey(prepared.key);
      setCleanupToken(prepared.cleanupToken);
      setPhase('inspecting');
      trackUpload(callApi, 'completed', file, uploadFormat, Date.now() - uploadStartedAt.current);
    } catch (caught) {
      setPhase('idle');
      setProgress(0);
      uploadRequest.current = undefined;
      const cancelled = caught instanceof UploadCancelledError;
      trackUpload(
        callApi,
        cancelled ? 'cancelled' : 'failed',
        file,
        uploadFormat,
        Date.now() - uploadStartedAt.current,
      );
      setFormError(
        cancelled
          ? 'Upload cancelled. Start again when you are ready.'
          : caught instanceof Error
            ? caught.message
            : String(caught),
      );
      return;
    }

    try {
      const registered = await callApi<RegisteredDatasource>({
        action: 'registerDatasource',
        cachePolicy,
        name,
        backend,
        location: { kind: 'object', key: prepared.key, format: uploadFormat },
        cleanupToken: prepared.cleanupToken,
      });
      trackUpload(
        callApi,
        'datasource_registered',
        file,
        uploadFormat,
        Date.now() - uploadStartedAt.current,
      );
      setFile(undefined);
      if (fileInput.current) fileInput.current.value = '';
      setUploadedKey(undefined);
      setCleanupToken(undefined);
      setRegistrationFailure(undefined);
      setProgress(0);
      setPhase('idle');
      onRegistered(registered);
    } catch (caught) {
      setPhase('idle');
      const inspectionFailed =
        caught instanceof ApiClientError && caught.code === 'datasource_inspection_failed';
      setRegistrationFailure(inspectionFailed ? 'inspection' : 'other');
      if (inspectionFailed)
        trackUpload(
          callApi,
          'inspection_failed',
          file,
          uploadFormat,
          Date.now() - uploadStartedAt.current,
        );
      setFormError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  function selectFile(selectedFile?: File) {
    setMessage(undefined);
    setFormError(undefined);
    setRegistrationFailure(undefined);
    setFileError(undefined);
    if (!selectedFile) {
      setFile(undefined);
      if (fileInput.current) fileInput.current.value = '';
      return;
    }
    const selectedFormat = datasourceUploadFormat(selectedFile.name);
    const validationError = validateFile(selectedFile, selectedFormat);
    if (!selectedFormat || validationError) {
      setFile(undefined);
      if (fileInput.current) fileInput.current.value = '';
      setFileError(validationError ?? 'Choose a CSV or Parquet file.');
      return;
    }
    setFile(selectedFile);
    setName(datasourceNameFromFileName(selectedFile.name));
  }

  async function removeFile() {
    if (!uploadedKey || !cleanupToken || !file) return;
    const uploadFormat = datasourceUploadFormat(file.name);
    if (!uploadFormat) return;
    setPhase('removing');
    try {
      await callApi({ action: 'removeDatasourceUpload', key: uploadedKey, cleanupToken });
      trackUpload(
        callApi,
        'file_removed',
        file,
        uploadFormat,
        Date.now() - uploadStartedAt.current,
      );
      setFile(undefined);
      if (fileInput.current) fileInput.current.value = '';
      setUploadedKey(undefined);
      setCleanupToken(undefined);
      setRegistrationFailure(undefined);
      setProgress(0);
      setFormError(undefined);
      setMessage('File removed.');
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPhase('idle');
    }
  }

  const busy = phase !== 'idle';
  return (
    <form className="max-w-xl" onSubmit={submit}>
      <FieldGroup>
        <Field>
          <FieldLabel id="source-backend-label">Analytics backend</FieldLabel>
          <ToggleGroup
            aria-labelledby="source-backend-label"
            value={[backend]}
            disabled={busy || Boolean(uploadedKey)}
            onValueChange={([selected]) => {
              if (selected) setBackend(selected);
            }}
            className="grid grid-cols-2 gap-3"
          >
            {analyticsBackends.map((option) => (
              <Toggle
                key={option.id}
                value={option.id}
                aria-label={option.name}
                className="group relative flex min-h-40 flex-col items-start gap-3 rounded-lg border border-input bg-background p-4 text-left transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-pressed:border-primary data-pressed:ring-1 data-pressed:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                <img src={`/analytics-backends/${option.id}.svg`} alt="" className="size-10" />
                <CheckIcon
                  aria-hidden="true"
                  className="absolute top-3 right-3 size-4 text-primary opacity-0 group-data-pressed:opacity-100"
                />
                <span className="flex flex-col gap-1">
                  <span className="font-medium">{option.name}</span>
                  <span className="text-sm text-muted-foreground">{option.description}</span>
                </span>
              </Toggle>
            ))}
          </ToggleGroup>
        </Field>
        <Field orientation="horizontal">
          <FieldLabel htmlFor="use-existing-data">Use existing workspace data</FieldLabel>
          <Switch
            id="use-existing-data"
            checked={useExistingData}
            onCheckedChange={setUseExistingData}
            disabled={busy || Boolean(uploadedKey)}
          />
        </Field>
        {!useExistingData ? (
          <Field data-invalid={Boolean(fileError)}>
            <FieldLabel htmlFor="source-file">File</FieldLabel>
            <Input
              id="source-file"
              ref={fileInput}
              type="file"
              accept=".csv,.parquet,text/csv,application/vnd.apache.parquet"
              aria-invalid={Boolean(fileError)}
              disabled={busy || Boolean(uploadedKey)}
              onChange={(event) => selectFile(event.target.files?.[0])}
            />
            <FieldDescription>CSV or Parquet, maximum 100 MB</FieldDescription>
            <FieldError>{fileError}</FieldError>
          </Field>
        ) : null}
        <Field>
          <FieldLabel htmlFor="source-name">Name</FieldLabel>
          <Input
            id="source-name"
            value={name}
            required
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        {useExistingData && backend === 'clickhouse' ? (
          <>
            <Field>
              <FieldLabel htmlFor="source-database">Database</FieldLabel>
              <Input
                id="source-database"
                value={database}
                required
                disabled={busy}
                onChange={(event) => setDatabase(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="source-table">Table</FieldLabel>
              <Input
                id="source-table"
                value={table}
                required
                disabled={busy}
                onChange={(event) => setTable(event.target.value)}
              />
              <FieldDescription>
                External tables must be authorized for this workspace.
              </FieldDescription>
            </Field>
          </>
        ) : useExistingData ? (
          <>
            <Field>
              <FieldLabel htmlFor="source-key">R2 key or prefix</FieldLabel>
              <Input
                id="source-key"
                list="workspace-objects"
                value={key}
                required
                onChange={(event) => setKey(event.target.value)}
              />
              <datalist id="workspace-objects">
                {objects.map((object) => (
                  <option key={object.key} value={object.key} />
                ))}
              </datalist>
              {objectsCursor ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void loadMoreObjects()}
                >
                  Load more objects
                </Button>
              ) : null}
            </Field>
            <Field>
              <FieldLabel htmlFor="source-kind">Location</FieldLabel>
              <NativeSelect
                id="source-kind"
                value={kind}
                onChange={(event) => setKind(event.target.value as typeof kind)}
              >
                <NativeSelectOption value="object">Single object</NativeSelectOption>
                <NativeSelectOption value="prefix">Partition prefix</NativeSelectOption>
              </NativeSelect>
            </Field>
            {!inferredExistingFormat ? (
              <Field>
                <FieldLabel htmlFor="source-format">Format</FieldLabel>
                <NativeSelect
                  id="source-format"
                  value={format}
                  onChange={(event) => setFormat(event.target.value as typeof format)}
                >
                  <NativeSelectOption value="csv">CSV</NativeSelectOption>
                  <NativeSelectOption value="parquet">Parquet</NativeSelectOption>
                </NativeSelect>
              </Field>
            ) : null}
          </>
        ) : null}
        <DatasourceCacheFields
          policy={cachePolicy}
          onChange={setCachePolicy}
          disabled={busy}
          defaultTtlSeconds={useExistingData && backend === 'clickhouse' ? 300 : 86_400}
        />
        {phase === 'uploading' ? (
          <Progress value={progress} aria-label="Upload progress">
            <ProgressLabel>Uploading</ProgressLabel>
            <ProgressValue>{(_, value) => `${Math.round(value ?? 0)}%`}</ProgressValue>
          </Progress>
        ) : null}
        {phase === 'preparing' ? (
          <p className="text-sm text-muted-foreground">Preparing upload...</p>
        ) : null}
        {phase === 'registering' ? (
          <p className="text-sm text-muted-foreground">Registering datasource...</p>
        ) : null}
        {phase === 'inspecting' ? (
          <p className="text-sm text-muted-foreground">
            {backend === 'clickhouse'
              ? 'Importing into ClickHouse...'
              : 'Inspecting file with DuckDB...'}
          </p>
        ) : null}
        <div className="flex gap-2">
          <Button type="submit" disabled={busy || Boolean(uploadedKey)}>
            {useExistingData ? 'Register datasource' : 'Upload and register'}
          </Button>
          {phase === 'uploading' ? (
            <Button type="button" variant="outline" onClick={() => uploadRequest.current?.abort()}>
              Cancel upload
            </Button>
          ) : null}
        </div>
        {formError || objectsQuery.error ? (
          <Alert variant="destructive">
            <AlertTitle>
              {uploadedKey
                ? registrationFailure === 'inspection'
                  ? 'File uploaded, inspection failed'
                  : 'File uploaded, registration failed'
                : 'Could not continue'}
            </AlertTitle>
            <AlertDescription>{formError ?? objectsQuery.error?.message}</AlertDescription>
          </Alert>
        ) : null}
        {uploadedKey ? (
          <Button type="button" variant="outline" disabled={busy} onClick={removeFile}>
            Remove file
          </Button>
        ) : null}
        {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
      </FieldGroup>
    </form>
  );
}

function validateFile(file: File, format: DatasourceUploadFormat | undefined) {
  if (!format) return 'Choose a CSV or Parquet file.';
  if (file.size > MAX_DATASOURCE_FILE_BYTES) return 'The file is larger than 100 MB.';
  if (file.size === 0) return 'The file is empty.';
  return undefined;
}

function uploadDatasourceFile(
  file: File,
  uploadUrl: string,
  onProgress: (progress: number) => void,
  onRequest: (request: XMLHttpRequest) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    onRequest(request);
    request.open('PUT', uploadUrl);
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress((event.loaded / event.total) * 100);
    });
    request.addEventListener('load', () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(100);
        resolve();
      } else {
        reject(new Error(`Upload returned HTTP ${request.status}.`));
      }
    });
    request.addEventListener('error', () => reject(new Error('The upload failed. Try again.')));
    request.addEventListener('abort', () => reject(new UploadCancelledError()));
    request.send(file);
  });
}

class UploadCancelledError extends Error {}

function trackUpload(
  callApi: import('#/api/query').ApiExecutor,
  event: DatasourceUploadEvent['event'],
  file: File,
  format: DatasourceUploadFormat,
  durationMs: number,
) {
  void callApi({
    action: 'trackDatasourceUpload',
    event,
    fileSize: file.size,
    format,
    durationMs,
  }).catch(() => undefined);
}
