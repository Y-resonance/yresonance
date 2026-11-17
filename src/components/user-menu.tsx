import { LogOutIcon, SettingsIcon } from 'lucide-react';
import { browserAnalytics } from '#/analytics/browser';
import { Avatar, AvatarFallback, AvatarImage } from '#/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu';
import { useAuth, useAuthActions } from '#/platform/index.ui';

/** Account menu of the signed-in user. The same for every auth provider. */
export function UserMenu() {
  const { user } = useAuth();
  const { signOut, manageAccount } = useAuthActions();
  const name = user?.name || user?.email;
  const initials =
    name
      ?.split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || '?';

  function run(action: 'manage_account' | 'sign_out', operation: () => void) {
    browserAnalytics()?.capture('account_menu_action', { action });
    operation();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account"
        className="rounded-full outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
      >
        <Avatar>
          <AvatarImage src={user?.imageUrl ?? undefined} alt="" />
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <div className="px-1.5 py-1">
          {user?.name ? <p className="truncate text-sm font-medium">{user.name}</p> : null}
          {user?.email ? (
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          ) : null}
        </div>
        {manageAccount ? (
          <DropdownMenuItem onClick={() => run('manage_account', manageAccount)}>
            <SettingsIcon />
            Manage account
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onClick={() => run('sign_out', signOut)}>
          <LogOutIcon />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
