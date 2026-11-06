import { Show } from '@clerk/tanstack-react-start';
import { Link } from '@tanstack/react-router';
import { GitHubIcon, githubUrl, trackGitHubClick } from '#/components/github-link';

const link = 'transition-colors hover:text-foreground';
const heading = 'font-medium text-foreground';

const repositoryLinks = [
  { label: 'Source code', href: githubUrl },
  { label: 'Issues', href: `${githubUrl}/issues` },
  { label: 'Documentation', href: `${githubUrl}/blob/main/docs/index.md` },
  { label: 'MIT license', href: `${githubUrl}/blob/main/LICENSE` },
];

/** Footer for public pages. The workspace screens leave it out to keep their vertical space. */
export function SiteFooter() {
  return (
    <footer className="bg-muted/40 text-sm text-muted-foreground">
      <div className="mx-auto grid w-full max-w-7xl grid-cols-2 gap-x-6 gap-y-10 px-4 pt-12 pb-8 sm:grid-cols-4 sm:px-6">
        <div className="col-span-2 sm:col-span-1">
          <Link className="font-semibold tracking-tight text-foreground" to="/">
            yresonance
          </Link>
          <p className="mt-2">Client reporting dashboards.</p>
        </div>

        {/* These jump to landing sections, and signed-in visitors get dashboards at / instead. */}
        <Show when="signed-out">
          <nav aria-label="Product">
            <p className={heading}>Product</p>
            <ul className="mt-3 flex flex-col gap-2">
              <li>
                <Link className={link} to="/" hash="agent-tools">
                  Agent tools
                </Link>
              </li>
              <li>
                <Link className={link} to="/" hash="reports">
                  Reports
                </Link>
              </li>
              <li>
                <Link className={link} to="/" hash="faq-title">
                  FAQ
                </Link>
              </li>
            </ul>
          </nav>
        </Show>

        <nav aria-label="Open source">
          <p className={heading}>Open source</p>
          <ul className="mt-3 flex flex-col gap-2">
            {repositoryLinks.map(({ label, href }) => (
              <li key={href}>
                <a
                  className={link}
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => trackGitHubClick('footer')}
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-label="Company">
          <p className={heading}>Company</p>
          <ul className="mt-3 flex flex-col gap-2">
            <li>
              <Link className={link} to="/imprint">
                Imprint
              </Link>
            </li>
            <li>
              <Link className={link} to="/imprint" hash="creator">
                Creator
              </Link>
            </li>
            <li>
              <a className={link} href="mailto:patriksimms@outlook.de">
                Contact
              </a>
            </li>
          </ul>
        </nav>

        <div className="col-span-2 flex items-center justify-between sm:col-span-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>© {new Date().getFullYear()} Patrik Simms</span>
            <Link className={link} to="/privacy">
              Privacy
            </Link>
            <Link className={link} to="/terms">
              Terms
            </Link>
          </div>
          <a
            className={link}
            href={githubUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="yresonance on GitHub"
            onClick={() => trackGitHubClick('footer')}
          >
            <GitHubIcon className="size-4" />
          </a>
        </div>
      </div>
    </footer>
  );
}
