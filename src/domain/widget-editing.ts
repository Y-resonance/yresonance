import type { ComboMetric, ControlState, WidgetDefinition } from '#/domain/schema';

export type WidgetFilter = NonNullable<Extract<WidgetDefinition, { type: 'scorecard' }>['filter']>;
type FilterCondition = WidgetFilter['conditions'][number];

export function patchFilterCondition(
  filter: WidgetFilter,
  index: number,
  patch: Partial<FilterCondition>,
): WidgetFilter {
  return {
    ...filter,
    conditions: filter.conditions.map((condition, itemIndex) =>
      itemIndex === index ? { ...condition, ...patch } : condition,
    ),
  };
}

export function clearControlValue(state: ControlState, controlId: string): ControlState {
  return {
    ...state,
    values: { ...state.values, [controlId]: [] },
  };
}

export function filterInputValue(value: unknown, list: boolean) {
  if (list && Array.isArray(value)) return value.map(String).join(', ');
  return value == null ? '' : String(value);
}

export function filterValueFromInput(value: string, list: boolean) {
  return list
    ? value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : value;
}

// Picks the axis for a combo metric of this data type. An edited metric keeps its current axis
// while that still fits; otherwise the metric joins the axis already showing its unit, then an empty
// axis. When neither exists the result keeps the conflict, which validation reports.
export function comboAxisFor(
  metrics: ComboMetric[],
  dataType: ComboMetric['dataType'],
  current?: ComboMetric['axis'],
): ComboMetric['axis'] {
  const onAxis = (axis: ComboMetric['axis']) => metrics.filter((metric) => metric.axis === axis);
  const fits = (axis: ComboMetric['axis']) =>
    onAxis(axis).every((metric) => metric.dataType === dataType);
  if (current && fits(current)) return current;
  return (
    (['left', 'right'] as const).find((axis) => onAxis(axis).length && fits(axis)) ??
    (['right', 'left'] as const).find(fits) ??
    current ??
    'right'
  );
}
