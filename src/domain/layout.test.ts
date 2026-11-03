import { describe, expect, it } from 'vitest';
import {
  appendPlacement,
  checkPlacement,
  defaultCanvasRows,
  insertRow,
  isRowEmpty,
  removeEmptyRow,
  rowInsertionCuts,
  rollbackFailedLayout,
  rollbackFailedLayoutState,
  validRowCuts,
  validateLayoutUpdate,
} from './layout';
import type { DashboardWidget } from './schema';

const widget: DashboardWidget = {
  id: 'one',
  layout: { x: 0, y: 0, width: 6, height: 2 },
  definition: { type: 'text', content: { schemaVersion: 'markdown-v1', document: 'hello' } },
  definitionHash: 'hash',
};

describe('dashboard layout', () => {
  it('appends below the current bottom and caps width to the grid', () => {
    expect(appendPlacement([widget], 20, 3, 12)).toEqual({ x: 0, y: 2, width: 12, height: 3 });
  });

  it('reports what a rejected placement collides with', () => {
    expect(checkPlacement([widget], { x: 5, y: 1, width: 4, height: 2 })).toEqual({
      ok: false,
      reason: 'overlap',
      widget,
    });
    expect(checkPlacement([widget], { x: 10, y: 3, width: 4, height: 2 })).toEqual({
      ok: false,
      reason: 'out-of-grid',
      placement: { x: 10, y: 3, width: 4, height: 2 },
      columns: 12,
    });
    expect(checkPlacement([widget], { x: 6, y: 0, width: 6, height: 2 })).toEqual({ ok: true });
  });

  it('accepts a complete free-placement layout with empty rows', () => {
    const second = { ...widget, id: 'two', layout: { x: 6, y: 0, width: 6, height: 2 } };
    expect(
      validateLayoutUpdate(
        [widget, second],
        [
          { widgetId: 'one', placement: { x: 0, y: 4, width: 4, height: 2 } },
          { widgetId: 'two', placement: { x: 8, y: 8, width: 4, height: 2 } },
        ],
      ),
    ).toEqual({ ok: true });
  });

  it('reports which widgets make a batch layout invalid', () => {
    const second = { ...widget, id: 'two', layout: { x: 6, y: 0, width: 6, height: 2 } };
    const widgets = [widget, second];
    expect(
      validateLayoutUpdate(widgets, [
        { widgetId: 'one', placement: { x: 0, y: 0, width: 6, height: 2 } },
      ]),
    ).toEqual({ ok: false, reason: 'missing', widgetIds: ['two'] });
    expect(
      validateLayoutUpdate(widgets, [
        { widgetId: 'one', placement: { x: 0, y: 0, width: 6, height: 2 } },
        { widgetId: 'one', placement: { x: 6, y: 0, width: 6, height: 2 } },
      ]),
    ).toEqual({ ok: false, reason: 'duplicate', widgetIds: ['one'] });
    expect(
      validateLayoutUpdate(widgets, [
        { widgetId: 'one', placement: { x: 0, y: 0, width: 6, height: 2 } },
        { widgetId: 'ghost', placement: { x: 6, y: 0, width: 6, height: 2 } },
      ]),
    ).toEqual({ ok: false, reason: 'unknown', widgetIds: ['ghost'] });
    expect(
      validateLayoutUpdate(widgets, [
        { widgetId: 'one', placement: { x: 0, y: 0, width: 8, height: 2 } },
        { widgetId: 'two', placement: { x: 6, y: 0, width: 6, height: 2 } },
      ]),
    ).toMatchObject({ ok: false, reason: 'overlap' });
    expect(
      validateLayoutUpdate(widgets, [
        { widgetId: 'one', placement: { x: 0, y: 0, width: 6, height: 2 } },
        { widgetId: 'two', placement: { x: 8, y: 0, width: 6, height: 2 } },
      ]),
    ).toMatchObject({ ok: false, reason: 'out-of-grid', columns: 12 });
  });

  it('rolls back only placements that still match the failed save', () => {
    const failed = { x: 2, y: 2, width: 6, height: 2 };
    const newer = { x: 4, y: 4, width: 6, height: 2 };
    const second = { ...widget, id: 'two', layout: failed };

    const rolledBack = rollbackFailedLayout(
      [{ ...widget, layout: newer }, second],
      new Map([
        ['one', widget.layout],
        ['two', { x: 6, y: 0, width: 6, height: 2 }],
      ]),
      new Map([
        ['one', failed],
        ['two', failed],
      ]),
    );

    expect(rolledBack[0]?.layout).toEqual(newer);
    expect(rolledBack[1]?.layout).toEqual({ x: 6, y: 0, width: 6, height: 2 });
  });

  it('derives a legacy canvas height with two trailing rows', () => {
    expect(defaultCanvasRows([widget])).toBe(10);
    expect(defaultCanvasRows([{ ...widget, layout: { ...widget.layout, y: 12 } }])).toBe(16);
  });

  it('offers only cuts that no widget crosses', () => {
    const lower = { ...widget, id: 'two', layout: { x: 0, y: 4, width: 6, height: 2 } };
    expect(validRowCuts([widget, lower])).toEqual([0, 2, 3, 4, 6]);
  });

  it('places the final insertion cut below all stored canvas rows', () => {
    const lower = { ...widget, id: 'two', layout: { x: 0, y: 4, width: 6, height: 2 } };
    expect(rowInsertionCuts([widget, lower], 10)).toEqual([0, 2, 3, 4, 10]);
    expect(rowInsertionCuts([], 10)).toEqual([10]);
  });

  it('inserts at a valid cut and shifts only widgets below it', () => {
    const lower = { ...widget, id: 'two', layout: { x: 0, y: 4, width: 6, height: 2 } };
    const inserted = insertRow([widget, lower], 10, 2);
    expect(inserted?.canvasRows).toBe(11);
    expect(inserted?.widgets.map((item) => item.layout.y)).toEqual([0, 5]);
    expect(insertRow([widget, lower], 10, 1)).toBeUndefined();
  });

  it('inserts below the final canvas row without moving widgets', () => {
    const inserted = insertRow([widget], 10, 10);
    expect(inserted?.canvasRows).toBe(11);
    expect(inserted?.widgets[0]?.layout).toEqual(widget.layout);
  });

  it('removes only empty rows and shifts widgets below them', () => {
    const lower = { ...widget, id: 'two', layout: { x: 0, y: 4, width: 6, height: 2 } };
    expect(isRowEmpty([widget, lower], 3)).toBe(true);
    const removed = removeEmptyRow([widget, lower], 11, 3);
    expect(removed?.canvasRows).toBe(10);
    expect(removed?.widgets.map((item) => item.layout.y)).toEqual([0, 3]);
    expect(removeEmptyRow([widget, lower], 11, 1)).toBeUndefined();
    expect(removeEmptyRow([widget, lower], 10, 3)).toBeUndefined();
  });

  it('rolls canvas height and placements back as one state', () => {
    const failedWidget = { ...widget, layout: { ...widget.layout, y: 1 } };
    const rolledBack = rollbackFailedLayoutState(
      { widgets: [failedWidget], canvasRows: 11 },
      { placements: new Map([[widget.id, widget.layout]]), canvasRows: 10 },
      { placements: new Map([[widget.id, failedWidget.layout]]), canvasRows: 11 },
    );
    expect(rolledBack.canvasRows).toBe(10);
    expect(rolledBack.widgets[0]?.layout).toEqual(widget.layout);

    const newer = rollbackFailedLayoutState(
      { widgets: [failedWidget], canvasRows: 12 },
      { placements: new Map([[widget.id, widget.layout]]), canvasRows: 10 },
      { placements: new Map([[widget.id, failedWidget.layout]]), canvasRows: 11 },
    );
    expect(newer.canvasRows).toBe(12);
    expect(newer.widgets[0]?.layout).toEqual(failedWidget.layout);
  });
});
