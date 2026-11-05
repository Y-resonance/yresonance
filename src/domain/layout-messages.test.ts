import { describe, expect, it } from 'vitest';
import { canvasRowsMessage, layoutMessage, placementMessage } from './layout-messages';
import { validateLayoutUpdate } from './layout';
import type { DashboardWidget } from './schema';

const chart: DashboardWidget = {
  id: 'one',
  layout: { x: 0, y: 0, width: 6, height: 2 },
  definition: {
    type: 'scorecard',
    title: 'Revenue',
    dataSourceId: 'source',
    dateRangeFieldId: 'date',
    metric: {
      source: { kind: 'field', fieldId: 'amount', aggregation: 'sum' },
      dataType: 'number',
    },
  },
  definitionHash: 'hash',
};
const note: DashboardWidget = {
  id: 'two',
  layout: { x: 6, y: 0, width: 6, height: 2 },
  definition: { type: 'text', content: { schemaVersion: 'markdown-v1', document: 'hello' } },
  definitionHash: 'hash',
};
const widgets = [chart, note];

function messageFor(updates: Parameters<typeof validateLayoutUpdate>[1]) {
  const validation = validateLayoutUpdate(widgets, updates);
  if (validation.ok) throw new Error('expected the layout to be rejected');
  return layoutMessage(validation, widgets);
}

describe('layout error messages', () => {
  it('names the widget missing a placement', () => {
    expect(messageFor([{ widgetId: 'one', placement: chart.layout }])).toBe(
      'The layout is missing a placement for "Text".',
    );
  });

  it('names a widget placed twice', () => {
    expect(
      messageFor([
        { widgetId: 'one', placement: chart.layout },
        { widgetId: 'one', placement: note.layout },
      ]),
    ).toBe('The layout places "Revenue" more than once. Every widget needs exactly one placement.');
  });

  it('tells the caller to reload when the layout references a widget that is gone', () => {
    expect(
      messageFor([
        { widgetId: 'one', placement: chart.layout },
        { widgetId: 'ghost', placement: note.layout },
      ]),
    ).toBe(
      'The layout places "ghost", which is not on this dashboard. Reload the dashboard and retry.',
    );
  });

  it('reports the grid width a placement exceeds', () => {
    expect(
      messageFor([
        { widgetId: 'one', placement: chart.layout },
        { widgetId: 'two', placement: { x: 8, y: 0, width: 6, height: 2 } },
      ]),
    ).toBe('"Text" runs past the 12-column grid (x 8 + width 6).');
  });

  it('names the widget a short canvas cannot fit', () => {
    const tall = { ...note, layout: { x: 6, y: 8, width: 6, height: 4 } };
    expect(canvasRowsMessage([chart, tall], 10)).toBe(
      'The canvas is 10 rows tall but "Text" reaches row 12. It needs at least 12 rows.',
    );
  });

  it('names the moved widget when a single placement is rejected', () => {
    expect(
      placementMessage(
        {
          ok: false,
          reason: 'out-of-grid',
          placement: { x: 10, y: 0, width: 4, height: 2 },
          columns: 12,
        },
        'Revenue',
      ),
    ).toBe('"Revenue" runs past the 12-column grid (x 10 + width 4).');
  });
});
