import { describe, expect, it } from 'vitest';
import { dateRangePresets, yesterday } from './dates';
import { dateRangeSearchValue, parseDateRangeSearch } from './date-range-search';

describe('date range search params', () => {
  it('round-trips preset and fixed selections', () => {
    const preset = dateRangePresets.find((item) => item.id === 'last-30-days')!.range;
    expect(parseDateRangeSearch(dateRangeSearchValue(preset))).toEqual(preset);

    const fixed = {
      startDate: { fixed: '2026-08-01' as const },
      endDate: { fixed: '2026-08-31' as const },
    };
    expect(dateRangeSearchValue(fixed)).toBe('2026-08-01..2026-08-31');
    expect(parseDateRangeSearch(dateRangeSearchValue(fixed))).toEqual(fixed);
  });

  it('round-trips a fixed start with a moving end', () => {
    const sinceLaunch = {
      startDate: { fixed: '2026-08-01' },
      endDate: yesterday,
    };
    expect(dateRangeSearchValue(sinceLaunch)).toBe('2026-08-01..yesterday');
    expect(parseDateRangeSearch('2026-08-01..yesterday')).toEqual(sinceLaunch);
  });

  it('ignores malformed and reversed fixed ranges', () => {
    expect(parseDateRangeSearch('custom')).toBeUndefined();
    expect(parseDateRangeSearch('2026-08-31..2026-08-01')).toBeUndefined();
  });
});
