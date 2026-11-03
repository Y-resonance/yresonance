import type { DashboardWidget } from '#/domain/schema';

/**
 * Human-readable name for a widget, used wherever a widget has to be pointed at in copy: builder
 * controls, remove confirmations, and layout error messages returned by the API.
 */
export function widgetLabel(widget: DashboardWidget) {
  if ('title' in widget.definition) return widget.definition.title;
  if (widget.definition.type === 'control') return widget.definition.userDefinedName ?? 'Filter';
  if (widget.definition.type === 'dateControl') return 'Date range';
  if (widget.definition.type === 'image') return widget.definition.alt;
  return 'Text';
}

/** Names widgets by id, falling back to the id itself when the widget is no longer on the dashboard. */
export function widgetLabels(widgets: DashboardWidget[], ids: string[]) {
  return ids.map((id) => {
    const widget = widgets.find((item) => item.id === id);
    return widget ? widgetLabel(widget) : id;
  });
}
