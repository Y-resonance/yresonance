import { useState } from 'react';
import { CalendarDaysIcon, CheckIcon, RotateCcwIcon } from 'lucide-react';
import { Button } from '#/components/ui/button';
import { Calendar } from '#/components/ui/calendar';
import { NativeSelect, NativeSelectOption } from '#/components/ui/native-select';
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover';
import type { DateRange } from '#/domain/schema';
import { dateRangePresets, resolveDateRange, tryResolveDateRange, yesterday } from '#/domain/dates';
import { isYesterday, sameDateRange } from '#/domain/date-range-search';

type DateValue = DateRange['startDate'];
// `relative` covers preset values such as "7 days ago". They can be shown but not chosen here.
type DateMode = 'fixed' | 'yesterday' | 'relative';

// Picks a preset with one click, or builds a custom range where each side is a fixed date or
// yesterday. A yesterday end keeps "campaign start to yesterday" current without edits. Custom
// edits stay a draft until Apply, so half-finished ranges do not query. Days after yesterday cannot
// be picked because their data is incomplete.
export function DateRangePicker({
  range,
  timezone,
  onChange,
  defaultRange,
}: {
  range: DateRange;
  timezone: string;
  onChange: (range: DateRange) => void;
  defaultRange?: DateRange;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(range);
  const resolved = tryResolveDateRange(range, timezone);
  const draftResolved = tryResolveDateRange(draft, timezone);
  const latest = resolveDateRange({ startDate: yesterday, endDate: yesterday }, timezone).end;
  const activePreset = dateRangePresets.find((preset) => sameDateRange(preset.range, range));
  const isDefault = defaultRange ? sameDateRange(defaultRange, range) : false;
  const reversed = draftResolved ? draftResolved.start > draftResolved.end : false;

  function changeOpen(next: boolean) {
    if (next) setDraft(range);
    setOpen(next);
  }

  function selectPreset(next: DateRange) {
    onChange(next);
    setOpen(false);
  }

  function apply() {
    onChange(draft);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            className="w-full justify-start font-normal"
            aria-label="Choose date range"
          />
        }
      >
        <CalendarDaysIcon data-icon="inline-start" />
        <span className="truncate">
          {activePreset?.label ??
            (resolved
              ? formatRange(resolved, isYesterday(range.endDate))
              : 'Unsupported date range')}
        </span>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="max-h-[calc(100vh-2rem)] w-auto max-w-[calc(100vw-2rem)] overflow-y-auto p-0"
      >
        <div className="flex flex-col md:flex-row">
          <div className="flex min-w-36 flex-col gap-1 p-2">
            {dateRangePresets.map((preset) => (
              <Button
                key={preset.id}
                variant={activePreset?.id === preset.id ? 'secondary' : 'ghost'}
                size="sm"
                className="justify-start"
                onClick={() => selectPreset(preset.range)}
              >
                {activePreset?.id === preset.id ? <CheckIcon data-icon="inline-start" /> : null}
                {preset.label}
              </Button>
            ))}
            {defaultRange && !isDefault ? (
              <Button
                variant="ghost"
                size="sm"
                className="justify-start"
                onClick={() => selectPreset(defaultRange)}
              >
                <RotateCcwIcon data-icon="inline-start" />
                Use default
              </Button>
            ) : null}
          </div>
          <div className="flex flex-col">
            <div className="flex flex-col md:flex-row">
              <DateSide
                label="Start date"
                value={draft.startDate}
                resolved={draftResolved?.start}
                latest={draftResolved && draftResolved.end < latest ? draftResolved.end : latest}
                range={draftResolved}
                onChange={(startDate) => setDraft({ ...draft, startDate })}
              />
              <DateSide
                label="End date"
                value={draft.endDate}
                resolved={draftResolved?.end}
                earliest={draftResolved?.start}
                latest={latest}
                range={draftResolved}
                recommendYesterday
                onChange={(endDate) => setDraft({ ...draft, endDate })}
              />
            </div>
            <div className="flex items-center justify-end gap-2 px-3 pb-3">
              {reversed ? (
                <span className="mr-auto text-sm text-destructive">Start is after end</span>
              ) : null}
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" disabled={!draftResolved || reversed} onClick={apply}>
                Apply
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// One side of a custom range: what kind of date it is, the day it resolves to today, and a month
// calendar when the date is fixed. `earliest` and `latest` bound the pickable days.
function DateSide({
  label,
  value,
  resolved,
  earliest,
  latest,
  range,
  recommendYesterday = false,
  onChange,
}: {
  label: string;
  value: DateValue;
  resolved?: string;
  earliest?: string;
  latest: string;
  range?: { start: string; end: string };
  recommendYesterday?: boolean;
  onChange: (value: DateValue) => void;
}) {
  const mode: DateMode = 'fixed' in value ? 'fixed' : isYesterday(value) ? 'yesterday' : 'relative';
  const selected = resolved ? parseCalendarDate(resolved) : undefined;
  const latestDay = parseCalendarDate(latest);

  return (
    <section aria-label={label} className="flex w-64 flex-col gap-2 p-3">
      <h3 className="text-sm font-medium">{label}</h3>
      <p className="text-sm text-muted-foreground">
        {resolved ? formatDay(resolved) : 'Unsupported date'}
      </p>
      <NativeSelect
        aria-label={`${label} type`}
        className="w-full"
        value={mode}
        onChange={(event) =>
          // Switching to a fixed date pins the day this side shows right now.
          onChange(event.target.value === 'yesterday' ? yesterday : { fixed: resolved ?? latest })
        }
      >
        <NativeSelectOption value="fixed">Fixed date</NativeSelectOption>
        <NativeSelectOption value="yesterday">
          {recommendYesterday ? 'Yesterday (recommended)' : 'Yesterday'}
        </NativeSelectOption>
        {mode === 'relative' ? (
          <NativeSelectOption value="relative" disabled>
            Relative
          </NativeSelectOption>
        ) : null}
      </NativeSelect>
      {mode === 'fixed' ? (
        <Calendar
          mode="single"
          required
          className="p-0"
          defaultMonth={selected}
          selected={selected}
          modifiers={
            range
              ? {
                  range_middle: {
                    after: parseCalendarDate(range.start),
                    before: parseCalendarDate(range.end),
                  },
                }
              : undefined
          }
          disabled={
            earliest
              ? [{ before: parseCalendarDate(earliest) }, { after: latestDay }]
              : { after: latestDay }
          }
          onSelect={(day) => onChange({ fixed: formatCalendarDate(day) })}
        />
      ) : null}
    </section>
  );
}

function parseCalendarDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatCalendarDate(value: Date) {
  const year = String(value.getFullYear()).padStart(4, '0');
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDay(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`));
}

function formatRange(range: { start: string; end: string }, movingEnd: boolean) {
  const formatter = new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
  const format = (value: string) => formatter.format(new Date(`${value}T00:00:00Z`));
  return `${format(range.start)} to ${movingEnd ? 'yesterday' : format(range.end)}`;
}
