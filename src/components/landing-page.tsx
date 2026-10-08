import { SignInAction, SignUpAction } from '#/components/auth-actions';
import { BrowserFrame } from '#/components/browser-frame';
import { BuildDemo } from '#/components/landing/build-demo';
import { useInView } from '#/components/landing/motion';
import { Button } from '#/components/ui/button';
import { cn } from '#/lib/utils';
import { landingFaqs } from '#/lib/seo';
import { Link } from '@tanstack/react-router';
import { ArrowRightIcon } from 'lucide-react';

// Real action names from src/api/contracts.ts, split over two rows that scroll in opposite
// directions.
const toolRows = [
  [
    'createDashboard',
    'addPage',
    'addWidget',
    'updateWidget',
    'moveWidget',
    'copyWidget',
    'updateLayout',
    'previewWidget',
    'queryWidget',
    'explainWidget',
    'shareDashboard',
  ],
  [
    'describeDatasource',
    'registerDatasource',
    'updateFieldMetadata',
    'upsertCalculatedField',
    'validateMetricExpression',
    'upsertLibraryMetric',
    'listLibraryMetrics',
    'getControlOptions',
    'duplicateDashboard',
  ],
];

// An illustration of what a widget compiles to. Tokens are pre-split so keywords can be tinted
// without a highlighter.
const sqlLines: Array<Array<{ text: string; keyword?: boolean }>> = [
  [{ text: 'SELECT', keyword: true }, { text: ' date,' }],
  [
    { text: '       ' },
    { text: 'SUM', keyword: true },
    { text: '(impressions) ' },
    { text: 'AS', keyword: true },
    { text: ' impressions,' },
  ],
  [
    { text: '       ' },
    { text: 'SUM', keyword: true },
    { text: '(clicks) / ' },
    { text: 'SUM', keyword: true },
    { text: '(impressions) ' },
    { text: 'AS', keyword: true },
    { text: ' ctr' },
  ],
  [{ text: 'FROM', keyword: true }, { text: ' campaign_delivery' }],
  [
    { text: 'WHERE', keyword: true },
    { text: ' date ' },
    { text: 'BETWEEN', keyword: true },
    { text: " '2026-01-01' " },
    { text: 'AND', keyword: true },
    { text: " '2026-03-31'" },
  ],
  [{ text: '  ' }, { text: 'AND', keyword: true }, { text: " market = 'DE'" }],
  [{ text: 'GROUP BY', keyword: true }, { text: ' date' }],
  [{ text: 'ORDER BY', keyword: true }, { text: ' date' }],
];

const backends = [
  { name: 'DuckDB', logo: '/analytics-backends/duckdb.svg' },
  { name: 'ClickHouse', logo: '/analytics-backends/clickhouse.svg' },
];

const facts = [
  {
    title: 'Share without seats',
    body: 'Send a link or grant a colleague access. Viewers get the stored widgets and controls and nothing else.',
  },
  {
    title: 'One filter set',
    body: 'A date range or filter applies to every widget that knows the field, across datasources.',
  },
  {
    title: 'Works on a phone',
    body: 'Clients open the same report on mobile. Nothing extra to build or maintain.',
  },
];

/**
 * Shows the screenshot that matches the active theme. The theme is a class on the document rather
 * than a media query, so CSS picks the variant the same way the header icons do and the server
 * needs no theme state. `bun run scripts/capture-landing.ts` writes the source PNGs.
 * `bun run scripts/convert-landing-images.ts` produces the lossless WebP assets.
 *
 * Only the visible image is in the accessibility tree, and the hidden one is never fetched because
 * both load lazily.
 */
function Screenshot({
  name,
  alt,
  width,
  height,
  className,
}: {
  name: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
}) {
  const shared = { alt, width, height, loading: 'lazy', decoding: 'async' } as const;
  return (
    <>
      <img src={`/landing/${name}.webp`} className={cn('dark:hidden', className)} {...shared} />
      <img
        src={`/landing/${name}-dark.webp`}
        className={cn('hidden dark:block', className)}
        {...shared}
      />
    </>
  );
}

/**
 * A soft brand-colored light that drifts slowly behind hero and closing sections. The radial mask
 * fades it out before the box edge, so the blur never ends in a visible cutoff.
 */
function Aurora({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute -z-10 overflow-hidden mask-radial-from-20% mask-radial-to-70%',
        className,
      )}
    >
      <div className="aurora absolute top-1/4 left-1/4 size-1/2 rounded-full bg-primary/25 blur-[100px] dark:bg-primary/20" />
      <div className="aurora absolute top-1/3 right-1/5 size-2/5 rounded-full bg-chart-7/20 blur-[110px] [animation-delay:-7s] [animation-duration:19s]" />
    </div>
  );
}

function ToolMarquee() {
  return (
    <div
      aria-hidden
      className="marquee mt-10 flex flex-col gap-3 overflow-hidden mask-x-from-80% font-mono text-sm sm:text-base"
    >
      {toolRows.map((tools, row) => (
        <div
          key={tools[0]}
          className={cn('marquee-track flex w-max', row % 2 && '[animation-direction:reverse]')}
        >
          {/* The list is rendered twice so the -50% loop point is seamless. */}
          {[...tools, ...tools].map((tool, index) => (
            <span
              key={`${tool}-${index}`}
              className="px-5 text-muted-foreground transition-colors hover:text-foreground"
            >
              {tool}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

/** The compiled query writes itself line by line the first time it scrolls into view. */
function CompiledQuery() {
  const [ref, inView] = useInView<HTMLDivElement>({ threshold: 0.5, once: true });
  return (
    <div
      ref={ref}
      className="reveal-on-scroll overflow-x-auto rounded-xl border bg-card font-mono text-xs leading-6 shadow-sm sm:text-sm sm:leading-7"
    >
      <p className="border-b px-4 py-3 text-muted-foreground">
        ctr = <span className="text-foreground">SUM(clicks) / SUM(impressions)</span>
      </p>
      <pre className="px-4 py-3">
        {sqlLines.map((tokens, line) => (
          <span
            key={line}
            className={cn(
              'block transition-[opacity,transform] duration-500 ease-out motion-reduce:transition-none',
              !inView &&
                'translate-x-2 opacity-0 motion-reduce:translate-x-0 motion-reduce:opacity-100',
            )}
            style={{ transitionDelay: `${line * 110}ms` }}
          >
            {tokens.map((token, index) => (
              <span key={index} className={token.keyword ? 'text-primary' : undefined}>
                {token.text}
              </span>
            ))}
          </span>
        ))}
      </pre>
    </div>
  );
}

const section = 'mx-auto w-full max-w-7xl px-4 sm:px-6';
const sectionTitle = 'text-3xl font-semibold tracking-tight text-balance sm:text-5xl';
const sectionBody = 'mt-4 max-w-xl text-base leading-7 text-muted-foreground';

export function LandingPage() {
  return (
    <main className="overflow-x-clip">
      <section className={cn(section, 'relative isolate pt-16 pb-24 text-center sm:pt-28')}>
        <Aurora className="inset-x-0 top-0 h-[44rem]" />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[36rem] mask-radial-from-0% mask-radial-to-70% mask-radial-at-top bg-[radial-gradient(circle,var(--color-muted-foreground)_1px,transparent_1px)] bg-size-[22px_22px] opacity-30"
        />

        <p className="text-sm font-medium text-muted-foreground">
          CSV, Parquet and ClickHouse reporting
        </p>
        <h1 className="mx-auto mt-5 max-w-4xl text-5xl font-semibold tracking-tighter text-balance sm:text-7xl">
          Build client reporting dashboards.
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">
          Connect your data, create charts and formulas, and share reports with clients. Let your
          agent draft the dashboard, then edit it yourself.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <SignUpAction>
            <Button className="group h-11 px-5 text-sm">
              Create account
              <ArrowRightIcon className="transition-transform group-hover:translate-x-0.5" />
            </Button>
          </SignUpAction>
          <SignInAction>
            <Button variant="outline" className="h-11 px-5 text-sm">
              Sign in
            </Button>
          </SignInAction>
        </div>

        <div className="mt-16 perspective-[2000px] sm:mt-20">
          <BrowserFrame
            url="yresonance.com/dashboards/q1-delivery"
            className="hero-tilt shadow-2xl ring-1 shadow-primary/15 ring-primary/10"
          >
            <BuildDemo />
          </BrowserFrame>
        </div>
      </section>

      <section className="py-20 sm:py-28">
        <div className={cn(section, 'reveal-on-scroll')}>
          <h2 className={sectionTitle}>Every click is also a tool</h2>
          <p className={sectionBody}>
            The editor and your agent share one set of actions. Whatever ChatGPT or Chrome drafts,
            you can inspect and change by hand.
          </p>
        </div>
        <ToolMarquee />
      </section>

      <section className={cn(section, 'py-20 sm:py-28')}>
        <div className="reveal-on-scroll">
          <h2 className={sectionTitle}>Every breakdown the report needs</h2>
          <p className={sectionBody}>
            Trends, grouped bars, share of spend and a pivot table with totals. One date range and
            one filter set drive all of them.
          </p>
        </div>
        <div className="zoom-on-scroll mt-12 overflow-hidden rounded-xl border shadow-xl">
          <Screenshot
            name="dashboard"
            alt="A yresonance dashboard with a date range and two filter controls, impressions, clicks, media spend and click-through rate against the previous period, a chart pairing impressions with click-through rate, a gauge for media spend against plan and a written note."
            width={2880}
            height={1632}
            className="h-auto w-full"
          />
          {/* Continues the dashboard above, so the two captures read as one long report. */}
          <Screenshot
            name="dashboard-breakdown"
            alt="Impressions by campaign and ad format as grouped bars, spend share by platform as a pie chart, and a pivot table of impressions and media spend per campaign and platform ending in a grand total row."
            width={2880}
            height={1792}
            className="h-auto w-full"
          />
        </div>
      </section>

      <section
        className={cn(section, 'grid items-center gap-12 py-20 sm:py-28 lg:grid-cols-[2fr_3fr]')}
      >
        <div className="reveal-on-scroll">
          <h2 className={sectionTitle}>Queries stay readable</h2>
          <p className={sectionBody}>
            Widgets compile to SQL over CSV, Parquet or ClickHouse data. Inspect the formulas and
            choose how long query results stay cached.
          </p>
          <ul className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-muted-foreground">
            <li>Runs on</li>
            {backends.map((backend) => (
              <li key={backend.name} className="flex items-center gap-2 text-foreground">
                <img src={backend.logo} alt="" width={20} height={20} className="size-5" />
                {backend.name}
              </li>
            ))}
          </ul>
        </div>
        <CompiledQuery />
      </section>

      <section className={cn(section, 'py-20 sm:py-28')}>
        <div className="reveal-on-scroll">
          <h2 className={sectionTitle}>Field metadata stays yours</h2>
          <p className={sectionBody}>
            Register a file that already exists, then correct only the labels, roles and types that
            matter. Every dashboard built on that source follows.
          </p>
        </div>
        <BrowserFrame
          url="yresonance.com/datasources/campaign-delivery"
          className="zoom-on-scroll mt-12 shadow-xl"
        >
          <Screenshot
            name="field-metadata"
            alt="The yresonance datasource screen listing each column of a registered file with its label, source, role, type and description, ending with a calculated field."
            width={2880}
            height={1960}
            className="h-auto max-h-[36rem] w-full object-cover object-top"
          />
        </BrowserFrame>
      </section>

      <section className={cn(section, 'grid gap-10 py-20 sm:grid-cols-3 sm:py-28')}>
        {facts.map((fact) => (
          <div key={fact.title} className="reveal-on-scroll">
            <h2 className="text-xl font-semibold tracking-tight">{fact.title}</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{fact.body}</p>
          </div>
        ))}
      </section>

      <section className={cn(section, 'py-20 sm:py-28')} aria-labelledby="faq-title">
        <h2 id="faq-title" className={sectionTitle}>
          Frequently asked questions
        </h2>
        <dl className="mt-10 grid max-w-3xl gap-8">
          {landingFaqs.map(({ question, answer }) => (
            <div key={question}>
              <dt className="text-lg font-semibold">{question}</dt>
              <dd className="mt-2 text-base leading-7 text-muted-foreground">{answer}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className={cn(section, 'relative isolate py-28 text-center sm:py-40')}>
        <Aurora className="inset-0" />
        <div className="reveal-on-scroll">
          <h2 className={cn(sectionTitle, 'mx-auto max-w-3xl')}>
            Point yresonance at a file you already have and see the first dashboard.
          </h2>
          <div className="mt-9">
            <SignUpAction>
              <Button className="group h-11 px-5 text-sm">
                Create account
                <ArrowRightIcon className="transition-transform group-hover:translate-x-0.5" />
              </Button>
            </SignUpAction>
          </div>
        </div>
      </section>
      <footer
        className="mx-auto flex w-full max-w-7xl items-center gap-2 px-4 py-8 text-sm text-muted-foreground sm:px-6"
        role="contentinfo"
      >
        <span>yresonance</span>
        <span aria-hidden="true">·</span>
        <Link className="hover:text-foreground hover:underline" to="/imprint">
          Imprint and creator
        </Link>
      </footer>
    </main>
  );
}
