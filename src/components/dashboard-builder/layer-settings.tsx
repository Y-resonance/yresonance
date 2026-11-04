import { Button } from '#/components/ui/button';
import { FieldLegend, FieldSet } from '#/components/ui/field';
import { placementsOverlap, type WidgetStacking } from '#/domain/layout';
import type { DashboardWidget } from '#/domain/schema';
import { widgetLabel } from '#/domain/widget-label';
import { cn } from '#/lib/utils';
import { BringToFrontIcon, SendToBackIcon } from 'lucide-react';

/**
 * Stacking controls for the selected widget. Shown only when it overlaps other widgets: lists that
 * stack top first so a covered widget can still be selected, and moves the selection to the front
 * or back of the page's paint order.
 */
export function LayerSettings({
  widgets,
  selected,
  onSelect,
  onRestack,
}: {
  widgets: DashboardWidget[];
  selected: DashboardWidget;
  onSelect: (widgetId: string) => void;
  onRestack: (stacking: WidgetStacking) => void;
}) {
  const stack = widgets
    .filter(
      (widget) => widget.id === selected.id || placementsOverlap(widget.layout, selected.layout),
    )
    .reverse();
  if (stack.length < 2) return null;
  return (
    <FieldSet className="mt-4 gap-2">
      <FieldLegend variant="label">Layers</FieldLegend>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={stack[0] === selected}
          onClick={() => onRestack('front')}
        >
          <BringToFrontIcon data-icon="inline-start" />
          Bring to front
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={stack.at(-1) === selected}
          onClick={() => onRestack('back')}
        >
          <SendToBackIcon data-icon="inline-start" />
          Send to back
        </Button>
      </div>
      <ol aria-label="Widgets at this position, top first" className="flex flex-col">
        {stack.map((widget) => (
          <li key={widget.id}>
            <Button
              variant="ghost"
              size="sm"
              className={cn('w-full justify-start', widget === selected && 'bg-muted')}
              aria-current={widget === selected ? 'true' : undefined}
              onClick={() => onSelect(widget.id)}
            >
              <span className="truncate">{widgetLabel(widget)}</span>
            </Button>
          </li>
        ))}
      </ol>
    </FieldSet>
  );
}
