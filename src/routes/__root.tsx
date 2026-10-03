import { ClerkProvider } from '@clerk/tanstack-react-start';
import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { TooltipProvider } from '#/components/ui/tooltip';

import appCss from '../styles.css?url';

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'yresonance' },
      {
        name: 'description',
        content: 'yresonance dashboard reporting',
      },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/favicon.ico', sizes: '48x48' },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
    ],
  }),
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Applies the stored theme (or the OS preference) before first paint,
            so a dark-mode visitor never sees a light flash. Must stay inline
            and ahead of hydration. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}",
          }}
        />
        <HeadContent />
      </head>
      <body>
        <ClerkProvider signInUrl="/sign-in" signUpUrl="/sign-up">
          <TooltipProvider>
            {children}
            <Scripts />
          </TooltipProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
