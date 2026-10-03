import { SignInAction, SignUpAction } from '#/components/auth-actions';
import { BrowserFrame } from '#/components/browser-frame';
import { Button } from '#/components/ui/button';
import { cn } from '#/lib/utils';
import { usePageTitle } from '#/lib/page-title';
import { Link } from '@tanstack/react-router';

const claims = [
  {
    title: 'Agents build, you adjust',
    body: 'Every action in the GUI is also a site tool, so an agent can assemble the first draft and you correct it by hand.',
  },
  {
    title: 'Queries stay readable',
    body: 'Widgets compile to SQL over your own CSV and parquet files. No copies, no hidden transforms, no second warehouse.',
  },
  {
    title: 'Share without seats',
    body: 'Send a link or grant a colleague access. Viewers get the stored widgets and controls and nothing else.',
  },
];

/**
 * Shows the screenshot that matches the active theme. The theme is a class on the document rather
 * than a media query, so CSS picks the variant the same way the header icons do and the server
 * needs no theme state. `bun run scripts/capture-landing.ts` writes both files.
 *
 * Only the visible image is in the accessibility tree, and the hidden one is never fetched unless
 * `priority` opts it out of lazy loading, which the hero needs for its own paint.
 */
function Screenshot({
  name,
  alt,
  width,
  height,
  className,
  priority = false,
}: {
  name: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
  priority?: boolean;
}) {
  const shared = {
    alt,
    width,
    height,
    ...(priority ? ({ fetchPriority: 'high' } as const) : ({ loading: 'lazy' } as const)),
  };
  return (
    <>
      <img src={`/landing/${name}.png`} className={cn('dark:hidden', className)} {...shared} />
      <img
        src={`/landing/${name}-dark.png`}
        className={cn('hidden dark:block', className)}
        {...shared}
      />
    </>
  );
}

export function LandingPage() {
  usePageTitle();

  return (
    <main>
      <section className="mx-auto w-full max-w-7xl px-4 pt-16 pb-12 sm:px-6 sm:pt-24">
        <div className="reveal-on-scroll max-w-3xl">
          <p className="text-sm font-medium text-muted-foreground">
            Client reporting without the rebuild
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
            Describe the report. Fine-tune in the editor.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground">
            yresonance turns reporting intent into query-backed dashboards while keeping every
            formula, filter, and access rule inspectable.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <SignUpAction>
              <Button className="h-10 px-4">Create account</Button>
            </SignUpAction>
            <SignInAction>
              <Button variant="outline" className="h-10 px-4">
                Sign in
              </Button>
            </SignInAction>
          </div>
        </div>
        <BrowserFrame
          url="yresonance.com/dashboards/q1-delivery"
          className="reveal-on-scroll mt-14"
        >
          <Screenshot
            name="dashboard"
            alt="A yresonance dashboard with a date range and two filter controls, impressions, clicks, media spend and click-through rate against the previous period, a chart pairing impressions with click-through rate, a gauge for media spend against plan and a written note."
            width={2880}
            height={1632}
            priority
            className="h-auto w-full"
          />
        </BrowserFrame>
      </section>

      <section className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6">
        <div className="grid gap-10 sm:grid-cols-3">
          {claims.map((claim) => (
            <div key={claim.title} className="reveal-on-scroll">
              <h2 className="text-lg font-semibold tracking-tight">{claim.title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{claim.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6">
        <div className="reveal-on-scroll max-w-2xl">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Every breakdown the report needs
          </h2>
          <p className="mt-3 text-base leading-7 text-muted-foreground">
            Grouped bars, share of spend and a pivot table with totals run on the same query. One
            date range and one filter set drive all of them.
          </p>
        </div>
        {/* The image continues the dashboard above, so it carries no browser chrome of its own. */}
        <Screenshot
          name="dashboard-breakdown"
          alt="Impressions by campaign and ad format as grouped bars, spend share by platform as a pie chart, and a pivot table of impressions and media spend per campaign and platform ending in a grand total row."
          width={2880}
          height={1792}
          className="reveal-on-scroll mt-10 h-auto w-full rounded-xl border"
        />
      </section>

      <section className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6">
        <div className="reveal-on-scroll max-w-2xl">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Field metadata stays yours
          </h2>
          <p className="mt-3 text-base leading-7 text-muted-foreground">
            Register a file that already exists, then correct only the labels, roles and types that
            matter. Every dashboard built on that source follows.
          </p>
        </div>
        <BrowserFrame
          url="yresonance.com/datasources/campaign-delivery"
          className="reveal-on-scroll mt-10"
        >
          <Screenshot
            name="field-metadata"
            alt="The yresonance datasource screen listing each column of a registered file with its label, source, role, type and description, ending with a calculated field."
            width={2880}
            height={1960}
            className="h-auto max-h-[32rem] w-full object-cover object-top"
          />
        </BrowserFrame>
      </section>

      <section className="mx-auto w-full max-w-7xl px-4 py-20 sm:px-6">
        <div className="reveal-on-scroll">
          <h2 className="max-w-2xl text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
            Point yresonance at a file you already have and see the first dashboard.
          </h2>
          <div className="mt-7">
            <SignUpAction>
              <Button className="h-10 px-4">Create account</Button>
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
          Imprint
        </Link>
      </footer>
    </main>
  );
}
