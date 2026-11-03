import { MIN_CANVAS_ROWS, type LayoutValidation, type PlacementCheck } from '#/domain/layout';
import type { DashboardWidget } from '#/domain/schema';
import { widgetLabel, widgetLabels } from '#/domain/widget-label';

/**
 * Turns a rejected placement into copy that names the offending widget. Callers pass the label of
 * the widget being moved, because a rejected placement has no widget of its own yet.
 */
export function placementMessage(
  check: Extract<PlacementCheck, { ok: false }>,
  movedLabel: string,
) {
  return `${quote(movedLabel)} runs past the ${check.columns}-column grid (x ${check.placement.x} + width ${check.placement.width}).`;
}

/** Turns a rejected whole-layout write into copy that names the widgets responsible. */
export function layoutMessage(
  validation: Extract<LayoutValidation, { ok: false }>,
  widgets: DashboardWidget[],
) {
  switch (validation.reason) {
    case 'duplicate':
      return `The layout places ${nameList(widgets, validation.widgetIds)} more than once. Every widget needs exactly one placement.`;
    case 'unknown':
      return `The layout places ${nameList(widgets, validation.widgetIds)}, which ${validation.widgetIds.length === 1 ? 'is' : 'are'} not on this dashboard. Reload the dashboard and retry.`;
    case 'missing':
      return `The layout is missing a placement for ${nameList(widgets, validation.widgetIds)}.`;
    case 'out-of-grid':
      return placementMessage(
        {
          ok: false,
          reason: 'out-of-grid',
          placement: validation.placement,
          columns: validation.columns,
        },
        widgetLabel(validation.widget),
      );
  }
}

/** Explains a canvas that is too short by naming the widget that reaches furthest down. */
export function canvasRowsMessage(widgets: DashboardWidget[], canvasRows: number) {
  const lowest = widgets.reduce((current, widget) =>
    widget.layout.y + widget.layout.height > current.layout.y + current.layout.height
      ? widget
      : current,
  );
  const bottom = lowest.layout.y + lowest.layout.height;
  return `The canvas is ${canvasRows} rows tall but ${quote(widgetLabel(lowest))} reaches row ${bottom}. It needs at least ${Math.max(bottom, MIN_CANVAS_ROWS)} rows.`;
}

function quote(label: string) {
  return `"${label}"`;
}

function nameList(widgets: DashboardWidget[], ids: string[]) {
  const labels = widgetLabels(widgets, ids).map(quote);
  if (labels.length <= 2) return labels.join(' and ');
  return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
}
