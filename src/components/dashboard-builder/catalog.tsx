import {
  BarChart3Icon,
  ChartNoAxesColumnIcon,
  ChartNoAxesCombinedIcon,
  CircleGaugeIcon,
  LineChartIcon,
  PieChartIcon,
  Table2Icon,
  ListFilterIcon,
  CalendarDaysIcon,
  CaseUpperIcon,
  PlusIcon,
} from 'lucide-react';
import { Button } from '#/components/ui/button';
import { type BuilderType } from './shared';

export const catalog: Array<{
  type: BuilderType;
  label: string;
  icon: typeof BarChart3Icon;
  size: { width: number; height: number };
}> = [
  {
    type: 'scorecard',
    label: 'Scorecard',
    icon: ChartNoAxesColumnIcon,
    size: { width: 4, height: 3 },
  },
  { type: 'gauge', label: 'Gauge', icon: CircleGaugeIcon, size: { width: 4, height: 3 } },
  { type: 'line', label: 'Line chart', icon: LineChartIcon, size: { width: 8, height: 5 } },
  { type: 'bar', label: 'Bar chart', icon: BarChart3Icon, size: { width: 8, height: 5 } },
  {
    type: 'combo',
    label: 'Combo chart',
    icon: ChartNoAxesCombinedIcon,
    size: { width: 8, height: 5 },
  },
  { type: 'pie', label: 'Pie chart', icon: PieChartIcon, size: { width: 6, height: 5 } },
  { type: 'table', label: 'Table', icon: Table2Icon, size: { width: 8, height: 5 } },
  // Controls hold a label and one input, so a single row fits them without leaving dead space.
  { type: 'control', label: 'Filter control', icon: ListFilterIcon, size: { width: 4, height: 1 } },
  {
    type: 'dateControl',
    label: 'Date control',
    icon: CalendarDaysIcon,
    size: { width: 4, height: 1 },
  },
  { type: 'text', label: 'Text', icon: CaseUpperIcon, size: { width: 6, height: 2 } },
];

export function WidgetCatalog({
  disabled,
  hasDateControl,
  onAdd,
  onDragStart,
}: {
  disabled: boolean;
  hasDateControl: boolean;
  onAdd: (type: BuilderType) => Promise<void>;
  onDragStart: (type: BuilderType) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">Drag onto the grid or click +.</p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-px">
        {catalog.map(({ type, label, icon: Icon }) => {
          const unavailable = disabled || (type === 'dateControl' && hasDateControl);
          return (
            <div
              key={type}
              draggable={!unavailable}
              onDragStart={(event) => {
                onDragStart(type);
                event.dataTransfer.setData('text/plain', type);
                event.dataTransfer.effectAllowed = 'copy';
              }}
              className="flex cursor-grab items-center gap-2 rounded-md py-0.5 pl-1.5 hover:bg-accent active:cursor-grabbing"
            >
              <Icon className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate text-sm">{label}</span>
              <Button
                variant="ghost"
                size="icon-xs"
                disabled={unavailable}
                aria-label={`Add ${label}`}
                onClick={() => void onAdd(type)}
              >
                <PlusIcon />
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
