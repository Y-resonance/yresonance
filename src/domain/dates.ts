import type { DateRange } from './schema';

export interface ResolvedDateRange {
  start: string;
  end: string;
}

const invalidRangeMessage = 'The start date must not be after the end date.';
export const unsupportedDateRangeMessage = 'The date range is outside the supported calendar.';

// Data for the current day is never complete, so yesterday is the latest day a dashboard can query.
// Every range is cut off there when it resolves, and presets end there.
export const yesterday = {
  relative: { amount: 1, unit: 'day', direction: 'past', anchor: 'startOfDay' },
} as const;

const daysAgo = (amount: number) => ({
  relative: {
    amount,
    unit: 'day' as const,
    direction: 'past' as const,
    anchor: 'startOfDay' as const,
  },
});

export const dateRangePresets = [
  { id: 'yesterday', label: 'Yesterday', range: { startDate: yesterday, endDate: yesterday } },
  ...[7, 28, 30, 90].map((days) => ({
    id: `last-${days}-days`,
    label: `Last ${days} days`,
    range: { startDate: daysAgo(days), endDate: yesterday },
  })),
  {
    id: 'this-month',
    label: 'This month',
    range: {
      startDate: {
        relative: { amount: 0, unit: 'month', direction: 'past', anchor: 'startOfMonth' },
      },
      endDate: yesterday,
    },
  },
  {
    id: 'last-month',
    label: 'Last month',
    range: {
      startDate: {
        relative: { amount: 1, unit: 'month', direction: 'past', anchor: 'startOfMonth' },
      },
      endDate: {
        relative: { amount: 1, unit: 'day', direction: 'past', anchor: 'startOfMonth' },
      },
    },
  },
  {
    id: 'this-quarter',
    label: 'This quarter',
    range: {
      startDate: {
        relative: { amount: 0, unit: 'quarter', direction: 'past', anchor: 'startOfQuarter' },
      },
      endDate: yesterday,
    },
  },
  {
    id: 'year-to-date',
    label: 'Year to date',
    range: {
      startDate: {
        relative: { amount: 0, unit: 'year', direction: 'past', anchor: 'startOfYear' },
      },
      endDate: yesterday,
    },
  },
  {
    id: 'last-year',
    label: 'Last year',
    range: {
      startDate: {
        relative: { amount: 1, unit: 'year', direction: 'past', anchor: 'startOfYear' },
      },
      endDate: {
        relative: { amount: 1, unit: 'day', direction: 'past', anchor: 'startOfYear' },
      },
    },
  },
] satisfies Array<{ id: string; label: string; range: DateRange }>;

export const yearToDateRange = dateRangePresets.find(
  (preset) => preset.id === 'year-to-date',
)!.range;

export const lastThirtyDaysRange = dateRangePresets.find(
  (preset) => preset.id === 'last-30-days',
)!.range;

export function resolveDateRange(
  range: DateRange,
  timezone: string,
  now = new Date(),
): ResolvedDateRange {
  const end = resolveDateValue(range.endDate, timezone, now);
  const latest = resolveDateValue(yesterday, timezone, now);
  return {
    start: resolveDateValue(range.startDate, timezone, now),
    end: end > latest ? latest : end,
  };
}

// Ranges saved before the yesterday cutoff ended today. Shift those by one day so "Last 7 days"
// keeps seven days and matches the current presets again.
export function withoutToday(range: DateRange): DateRange {
  const { endDate, startDate } = range;
  const endsToday =
    'relative' in endDate &&
    endDate.relative.amount === 0 &&
    endDate.relative.unit === 'day' &&
    endDate.relative.direction === 'past' &&
    endDate.relative.anchor === 'startOfDay';
  if (!endsToday) return range;
  const startsDaysAgo =
    'relative' in startDate &&
    startDate.relative.unit === 'day' &&
    startDate.relative.direction === 'past' &&
    startDate.relative.anchor === 'startOfDay';
  return {
    startDate: startsDaysAgo ? daysAgo(startDate.relative.amount + 1) : startDate,
    endDate: yesterday,
  };
}

export function tryResolveDateRange(range: DateRange, timezone: string, now = new Date()) {
  try {
    const resolved = resolveDateRange(range, timezone, now);
    return isHtmlDate(resolved.start) && isHtmlDate(resolved.end) ? resolved : undefined;
  } catch (caught) {
    if (caught instanceof RangeError) return undefined;
    throw caught;
  }
}

function isHtmlDate(value: string) {
  return /^(?!0000)\d{4,}-\d{2}-\d{2}$/u.test(value);
}

export function comparisonDateRange(
  range: DateRange,
  mode: 'previousPeriod' | 'previousYear',
  timezone: string,
  now = new Date(),
): DateRange {
  const resolved = resolveDateRange(range, timezone, now);
  const start = parseDate(resolved.start);
  const end = parseDate(resolved.end);
  if (mode === 'previousYear') {
    start.setTime(shiftMonths(start, -12).getTime());
    end.setTime(shiftMonths(end, -12).getTime());
  } else {
    const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
    end.setUTCDate(start.getUTCDate() - 1);
    start.setTime(end.getTime());
    start.setUTCDate(start.getUTCDate() - days + 1);
  }
  return {
    startDate: { fixed: formatDate(start) },
    endDate: { fixed: formatDate(end) },
  };
}

function resolveDateValue(value: DateRange['startDate'], timezone: string, now: Date) {
  if ('fixed' in value) return value.fixed;
  const parts = dateParts(now, timezone);
  let resolved = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (value.relative.anchor === 'startOfWeek') {
    const day = resolved.getUTCDay() || 7;
    resolved.setUTCDate(resolved.getUTCDate() - day + 1);
  } else if (value.relative.anchor === 'startOfMonth') {
    resolved.setUTCDate(1);
  } else if (value.relative.anchor === 'startOfQuarter') {
    resolved.setUTCMonth(Math.floor(resolved.getUTCMonth() / 3) * 3, 1);
  } else if (value.relative.anchor === 'startOfYear') {
    resolved.setUTCMonth(0, 1);
  }
  const direction = value.relative.direction === 'past' ? -1 : 1;
  const amount = value.relative.amount * direction;
  switch (value.relative.unit) {
    case 'day':
      resolved.setUTCDate(resolved.getUTCDate() + amount);
      break;
    case 'week':
      resolved.setUTCDate(resolved.getUTCDate() + amount * 7);
      break;
    case 'month':
      resolved = shiftMonths(resolved, amount);
      break;
    case 'quarter':
      resolved = shiftMonths(resolved, amount * 3);
      break;
    case 'year':
      resolved = shiftMonths(resolved, amount * 12);
      break;
  }
  return resolved.toISOString().slice(0, 10);
}

export function updateDateRangeBoundary(
  range: DateRange,
  timezone: string,
  boundary: 'start' | 'end',
  value: string,
): { range?: DateRange; error?: string } {
  if (!value) return {};
  const resolved = tryResolveDateRange(range, timezone);
  if (!resolved) return { error: unsupportedDateRangeMessage };
  const next = {
    startDate: { fixed: boundary === 'start' ? value : resolved.start },
    endDate: { fixed: boundary === 'end' ? value : resolved.end },
  } satisfies DateRange;
  if (next.startDate.fixed > next.endDate.fixed) return { error: invalidRangeMessage };
  return { range: next };
}

export function dateRangeOrderError(range: DateRange, timezone: string) {
  const resolved = tryResolveDateRange(range, timezone);
  if (!resolved) return unsupportedDateRangeMessage;
  return resolved.start > resolved.end ? invalidRangeMessage : undefined;
}

function shiftMonths(date: Date, amount: number) {
  const target = utcDate(date.getUTCFullYear(), date.getUTCMonth() + amount, 1);
  const lastDay = utcDate(target.getUTCFullYear(), target.getUTCMonth() + 1, 0).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return target;
}

function utcDate(year: number, month: number, day: number) {
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month, day);
  return date;
}

function parseDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function formatDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function dateParts(date: Date, timezone: string) {
  const values = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(values.find((item) => item.type === type)?.value);
  return { year: part('year'), month: part('month'), day: part('day') };
}
