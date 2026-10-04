import type { ApiRequest } from '#/api/contracts';
import type { ControlState, DashboardWidget, DrillPath } from '#/domain/schema';

export function widgetQueryRequest({
  dashboardId,
  widget,
  controlState,
  drillPath,
  preview,
  shareToken,
  page,
}: {
  dashboardId: string;
  widget: DashboardWidget;
  controlState: ControlState;
  drillPath?: DrillPath;
  preview: boolean;
  shareToken?: string;
  page?: number;
}): Extract<ApiRequest, { action: 'previewWidget' | 'queryWidget' }> {
  return preview
    ? {
        action: 'previewWidget',
        dashboardId,
        definition: widget.definition,
        width: widget.layout.width,
        controlState,
        drillPath,
      }
    : {
        action: 'queryWidget',
        dashboardId,
        widgetId: widget.id,
        shareToken,
        controlState,
        drillPath,
        page,
      };
}
