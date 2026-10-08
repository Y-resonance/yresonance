import { Link, createFileRoute } from '@tanstack/react-router';
import { AppShell } from '#/components/app-shell';
import { publicPageHead, siteUrl } from '#/lib/seo';

export const Route = createFileRoute('/imprint')({
  component: Imprint,
  head: () => ({
    ...publicPageHead('/imprint'),
    scripts: [
      {
        type: 'application/ld+json',
        children: JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home', item: `${siteUrl}/` },
            { '@type': 'ListItem', position: 2, name: 'Imprint', item: `${siteUrl}/imprint` },
          ],
        }),
      },
    ],
  }),
});

function Imprint() {
  return (
    <AppShell>
      <main className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 sm:py-24">
        <article className="max-w-2xl">
          <nav aria-label="Breadcrumb" className="mb-8 text-sm text-muted-foreground">
            <ol className="flex items-center gap-2">
              <li>
                <Link to="/" className="hover:underline">
                  Home
                </Link>
              </li>
              <li aria-hidden="true">/</li>
              <li aria-current="page">Imprint</li>
            </ol>
          </nav>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Imprint</h1>
          <p className="mt-4 text-base text-muted-foreground">Imprint of yresonance</p>

          <section id="creator" className="mt-12">
            <h2 className="text-xl font-semibold tracking-tight">Built by Patrik Simms</h2>
            <p className="mt-4 text-base leading-7 text-muted-foreground">
              I'm Patrik, a product engineer working mainly at esome advertising. I build tools to
              solve practical problems and keep the solutions simple. yresonance is my dashboard
              builder for client reporting.
            </p>
          </section>

          <section className="mt-12">
            <h2 className="text-xl font-semibold tracking-tight">Service provider</h2>
            <address className="mt-4 space-y-1 text-base leading-7 not-italic">
              <p>Patrik Simms</p>
              <p>Lokstedter Steindamm 96</p>
              <p>22529 Hamburg</p>
              <p>Germany</p>
            </address>
          </section>

          <section className="mt-10">
            <h2 className="text-xl font-semibold tracking-tight">Contact</h2>
            <p className="mt-4 text-base leading-7">
              Email:{' '}
              <a
                className="text-primary underline underline-offset-4"
                href="mailto:patriksimms@outlook.de"
              >
                patriksimms@outlook.de
              </a>
            </p>
          </section>
        </article>
      </main>
    </AppShell>
  );
}
