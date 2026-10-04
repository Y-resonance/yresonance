import { dashboardControlWidgets } from '#/domain/schema';
import type { ControlState, DashboardDocument, DashboardWidget } from './schema';

export function mergeControlState(defaults: ControlState, input?: ControlState): ControlState {
  return {
    ...defaults,
    ...input,
    values: { ...defaults.values, ...input?.values },
  };
}

export function controlDefaultValues(widget: DashboardWidget) {
  if (widget.definition.type !== 'control') return [];
  const values = widget.definition.defaultValues ?? [];
  return widget.definition.allowMultiple ? values : values?.slice(0, 1);
}

export function withDefaultDateRange(
  state: ControlState,
  dateRange: NonNullable<ControlState['dateRange']>,
) {
  return state.dateRange ? state : { ...state, dateRange };
}

export function withoutWidgetControlState(
  state: ControlState,
  widget: DashboardWidget,
  hasRemainingDateControl: boolean,
): ControlState {
  if (widget.definition.type === 'dateControl' && !hasRemainingDateControl) {
    const { dateRange: _removed, ...rest } = state;
    return rest;
  }
  if (widget.definition.type === 'control') {
    const values = { ...state.values };
    delete values[widget.id];
    return { ...state, values: Object.keys(values).length ? values : undefined };
  }
  return state;
}

export function singleValueControlWithMultipleSelections(
  dashboard: DashboardDocument,
  state: ControlState,
) {
  return dashboardControlWidgets(dashboard).find(
    (widget) =>
      widget.definition.type === 'control' &&
      !widget.definition.allowMultiple &&
      (state.values?.[widget.id]?.length ?? 0) > 1,
  )?.id;
}

export function toggleControlValue(selected: string[], value: string, allowMultiple: boolean) {
  if (!allowMultiple) return [value];
  return selected.includes(value)
    ? selected.filter((selectedValue) => selectedValue !== value)
    : [...selected, value];
}

export function reconcileDashboardControls(
  dashboard: DashboardDocument,
  state: ControlState,
): ControlState {
  const widgets = dashboardControlWidgets(dashboard);
  const values = Object.fromEntries(
    widgets.flatMap((widget) =>
      widget.definition.type === 'control'
        ? [[widget.id, state.values?.[widget.id] ?? controlDefaultValues(widget)]]
        : [],
    ),
  );
  return {
    dateRange: widgets.some((widget) => widget.definition.type === 'dateControl')
      ? state.dateRange
      : undefined,
    values: Object.keys(values).length ? values : undefined,
  };
}
