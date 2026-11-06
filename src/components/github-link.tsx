import type { ComponentProps } from 'react';
import { browserAnalytics } from '#/analytics/browser';
import { buttonVariants } from '#/components/ui/button';
import { cn } from '#/lib/utils';

export const githubUrl = 'https://github.com/Y-resonance/yresonance';

export const trackGitHubClick = (source: 'header' | 'footer') =>
  browserAnalytics()?.capture('github_link_clicked', { source });

// Lucide dropped brand icons, so the mark is inlined. Decorative: the link names its destination.
export function GitHubIcon(props: ComponentProps<'svg'>) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12 .3a12 12 0 0 0-3.8 23.38c.6.12.83-.26.83-.57l-.02-2.23c-3.34.72-4.04-1.42-4.04-1.42-.55-1.39-1.33-1.76-1.33-1.76-1.09-.74.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5 1 .1-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.1-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.3-1.55 3.3-1.23 3.3-1.23.64 1.66.23 2.88.1 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.63-5.48 5.92.43.37.81 1.1.81 2.22l-.01 3.29c0 .31.22.69.83.57A12 12 0 0 0 12 .3" />
    </svg>
  );
}

// GitHub has no link that stars directly, so this opens the repository where the star button lives.
// A plain anchor with button styles: Button's render prop would announce the link as a button.
export function GitHubStarButton({ className }: { className?: string }) {
  return (
    <a
      className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), className)}
      href={githubUrl}
      target="_blank"
      rel="noreferrer"
      aria-label="Star yresonance on GitHub"
      onClick={() => trackGitHubClick('header')}
    >
      <GitHubIcon />
      Star
    </a>
  );
}
