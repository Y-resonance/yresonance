export interface DashboardCollaborator {
  clerkUserId: string;
  displayName?: string;
  userEmail?: string;
  imageUrl?: string;
  role: string;
}

export function sharedUserLabel(user: Pick<DashboardCollaborator, 'displayName' | 'userEmail'>) {
  if (user.displayName && user.userEmail) return `${user.displayName} · ${user.userEmail}`;
  return user.displayName ?? user.userEmail ?? 'Unknown or deleted user';
}
