import { createFileRoute } from '@tanstack/react-router';
import { AppShell } from '#/components/app-shell';
import { usePageTitle } from '#/lib/page-title';

export const Route = createFileRoute('/imprint')({ component: Imprint });

function Imprint() {
  usePageTitle('Imprint');

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 sm:py-24">
        <article className="max-w-2xl">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Imprint</h1>
          <p className="mt-4 text-base text-muted-foreground">Imprint of yresonance</p>

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
