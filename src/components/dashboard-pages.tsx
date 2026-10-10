import { useEffect, useState } from 'react';
import type { DashboardDocument } from '#/domain/schema';
import { activeDashboardPage } from '#/domain/dashboard-pages';
import { useApi } from '#/api/query';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Field, FieldLabel, FieldGroup } from './ui/field';
import { Switch } from './ui/switch';
import { ArrowLeft, ArrowRight, Ellipsis, Eye, EyeOff, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
} from './ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog';
import { Alert, AlertDescription } from './ui/alert';

export function DashboardPages({
  dashboard,
  pageId,
  onPageChange,
  canEdit = false,
  disabled = false,
  shareToken,
  refresh,
}: {
  dashboard: DashboardDocument;
  pageId?: string;
  onPageChange: (id: string) => void;
  canEdit?: boolean;
  disabled?: boolean;
  shareToken?: string;
  refresh?: () => Promise<void>;
}) {
  const callApi = useApi();
  const page = activeDashboardPage(dashboard, pageId);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [hidden, setHidden] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [confirmRemoval, setConfirmRemoval] = useState(false);

  useEffect(() => {
    if (!page) return;
    void callApi({
      action: 'trackPageView',
      dashboardId: dashboard.id,
      pageId: page.id,
      shareToken,
    }).catch(() => undefined);
  }, [dashboard.id, page?.id, shareToken, callApi]);

  async function mutate(operation: () => Promise<DashboardDocument>, selectNew = false) {
    setSaving(true);
    setError(undefined);
    try {
      const updated = await operation();
      await refresh?.();
      if (selectNew) onPageChange(updated.pages.at(-1)!.id);
      else if (!updated.pages.some((item) => item.id === page?.id))
        onPageChange(updated.pages[0]!.id);
      setOpen(false);
      setConfirmRemoval(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {dashboard.pages.length > 1 || canEdit ? (
        <Tabs
          value={page?.id}
          onValueChange={(value) => onPageChange(String(value))}
          className="min-w-0 max-w-full overflow-x-auto"
        >
          <TabsList variant="line" aria-label="Dashboard pages">
            {dashboard.pages.map((item) => (
              <div key={item.id} className="flex h-full items-center">
                <TabsTrigger value={item.id} disabled={disabled || saving}>
                  {item.name}
                  {item.hidden ? ' (draft)' : ''}
                </TabsTrigger>
                {canEdit && item.id === page?.id ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={<Button variant="ghost" size="icon-sm" />}
                      aria-label={`Page actions for ${item.name}`}
                      disabled={disabled || saving}
                    >
                      <Ellipsis />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="min-w-44">
                      <DropdownMenuGroup>
                        <DropdownMenuItem
                          onClick={() => {
                            setAdding(false);
                            setName(item.name);
                            setHidden(item.hidden);
                            setError(undefined);
                            setConfirmRemoval(false);
                            setOpen(true);
                          }}
                        >
                          <Pencil aria-hidden="true" />
                          Rename page
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            void mutate(() =>
                              callApi({
                                action: 'updatePage',
                                dashboardId: dashboard.id,
                                pageId: item.id,
                                hidden: !item.hidden,
                              }),
                            )
                          }
                        >
                          {item.hidden ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
                          {item.hidden ? 'Publish page' : 'Hide page'}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={dashboard.pages[0]?.id === item.id}
                          onClick={() =>
                            void mutate(() =>
                              callApi({
                                action: 'updatePage',
                                dashboardId: dashboard.id,
                                pageId: item.id,
                                position: dashboard.pages.indexOf(item) - 1,
                              }),
                            )
                          }
                        >
                          <ArrowLeft aria-hidden="true" />
                          Move left
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={dashboard.pages.at(-1)?.id === item.id}
                          onClick={() =>
                            void mutate(() =>
                              callApi({
                                action: 'updatePage',
                                dashboardId: dashboard.id,
                                pageId: item.id,
                                position: dashboard.pages.indexOf(item) + 1,
                              }),
                            )
                          }
                        >
                          <ArrowRight aria-hidden="true" />
                          Move right
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          disabled={dashboard.pages.length === 1}
                          onClick={() => {
                            setError(undefined);
                            setConfirmRemoval(true);
                            setOpen(true);
                          }}
                        >
                          <Trash2 aria-hidden="true" />
                          Remove page
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
            ))}
            {canEdit ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Add page"
                disabled={disabled || saving}
                onClick={() => {
                  setAdding(true);
                  setName('');
                  setHidden(false);
                  setError(undefined);
                  setConfirmRemoval(false);
                  setOpen(true);
                }}
              >
                <Plus />
              </Button>
            ) : null}
          </TabsList>
        </Tabs>
      ) : null}
      {error && !open ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {!page ? <p className="text-sm text-muted-foreground">No published pages.</p> : null}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!saving) setOpen(value);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmRemoval ? `Remove ${page?.name}?` : adding ? 'Add page' : 'Rename page'}
            </DialogTitle>
            <DialogDescription>
              {confirmRemoval
                ? 'The page and all its widgets will be deleted. This cannot be undone.'
                : 'Draft pages are visible only to editors.'}
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {confirmRemoval ? (
            <DialogFooter>
              <Button variant="outline" disabled={saving} onClick={() => setConfirmRemoval(false)}>
                Keep page
              </Button>
              <Button
                variant="destructive"
                disabled={saving}
                onClick={() =>
                  void mutate(() =>
                    callApi({
                      action: 'removePage',
                      dashboardId: dashboard.id,
                      pageId: page!.id,
                      confirm: true,
                    }),
                  )
                }
              >
                Remove page
              </Button>
            </DialogFooter>
          ) : (
            <>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="page-name">Page name</FieldLabel>
                  <Input
                    id="page-name"
                    value={name}
                    disabled={saving}
                    onChange={(event) => setName(event.target.value)}
                  />
                </Field>
                {adding ? (
                  <Field orientation="horizontal">
                    <FieldLabel htmlFor="page-hidden">Draft</FieldLabel>
                    <Switch
                      id="page-hidden"
                      checked={hidden}
                      disabled={saving}
                      onCheckedChange={setHidden}
                    />
                  </Field>
                ) : null}
              </FieldGroup>
              <DialogFooter>
                <Button
                  disabled={saving || !name.trim()}
                  onClick={() =>
                    void mutate(
                      () =>
                        adding
                          ? callApi({ action: 'addPage', dashboardId: dashboard.id, name, hidden })
                          : callApi({
                              action: 'updatePage',
                              dashboardId: dashboard.id,
                              pageId: page!.id,
                              name,
                            }),
                      adding,
                    )
                  }
                >
                  {saving ? 'Saving...' : adding ? 'Add page' : 'Save'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
