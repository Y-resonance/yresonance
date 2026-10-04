import { describe, expect, it } from 'vitest';
import {
  controlDefaultValues,
  mergeControlState,
  singleValueControlWithMultipleSelections,
  toggleControlValue,
  withDefaultDateRange,
  withoutWidgetControlState,
} from './control-state';

describe('dashboard control defaults', () => {
  const defaults = {
    dateRange: {
      startDate: {
        relative: {
          amount: 30,
          unit: 'day' as const,
          direction: 'past' as const,
          anchor: 'startOfDay' as const,
        },
      },
      endDate: {
        relative: {
          amount: 0,
          unit: 'day' as const,
          direction: 'past' as const,
          anchor: 'startOfDay' as const,
        },
      },
    },
    values: { region: ['EMEA'], channel: ['search'] },
  };

  it('uses dashboard defaults when WebMCP omits control state', () => {
    expect(mergeControlState(defaults)).toEqual(defaults);
  });

  it('overrides only controls supplied by the caller', () => {
    expect(mergeControlState(defaults, { values: { region: ['APAC'] } })).toEqual({
      ...defaults,
      values: { region: ['APAC'], channel: ['search'] },
    });
  });

  it('fills a missing date range when a date control is added', () => {
    expect(withDefaultDateRange({}, defaults.dateRange)).toEqual({
      dateRange: defaults.dateRange,
    });
  });

  it('preserves a user-selected date range', () => {
    const selected = {
      startDate: { fixed: '2026-02-01' as const },
      endDate: { fixed: '2026-02-28' as const },
    };

    expect(withDefaultDateRange({ dateRange: selected }, defaults.dateRange)).toEqual({
      dateRange: selected,
    });
  });

  it('clears a removed filter control value', () => {
    expect(
      withoutWidgetControlState(
        defaults,
        {
          id: 'region',
          definition: {
            type: 'control',
            dataSourceId: 'source',
            fieldId: 'region',
            allowMultiple: true,
          },
          layout: { x: 0, y: 0, width: 3, height: 1 },
          definitionHash: 'hash',
        },
        false,
      ),
    ).toEqual({ dateRange: defaults.dateRange, values: { channel: ['search'] } });
  });

  it('clears the date range when the last date control is removed', () => {
    expect(
      withoutWidgetControlState(
        defaults,
        {
          id: 'date',
          definition: { type: 'dateControl' },
          layout: { x: 0, y: 0, width: 3, height: 1 },
          definitionHash: 'hash',
        },
        false,
      ),
    ).toEqual({ values: defaults.values });
  });

  it('keeps the date range while another date control remains', () => {
    const widget = {
      id: 'date',
      definition: { type: 'dateControl' as const },
      layout: { x: 0, y: 0, width: 3, height: 1 },
      definitionHash: 'hash',
    };
    expect(withoutWidgetControlState(defaults, widget, true)).toBe(defaults);
  });

  it('detects multiple submitted values for a single-select control', () => {
    const dashboard = {
      pages: [
        {
          hidden: false,
          widgets: [
            {
              id: 'region',
              definition: {
                type: 'control' as const,
                dataSourceId: 'source',
                fieldId: 'region',
                allowMultiple: false,
              },
            },
          ],
        },
      ],
    } as Parameters<typeof singleValueControlWithMultipleSelections>[0];

    expect(
      singleValueControlWithMultipleSelections(dashboard, {
        values: { region: ['EMEA', 'APAC'] },
      }),
    ).toBe('region');
    expect(
      singleValueControlWithMultipleSelections(dashboard, { values: { region: ['EMEA'] } }),
    ).toBeUndefined();
  });

  it('limits persisted single-select defaults to one value', () => {
    const widget = {
      id: 'region',
      definition: {
        type: 'control' as const,
        dataSourceId: 'source',
        fieldId: 'region',
        allowMultiple: false,
        defaultValues: ['EMEA', 'APAC'],
      },
      layout: { x: 0, y: 0, width: 3, height: 1 },
      definitionHash: 'hash',
    };
    expect(controlDefaultValues(widget)).toEqual(['EMEA']);
  });

  it('replaces a single selection and toggles multiple selections', () => {
    expect(toggleControlValue(['EMEA'], 'APAC', false)).toEqual(['APAC']);
    expect(toggleControlValue(['EMEA'], 'APAC', true)).toEqual(['EMEA', 'APAC']);
    expect(toggleControlValue(['EMEA', 'APAC'], 'EMEA', true)).toEqual(['APAC']);
  });
});
