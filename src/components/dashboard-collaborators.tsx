import type { DashboardCollaborator } from '#/domain/sharing';
import { sharedUserLabel } from '#/domain/sharing';
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from '#/components/ui/avatar';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '#/components/ui/popover';

export function CollaboratorAvatar({
  user,
  size = 'default',
}: {
  user: DashboardCollaborator;
  size?: 'default' | 'sm';
}) {
  const name = user.displayName || user.userEmail;
  const initials =
    name
      ?.split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || '?';
  return (
    <Avatar size={size}>
      <AvatarImage src={user.imageUrl} alt="" />
      <AvatarFallback>{initials}</AvatarFallback>
    </Avatar>
  );
}

export function DashboardCollaborators({
  users = [],
  size = 'default',
}: {
  users?: DashboardCollaborator[];
  size?: 'default' | 'sm';
}) {
  if (!users.length) return null;
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        closeDelay={150}
        aria-label={`Show ${users.length} collaborator${users.length === 1 ? '' : 's'}`}
        className="self-start rounded-full outline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
      >
        <AvatarGroup aria-hidden="true">
          {users.slice(0, 3).map((user) => (
            <CollaboratorAvatar key={user.clerkUserId} user={user} size={size} />
          ))}
          {users.length > 3 ? <AvatarGroupCount>+{users.length - 3}</AvatarGroupCount> : null}
        </AvatarGroup>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)]">
        <PopoverTitle>Collaborators ({users.length})</PopoverTitle>
        <ul
          className="flex max-h-72 flex-col gap-3 overflow-y-auto"
          tabIndex={0}
          aria-label="Collaborators"
        >
          {users.map((user) => (
            <li key={user.clerkUserId} className="flex items-center gap-3">
              <CollaboratorAvatar user={user} />
              <div className="min-w-0 flex-1">
                <p className="break-words">{sharedUserLabel(user)}</p>
                <p className="text-xs text-muted-foreground capitalize">{user.role}</p>
              </div>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
