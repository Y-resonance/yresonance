import { useRouter } from '@tanstack/react-router';
import { UsersIcon } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useAuth } from '#/auth/provider';
import { useApi, useApiQuery } from '#/api/query';
import type { ApiRequest } from '#/api/contracts';
import { useWebMcpTools } from '#/webmcp/use-webmcp-tools';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Field, FieldGroup, FieldLabel } from './ui/field';
import { Alert, AlertDescription } from './ui/alert';
import { NativeSelect, NativeSelectOption } from './ui/native-select';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogTrigger } from './ui/dialog';

type Role = 'admin' | 'member';
interface WorkspaceList {
  memberships: { id: string; name: string; role: Role }[];
  invitations: { id: string; name: string; role: Role }[];
  activeWorkspaceId: string | null;
}
interface MemberList {
  members: { userId: string; email: string; name: string; role: Role }[];
  invitations: { id: string; email: string; role: Role }[];
}

export function KeycloakAccount() {
  const { isAdmin } = useAuth();
  const router = useRouter();
  useWebMcpTools({
    canManageWorkspaces: true,
    isAdmin,
    onMutation: async () => {
      await router.invalidate();
    },
  });
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Workspaces" />}>
        <UsersIcon />
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogTitle>Workspaces</DialogTitle>
        <DialogDescription>Choose a workspace or manage its members.</DialogDescription>
        <KeycloakWorkspaces />
        <form method="post" action="/api/auth/logout">
          <Button type="submit" variant="ghost" size="sm">
            Sign out
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function KeycloakWorkspaces() {
  const callApi = useApi();
  const { userId } = useAuth();
  const {
    data,
    error: loadError,
    refetch,
  } = useApiQuery<WorkspaceList>({ action: 'listWorkspaces' });
  const isAdmin =
    data?.memberships.some(
      (member) => member.id === data.activeWorkspaceId && member.role === 'admin',
    ) ?? false;
  const {
    data: memberData,
    error: memberError,
    refetch: refetchMembers,
  } = useApiQuery<MemberList>({ action: 'listWorkspaceMembers' }, { enabled: isAdmin });
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function run(request: ApiRequest, reload = false) {
    setBusy(true);
    setError(undefined);
    try {
      await callApi(request);
      if (reload) {
        window.location.assign('/');
        return;
      }
      await refetch();
      if (isAdmin) await refetchMembers();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update the workspace.');
    } finally {
      setBusy(false);
    }
  }
  function create(event: FormEvent) {
    event.preventDefault();
    void run({ action: 'createWorkspace', name }, true);
  }
  function invite(event: FormEvent) {
    event.preventDefault();
    void run({ action: 'inviteWorkspaceMember', email, role });
  }

  return (
    <div className="flex flex-col gap-6">
      {error || loadError || memberError ? (
        <Alert variant="destructive">
          <AlertDescription>{error ?? loadError?.message ?? memberError?.message}</AlertDescription>
        </Alert>
      ) : null}
      {!data ? (
        <p role="status">Loading workspaces...</p>
      ) : (
        <>
          {data.memberships.length ? (
            <section className="flex flex-col gap-2">
              <h2 className="font-medium">Your workspaces</h2>
              {data.memberships.map((workspace) => (
                <div key={workspace.id} className="flex items-center justify-between gap-3">
                  <span>{workspace.name}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || workspace.id === data.activeWorkspaceId}
                    onClick={() =>
                      void run({ action: 'selectWorkspace', workspaceId: workspace.id }, true)
                    }
                  >
                    {workspace.id === data.activeWorkspaceId ? 'Current' : 'Continue'}
                  </Button>
                </div>
              ))}
            </section>
          ) : null}
          {data.invitations.length ? (
            <section className="flex flex-col gap-2">
              <h2 className="font-medium">Invitations</h2>
              {data.invitations.map((invitation) => (
                <div key={invitation.id} className="flex items-center justify-between gap-3">
                  <span>{invitation.name}</span>
                  <Button
                    disabled={busy}
                    size="sm"
                    onClick={() =>
                      void run(
                        { action: 'acceptWorkspaceInvitation', invitationId: invitation.id },
                        true,
                      )
                    }
                  >
                    Accept
                  </Button>
                </div>
              ))}
            </section>
          ) : null}
          <form onSubmit={create}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="new-workspace">Create a workspace</FieldLabel>
                <Input
                  id="new-workspace"
                  value={name}
                  maxLength={100}
                  required
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
              <Field>
                <Button type="submit" disabled={busy || !name.trim()}>
                  Create workspace
                </Button>
              </Field>
            </FieldGroup>
          </form>
          {isAdmin ? (
            <section className="flex flex-col gap-4">
              <h2 className="font-medium">Workspace members</h2>
              {memberData?.members.map((member) => (
                <div
                  key={member.userId}
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <span className="min-w-0 truncate text-sm">{member.email}</span>
                  <div className="flex items-center gap-2">
                    <NativeSelect
                      aria-label={`Role for ${member.email}`}
                      value={member.role}
                      disabled={busy}
                      onChange={(event) =>
                        void run(
                          {
                            action: 'updateWorkspaceMember',
                            userId: member.userId,
                            role: event.target.value === 'admin' ? 'admin' : 'member',
                          },
                          member.userId === userId,
                        )
                      }
                    >
                      <NativeSelectOption value="member">Member</NativeSelectOption>
                      <NativeSelectOption value="admin">Admin</NativeSelectOption>
                    </NativeSelect>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          {
                            action: 'updateWorkspaceMember',
                            userId: member.userId,
                            role: 'remove',
                          },
                          member.userId === userId,
                        )
                      }
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
              {memberData?.invitations.map((invitation) => (
                <div
                  key={invitation.id}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span>{invitation.email} · Pending</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void run({ action: 'revokeWorkspaceInvitation', invitationId: invitation.id })
                    }
                  >
                    Revoke
                  </Button>
                </div>
              ))}
              <form onSubmit={invite}>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="invite-email">Invite by email</FieldLabel>
                    <Input
                      id="invite-email"
                      type="email"
                      required
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="invite-role">Role</FieldLabel>
                    <NativeSelect
                      id="invite-role"
                      value={role}
                      onChange={(event) =>
                        setRole(event.target.value === 'admin' ? 'admin' : 'member')
                      }
                    >
                      <NativeSelectOption value="member">Member</NativeSelectOption>
                      <NativeSelectOption value="admin">Admin</NativeSelectOption>
                    </NativeSelect>
                  </Field>
                  <p className="text-sm text-muted-foreground">
                    They can accept after signing in with this verified email. Invitations expire
                    after seven days.
                  </p>
                  <Field>
                    <Button type="submit" disabled={busy || !email}>
                      Invite member
                    </Button>
                  </Field>
                </FieldGroup>
              </form>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
