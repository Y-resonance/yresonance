import { test } from './support/ui-test';
import { expect } from '@playwright/test';
import { mockYresonanceApi } from './support/yresonance-api';

test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false });

type Tool = { execute: (input: Record<string, unknown>) => Promise<unknown> };

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

  const saved = page.waitForRequest(
    (request) =>
      request.url().endsWith('/api/yresonance') && request.postDataJSON().action === 'updateWidget',
  );
  await editor.blur();
  const document: string = (await saved).postDataJSON().definition.content.document;
  expect(document).toMatch(/^Plain notes\s*\\?\nSecond line\n\nBudget \*\*up\*\*, see \[/);
  expect(document).toContain('](https://example.com/plan)');

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
  const saved = page.waitForRequest(
    (request) =>
      request.url().endsWith('/api/yresonance') && request.postDataJSON().action === 'updateWidget',
  );
  await editor.blur();
  const document: string = (await saved).postDataJSON().definition.content.document;
  expect(document).toBe(original.replace('Run', 'First, Run'));
  expect(errors).toEqual([]);
});
