import type { ReactNode } from 'react';
import { AppShell } from '#/components/app-shell';
import { SiteFooter } from '#/components/site-footer';

/** Layout for short public pages such as the imprint. */
export function PublicPage({ children }: { children: ReactNode }) {
  return (
    <AppShell>
      {/* Fills the viewport below the header (3.5rem plus its 1px border) so the footer rests at the bottom. */}
      <div className="flex min-h-[calc(100vh-3.5rem-1px)] flex-col">
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-16 sm:px-6 sm:py-24">
          <article className="max-w-2xl">{children}</article>
        </main>
        <SiteFooter />
      </div>
    </AppShell>
  );
}

/** Placeholder for a legal page whose text is not written yet. Pair it with `wipPageHead`. */
export function WipPage({ title }: { title: string }) {
  return (
    <PublicPage>
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">{title}</h1>
      <p className="mt-4 text-base leading-7 text-muted-foreground">
        This page is a work in progress. Questions until then:{' '}
        <a
          className="text-primary underline underline-offset-4"
          href="mailto:patriksimms@outlook.de"
        >
          patriksimms@outlook.de
        </a>
      </p>
    </PublicPage>
  );
}
