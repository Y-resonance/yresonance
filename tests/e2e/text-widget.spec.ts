import { test } from './support/ui-test';
import { expect, type Page } from '@playwright/test';
import { dataSourceId, mockYresonanceApi } from './support/yresonance-api';

test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false });

type Tool = { execute: (input: Record<string, unknown>) => Promise<unknown> };

// Records every text save, because an autosave can land before a test leaves the editor.
function trackSavedDocuments(page: Page) {
  const documents: string[] = [];
  page.on('request', (request) => {
    if (!request.url().endsWith('/api/yresonance')) return;
    const body = request.postDataJSON();
    if (body.action === 'updateWidget') documents.push(body.definition.content.document);
  });
  return documents;
}

// Opens the builder on a text widget holding `document`, and returns the widget and its editor.
async function openTextWidget(page: Page, document: string, entry = '/dashboards/dash_demo') {
  const state = await mockYresonanceApi(page, { role: 'editor' });
  state.dashboard.pages[0]!.widgets.push({
    id: 'w_notes',
    layout: { x: 0, y: 7, width: 6, height: 3 },
    definition: { type: 'text', content: { schemaVersion: 'markdown-v1', document } },
    definitionHash: 'hash_notes',
  });
  await page.goto(entry);
  // Entering from the list leaves a history entry to go back to without reloading the app.
  if (entry === '/') await page.getByRole('link', { name: 'Client weekly', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Changes saved' })).toBeVisible();
  const widget = page.locator('[data-widget-id="w_notes"]');
  await widget.click({ position: { x: 40, y: 20 } });
  const editor = page.getByRole('complementary').getByRole('textbox', { name: 'Text' });
  await expect(editor).toContainText(document);
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  return { state, widget, editor };
}

test('editors format text and add links in the inspector', async ({ page }) => {
  const state = await mockYresonanceApi(page, { role: 'editor' });
  state.dashboard.pages[0]!.widgets.push({
    id: 'w_notes',
    layout: { x: 0, y: 7, width: 6, height: 3 },
    definition: {
      type: 'text',
      content: { schemaVersion: 'markdown-v1', document: 'Plain notes\nSecond line' },
    },
    definitionHash: 'hash_notes',
  });
  const documents = trackSavedDocuments(page);
  await page.goto('/dashboards/dash_demo');
  await expect(page.getByRole('status', { name: 'Changes saved' })).toBeVisible();

  const notes = page.locator('[data-widget-id="w_notes"]');
  // Plain text keeps its lines.
  await expect(notes.locator('p br')).toHaveCount(1);

  await notes.click({ position: { x: 40, y: 40 } });
  const settings = page.getByRole('complementary');
  const editor = settings.getByRole('textbox', { name: 'Text' });
  await expect(editor).toContainText('Second line');

  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Budget ');
  await settings.getByRole('button', { name: 'Bold' }).click();
  await page.keyboard.type('up');
  await settings.getByRole('button', { name: 'Bold' }).click();
  await page.keyboard.type(', see ');
  await settings.getByRole('button', { name: 'Link' }).click();
  await page.getByLabel('Link URL').fill('javascript:alert(1)');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Use an https:// or mailto: link.')).toBeVisible();
  await page.getByLabel('Link URL').fill('example.com/plan');
  await page.keyboard.press('Enter');

  await editor.blur();
  await expect
    .poll(() => documents.at(-1))
    .toMatch(
      /^Plain notes\s*\\?\nSecond line\n\nBudget \*\*up\*\*, see \[.*\]\(https:\/\/example\.com\/plan\)/,
    );

  await expect(notes.locator('strong')).toHaveText('up');
  const link = notes.getByRole('link', { name: 'https://example.com/plan' });
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(notes.locator('p br')).toHaveCount(1);
});

test('an agent adds a formatted text widget with links through addWidget', async ({ page }) => {
  await page.addInitScript(() => {
    const tools = new Map<string, Tool>();
    Object.defineProperty(document, 'modelContext', {
      value: {
        tools,
        registerTool: async (tool: Tool & { name: string }) => tools.set(tool.name, tool),
      },
    });
  });
  await mockYresonanceApi(page, { role: 'editor' });
  await page.goto('/dashboards/dash_demo');
  await expect(page.getByRole('status', { name: 'Changes saved' })).toBeVisible();
  const addWidget = () =>
    page.evaluate(async () => {
      const tools = (document.modelContext as unknown as { tools: Map<string, Tool> }).tools;
      const tool = tools.get('addWidget');
      if (!tool) return false;
      await tool.execute({
        pageId: 'page_overview',
        width: 6,
        height: 3,
        definition: {
          type: 'text',
          content: {
            schemaVersion: 'markdown-v1',
            document:
              '## Agent notes\n\nRead the [plan](https://example.com/plan), not [this](javascript:alert(1)).\n\n<b>raw</b>',
          },
        },
      });
      return true;
    });
  await expect.poll(addWidget).toBe(true);

  // The first tool call switches the builder to agent mode, which renders the viewer layout.
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Agent notes' })).toBeVisible();
  await expect(main.getByRole('link', { name: 'plan', exact: true })).toHaveAttribute(
    'href',
    'https://example.com/plan',
  );
  await expect(main.getByRole('link', { name: 'this', exact: true })).toHaveCount(0);
  await expect(main.getByText('not this.')).toBeVisible();
  await expect(main.locator('b')).toHaveCount(0);
});

test('editing keeps Markdown the editor has no button for', async ({ page }) => {
  const state = await mockYresonanceApi(page, { role: 'editor' });
  const original = [
    '    indented line',
    'Run `npm i` first.',
    '![Logo](https://example.com/logo.png)',
    '| a | b |\n| --- | --- |\n| 1 | 2 |',
  ].join('\n\n');
  state.dashboard.pages[0]!.widgets.push({
    id: 'w_notes',
    layout: { x: 0, y: 7, width: 6, height: 3 },
    definition: { type: 'text', content: { schemaVersion: 'markdown-v1', document: original } },
    definitionHash: 'hash_notes',
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const documents = trackSavedDocuments(page);
  await page.goto('/dashboards/dash_demo');
  await expect(page.getByRole('status', { name: 'Changes saved' })).toBeVisible();
  await page.locator('[data-widget-id="w_notes"]').click({ position: { x: 40, y: 20 } });
  const editor = page.getByRole('complementary').getByRole('textbox', { name: 'Text' });
  await expect(editor).toContainText('npm i');

  // Clicking a kept block selects it like an image, so start typing in the first paragraph.
  await editor
    .locator('p')
    .first()
    .click({ position: { x: 1, y: 5 } });
  await page.keyboard.press('Home');
  await page.keyboard.type('First, ');
  await editor.blur();
  await expect.poll(() => documents.at(-1)).toBe(original.replace('Run', 'First, Run'));
  expect(errors).toEqual([]);
});

test('typed leading spaces stay editable text instead of becoming a code block', async ({
  page,
}) => {
  const documents = trackSavedDocuments(page);
  const { editor } = await openTextWidget(page, 'Old');

  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('    Note');
  await editor.blur();
  await expect.poll(() => documents.at(-1)).toBe('Note');
});

test('text saves after a pause in typing, without leaving the editor', async ({ page }) => {
  const documents = trackSavedDocuments(page);
  const { widget, editor } = await openTextWidget(page, 'Old');

  await page.keyboard.type(' one');
  await expect.poll(() => documents).toEqual(['Old one']);
  await expect(widget).toContainText('Old one');
  await expect(editor).toBeFocused();

  // Saving neither moves the cursor nor interrupts the toolbar.
  await page.getByRole('complementary').getByRole('button', { name: 'Bold' }).click();
  await page.keyboard.type(' two');
  await expect.poll(() => documents.at(-1)).toBe('Old one **two**');
  await expect(editor).toBeFocused();
});

test('text saves during long typing that never pauses', async ({ page }) => {
  await page.clock.install();
  const documents = trackSavedDocuments(page);
  await openTextWidget(page, 'Old');

  for (let elapsed = 0; elapsed < 10_500; elapsed += 1_500) {
    await page.keyboard.type('x');
    await page.clock.runFor(1_500);
  }
  await expect.poll(() => documents.at(0)).toMatch(/^Oldx+$/);
});

test('a failed save keeps the text, warns before leaving, and retries', async ({ page }) => {
  const { widget, editor } = await openTextWidget(page, 'Old');
  let failing = true;
  await page.route('**/api/yresonance', (route) =>
    failing && route.request().postDataJSON().action === 'updateWidget'
      ? route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: false,
            error: { code: 'dashboard_conflict', message: 'This dashboard changed while saving.' },
          }),
        })
      : route.fallback(),
  );

  await page.keyboard.type(' written');
  await editor.blur();
  await expect(page.getByText('This dashboard changed while saving.')).toBeVisible();
  await expect(editor).toContainText('Old written');
  await expect(widget).not.toContainText('written');
  const leavingIsCancelled = () =>
    page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })));
  expect(await leavingIsCancelled()).toBe(true);

  failing = false;
  await editor.focus();
  await editor.blur();
  await expect(widget).toContainText('Old written');
  await expect(page.getByText('This dashboard changed while saving.')).toBeHidden();
  await expect(editor).toContainText('Old written');
  await expect.poll(leavingIsCancelled).toBe(false);
});

test('a refresh landing during a newer save does not undo it, even if the next refresh fails', async ({
  page,
}) => {
  const documents = trackSavedDocuments(page);
  const { widget, editor } = await openTextWidget(page, 'Old');
  let releaseRefresh = () => {};
  let releaseSecondSave = () => {};
  const refreshGate = new Promise<void>((release) => (releaseRefresh = release));
  let refreshHeld = () => {};
  const firstRefresh = new Promise<void>((held) => (refreshHeld = held));
  let refreshes = 0;
  await page.route('**/api/yresonance', async (route) => {
    if (route.request().postDataJSON().action !== 'getDashboard') return route.fallback();
    refreshes += 1;
    if (refreshes > 1) return route.abort();
    refreshHeld();
    await refreshGate;
    await route.fallback();
  });
  await page.keyboard.type(' one');
  await firstRefresh;

  const saveGate = new Promise<void>((release) => (releaseSecondSave = release));
  let secondSaveSeen = () => {};
  const secondSave = new Promise<void>((seen) => (secondSaveSeen = seen));
  await page.route('**/api/yresonance', async (route) => {
    if (route.request().postDataJSON().action === 'updateWidget') {
      secondSaveSeen();
      await saveGate;
    }
    await route.fallback();
  });
  await page.keyboard.type(' two');
  await secondSave;

  // The mock still holds the first save, so this refresh answers with older text.
  const staleRefresh = page.waitForResponse(
    (response) => response.request().postDataJSON()?.action === 'getDashboard',
  );
  releaseRefresh();
  await staleRefresh;
  await page.waitForTimeout(500);
  await expect(widget).toContainText('Old one two');
  await expect(editor).toContainText('Old one two');

  releaseSecondSave();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(widget).toContainText('Old one two');
  await expect(editor).toContainText('Old one two');

  // Changing a style saves the whole definition, which must hold the newest text.
  const saves = documents.length;
  await page.getByRole('complementary').getByRole('combobox', { name: 'Size' }).click();
  await page.getByRole('option').nth(1).click();
  await expect.poll(() => documents.length).toBe(saves + 1);
  expect(documents.at(-1)).toBe('Old one two');

  // Reopening shows the newest text, and editing keeps it.
  await page.locator('[data-widget-id]', { hasText: 'Media spend' }).click();
  await widget.click({ position: { x: 40, y: 20 } });
  await expect(editor).toContainText('Old one two');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' three');
  await expect.poll(() => documents.at(-1)).toBe('Old one two three');
});

test('a refresh still running from an earlier save does not bring back older text', async ({
  page,
}) => {
  const documents = trackSavedDocuments(page);
  const { state, widget, editor } = await openTextWidget(page, 'Old');
  // Only the first refresh is held back, answering with the dashboard as it was when requested.
  let releaseRefresh = () => {};
  const refreshGate = new Promise<void>((release) => (releaseRefresh = release));
  let refreshHeld = () => {};
  const firstRefresh = new Promise<void>((held) => (refreshHeld = held));
  let held = false;
  await page.route('**/api/yresonance', async (route) => {
    if (held || route.request().postDataJSON().action !== 'getDashboard') return route.fallback();
    held = true;
    const dashboard = state.dashboard;
    refreshHeld();
    await refreshGate;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: {
          dashboard,
          role: 'editor',
          dataSources: [{ id: dataSourceId, name: state.source.name }],
          assets: [],
        },
      }),
    });
  });

  await page.keyboard.type(' one');
  await firstRefresh;
  await page.keyboard.type(' two');
  await expect.poll(() => documents.at(-1)).toBe('Old one two');

  releaseRefresh();
  await expect(page.getByRole('status', { name: 'Changes saved' })).toBeVisible();
  await expect(editor).toContainText('Old one two');
  await expect(widget).toContainText('Old one two');
  await page.keyboard.type(' three');
  await expect.poll(() => documents.at(-1)).toBe('Old one two three');
});

test('a stale refresh does not bring back older text when the next refresh fails', async ({
  page,
}) => {
  const documents = trackSavedDocuments(page);
  const { state, editor } = await openTextWidget(page, 'Old');
  let releaseRefresh = () => {};
  const refreshGate = new Promise<void>((release) => (releaseRefresh = release));
  let refreshHeld = () => {};
  const firstRefresh = new Promise<void>((held) => (refreshHeld = held));
  let refreshes = 0;
  await page.route('**/api/yresonance', async (route) => {
    if (route.request().postDataJSON().action !== 'getDashboard') return route.fallback();
    refreshes += 1;
    if (refreshes > 1) return route.abort();
    const dashboard = state.dashboard;
    refreshHeld();
    await refreshGate;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: {
          dashboard,
          role: 'editor',
          dataSources: [{ id: dataSourceId, name: state.source.name }],
          assets: [],
        },
      }),
    });
  });

  await page.keyboard.type(' one');
  await firstRefresh;
  await page.keyboard.type(' two');
  await expect.poll(() => documents.at(-1)).toBe('Old one two');

  releaseRefresh();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(editor).toContainText('Old one two');

  // The save has finished, so this must not save the stale refresh's older text.
  const saves = documents.length;
  await page.getByRole('complementary').getByRole('combobox', { name: 'Size' }).click();
  await page.getByRole('option').nth(1).click();
  await expect.poll(() => documents.length).toBe(saves + 1);
  expect(documents.at(-1)).toBe('Old one two');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' three');
  await expect.poll(() => documents.at(-1)).toBe('Old one two three');
});

test('text from a save that fails after leaving the widget comes back when reselected', async ({
  page,
}) => {
  const documents = trackSavedDocuments(page);
  const { widget, editor } = await openTextWidget(page, 'Old');
  let failing = true;
  await page.route('**/api/yresonance', (route) =>
    failing && route.request().postDataJSON().action === 'updateWidget'
      ? route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: false,
            error: { code: 'dashboard_conflict', message: 'This dashboard changed while saving.' },
          }),
        })
      : route.fallback(),
  );
  const leavingIsCancelled = () =>
    page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })));
  const otherWidget = page.locator('[data-widget-id]', { hasText: 'Media spend' });

  await page.keyboard.type(' written');
  await otherWidget.click();
  await expect(page.getByText('This dashboard changed while saving.')).toBeVisible();
  await expect(widget).not.toContainText('written');
  expect(await leavingIsCancelled()).toBe(true);

  await widget.click({ position: { x: 40, y: 20 } });
  await expect(editor).toContainText('Old written');

  // Leaving again retries, without another edit.
  failing = false;
  await otherWidget.click();
  await expect(widget).toContainText('Old written');
  await expect.poll(() => documents.at(-1)).toBe('Old written');
  await expect.poll(leavingIsCancelled).toBe(false);
});

test('reselecting while a save is running keeps the text if that save then fails', async ({
  page,
}) => {
  const documents = trackSavedDocuments(page);
  const { widget, editor } = await openTextWidget(page, 'Old');
  let releaseSave = () => {};
  const saveGate = new Promise<void>((release) => (releaseSave = release));
  let held = false;
  await page.route('**/api/yresonance', async (route) => {
    if (held || route.request().postDataJSON().action !== 'updateWidget') return route.fallback();
    held = true;
    await saveGate;
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: false,
        error: { code: 'dashboard_conflict', message: 'This dashboard changed while saving.' },
      }),
    });
  });
  const leavingIsCancelled = () =>
    page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })));
  const otherWidget = page.locator('[data-widget-id]', { hasText: 'Media spend' });

  await page.keyboard.type(' written');
  await otherWidget.click();
  await expect.poll(() => documents).toEqual(['Old written']);
  // The editor is gone, but the save can still fail, so leaving must still warn.
  await expect(editor).toBeHidden();
  expect(await leavingIsCancelled()).toBe(true);

  await widget.click({ position: { x: 40, y: 20 } });
  await expect(editor).toContainText('Old written');
  releaseSave();
  await expect(page.getByText('This dashboard changed while saving.')).toBeVisible();
  await expect(editor).toContainText('Old written');

  await otherWidget.click();
  await expect.poll(() => documents.length).toBe(2);
  await expect(widget).toContainText('Old written');
  await expect.poll(leavingIsCancelled).toBe(false);
});

test('reselecting while a save succeeds does not save it twice or warn', async ({ page }) => {
  const documents = trackSavedDocuments(page);
  const { widget, editor } = await openTextWidget(page, 'Old');
  let releaseSave = () => {};
  const saveGate = new Promise<void>((release) => (releaseSave = release));
  await page.route('**/api/yresonance', async (route) => {
    if (route.request().postDataJSON().action === 'updateWidget') await saveGate;
    await route.fallback();
  });
  const otherWidget = page.locator('[data-widget-id]', { hasText: 'Media spend' });

  await page.keyboard.type(' written');
  await otherWidget.click();
  await expect.poll(() => documents).toEqual(['Old written']);
  await widget.click({ position: { x: 40, y: 20 } });
  await expect(editor).toContainText('Old written');
  releaseSave();
  await expect(page.getByRole('status', { name: 'Changes saved' })).toBeVisible();

  await otherWidget.click();
  await expect(editor).toBeHidden();
  expect(documents).toEqual(['Old written']);
  expect(
    await page.evaluate(
      () => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })),
    ),
  ).toBe(false);
});

test('an older save finishing does not clear the warning for a newer one', async ({ page }) => {
  const documents = trackSavedDocuments(page);
  await openTextWidget(page, 'Old');
  let releaseFirst = () => {};
  let releaseSecond = () => {};
  const gates = [
    new Promise<void>((release) => (releaseFirst = release)),
    new Promise<void>((release) => (releaseSecond = release)),
  ];
  await page.route('**/api/yresonance', async (route) => {
    if (route.request().postDataJSON().action === 'updateWidget') await gates.shift();
    await route.fallback();
  });
  const leavingIsCancelled = () =>
    page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })));

  await page.keyboard.type(' one');
  await expect.poll(() => documents).toEqual(['Old one']);
  await page.keyboard.type(' two');
  await page.getByRole('complementary').getByRole('textbox', { name: 'Text' }).blur();
  releaseFirst();
  await expect.poll(() => documents).toEqual(['Old one', 'Old one two']);
  expect(await leavingIsCancelled()).toBe(true);
  releaseSecond();
  await expect.poll(leavingIsCancelled).toBe(false);
});

test('the open editor follows text changed elsewhere and each widget keeps its own', async ({
  page,
}) => {
  const { state, widget, editor } = await openTextWidget(page, 'Old');
  const textOf = (document: string) => ({
    type: 'text' as const,
    content: { schemaVersion: 'markdown-v1' as const, document },
  });
  state.dashboard = {
    ...state.dashboard,
    pages: state.dashboard.pages.map((item) => ({
      ...item,
      widgets: [
        ...item.widgets.map((candidate) =>
          candidate.id === 'w_notes'
            ? { ...candidate, definition: textOf('Changed by an agent') }
            : candidate,
        ),
        {
          id: 'w_other',
          layout: { x: 6, y: 7, width: 6, height: 3 },
          definition: textOf('Second widget'),
          definitionHash: 'hash_other',
        },
      ],
    })),
  };

  // Removing another widget refreshes the dashboard while this editor stays open.
  await page.getByRole('button', { name: 'Remove Media spend' }).click();
  await page.getByRole('button', { name: 'Remove widget' }).click();
  await expect(editor).toContainText('Changed by an agent');

  // Switching back and forth must not leave either widget showing the other's text.
  const second = page.locator('[data-widget-id="w_other"]');
  await second.click({ position: { x: 40, y: 20 } });
  await expect(editor).toHaveText('Second widget');
  await widget.click({ position: { x: 40, y: 20 } });
  await expect(editor).toHaveText('Changed by an agent');
  await second.click({ position: { x: 40, y: 20 } });
  await expect(editor).toHaveText('Second widget');
});

test('a save that fails because someone else changed the text loads their change', async ({
  page,
}) => {
  const documents = trackSavedDocuments(page);
  const { state, widget, editor } = await openTextWidget(page, 'Old');
  let conflict = true;
  await page.route('**/api/yresonance', async (route) => {
    if (!conflict || route.request().postDataJSON().action !== 'updateWidget')
      return route.fallback();
    conflict = false;
    state.dashboard = {
      ...state.dashboard,
      pages: state.dashboard.pages.map((item) => ({
        ...item,
        widgets: item.widgets.map((candidate) =>
          candidate.id === 'w_notes'
            ? {
                ...candidate,
                definition: {
                  type: 'text' as const,
                  content: { schemaVersion: 'markdown-v1' as const, document: 'Agent text' },
                },
              }
            : candidate,
        ),
      })),
    };
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: false,
        error: { code: 'dashboard_conflict', message: 'This dashboard changed while saving.' },
      }),
    });
  });

  await page.keyboard.type(' written');
  await editor.blur();
  await expect(page.getByText('This dashboard changed while saving.')).toBeVisible();
  await expect(widget).toContainText('Agent text');
  await expect(editor).toContainText('Old written');

  // A style change sends the whole definition, which now holds the other writer's text.
  const saves = documents.length;
  await page.getByRole('complementary').getByRole('combobox', { name: 'Size' }).click();
  await page.getByRole('option').nth(1).click();
  await expect.poll(() => documents.length).toBe(saves + 1);
  expect(documents.at(-1)).toBe('Agent text');
});

test('a failed refresh after a save keeps the builder and the text', async ({ page }) => {
  const { widget, editor } = await openTextWidget(page, 'Old');
  let failing = true;
  await page.route('**/api/yresonance', (route) => {
    if (!failing || route.request().postDataJSON().action !== 'getDashboard')
      return route.fallback();
    failing = false;
    return route.abort();
  });

  await page.keyboard.type(' one');
  await expect(widget).toContainText('Old one');
  await expect.poll(() => failing).toBe(false);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(editor).toBeFocused();
  await page.keyboard.type(' two');
  await expect(editor).toContainText('Old one two');
  await expect(widget).toContainText('Old one two');
});

test('leaving while the link popover has focus saves the text right away', async ({ page }) => {
  const documents = trackSavedDocuments(page);
  const { editor } = await openTextWidget(page, 'Old', '/');

  await page.keyboard.type(' last words');
  await page.getByRole('complementary').getByRole('button', { name: 'Link' }).click();
  await expect(page.getByLabel('Link URL')).toBeFocused();
  await page.goBack();
  await expect(editor).toBeHidden();
  // Shorter than the pause before an autosave, so only closing the editor can have saved this.
  await expect.poll(() => documents, { timeout: 1_000 }).toEqual(['Old last words']);
});

test('the editor pops out into a dialog and keeps its text, cursor and undo', async ({ page }) => {
  const documents = trackSavedDocuments(page);
  const { widget, editor } = await openTextWidget(page, 'Old');
  const settings = page.getByRole('complementary');

  await page.keyboard.type(' abc');
  const inspectorWidth = (await settings.boundingBox())!.width;
  await settings.getByRole('button', { name: 'Expand editor' }).click();
  const dialog = page.getByRole('dialog');
  const dialogEditor = dialog.getByRole('textbox', { name: 'Text' });
  await expect(dialogEditor).toBeFocused();
  expect((await dialogEditor.boundingBox())!.width).toBeGreaterThan(inspectorWidth);

  // Typing carries on at the same place, and undo reaches what was typed before popping out.
  await page.keyboard.type(' def');
  await expect(dialogEditor).toContainText('Old abc def');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(dialogEditor).not.toContainText('def');
  // Typing close together can undo as one step, depending on timing.
  const undoneTogether = !(await dialogEditor.textContent())!.includes('abc');
  if (!undoneTogether) await page.keyboard.press('ControlOrMeta+z');
  await expect(dialogEditor).not.toContainText('abc');
  await expect(dialogEditor).toContainText('Old');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  if (!undoneTogether) await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(dialogEditor).toContainText('Old abc def');

  await page.keyboard.type(' typed ');
  await dialog.getByRole('button', { name: 'Bold' }).click();
  await page.keyboard.type('here');
  await expect(dialogEditor).toContainText('Old abc def typed here');
  await expect(dialogEditor.locator('strong')).toHaveText('here');
  await expect.poll(() => documents.at(-1)).toBe('Old abc def typed **here**');
  await expect(dialogEditor).toBeFocused();

  // A link popover inside the dialog must not close the dialog or lose focus to the page.
  await page.keyboard.press('Enter');
  await dialog.getByRole('button', { name: 'Link' }).click();
  await page.getByLabel('Link URL').fill('example.com/plan');
  await page.keyboard.press('Enter');
  await expect(dialogEditor.getByRole('link')).toHaveCount(1);

  // Escape closes only the dialog, and the widget stays selected with the same text.
  await expect(dialogEditor).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(editor).toBeFocused();
  await expect(editor).toContainText('Old abc def typed here');
  await page.keyboard.type(' after');
  await editor.blur();
  await expect.poll(() => documents.at(-1)).toContain('Old abc def typed **here**');
  await expect(editor).toContainText(/after$/);
  await expect(widget).toContainText('after');
});
