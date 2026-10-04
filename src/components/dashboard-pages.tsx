import { useEffect, useState } from 'react';
import type { DashboardDocument } from '#/domain/schema';
import { activeDashboardPage } from '#/domain/dashboard-pages';
import { callApi } from '#/api/client';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Field, FieldLabel, FieldGroup } from './ui/field';
import { Switch } from './ui/switch';
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
  }, [dashboard.id, page?.id, shareToken]);

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
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        {dashboard.pages.length > 1 ? (
          <Tabs
            value={page?.id}
            onValueChange={(value) => onPageChange(String(value))}
            className="min-w-0 max-w-full overflow-x-auto"
          >
            <TabsList variant="line" aria-label="Dashboard pages">
              {dashboard.pages.map((item) => (
                <TabsTrigger key={item.id} value={item.id} disabled={disabled || saving}>
                  {item.name}
                  {item.hidden ? ' (draft)' : ''}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        ) : null}
        {canEdit ? (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
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
              Add page
            </Button>
            {page ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={disabled || saving}
                onClick={() => {
                  setAdding(false);
                  setName(page.name);
                  setHidden(page.hidden);
                  setError(undefined);
                  setConfirmRemoval(false);
                  setOpen(true);
                }}
              >
                Page settings
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
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
              {confirmRemoval ? `Remove ${page?.name}?` : adding ? 'Add page' : 'Page settings'}
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
                <Field orientation="horizontal">
                  <FieldLabel htmlFor="page-hidden">Draft</FieldLabel>
                  <Switch
                    id="page-hidden"
                    checked={hidden}
                    disabled={saving}
                    onCheckedChange={setHidden}
                  />
                </Field>
              </FieldGroup>
              {!adding && page ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={saving || dashboard.pages[0]?.id === page.id}
                    onClick={() =>
                      void mutate(() =>
                        callApi({
                          action: 'updatePage',
                          dashboardId: dashboard.id,
                          pageId: page.id,
                          position: dashboard.pages.indexOf(page) - 1,
                        }),
                      )
                    }
                  >
                    Move left
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={saving || dashboard.pages.at(-1)?.id === page.id}
                    onClick={() =>
                      void mutate(() =>
                        callApi({
                          action: 'updatePage',
                          dashboardId: dashboard.id,
                          pageId: page.id,
                          position: dashboard.pages.indexOf(page) + 1,
                        }),
                      )
                    }
                  >
                    Move right
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={saving || dashboard.pages.length === 1}
                    onClick={() => setConfirmRemoval(true)}
                  >
                    Remove page
                  </Button>
                </div>
              ) : null}
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
                              hidden,
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
