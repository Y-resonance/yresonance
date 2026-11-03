import { useEffect, useRef, useState, type ReactNode } from 'react';
import { RotateCcwIcon } from 'lucide-react';
import { type Appearance, type DashboardTheme, themeColorSchema } from '#/domain/schema';
import { cssColor, defaultAppearance, type ResolvedAppearance } from '#/domain/appearance';
import { Button } from '#/components/ui/button';
import { Field, FieldLabel } from '#/components/ui/field';
import { Input } from '#/components/ui/input';
import { NativeSelect, NativeSelectOption } from '#/components/ui/native-select';
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover';
import { Switch } from '#/components/ui/switch';
import { cn } from '#/lib/utils';

type Color = NonNullable<Appearance['background']>;

const themeColorLabels: Record<(typeof themeColorSchema.options)[number], string> = {
  'theme:brand': 'Brand',
  'theme:surface': 'Surface',
  'theme:muted': 'Muted',
  'theme:foreground': 'Foreground',
};

/**
 * "Background and border" for one widget or for the theme's widget defaults. Unset fields show the
 * value they inherit in muted text and have no reset, so it is visible where a value comes from.
 */
export function AppearanceSettings({
  legend,
  value,
  inherited,
  theme,
  onChange,
}: {
  legend: string;
  value: Appearance | undefined;
  /** What every unset field falls back to: the theme's widget defaults, then the app default. */
  inherited: ResolvedAppearance;
  theme: DashboardTheme | undefined;
  onChange: (appearance: Appearance | undefined) => void;
}) {
  function update<K extends keyof Appearance>(key: K, next: Appearance[K]) {
    const draft: Appearance = { ...value, [key]: next };
    if (next === undefined) delete draft[key];
    onChange(Object.keys(draft).length ? draft : undefined);
  }
  const row = <K extends keyof Appearance>(key: K, label: string, control: ReactNode) => (
    <SettingRow
      label={label}
      inherited={value?.[key] === undefined}
      onReset={() => update(key, undefined)}
    >
      {control}
    </SettingRow>
  );
  return (
    <Field>
      <FieldLabel>{legend}</FieldLabel>
      <div className="grid grid-cols-2 gap-2">
        {row(
          'background',
          'Background',
          <ColorPicker
            label={`${legend}: background`}
            value={value?.background}
            inherited={inherited.background}
            theme={theme}
            onChange={(next) => update('background', next)}
          />,
        )}
        {row(
          'backgroundOpacity',
          'Opacity %',
          <NumberSetting
            label={`${legend}: background opacity`}
            value={value?.backgroundOpacity}
            inherited={inherited.backgroundOpacity}
            max={100}
            onChange={(next) => update('backgroundOpacity', next)}
          />,
        )}
        {row(
          'borderColor',
          'Border color',
          <ColorPicker
            label={`${legend}: border color`}
            value={value?.borderColor}
            inherited={inherited.borderColor}
            theme={theme}
            onChange={(next) => update('borderColor', next)}
          />,
        )}
        {row(
          'borderWidth',
          'Border weight',
          <NumberSetting
            label={`${legend}: border weight`}
            value={value?.borderWidth}
            inherited={inherited.borderWidth}
            max={8}
            onChange={(next) => update('borderWidth', next)}
          />,
        )}
        {row(
          'borderStyle',
          'Border style',
          <NativeSelect
            aria-label={`${legend}: border style`}
            className={cn('w-full', value?.borderStyle === undefined && 'text-muted-foreground')}
            value={value?.borderStyle ?? inherited.borderStyle}
            onChange={(event) =>
              update(
                'borderStyle',
                event.target.value === 'dashed' || event.target.value === 'dotted'
                  ? event.target.value
                  : 'solid',
              )
            }
          >
            <NativeSelectOption value="solid">Solid</NativeSelectOption>
            <NativeSelectOption value="dashed">Dashed</NativeSelectOption>
            <NativeSelectOption value="dotted">Dotted</NativeSelectOption>
          </NativeSelect>,
        )}
        {row(
          'borderRadius',
          'Radius',
          <NumberSetting
            label={`${legend}: border radius`}
            value={value?.borderRadius}
            inherited={inherited.borderRadius}
            max={32}
            onChange={(next) => update('borderRadius', next)}
          />,
        )}
        {row(
          'shadow',
          'Shadow',
          <div className="flex h-8 items-center">
            <Switch
              aria-label={`${legend}: shadow`}
              className={cn(value?.shadow === undefined && 'opacity-60')}
              checked={value?.shadow ?? inherited.shadow}
              onCheckedChange={(shadow) => update('shadow', shadow)}
            />
          </div>,
        )}
      </div>
    </Field>
  );
}

/** The dashboard theme: brand, canvas, chart palette and the defaults every widget inherits. */
export function ThemeSettings({
  theme,
  onChange,
}: {
  theme: DashboardTheme | undefined;
  onChange: (theme: DashboardTheme) => void;
}) {
  function update<K extends keyof DashboardTheme>(key: K, next: DashboardTheme[K]) {
    const draft: DashboardTheme = { ...theme, [key]: next };
    if (next === undefined) delete draft[key];
    onChange(draft);
  }
  return (
    <section aria-label="Dashboard theme" className="flex flex-col gap-4">
      <h2 className="font-medium">Dashboard theme</h2>
      <div className="grid grid-cols-2 gap-2">
        <SettingRow
          label="Brand color"
          inherited={theme?.brandColor === undefined}
          onReset={() => update('brandColor', undefined)}
        >
          <HexInput
            label="Brand color"
            value={theme?.brandColor}
            placeholder="App primary"
            onChange={(next) => update('brandColor', next)}
          />
        </SettingRow>
        <SettingRow
          label="Chart palette"
          inherited={theme?.chartPalette === undefined}
          onReset={() => update('chartPalette', undefined)}
        >
          <NativeSelect
            aria-label="Chart palette"
            className={cn('w-full', theme?.chartPalette === undefined && 'text-muted-foreground')}
            value={theme?.chartPalette ?? 'default'}
            onChange={(event) =>
              update('chartPalette', event.target.value === 'brand' ? 'brand' : 'default')
            }
          >
            <NativeSelectOption value="default">Default</NativeSelectOption>
            <NativeSelectOption value="brand" disabled={!theme?.brandColor}>
              Brand
            </NativeSelectOption>
          </NativeSelect>
        </SettingRow>
        <SettingRow
          label="Canvas"
          inherited={theme?.canvasBackground === undefined}
          onReset={() => update('canvasBackground', undefined)}
        >
          <ColorPicker
            label="Canvas background"
            value={theme?.canvasBackground}
            inherited={undefined}
            theme={theme}
            onChange={(next) => update('canvasBackground', next)}
          />
        </SettingRow>
      </div>
      <AppearanceSettings
        legend="Widget defaults"
        value={theme?.widgetDefaults}
        inherited={defaultAppearance}
        theme={theme}
        onChange={(widgetDefaults) => update('widgetDefaults', widgetDefaults)}
      />
    </section>
  );
}

function SettingRow({
  label,
  inherited,
  onReset,
  children,
}: {
  label: string;
  inherited: boolean;
  onReset: () => void;
  children: ReactNode;
}) {
  return (
    <div className="grid min-w-0 gap-1">
      <div className="flex h-6 items-center justify-between gap-1">
        <span className="truncate text-xs text-muted-foreground">{label}</span>
        {inherited ? null : (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Reset ${label.toLowerCase()}`}
            onClick={onReset}
          >
            <RotateCcwIcon />
          </Button>
        )}
      </div>
      {children}
    </div>
  );
}

function colorLabel(color: Color | undefined) {
  if (!color) return 'Default';
  const parsed = themeColorSchema.safeParse(color);
  return parsed.success ? themeColorLabels[parsed.data] : color.toUpperCase();
}

/** Theme swatches first, then a free hex colour. Shows the inherited colour muted while unset. */
function ColorPicker({
  label,
  value,
  inherited,
  theme,
  onChange,
}: {
  label: string;
  value: Color | undefined;
  inherited: Color | undefined;
  theme: DashboardTheme | undefined;
  onChange: (color: Color) => void;
}) {
  const [open, setOpen] = useState(false);
  const shown = value ?? inherited;
  const pick = (color: Color) => {
    onChange(color);
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            aria-label={label}
            className={cn(
              'w-full justify-start font-normal',
              value === undefined && 'text-muted-foreground',
            )}
          />
        }
      >
        <Swatch color={shown} theme={theme} />
        <span className="truncate">{colorLabel(shown)}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 gap-3">
        <div className="grid grid-cols-2 gap-1">
          {themeColorSchema.options.map((color) => (
            <Button
              key={color}
              variant={value === color ? 'secondary' : 'ghost'}
              size="sm"
              className="justify-start font-normal"
              onClick={() => pick(color)}
            >
              <Swatch color={color} theme={theme} />
              {themeColorLabels[color]}
            </Button>
          ))}
        </div>
        <HexInput
          label={`${label} hex`}
          value={value?.startsWith('#') ? value : undefined}
          placeholder="#RRGGBB"
          onChange={(next) => next && pick(next)}
        />
      </PopoverContent>
    </Popover>
  );
}

function Swatch({ color, theme }: { color: Color | undefined; theme: DashboardTheme | undefined }) {
  return (
    <span
      aria-hidden="true"
      className="size-3.5 shrink-0 rounded-sm ring-1 ring-foreground/15"
      style={{ background: color ? cssColor(color, theme) : 'transparent' }}
    />
  );
}

/**
 * A native colour well next to a hex field. The hex commits on blur or Enter, the well once its
 * picker closes: React's onChange fires on every drag step, which would save each one.
 */
function HexInput({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string | undefined;
  placeholder: string;
  onChange: (hex: string | undefined) => void;
}) {
  const [input, setInput] = useState(value ?? '');
  useEffect(() => setInput(value ?? ''), [value]);
  const well = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const element = well.current;
    if (!element) return;
    const commitWell = () => onChange(element.value);
    element.addEventListener('change', commitWell);
    return () => element.removeEventListener('change', commitWell);
  }, [onChange]);
  const commit = () => {
    const hex = input.trim().startsWith('#') ? input.trim() : `#${input.trim()}`;
    const next = hex.toLowerCase();
    // Leaving the field unchanged must not save, like the number settings.
    if (!/^#[0-9a-f]{6}$/.test(next)) setInput(value ?? '');
    else if (next !== value) onChange(next);
    else setInput(next);
  };
  return (
    <div className="flex gap-1">
      <input
        ref={well}
        type="color"
        aria-label={`${label} picker`}
        className="h-8 w-8 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5"
        value={/^#[0-9a-f]{6}$/i.test(input) ? input : (value ?? '#000000')}
        onChange={(event) => setInput(event.target.value)}
      />
      <Input
        aria-label={label}
        className="min-w-0"
        value={input}
        placeholder={placeholder}
        onChange={(event) => setInput(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
        }}
      />
    </div>
  );
}

/** Whole numbers from 0 to max. Empty shows the inherited value as placeholder. */
function NumberSetting({
  label,
  value,
  inherited,
  max,
  onChange,
}: {
  label: string;
  value: number | undefined;
  inherited: number;
  max: number;
  onChange: (value: number | undefined) => void;
}) {
  const [input, setInput] = useState(value === undefined ? '' : String(value));
  useEffect(() => setInput(value === undefined ? '' : String(value)), [value]);
  const commit = () => {
    if (input.trim() === '') return value === undefined ? undefined : onChange(undefined);
    const next = Number(input);
    if (Number.isInteger(next) && next >= 0 && next <= max) {
      if (next !== value) onChange(next);
    } else setInput(value === undefined ? '' : String(value));
  };
  return (
    <Input
      aria-label={label}
      type="number"
      min={0}
      max={max}
      value={input}
      placeholder={String(inherited)}
      onChange={(event) => setInput(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
      }}
    />
  );
}
