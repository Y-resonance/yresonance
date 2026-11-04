import { useEffect, useRef, useState } from 'react';
import { CheckIcon, UploadIcon } from 'lucide-react';
import { useApiQuery } from '#/api/query';
import { uploadFile, UploadCancelledError } from '#/api/upload';
import { browserAnalytics } from '#/analytics/browser';
import {
  imageContentTypes,
  imageUploadRejection,
  MAX_IMAGE_UPLOAD_BYTES,
  formatMegabytes,
  type ImageAsset,
} from '#/domain/image-assets';
import type { WidgetDefinition } from '#/domain/schema';
import { Alert, AlertDescription } from '#/components/ui/alert';
import { Field, FieldDescription, FieldError, FieldLabel } from '#/components/ui/field';
import { Input } from '#/components/ui/input';
import { NativeSelect, NativeSelectOption } from '#/components/ui/native-select';
import { Button } from '#/components/ui/button';
import { Progress } from '#/components/ui/progress';
import { cn } from '#/lib/utils';

/**
 * Uploads a new workspace image or picks an existing one for the image widget inspector. The file
 * is checked for SVG, size and type before any byte is sent.
 */
export function ImageAssetPicker({
  dashboardId,
  selectedId,
  onSelect,
}: {
  dashboardId: string;
  selectedId?: string;
  onSelect: (asset: ImageAsset) => void;
}) {
  const assetsQuery = useApiQuery<{ assets: ImageAsset[]; uploadLimitBytes: number }>({
    action: 'listAssets',
    dashboardId,
  });
  const limit = assetsQuery.data?.uploadLimitBytes ?? MAX_IMAGE_UPLOAD_BYTES;
  const [progress, setProgress] = useState<number>();
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const request = useRef<XMLHttpRequest | undefined>(undefined);
  useEffect(() => () => request.current?.abort(), []);
  // Editors keep changing other settings during an upload, which must end with their latest state.
  const latestOnSelect = useRef(onSelect);
  useEffect(() => {
    latestOnSelect.current = onSelect;
  });

  async function upload(file: File) {
    setError(undefined);
    const track = (result: string, reason?: string) =>
      browserAnalytics()?.capture('image_upload', {
        result,
        reason,
        content_type: file.type,
        size_bytes: file.size,
      });
    const rejection = imageUploadRejection(file, limit);
    if (rejection) {
      setError(rejection.message);
      track('rejected', rejection.reason);
      return;
    }
    setProgress(0);
    try {
      const body = await uploadFile(
        file,
        `/api/dashboards/${encodeURIComponent(dashboardId)}/assets?name=${encodeURIComponent(file.name)}`,
        setProgress,
        (current) => {
          request.current = current;
        },
      );
      track('success');
      void assetsQuery.refetch();
      latestOnSelect.current(JSON.parse(body) as ImageAsset);
    } catch (caught) {
      const cancelled = caught instanceof UploadCancelledError;
      track(cancelled ? 'cancelled' : 'failed');
      setError(cancelled ? undefined : caught instanceof Error ? caught.message : String(caught));
    } finally {
      request.current = undefined;
      setProgress(undefined);
      if (input.current) input.current.value = '';
    }
  }

  const assets = assetsQuery.data?.assets ?? [];
  return (
    <div className="flex flex-col gap-2">
      <input
        ref={input}
        type="file"
        className="sr-only"
        aria-label="Image file"
        accept={Object.values(imageContentTypes).join(',')}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      {progress === undefined ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => input.current?.click()}
        >
          <UploadIcon data-icon="inline-start" />
          Upload image
        </Button>
      ) : (
        <div className="flex items-center gap-2">
          <Progress value={progress} aria-label="Upload progress" className="flex-1" />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => request.current?.abort()}
          >
            Cancel
          </Button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        PNG, JPEG, WebP, GIF or AVIF up to {formatMegabytes(limit)}.
      </p>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {assets.length ? (
        <ul aria-label="Workspace images" className="flex max-h-48 flex-col overflow-y-auto">
          {assets.map((asset) => (
            <li key={asset.id}>
              <button
                type="button"
                aria-pressed={asset.id === selectedId}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm hover:bg-accent',
                  asset.id === selectedId && 'bg-accent',
                )}
                onClick={() => onSelect(asset)}
              >
                <span className="min-w-0 flex-1 truncate">{asset.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {asset.width}×{asset.height}
                </span>
                {asset.id === selectedId ? <CheckIcon className="size-4 shrink-0" /> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** The file name doubles as alt text until edited. */
function defaultAlt(asset: ImageAsset) {
  return (
    asset.name
      .replace(/\.[a-z0-9]+$/iu, '')
      .replace(/[-_]+/gu, ' ')
      .trim() || 'Image'
  );
}

type ImageDefinition = Extract<WidgetDefinition, { type: 'image' }>;

/**
 * Inspector fields for an image widget: the image itself, an optional title and, once an image is
 * chosen, alt text, fit and an optional link. Title, alt text and link are drafts until they are
 * valid, so an invalid entry never rides along with the next fit or image change.
 */
export function ImageSettings({
  widgetId,
  dashboardId,
  definition,
  commit,
}: {
  widgetId: string;
  dashboardId: string;
  definition: ImageDefinition;
  commit: (definition: WidgetDefinition) => Promise<void>;
}) {
  const [title, setTitle] = useState(definition.title ?? '');
  const [alt, setAlt] = useState(definition.alt ?? '');
  const [link, setLink] = useState(definition.href ?? '');
  const [linkError, setLinkError] = useState<string>();
  // Separate from the effect below: picking the first image sets the alt text and must not discard
  // a title that is still being typed.
  useEffect(() => setTitle(definition.title ?? ''), [definition.title]);
  useEffect(() => {
    setAlt(definition.alt ?? '');
    setLink(definition.href ?? '');
    setLinkError(undefined);
  }, [definition.alt, definition.href]);
  return (
    <>
      <Field>
        <FieldLabel>Image</FieldLabel>
        <ImageAssetPicker
          dashboardId={dashboardId}
          selectedId={definition.assetId}
          onSelect={(asset) =>
            void commit({
              ...definition,
              assetId: asset.id,
              alt: definition.alt ?? defaultAlt(asset),
            })
          }
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`title-${widgetId}`}>Title</FieldLabel>
        <Input
          id={`title-${widgetId}`}
          placeholder="Optional"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => {
            const next = title.trim() || undefined;
            setTitle(next ?? '');
            if (next !== definition.title) void commit({ ...definition, title: next });
          }}
        />
      </Field>
      {definition.assetId ? (
        <>
          <Field>
            <FieldLabel htmlFor={`alt-${widgetId}`}>Alt text</FieldLabel>
            <Input
              id={`alt-${widgetId}`}
              value={alt}
              onChange={(event) => setAlt(event.target.value)}
              onBlur={() => {
                const next = alt.trim();
                if (!next) setAlt(definition.alt ?? '');
                else if (next !== definition.alt) void commit({ ...definition, alt: next });
              }}
            />
            <FieldDescription>Describes the image for screen readers.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor={`fit-${widgetId}`}>Fit</FieldLabel>
            <NativeSelect
              id={`fit-${widgetId}`}
              value={definition.fit}
              onChange={(event) =>
                void commit({ ...definition, fit: event.target.value as ImageDefinition['fit'] })
              }
            >
              <NativeSelectOption value="contain">Show whole image</NativeSelectOption>
              <NativeSelectOption value="cover">Fill and crop</NativeSelectOption>
            </NativeSelect>
          </Field>
          <Field data-invalid={Boolean(linkError)}>
            <FieldLabel htmlFor={`link-${widgetId}`}>Link</FieldLabel>
            <Input
              id={`link-${widgetId}`}
              type="url"
              placeholder="https://"
              value={link}
              aria-invalid={Boolean(linkError)}
              onChange={(event) => {
                setLinkError(undefined);
                setLink(event.target.value);
              }}
              onBlur={() => {
                const href = link.trim() || undefined;
                if (href && !(URL.canParse(href) && new URL(href).protocol === 'https:')) {
                  setLinkError('Use an https:// link.');
                  return;
                }
                if (href !== definition.href) void commit({ ...definition, href });
              }}
            />
            {linkError ? <FieldError>{linkError}</FieldError> : null}
          </Field>
        </>
      ) : null}
    </>
  );
}
