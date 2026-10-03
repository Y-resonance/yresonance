import { CheckIcon, CopyIcon, Share2Icon, Trash2Icon } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { callApi } from '#/api/client';
import { Button } from '#/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '#/components/ui/field';
import { Input } from '#/components/ui/input';
import { NativeSelect, NativeSelectOption } from '#/components/ui/native-select';
import { Separator } from '#/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { sharedUserLabel } from '#/domain/sharing';

export interface SharingState {
  links: Array<{ token: string; url: string; createdAt: string }>;
  grants: Array<{
    clerkUserId: string;
    userEmail?: string;
    displayName?: string;
    role: string;
    grantedAt: string;
  }>;
}

export function DashboardSharing({
  dashboardId,
  sharing,
  refresh,
  linksOnly = false,
  loading = false,
  error,
  onOpenChange,
}: {
  dashboardId: string;
  linksOnly?: boolean;
  loading?: boolean;
  error?: string;
  onOpenChange?: (open: boolean) => void;
  sharing: SharingState;
  refresh: () => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'viewer' | 'editor'>('viewer');
  const [message, setMessage] = useState<string>();
  const [copiedToken, setCopiedToken] = useState<string>();
  // The service returns share paths; the origin only exists in the browser, so it fills in
  // after hydration and the displayed link stays a full URL people can paste anywhere.
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);
  useEffect(() => {
    if (!copiedToken) return;
    const timer = setTimeout(() => setCopiedToken(undefined), 2000);
    return () => clearTimeout(timer);
  }, [copiedToken]);
  async function copyLink(token: string, url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setMessage(undefined);
      setCopiedToken(token);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : String(caught));
    }
  }
  async function mutate(action: () => Promise<void>, success: string) {
    if (pending) return false;
    setPending(true);
    setMessage(undefined);
    try {
      await action();
      await refresh();
      setMessage(success);
      return true;
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : String(caught));
      return false;
    } finally {
      setPending(false);
    }
  }
  async function grant(event: FormEvent) {
    event.preventDefault();
    const granted = await mutate(
      () =>
        callApi({
          action: 'shareDashboard',
          dashboardId,
          operation: { kind: 'grant', userEmail: email, role },
        }),
      `Granted ${role} access to ${email}.`,
    );
    if (granted) setEmail('');
  }
  return (
    <Dialog onOpenChange={onOpenChange}>
      {linksOnly ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <DialogTrigger
                render={<Button variant="ghost" size="icon-sm" aria-label="Share" />}
              />
            }
          >
            <Share2Icon aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent>Share</TooltipContent>
        </Tooltip>
      ) : (
        <DialogTrigger render={<Button variant="outline" />}>Share</DialogTrigger>
      )}
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Share dashboard</DialogTitle>
          <DialogDescription>
            {linksOnly
              ? 'Anyone with a link can view this dashboard.'
              : 'Links are read-only. User grants require a Clerk account.'}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Button
            disabled={loading || pending || Boolean(error)}
            className="self-start"
            onClick={() =>
              void mutate(
                () =>
                  callApi({
                    action: 'shareDashboard',
                    dashboardId,
                    operation: { kind: 'createLink' },
                  }),
                'Created an unlisted link.',
              )
            }
          >
            Create unlisted link
          </Button>
          {sharing.links.map((link) => {
            const shareUrl = `${origin}${link.url}`;
            const copied = copiedToken === link.token;
            return (
              <div className="flex items-center gap-3" key={link.token}>
                <a className="min-w-0 flex-1 break-all text-sm underline" href={link.url}>
                  {shareUrl}
                </a>
                <Button
                  aria-label={copied ? 'Copied unlisted link' : 'Copy unlisted link'}
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => void copyLink(link.token, shareUrl)}
                >
                  {copied ? <CheckIcon /> : <CopyIcon />}
                </Button>
                <Button
                  disabled={loading || pending || Boolean(error)}
                  aria-label="Revoke unlisted link"
                  size="icon-sm"
                  variant="ghost"
                  onClick={() =>
                    void mutate(
                      () =>
                        callApi({
                          action: 'shareDashboard',
                          dashboardId,
                          operation: { kind: 'revokeLink', token: link.token },
                        }),
                      'Revoked the unlisted link.',
                    )
                  }
                >
                  <Trash2Icon />
                </Button>
              </div>
            );
          })}
        </div>
        {linksOnly ? null : (
          <>
            <Separator />
            <form onSubmit={grant}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="share-email">User email</FieldLabel>
                  <Input
                    id="share-email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="share-role">Role</FieldLabel>
                  <NativeSelect
                    id="share-role"
                    value={role}
                    onChange={(event) => setRole(event.target.value as typeof role)}
                  >
                    <NativeSelectOption value="viewer">Viewer</NativeSelectOption>
                    <NativeSelectOption value="editor">Editor</NativeSelectOption>
                  </NativeSelect>
                </Field>
                <Button type="submit" disabled={pending}>
                  Grant access
                </Button>
              </FieldGroup>
            </form>
          </>
        )}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
        {!linksOnly && sharing.grants.length ? (
          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-medium">People with access</h3>
            {sharing.grants.map((grant) => {
              const label = sharedUserLabel(grant);
              return (
                <div className="flex items-center gap-3 text-sm" key={grant.clerkUserId}>
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                  <span className="text-muted-foreground">{grant.role}</span>
                  <Button
                    disabled={pending}
                    aria-label={`Revoke ${label}`}
                    size="icon-sm"
                    variant="ghost"
                    onClick={() =>
                      void mutate(
                        () =>
                          callApi({
                            action: 'shareDashboard',
                            dashboardId,
                            operation: { kind: 'revoke', userId: grant.clerkUserId },
                          }),
                        'Revoked user access.',
                      )
                    }
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              );
            })}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
