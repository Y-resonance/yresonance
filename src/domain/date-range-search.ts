import { dateRangeSchema, type DateRange } from './schema';
import { dateRangePresets, yesterday } from './dates';

// Custom ranges in the URL: `2026-08-01..2026-08-31`, or `2026-08-01..yesterday` for a range that
// keeps ending yesterday.
const customRangePattern = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2}|yesterday)$/u;

export function parseDateRangeSearch(value: unknown): DateRange | undefined {
  if (typeof value !== 'string') return undefined;
  const preset = dateRangePresets.find((item) => item.id === value);
  if (preset) return preset.range;
  const custom = customRangePattern.exec(value);
  if (!custom) return undefined;
  const [, start, end] = custom;
  const parsed = dateRangeSchema.safeParse({
    startDate: { fixed: start },
    endDate: end === 'yesterday' ? yesterday : { fixed: end },
  });
  return parsed.success ? parsed.data : undefined;
}

export function dateRangeSearchValue(range: DateRange) {
  const preset = dateRangePresets.find((item) => sameDateRange(item.range, range));
  if (preset) return preset.id;
  if (!('fixed' in range.startDate)) return undefined;
  if ('fixed' in range.endDate) return `${range.startDate.fixed}..${range.endDate.fixed}`;
  return isYesterday(range.endDate) ? `${range.startDate.fixed}..yesterday` : undefined;
}

export function isYesterday(value: DateRange['startDate']) {
  return sameDateValue(value, yesterday);
}

export function sameDateRange(left: DateRange, right: DateRange) {
  return (
    sameDateValue(left.startDate, right.startDate) && sameDateValue(left.endDate, right.endDate)
  );
}

function sameDateValue(left: DateRange['startDate'], right: DateRange['startDate']) {
  if ('fixed' in left || 'fixed' in right)
    return 'fixed' in left && 'fixed' in right && left.fixed === right.fixed;
  return (
    left.relative.amount === right.relative.amount &&
    left.relative.unit === right.relative.unit &&
    left.relative.direction === right.relative.direction &&
    left.relative.anchor === right.relative.anchor
  );
}
