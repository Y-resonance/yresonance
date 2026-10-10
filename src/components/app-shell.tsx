import { Show, UserButton } from '@clerk/tanstack-react-start';
import { Link } from '@tanstack/react-router';
import { MenuIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { GetAccessButton, SignInAction } from '#/components/auth-actions';
import { ThemeToggle } from '#/components/theme-toggle';
import { Button } from '#/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '#/components/ui/sheet';
import { WorkspaceGate } from '#/components/workspace-gate';

// Dashboards live at the root, so only an exact match may mark it active. The
// others stay active on their detail routes, such as /datasources/:datasourceId.
const navigation = [
  { to: '/', label: 'Dashboards', exact: true },
  { to: '/datasources', label: 'Datasources', exact: false },
] as const;

// Active and inactive styling are kept apart so the two never both apply and
// leave the winning border colour to stylesheet order.
const barLink = 'flex h-full items-center border-b-2 transition-colors hover:text-foreground';
const barLinkActive = { className: 'border-foreground text-foreground' };
const barLinkInactive = { className: 'border-transparent text-muted-foreground' };

const sheetLink =
  'flex min-h-11 items-center rounded-lg px-2 text-sm hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none';
const sheetLinkActive = { className: 'bg-muted font-medium text-foreground' };
const sheetLinkInactive = { className: 'text-muted-foreground' };

export function AppShell({
  children,
  requireWorkspace = false,
}: {
  children: ReactNode;
  requireWorkspace?: boolean;
}) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-3 px-4 sm:gap-5 sm:px-6">
          <Show when="signed-in">
            <MobileNavigation />
          </Show>
          <Link className="font-semibold tracking-tight" to="/">
            yresonance
          </Link>
          {/* Links collapse into the sheet below sm so the bar still fits a 320 px screen. */}
          <nav
            aria-label="Main"
            className="hidden h-full flex-1 items-center gap-4 text-sm sm:flex"
          >
            <Show when="signed-in">
              {navigation.map((item) => (
                <Link
                  key={item.to}
                  className={barLink}
                  activeProps={barLinkActive}
                  inactiveProps={barLinkInactive}
                  activeOptions={{ exact: item.exact }}
                  to={item.to}
                >
                  {item.label}
                </Link>
              ))}
            </Show>
          </nav>
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <ThemeToggle />
            <Show when="signed-out">
              <SignInAction>
                <Button className="hidden min-[360px]:inline-flex" variant="ghost" size="sm">
                  Sign in
                </Button>
              </SignInAction>
              <GetAccessButton size="sm" />
            </Show>
            <Show when="signed-in">
              <UserButton />
            </Show>
          </div>
        </div>
      </header>
      {requireWorkspace ? <WorkspaceGate>{children}</WorkspaceGate> : children}
    </div>
  );
}

function MobileNavigation() {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={<Button className="sm:hidden" variant="ghost" size="icon-sm" aria-label="Menu" />}
      >
        <MenuIcon />
      </SheetTrigger>
      <SheetContent side="left" className="w-[min(80vw,18rem)]">
        <SheetHeader>
          <SheetTitle>Menu</SheetTitle>
          <SheetDescription>Move between the workspace screens.</SheetDescription>
        </SheetHeader>
        <ul className="flex flex-col gap-1 px-2 pb-4">
          {navigation.map((item) => (
            <li key={item.to}>
              <Link
                className={sheetLink}
                activeProps={sheetLinkActive}
                inactiveProps={sheetLinkInactive}
                activeOptions={{ exact: item.exact }}
                to={item.to}
                onClick={() => setOpen(false)}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  );
}
