import type { CSSProperties } from 'react';
import type { Appearance, DashboardTheme } from './schema';

type Color = NonNullable<Appearance['background']>;

/** Every field filled in, except the border colour, whose app default is the card's own hairline. */
export type ResolvedAppearance = Required<Omit<Appearance, 'borderColor'>> &
  Pick<Appearance, 'borderColor'>;

/**
 * What a widget box looks like when neither the widget nor the theme sets a field. These match the
 * card classes, so a dashboard without any appearance renders exactly as before.
 */
export const defaultAppearance: ResolvedAppearance = {
  background: 'theme:surface',
  backgroundOpacity: 100,
  borderRadius: 14,
  borderWidth: 1,
  borderStyle: 'solid',
  shadow: false,
};

/** Field by field: the widget's own value, then the theme's widget defaults, then the app default. */
export function resolveAppearance(
  theme: DashboardTheme | undefined,
  appearance: Appearance | undefined,
): ResolvedAppearance {
  const pick = <K extends keyof ResolvedAppearance>(key: K) =>
    appearance?.[key] ?? theme?.widgetDefaults?.[key] ?? defaultAppearance[key];
  return {
    background: pick('background'),
    backgroundOpacity: pick('backgroundOpacity'),
    borderColor: pick('borderColor'),
    borderRadius: pick('borderRadius'),
    borderWidth: pick('borderWidth'),
    borderStyle: pick('borderStyle'),
    shadow: pick('shadow'),
  };
}

// Surface, muted and foreground are the app's light and dark tokens, so they flip with the mode.
const themeColors = new Map<string, string>([
  ['theme:surface', 'var(--card)'],
  ['theme:muted', 'var(--muted)'],
  ['theme:foreground', 'var(--foreground)'],
]);

/** CSS value of a stored colour. `theme:brand` falls back to the app primary without a brand. */
export function cssColor(color: Color, theme: DashboardTheme | undefined, opacity = 100) {
  const value =
    color === 'theme:brand'
      ? (theme?.brandColor ?? 'var(--primary)')
      : (themeColors.get(color) ?? color);
  return opacity < 100 ? `color-mix(in srgb, ${value} ${opacity}%, transparent)` : value;
}

// Same as the card's `ring-foreground/10`.
const hairline = 'color-mix(in oklab, var(--foreground) 10%, transparent)';
const shadow = '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)';

/**
 * Inline style for a widget box, or undefined when nothing is set anywhere so the card keeps its
 * classes untouched. The border is an inset outline: it supports dashed and dotted, follows the
 * radius, and never changes the content size when its weight changes.
 */
export function widgetBoxStyle(
  theme: DashboardTheme | undefined,
  appearance: Appearance | undefined,
): CSSProperties | undefined {
  if (!hasValues(theme?.widgetDefaults) && !hasValues(appearance)) return undefined;
  const resolved = resolveAppearance(theme, appearance);
  return {
    backgroundColor: cssColor(resolved.background, theme, resolved.backgroundOpacity),
    borderRadius: resolved.borderRadius,
    outline: resolved.borderWidth
      ? `${resolved.borderWidth}px ${resolved.borderStyle} ${
          resolved.borderColor ? cssColor(resolved.borderColor, theme) : hairline
        }`
      : 'none',
    outlineOffset: -resolved.borderWidth,
    boxShadow: resolved.shadow ? shadow : 'none',
  };
}

/** Canvas background and chart palette for the element that holds a dashboard page's widgets. */
export function dashboardCanvasStyle(theme: DashboardTheme | undefined): CSSProperties {
  const palette =
    theme?.chartPalette === 'brand' && theme.brandColor ? brandPalette(theme.brandColor) : [];
  return {
    ...(theme?.canvasBackground
      ? { backgroundColor: cssColor(theme.canvasBackground, theme) }
      : {}),
    // Charts read --chart-1..8, so overriding them here recolours every series below.
    ...Object.fromEntries(palette.map((color, index) => [`--chart-${index + 1}`, color])),
  };
}

// Golden-angle steps keep neighbouring series far apart on the colour wheel.
const hueSteps = [0, 137.5, 275, 52.5, 190, 327.5, 105, 242.5];

/**
 * Eight chart colours derived from the brand. The first slot is the brand itself, the rest rotate its
 * hue. Lightness stays in a middle band and chroma in a visible range, so every slot reads on both the
 * light and the dark card. Semantic colours (positive, warning, negative) have their own tokens and
 * are not touched.
 */
export function brandPalette(brandColor: string) {
  const { lightness, chroma, hue } = hexToOklch(brandColor);
  const readableChroma = clamp(chroma, 0.09, 0.19);
  return hueSteps.map((step, index) => {
    const slotLightness = index === 0 ? clamp(lightness, 0.55, 0.72) : index % 2 ? 0.6 : 0.7;
    return `oklch(${round(slotLightness)} ${round(readableChroma)} ${round((hue + step) % 360)})`;
  });
}

function hexToOklch(hex: string) {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((start) => {
    const channel = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return {
    lightness: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    chroma: Math.hypot(a, bb),
    hue: ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360,
  };
}

/** Names of the fields an appearance or theme sets, for usage telemetry. */
export function appearanceFieldNames(value: object | undefined, prefix = ''): string[] {
  return Object.entries(value ?? {}).flatMap(([key, field]) =>
    field === undefined
      ? []
      : field && typeof field === 'object'
        ? appearanceFieldNames(field, `${prefix}${key}.`)
        : [`${prefix}${key}`],
  );
}

function hasValues(value: object | undefined) {
  return Object.values(value ?? {}).some((field) => field !== undefined);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}
