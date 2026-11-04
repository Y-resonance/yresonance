import { useEffect, useState } from 'react';
import { CalendarDaysIcon, CheckIcon, RotateCcwIcon } from 'lucide-react';
import type { DateRange as CalendarRange } from 'react-day-picker';
import { Button } from '#/components/ui/button';
import { Calendar } from '#/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover';
import type { DateRange } from '#/domain/schema';
import { dateRangePresets, tryResolveDateRange } from '#/domain/dates';
import { sameDateRange } from '#/domain/date-range-search';

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
  const resolved = tryResolveDateRange(range, timezone);
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<CalendarRange | undefined>(() =>
    resolved ? calendarRange(resolved) : undefined,
  );
  useEffect(() => {
    setSelection(resolved ? calendarRange(resolved) : undefined);
  }, [resolved?.end, resolved?.start]);
  const activePreset = dateRangePresets.find((preset) => sameDateRange(preset.range, range));
  const isDefault = defaultRange ? sameDateRange(defaultRange, range) : false;

  function select(next: DateRange) {
    onChange(next);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
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
          {activePreset?.label ?? (resolved ? formatRange(resolved) : 'Unsupported date range')}
        </span>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="max-h-(--available-height) w-auto max-w-[calc(100vw-2rem)] overflow-y-auto p-0"
      >
        <div className="flex flex-col md:flex-row">
          <div className="flex min-w-44 flex-col gap-1 p-2">
            {dateRangePresets.map((preset) => (
              <Button
                key={preset.id}
                variant={activePreset?.id === preset.id ? 'secondary' : 'ghost'}
                size="sm"
                className="justify-start"
                onClick={() => select(preset.range)}
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
                onClick={() => select(defaultRange)}
              >
                <RotateCcwIcon data-icon="inline-start" />
                Use default
              </Button>
            ) : null}
          </div>
          <Calendar
            mode="range"
            numberOfMonths={2}
            defaultMonth={selection?.from}
            selected={selection}
            onSelect={(next, selectedDay) => {
              if (selection?.from && selection.to) {
                setSelection({ from: selectedDay });
                return;
              }
              setSelection(next);
              if (!next?.from || !next.to) return;
              select({
                startDate: { fixed: formatCalendarDate(next.from) },
                endDate: { fixed: formatCalendarDate(next.to) },
              });
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function calendarRange(range: { start: string; end: string }): CalendarRange {
  return { from: parseCalendarDate(range.start), to: parseCalendarDate(range.end) };
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

function formatRange(range: { start: string; end: string }) {
  const formatter = new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
  return `${formatter.format(new Date(`${range.start}T00:00:00Z`))} to ${formatter.format(
    new Date(`${range.end}T00:00:00Z`),
  )}`;
}
