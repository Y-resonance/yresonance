import { CheckIcon, LoaderIcon } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useInView, useLoopingSteps, usePrefersReducedMotion } from '#/components/landing/motion';
import { cn } from '#/lib/utils';

/**
 * The hero demo: an agent drafts a dashboard through site tools, then a person resizes a widget by
 * hand. It is a scripted mock, not the running app, so the whole block is hidden from assistive
 * technology. The real screenshots further down the page carry the descriptions.
 *
 * The script is a list of steps with durations. Every visual derives from "has this step been
 * reached", so the dashboard is always fully laid out and nothing shifts while it fills in.
 */
const script = [
  { id: 'idle', ms: 700 },
  { id: 'prompt', ms: 3600 },
  { id: 'describe', ms: 900 },
  { id: 'create', ms: 800 },
  { id: 'scorecards', ms: 1500 },
  { id: 'combo', ms: 1800 },
  { id: 'gauge', ms: 1100 },
  { id: 'note', ms: 1000 },
  { id: 'ready', ms: 1800 },
  { id: 'grab', ms: 1300 },
  { id: 'drag', ms: 1600 },
  { id: 'rest', ms: 3600 },
] as const;

type StepId = (typeof script)[number]['id'];

const durations = script.map((step) => step.ms);
const stepIndex = (id: StepId) => script.findIndex((step) => step.id === id);
const lastStep = script.length - 1;

const prompt =
  'Build the Q1 delivery report for Acme Media from campaign_delivery.parquet. KPIs on top, impressions against CTR over time, spend against plan.';

const toolCalls: Array<{ at: StepId; tool: string; detail: string }> = [
  { at: 'describe', tool: 'describeDatasource', detail: 'campaign_delivery' },
  { at: 'create', tool: 'createDashboard', detail: 'Q1 delivery' },
  { at: 'scorecards', tool: 'addWidget', detail: 'scorecard ×4' },
  { at: 'combo', tool: 'addWidget', detail: 'combo' },
  { at: 'gauge', tool: 'addWidget', detail: 'gauge' },
  { at: 'note', tool: 'addWidget', detail: 'text' },
];

const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const euro = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR' });
const percent = new Intl.NumberFormat('en-US', { style: 'percent', minimumFractionDigits: 2 });

const scorecards = [
  { label: 'Impressions', value: 59_114_956, format: integer },
  { label: 'Clicks', value: 337_137, format: integer },
  { label: 'Media spend', value: 200_975.81, format: euro },
  { label: 'Click-through rate', value: 0.0057, format: percent },
];

// Deterministic noise, so server and client draw the same lines.
function noise(index: number, seed: number) {
  const value = Math.sin(index * 12.9898 + seed) * 43758.5453;
  return value - Math.floor(value);
}

const chart = { width: 600, height: 200, points: 64 };

function linePath(valueAt: (index: number) => number) {
  return Array.from({ length: chart.points }, (_, index) => {
    const x = (index / (chart.points - 1)) * chart.width;
    const y = chart.height - valueAt(index) * chart.height;
    return `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
}

// Impressions climb through the quarter with weekend dips, the rate stays flat and noisy.
const impressionsPath = linePath((index) => {
  const trend = 0.12 + (index / chart.points) ** 1.6 * 0.6;
  const weekend = index % 7 > 4 ? 0.55 : 1;
  return Math.min(0.95, trend * weekend + noise(index, 1) * 0.06);
});
const ratePath = linePath((index) => 0.62 + (noise(index, 7) - 0.5) * 0.2);

export function BuildDemo({ className }: { className?: string }) {
  const reducedMotion = usePrefersReducedMotion();
  const [ref, inView] = useInView<HTMLDivElement>({ threshold: 0.2 });
  const playing = useLoopingSteps(durations, inView && !reducedMotion);
  // Reduced motion shows the finished draft instead of a frozen first frame.
  const step = reducedMotion ? lastStep : playing;
  const reached = (id: StepId) => step >= stepIndex(id);
  const dragged = reached('drag');

  return (
    <div
      ref={ref}
      aria-hidden
      className={cn('grid bg-background text-left lg:grid-cols-[19rem_1fr]', className)}
    >
      <div className="relative h-48 border-b lg:h-auto lg:border-r lg:border-b-0">
        <div className="absolute inset-0 flex flex-col justify-end gap-2 overflow-hidden mask-t-from-75% p-4 text-xs">
          {reached('prompt') ? (
            <p className="rounded-lg bg-muted px-3 py-2 leading-5 text-foreground">
              <Typewriter text={prompt} instant={reducedMotion} />
            </p>
          ) : (
            <p className="text-muted-foreground">Your agent, connected to the site tools</p>
          )}
          {toolCalls
            .filter((call) => reached(call.at))
            .map((call) => (
              <p
                key={`${call.tool}-${call.detail}`}
                className="flex animate-in items-center gap-2 font-mono duration-300 fade-in slide-in-from-bottom-2 motion-reduce:animate-none"
              >
                {step === stepIndex(call.at) ? (
                  <LoaderIcon className="size-3 animate-spin text-muted-foreground" />
                ) : (
                  <CheckIcon className="size-3 text-success" />
                )}
                <span className="text-foreground">{call.tool}</span>
                <span className="truncate text-muted-foreground">{call.detail}</span>
              </p>
            ))}
          {reached('ready') ? (
            <p className="animate-in leading-5 text-foreground duration-300 fade-in slide-in-from-bottom-2 motion-reduce:animate-none">
              Draft is ready. Adjust anything by hand.
            </p>
          ) : null}
        </div>
      </div>

      {/* Sizes below are in em against a container-relative font size, so the mock scales like a
          screenshot instead of reflowing on narrow screens. */}
      <div className="@container">
        <div className="p-[1.6em] text-[2.5cqw] sm:text-[1.5cqw]">
          <Appear shown={reached('create')}>
            <p className="text-[0.8em] text-muted-foreground">yresonance</p>
            <p className="text-[1.6em] font-semibold tracking-tight">Acme Media, Q1 delivery</p>
          </Appear>

          <div className="mt-[1em] grid grid-cols-4 gap-[0.8em]">
            {scorecards.map((card, index) => (
              <Appear
                key={card.label}
                shown={reached('scorecards')}
                delay={index * 110}
                className="rounded-[0.7em] border bg-card p-[0.9em]"
              >
                <p className="truncate text-[0.85em]">{card.label}</p>
                <p className="mt-[0.5em] text-[1.45em] font-semibold tracking-tight tabular-nums">
                  <CountUp
                    value={card.value}
                    format={card.format}
                    running={reached('scorecards')}
                    instant={reducedMotion}
                  />
                </p>
              </Appear>
            ))}
          </div>

          <div
            className="relative mt-[0.8em] grid gap-[0.8em] transition-[grid-template-columns] duration-[1400ms] ease-in-out motion-reduce:transition-none"
            style={{ gridTemplateColumns: dragged ? '1.3fr 1fr' : '2fr 1fr' }}
          >
            <Appear
              shown={reached('combo')}
              className={cn(
                'min-w-0 rounded-[0.7em] border bg-card p-[0.9em] outline-2 outline-offset-2 outline-transparent transition-[opacity,transform,filter,outline-color]',
                reached('grab') && !reached('rest') && 'outline-primary',
              )}
            >
              <p className="truncate text-[0.85em]">Impressions and click-through rate</p>
              <svg
                viewBox={`0 0 ${chart.width} ${chart.height}`}
                preserveAspectRatio="none"
                className="mt-[0.8em] h-[13em] w-full overflow-visible"
              >
                {[0, 0.25, 0.5, 0.75, 1].map((line) => (
                  <line
                    key={line}
                    x1={0}
                    x2={chart.width}
                    y1={line * chart.height}
                    y2={line * chart.height}
                    className="stroke-border"
                    strokeWidth={1}
                  />
                ))}
                {[
                  { path: ratePath, className: 'stroke-chart-2', delay: 250 },
                  { path: impressionsPath, className: 'stroke-chart-1', delay: 0 },
                ].map((line) => (
                  <path
                    key={line.className}
                    d={line.path}
                    pathLength={1}
                    fill="none"
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeDasharray={1}
                    strokeDashoffset={reached('combo') ? 0 : 1}
                    className={cn(
                      line.className,
                      'transition-[stroke-dashoffset] duration-[1500ms] ease-out motion-reduce:transition-none',
                    )}
                    style={{ transitionDelay: reached('combo') ? `${line.delay}ms` : '0ms' }}
                  />
                ))}
              </svg>
              <div className="mt-[0.8em] flex justify-center gap-[1.4em] text-[0.75em] text-muted-foreground">
                <LegendEntry className="bg-chart-1">Impressions</LegendEntry>
                <LegendEntry className="bg-chart-2">Click-through rate</LegendEntry>
              </div>
            </Appear>

            <div className="grid min-w-0 gap-[0.8em]">
              <Appear shown={reached('gauge')} className="rounded-[0.7em] border bg-card p-[0.9em]">
                <p className="truncate text-[0.85em]">Media spend against plan</p>
                <p className="mt-[0.5em] text-[1.45em] font-semibold tracking-tight tabular-nums">
                  {euro.format(200_975.81)}
                </p>
                <div className="mt-[0.7em] h-[0.45em] overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full origin-left rounded-full bg-chart-1 transition-transform delay-200 duration-1000 ease-out motion-reduce:transition-none"
                    style={{ transform: `scaleX(${reached('gauge') ? 0.77 : 0})` }}
                  />
                </div>
              </Appear>
              <Appear shown={reached('note')} className="rounded-[0.7em] border bg-card p-[0.9em]">
                <p className="text-[0.85em] leading-[1.6]">
                  Easter week carried the quarter. Spend stays inside the plan, so the remaining
                  budget moves to TikTok video in April.
                </p>
              </Appear>
            </div>

            {/* The hand-off: a person grabs the chart's edge and resizes it. The pointer follows
                the column boundary, so it uses the same duration and easing as the grid. */}
            <div
              className={cn(
                'pointer-events-none absolute top-[45%] z-10 transition-[left,top,opacity] duration-[1400ms] ease-in-out motion-reduce:transition-none',
                reached('grab') ? 'opacity-100' : 'top-[110%] opacity-0',
                reached('rest') && 'opacity-0',
              )}
              style={{ left: dragged ? '56%' : reached('grab') ? '66%' : '90%' }}
            >
              <svg viewBox="0 0 16 16" className="size-[1.4em] drop-shadow-sm">
                <path
                  d="M2 1.5 13.5 7 8.6 8.6 7 13.5Z"
                  className="fill-foreground stroke-background"
                  strokeWidth={1}
                  strokeLinejoin="round"
                />
              </svg>
              <span className="ml-[1.1em] block w-fit rounded-[0.4em] bg-primary px-[0.5em] py-[0.15em] text-[0.75em] font-medium text-primary-foreground">
                You
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Fades a widget into its reserved place. Hidden widgets keep their size, so nothing reflows. */
function Appear({
  shown,
  delay = 0,
  className,
  children,
}: {
  shown: boolean;
  delay?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'transition-[opacity,transform,filter] duration-500 ease-out motion-reduce:transition-none',
        shown ? 'opacity-100' : 'translate-y-[0.6em] scale-[0.98] opacity-0 blur-[2px]',
        className,
      )}
      style={{ transitionDelay: shown ? `${delay}ms` : '0ms' }}
    >
      {children}
    </div>
  );
}

function LegendEntry({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-[0.5em]">
      <span className={cn('size-[0.7em] rounded-[0.15em]', className)} />
      {children}
    </span>
  );
}

function Typewriter({ text, instant }: { text: string; instant: boolean }) {
  const [length, setLength] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setLength((current) => Math.min(text.length, current + 2)), 40);
    return () => clearInterval(timer);
  }, [text]);
  return text.slice(0, instant ? text.length : length);
}

/** Counts from zero to `value` with an ease-out curve each time `running` turns on. */
function CountUp({
  value,
  format,
  running,
  instant,
}: {
  value: number;
  format: Intl.NumberFormat;
  running: boolean;
  instant: boolean;
}) {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    if (!running) {
      setProgress(0);
      return;
    }
    const start = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const elapsed = Math.min(1, (now - start) / 1200);
      setProgress(1 - (1 - elapsed) ** 4);
      if (elapsed < 1) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [running]);
  return format.format(value * (instant ? 1 : progress));
}
