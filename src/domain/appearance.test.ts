import { describe, expect, it } from 'vitest';
import {
  appearanceFieldNames,
  brandPalette,
  dashboardCanvasStyle,
  defaultAppearance,
  resolveAppearance,
  widgetBoxStyle,
} from './appearance';
import { dashboardDocumentSchema } from './schema';

describe('widget appearance', () => {
  it('resolves each field from the widget, then the theme defaults, then the app default', () => {
    const theme = { widgetDefaults: { borderWidth: 0, borderRadius: 4, shadow: true } };

    expect(resolveAppearance(theme, { borderRadius: 20, background: '#ff0000' })).toEqual({
      ...defaultAppearance,
      background: '#ff0000',
      borderRadius: 20,
      borderWidth: 0,
      shadow: true,
    });
    expect(resolveAppearance(theme, undefined).borderRadius).toBe(4);
  });

  it('leaves widgets untouched when neither the widget nor the theme sets anything', () => {
    expect(widgetBoxStyle(undefined, undefined)).toBeUndefined();
    expect(widgetBoxStyle({ brandColor: '#123456', widgetDefaults: {} }, {})).toBeUndefined();
  });

  it('restyles every widget from the theme defaults and lets a widget override win', () => {
    const theme = { widgetDefaults: { borderWidth: 2, borderStyle: 'dashed' as const } };

    expect(widgetBoxStyle(theme, undefined)).toMatchObject({
      outline: '2px dashed color-mix(in oklab, var(--foreground) 10%, transparent)',
      outlineOffset: -2,
    });
    expect(widgetBoxStyle(theme, { borderWidth: 0 })).toMatchObject({ outline: 'none' });
  });

  it('follows the brand and the light or dark tokens for theme references, and keeps hex as stored', () => {
    const appearance = { background: 'theme:brand' as const, borderColor: 'theme:muted' as const };

    expect(widgetBoxStyle({ brandColor: '#7c3aed' }, appearance)).toMatchObject({
      backgroundColor: '#7c3aed',
      outline: '1px solid var(--muted)',
    });
    expect(widgetBoxStyle(undefined, appearance)?.backgroundColor).toBe('var(--primary)');
    expect(
      widgetBoxStyle(undefined, { background: '#00ff00', backgroundOpacity: 40 })?.backgroundColor,
    ).toBe('color-mix(in srgb, #00ff00 40%, transparent)');
  });
});

describe('dashboard theme', () => {
  it('keeps the default chart palette until a brand palette has a brand colour', () => {
    expect(dashboardCanvasStyle({ chartPalette: 'brand' })).toEqual({});
    expect(dashboardCanvasStyle({ brandColor: '#7c3aed' })).toEqual({});
  });

  it('derives the chart palette from the brand colour and paints the canvas', () => {
    const style = dashboardCanvasStyle({
      brandColor: '#7c3aed',
      chartPalette: 'brand',
      canvasBackground: 'theme:muted',
    });

    expect(style).toMatchObject({ backgroundColor: 'var(--muted)' });
    expect(Object.keys(style).filter((key) => key.startsWith('--chart-'))).toHaveLength(8);
    expect(dashboardCanvasStyle({ brandColor: '#0f766e', chartPalette: 'brand' })).not.toEqual(
      style,
    );
  });

  it.each(['#000000', '#ffffff', '#fde047', '#7c3aed'])(
    'keeps brand palette slots readable on light and dark cards for %s',
    (brand) => {
      const slots = brandPalette(brand).map((color) => {
        const [, lightness, chroma, hue] = /oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/.exec(color)!;
        return { lightness: Number(lightness), chroma: Number(chroma), hue: Number(hue) };
      });

      expect(new Set(slots.map((slot) => slot.hue)).size).toBe(8);
      for (const slot of slots) {
        expect(slot.lightness).toBeGreaterThanOrEqual(0.55);
        expect(slot.lightness).toBeLessThanOrEqual(0.72);
        expect(slot.chroma).toBeGreaterThanOrEqual(0.09);
      }
    },
  );

  it('keeps stored dashboards without a theme valid and rejects invalid colours', () => {
    const document = {
      id: 'dash',
      workspaceId: 'ws',
      name: 'Report',
      schemaVersion: 3,
      defaultDateRange: {
        startDate: { fixed: '2026-01-01' },
        endDate: { fixed: '2026-01-31' },
      },
      createdBy: 'user',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      pages: [{ id: 'page', name: 'Overview', canvasRows: 10, widgets: [] }],
    };

    expect(dashboardDocumentSchema.parse(document).theme).toBeUndefined();
    expect(
      dashboardDocumentSchema.safeParse({ ...document, theme: { brandColor: 'purple' } }).success,
    ).toBe(false);
    expect(
      dashboardDocumentSchema.safeParse({
        ...document,
        theme: { canvasBackground: 'theme:accent' },
      }).success,
    ).toBe(false);
  });
});

it('names the fields a theme sets for usage telemetry', () => {
  expect(
    appearanceFieldNames({
      brandColor: '#7c3aed',
      chartPalette: undefined,
      widgetDefaults: { shadow: false, borderWidth: 0 },
    }),
  ).toEqual(['brandColor', 'widgetDefaults.shadow', 'widgetDefaults.borderWidth']);
});
