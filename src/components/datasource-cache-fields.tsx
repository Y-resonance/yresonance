import { useId, useState } from 'react';
import type { DatasourceCachePolicy } from '#/domain/schema';
import { Field, FieldDescription, FieldLabel } from './ui/field';
import { Input } from './ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';

export function DatasourceCacheFields({
  policy,
  onChange,
  disabled,
  hideLabel = false,
  defaultTtlSeconds = 86_400,
}: {
  policy: DatasourceCachePolicy;
  onChange: (policy: DatasourceCachePolicy) => void;
  disabled?: boolean;
  hideLabel?: boolean;
  defaultTtlSeconds?: number;
}) {
  const id = useId();
  const presets = [60, 300, 900, 3600, 86400];
  const duration = policy.mode === 'duration' ? policy.ttlSeconds : 300;
  const [custom, setCustom] = useState(!presets.includes(duration));
  const modes = [
    {
      value: 'default',
      label: `Default (${defaultTtlSeconds < 3600 ? `${defaultTtlSeconds / 60} minutes` : `${defaultTtlSeconds / 3600} hours`})`,
    },
    { value: 'duration', label: 'Cache for…' },
    { value: 'disabled', label: 'Disabled' },
  ];
  const durations = [
    { value: '60', label: '1 minute' },
    { value: '300', label: '5 minutes' },
    { value: '900', label: '15 minutes' },
    { value: '3600', label: '1 hour' },
    { value: '86400', label: '24 hours' },
    { value: 'custom', label: 'Custom' },
  ];
  return (
    <div className="flex flex-wrap items-start gap-4">
      <Field className="w-full sm:w-48">
        <FieldLabel htmlFor={`${id}-mode`} className={hideLabel ? 'sr-only' : undefined}>
          Query caching
        </FieldLabel>
        <Select
          items={modes}
          value={policy.mode}
          disabled={disabled}
          onValueChange={(value) => {
            if (value === null) return;
            onChange(
              value === 'duration'
                ? { mode: 'duration', ttlSeconds: 300 }
                : { mode: value === 'disabled' ? 'disabled' : 'default' },
            );
          }}
        >
          <SelectTrigger id={`${id}-mode`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {modes.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
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
            <Select
              items={durations}
              disabled={disabled}
              value={custom ? 'custom' : String(duration)}
              onValueChange={(value) => {
                if (value === null) return;
                setCustom(value === 'custom');
                onChange({
                  mode: 'duration',
                  ttlSeconds: value === 'custom' ? duration : Number(value),
                });
              }}
            >
              <SelectTrigger id={`${id}-duration`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {durations.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
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
