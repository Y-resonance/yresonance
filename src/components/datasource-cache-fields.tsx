import { useId, useState } from 'react';
import type { DatasourceCachePolicy } from '#/domain/schema';
import { Field, FieldDescription, FieldLabel } from './ui/field';
import { Input } from './ui/input';
import { NativeSelect, NativeSelectOption } from './ui/native-select';

export function DatasourceCacheFields({
  policy,
  onChange,
  disabled,
  defaultTtlSeconds = 86_400,
}: {
  policy: DatasourceCachePolicy;
  onChange: (policy: DatasourceCachePolicy) => void;
  disabled?: boolean;
  defaultTtlSeconds?: number;
}) {
  const id = useId();
  const presets = [60, 300, 900, 3600, 86400];
  const duration = policy.mode === 'duration' ? policy.ttlSeconds : 300;
  const [custom, setCustom] = useState(!presets.includes(duration));
  return (
    <div className="flex flex-wrap items-start gap-4">
      <Field className="w-full sm:w-48">
        <FieldLabel htmlFor={`${id}-mode`}>Query caching</FieldLabel>
        <NativeSelect
          id={`${id}-mode`}
          value={policy.mode}
          disabled={disabled}
          onChange={(event) =>
            onChange(
              event.target.value === 'duration'
                ? { mode: 'duration', ttlSeconds: 300 }
                : { mode: event.target.value === 'disabled' ? 'disabled' : 'default' },
            )
          }
        >
          <NativeSelectOption value="default">
            Default (
            {defaultTtlSeconds < 3600
              ? `${defaultTtlSeconds / 60} minutes`
              : `${defaultTtlSeconds / 3600} hours`}
            )
          </NativeSelectOption>
          <NativeSelectOption value="duration">Cache for…</NativeSelectOption>
          <NativeSelectOption value="disabled">Disabled</NativeSelectOption>
        </NativeSelect>
        <FieldDescription>
          {policy.mode === 'disabled'
            ? 'Run every requested query.'
            : 'Expiry runs a new query on the next request.'}
        </FieldDescription>
      </Field>
      {policy.mode === 'duration' ? (
        <>
          <Field className="w-full sm:w-48">
            <FieldLabel htmlFor={`${id}-duration`}>Reuse query results for</FieldLabel>
            <NativeSelect
              id={`${id}-duration`}
              disabled={disabled}
              value={custom ? 'custom' : String(duration)}
              onChange={(event) => {
                setCustom(event.target.value === 'custom');
                onChange({
                  mode: 'duration',
                  ttlSeconds:
                    event.target.value === 'custom' ? duration : Number(event.target.value),
                });
              }}
            >
              <NativeSelectOption value="60">1 minute</NativeSelectOption>
              <NativeSelectOption value="300">5 minutes</NativeSelectOption>
              <NativeSelectOption value="900">15 minutes</NativeSelectOption>
              <NativeSelectOption value="3600">1 hour</NativeSelectOption>
              <NativeSelectOption value="86400">24 hours</NativeSelectOption>
              <NativeSelectOption value="custom">Custom</NativeSelectOption>
            </NativeSelect>
          </Field>
          {custom ? (
            <Field className="w-full sm:w-40">
              <FieldLabel htmlFor={`${id}-minutes`}>Minutes</FieldLabel>
              <Input
                id={`${id}-minutes`}
                type="number"
                min={1 / 60}
                max={1440}
                step="any"
                required
                disabled={disabled}
                value={duration / 60}
                onChange={(event) =>
                  onChange({
                    mode: 'duration',
                    ttlSeconds: Math.round(Number(event.target.value) * 60),
                  })
                }
              />
            </Field>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
