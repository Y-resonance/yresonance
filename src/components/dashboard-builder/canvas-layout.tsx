import {
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
  type RefObject,
} from 'react';
import GridLayout, { noCompactor, useContainerWidth, type LayoutItem } from 'react-grid-layout';
import { GridBackground } from 'react-grid-layout/extras';
import { DashboardWidgetView } from '#/components/dashboard-view';
import type { DashboardDocument, ControlState } from '#/domain/schema';
import { isRowEmpty, rowInsertionCuts } from '#/domain/layout';
import { widgetLabel } from '#/domain/widget-label';
import { cn } from '#/lib/utils';
import { GripVerticalIcon, Trash2Icon } from 'lucide-react';
import { catalog } from './catalog';
import type { BuilderType } from './shared';
import { type DashboardWidget } from '#/domain/schema';
import { type Layout } from 'react-grid-layout';
import { Button } from '#/components/ui/button';
import { PlusIcon, MinusIcon } from 'lucide-react';

export function layoutFor(widgets: DashboardWidget[]): Layout {
  return widgets.map((widget) => ({
    i: widget.id,
    x: widget.layout.x,
    y: widget.layout.y,
    w: widget.layout.width,
    h: widget.layout.height,
  }));
}

export function RowInsertionControl({
  cut,
  disabled,
  onInsert,
}: {
  cut: number;
  disabled: boolean;
  onInsert: () => void;
}) {
  const label = cut === 0 ? 'Insert first row' : `Insert row after row ${cut}`;
  return (
    <div
      className="group/row absolute right-2 left-2 z-20 flex h-6 -translate-y-1/2 items-center"
      style={{ top: cut === 0 ? 8 : cut * 64 + 4 }}
    >
      <span className="h-px flex-1 bg-primary opacity-0 transition-none group-hover/row:opacity-100 group-focus-within/row:opacity-100" />
      <Button
        className="opacity-0 transition-none group-hover/row:opacity-100 focus-visible:opacity-100"
        size="icon-xs"
        disabled={disabled}
        aria-label={label}
        onClick={(event) => {
          event.stopPropagation();
          onInsert();
        }}
      >
        <PlusIcon />
      </Button>
      <span className="h-px flex-1 bg-primary opacity-0 transition-none group-hover/row:opacity-100 group-focus-within/row:opacity-100" />
    </div>
  );
}

export function RowRemovalControl({
  row,
  disabled,
  onRemove,
}: {
  row: number;
  disabled: boolean;
  onRemove: () => void;
}) {
  return (
    <Button
      className="absolute right-3 z-30 -translate-y-1/2 opacity-0 transition-none hover:opacity-100 focus-visible:opacity-100"
      style={{ top: row * 64 + 36 }}
      variant="outline"
      size="icon-xs"
      disabled={disabled}
      aria-label={`Remove empty row ${row + 1}`}
      onClick={(event) => {
        event.stopPropagation();
        onRemove();
      }}
    >
      <MinusIcon />
    </Button>
  );
}

export function BuilderCanvas({
  dashboard,
  desktop,
  saving,
  selectedId,
  setSelectedId,
  setMobileOpen,
  setRemoveTarget,
  pendingWidgets,
  controlState,
  setControlState,
  draggedType,
  setCatalogOpen,
  addWidget,
  saveLayout,
  saveRowInsertion,
  saveRowRemoval,
}: {
  dashboard: DashboardDocument;
  desktop: boolean | undefined;
  saving: boolean;
  selectedId: string | undefined;
  setSelectedId: Dispatch<SetStateAction<string | undefined>>;
  setMobileOpen: Dispatch<SetStateAction<boolean>>;
  setRemoveTarget: Dispatch<SetStateAction<DashboardWidget | undefined>>;
  pendingWidgets: Record<string, number>;
  controlState: ControlState;
  setControlState: Dispatch<SetStateAction<ControlState>>;
  draggedType: RefObject<BuilderType | undefined>;
  setCatalogOpen: Dispatch<SetStateAction<boolean>>;
  addWidget: (type: BuilderType, dropped?: LayoutItem) => Promise<void>;
  saveLayout: (next: Layout, requestedCanvasRows?: number) => Promise<void>;
  saveRowInsertion: (cut: number) => void;
  saveRowRemoval: (row: number) => void;
}) {
  const [chartRevision, setChartRevision] = useState(0);
  // Set while the grid is moving or resizing a widget: the click that ends such a gesture
  // lands on the canvas background and must not be read as a deselect.
  const gridGestureRef = useRef(false);
  const { width, containerRef, mounted } = useContainerWidth({ measureBeforeMount: true });
  const layout = useMemo<Layout>(
    () =>
      dashboard.widgets.map((widget) => {
        const control =
          widget.definition.type === 'control' || widget.definition.type === 'dateControl';
        return {
          i: widget.id,
          x: widget.layout.x,
          y: widget.layout.y,
          w: widget.layout.width,
          h: widget.layout.height,
          minW: control ? 4 : 2,
          minH: control ? 1 : 2,
        };
      }),
    [dashboard.widgets],
  );
  const gridRows = dashboard.canvasRows;
  const insertionCuts = rowInsertionCuts(dashboard.widgets, dashboard.canvasRows);
  return (
    <>
      {desktop !== false ? (
        <div
          ref={containerRef}
          className="relative"
          // Matches the height GridBackground draws (56px cells + 8px margins)
          // so the drop area covers the spare rows below the last widget.
          style={{ minHeight: gridRows * 64 + 8 }}
          onPointerDownCapture={() => {
            gridGestureRef.current = false;
          }}
          onClick={() => {
            if (gridGestureRef.current) {
              gridGestureRef.current = false;
              return;
            }
            setSelectedId(undefined);
          }}
        >
          {mounted ? (
            <>
              <GridBackground
                width={width}
                cols={12}
                rowHeight={56}
                margin={[8, 8]}
                rows={gridRows}
                color="color-mix(in srgb, var(--color-muted) 96%, var(--color-foreground) 4%)"
                // Numeric prop, so --radius-xl (0.625rem * 1.4) is inlined here to keep the
                // empty cells on the same radius as the widget cards that land on them.
                borderRadius={14}
              />
              {insertionCuts.map((cut) => (
                <RowInsertionControl
                  key={cut}
                  cut={cut}
                  disabled={saving}
                  onInsert={() => saveRowInsertion(cut)}
                />
              ))}
              {gridRows > 10
                ? Array.from({ length: gridRows }, (_, row) => row)
                    .filter((row) => isRowEmpty(dashboard.widgets, row))
                    .map((row) => (
                      <RowRemovalControl
                        key={row}
                        row={row}
                        disabled={saving}
                        onRemove={() => saveRowRemoval(row)}
                      />
                    ))
                : null}
              <GridLayout
                width={width}
                layout={layout}
                compactor={noCompactor}
                gridConfig={{ cols: 12, rowHeight: 56, margin: [8, 8] }}
                dragConfig={{ enabled: !saving, handle: '.widget-drag-handle', threshold: 8 }}
                resizeConfig={{
                  enabled: !saving,
                  handles: ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'],
                }}
                dropConfig={{ enabled: !saving, defaultItem: { w: 4, h: 3 } }}
                droppingItem={{ i: '__dropping__', x: 0, y: 0, w: 4, h: 3 }}
                onDrop={(next, item) => {
                  const type = draggedType.current;
                  draggedType.current = undefined;
                  setCatalogOpen(false);
                  if (type && item) void addWidget(type, item);
                  else if (next.length === dashboard.widgets.length) void saveLayout(next);
                }}
                onDropDragOver={() => {
                  const entry = catalog.find((item) => item.type === draggedType.current);
                  return entry ? { w: entry.size.width, h: entry.size.height } : false;
                }}
                onDragStart={() => {
                  gridGestureRef.current = true;
                }}
                onResizeStart={() => {
                  gridGestureRef.current = true;
                }}
                onDragStop={(next) => void saveLayout(next)}
                onResizeStop={(next) => {
                  setChartRevision((value) => value + 1);
                  void saveLayout(next);
                }}
              >
                {dashboard.widgets.map((widget) => (
                  <div
                    key={widget.id}
                    data-widget-id={widget.id}
                    className={cn(
                      'group overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-foreground/10 focus-within:ring-2 focus-within:ring-ring',
                      selectedId === widget.id && 'ring-2 ring-primary',
                    )}
                    onClick={(event) => {
                      // Keeps the canvas background click from deselecting again.
                      event.stopPropagation();
                      setSelectedId(widget.id);
                    }}
                  >
                    {/* Pointer users drag it; Enter selects the widget for the settings form. */}
                    <Button
                      className="widget-drag-handle absolute top-2 left-1/2 z-10 -translate-x-1/2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Edit ${widgetLabel(widget)}`}
                      onClick={() => setSelectedId(widget.id)}
                    >
                      <GripVerticalIcon />
                    </Button>
                    <Button
                      className="absolute top-2 right-2 z-10 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${widgetLabel(widget)}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setRemoveTarget(widget);
                      }}
                    >
                      <Trash2Icon />
                    </Button>
                    <div
                      key={`${widget.id}-${chartRevision}`}
                      className="h-full [&>[data-slot=card]]:h-full"
                    >
                      <DashboardWidgetView
                        dashboard={dashboard}
                        widget={widget}
                        preview={Boolean(pendingWidgets[widget.id])}
                        controlState={controlState}
                        setControlState={setControlState}
                      />
                    </div>
                  </div>
                ))}
              </GridLayout>
            </>
          ) : null}
        </div>
      ) : null}
      {desktop === false ? (
        <div className="flex flex-col gap-4">
          {[...dashboard.widgets]
            .sort((left, right) => left.layout.y - right.layout.y || left.layout.x - right.layout.x)
            .map((widget) => (
              <div
                key={widget.id}
                data-widget-id={widget.id}
                className="relative rounded-xl ring-1 ring-foreground/10 focus-within:ring-2 focus-within:ring-ring"
              >
                <div className="absolute top-2 right-2 z-10 flex gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Edit ${widgetLabel(widget)}`}
                    onClick={() => {
                      setSelectedId(widget.id);
                      setMobileOpen(true);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label={`Remove ${widgetLabel(widget)}`}
                    onClick={() => setRemoveTarget(widget)}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
                <DashboardWidgetView
                  dashboard={dashboard}
                  widget={widget}
                  preview={Boolean(pendingWidgets[widget.id])}
                  controlState={controlState}
                  setControlState={setControlState}
                />
              </div>
            ))}
        </div>
      ) : null}
    </>
  );
}
