import { describe, expect, it } from 'vitest';
import {
  clearControlValue,
  comboAxisFor,
  filterInputValue,
  filterValueFromInput,
  patchFilterCondition,
  type WidgetFilter,
} from '#/domain/widget-editing';
import { mergeControlState } from '#/domain/control-state';

describe('widget filter editing', () => {
  it('preserves untouched conditions and the connector', () => {
    const filter: WidgetFilter = {
      connector: 'or',
      conditions: [
        { fieldId: 'country', operator: 'equals', value: 'DE' },
        { fieldId: 'spend', operator: 'greaterThan', value: 100 },
      ],
    };

    expect(patchFilterCondition(filter, 0, { value: 'FR' })).toEqual({
      connector: 'or',
      conditions: [
        { fieldId: 'country', operator: 'equals', value: 'FR' },
        { fieldId: 'spend', operator: 'greaterThan', value: 100 },
      ],
    });
  });

  it('clears only the edited control value', () => {
    expect(
      clearControlValue({ values: { country: ['DE'], channel: ['Social'] } }, 'country'),
    ).toEqual({ values: { country: [], channel: ['Social'] } });
  });

  it('overrides a control default with an explicit empty value', () => {
    const cleared = clearControlValue({ values: { country: ['DE'] } }, 'country');

    expect(mergeControlState({ values: { country: ['DE'] } }, cleared)).toEqual({
      values: { country: [] },
    });
  });

  it('round-trips list filter values through the text input', () => {
    const input = filterInputValue(['DE', 'FR'], true);

    expect(input).toBe('DE, FR');
    expect(filterValueFromInput(input, true)).toEqual(['DE', 'FR']);
  });
});

describe('combo axis choice', () => {
  const metric = (dataType: 'currency' | 'percent' | 'number', axis: 'left' | 'right') => ({
    source: { kind: 'library' as const, libraryMetricId: dataType },
    dataType,
    mark: 'line' as const,
    axis,
  });

  it('joins the axis that already shows the unit, otherwise an empty one', () => {
    const spend = metric('currency', 'left');
    expect(comboAxisFor([spend], 'currency')).toBe('left');
    expect(comboAxisFor([spend], 'percent')).toBe('right');
    expect(comboAxisFor([metric('percent', 'right')], 'number')).toBe('left');
  });

  it('keeps an edited metric on its axis while the unit still fits there', () => {
    const ctr = metric('percent', 'right');
    expect(comboAxisFor([metric('currency', 'left')], 'currency', 'right')).toBe('right');
    expect(comboAxisFor([metric('currency', 'left'), ctr], 'currency', 'right')).toBe('left');
    expect(comboAxisFor([metric('currency', 'left'), ctr], 'number', 'right')).toBe('right');
  });
});
