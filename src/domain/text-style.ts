import type { TextStyle } from './schema';

// Every option maps to a literal class because Tailwind only ships classes it can find in source.
const sizes = {
  xs: 'text-xs',
  sm: 'text-sm',
  base: 'text-base',
  lg: 'text-lg',
  xl: 'text-xl',
  '2xl': 'text-2xl',
} as const;

const weights = {
  normal: 'font-normal',
  medium: 'font-medium',
  semibold: 'font-semibold',
  // Headings set their own weight, so bold has to reach them or they end up lighter than the body.
  bold: 'font-bold [&_:is(h1,h2,h3,h4,h5,h6)]:font-bold!',
} as const;

const decorations = { underline: 'underline', strikethrough: 'line-through' } as const;

// Uppercase without extra tracking reads as a cramped block, so the two always travel together.
const transforms = { none: 'normal-case', uppercase: 'uppercase tracking-wide' } as const;

const alignments = { left: 'text-left', center: 'text-center', right: 'text-right' } as const;

// Vertical alignment moves the text inside its box rather than styling the text, so it maps to
// flex classes for the container and is kept out of `textStyleClasses`.
const verticalAlignments = {
  top: 'justify-start',
  center: 'justify-center',
  bottom: 'justify-end',
} as const;

const tones = {
  default: 'text-foreground',
  muted: 'text-muted-foreground',
  primary: 'text-primary',
} as const;

/**
 * Turns a stored text style into Tailwind classes. Unset properties produce nothing so the element
 * keeps its own defaults, and the result is appended after those defaults so tailwind-merge wins.
 */
export function textStyleClasses(style: TextStyle | undefined) {
  if (!style) return undefined;
  const classes = [
    style.size && sizes[style.size],
    style.weight && weights[style.weight],
    style.italic && 'italic',
    style.decoration && decorations[style.decoration],
    style.transform && transforms[style.transform],
    style.align && alignments[style.align],
    style.tone && tones[style.tone],
  ].filter(Boolean);
  return classes.length ? classes.join(' ') : undefined;
}

/**
 * Classes for the box around a text block, which is where vertical alignment has to live: the
 * element that owns the leftover height, not the text itself. The caller supplies the flex column,
 * this only picks where the text sits inside it.
 */
export function textBoxClasses(style: TextStyle | undefined) {
  return style?.verticalAlign ? verticalAlignments[style.verticalAlign] : undefined;
}
