import { describe, expect, it } from 'vitest';
import { dashboardWidgetSchema, widgetDefinitionSchema } from '#/domain/schema';
import { markdownFeatures } from '#/domain/text-content';

const storedText = (content: unknown) =>
  dashboardWidgetSchema.parse({
    id: 'w_text',
    layout: { x: 0, y: 0, width: 4, height: 2 },
    definition: { type: 'text', content, textStyle: { size: 'lg' } },
    definitionHash: 'hash',
  }).definition;

describe('stored text widgets', () => {
  it('reads plain-text documents as Markdown without changing their wording', () => {
    expect(storedText({ schemaVersion: 'plain-text-v1', document: 'Line 1\nLine 2' })).toEqual({
      type: 'text',
      content: { schemaVersion: 'markdown-v1', document: 'Line 1\nLine 2' },
      textStyle: { size: 'lg' },
    });
    expect(storedText({ schemaVersion: '1', document: 'Notes' })).toMatchObject({
      content: { schemaVersion: 'markdown-v1', document: 'Notes' },
    });
  });

  it('flattens structured documents to text once', () => {
    const definition = storedText({
      schemaVersion: 'rich-v0',
      document: [{ type: 'paragraph', children: [{ text: 'Campaign notes' }] }],
    });
    expect(definition).toMatchObject({
      content: {
        schemaVersion: 'markdown-v1',
        document: expect.stringContaining('Campaign notes'),
      },
    });
  });

  it('only accepts Markdown documents through the API', () => {
    const text = (content: unknown) =>
      widgetDefinitionSchema.safeParse({ type: 'text', content }).success;
    expect(text({ schemaVersion: 'markdown-v1', document: '**Hi**' })).toBe(true);
    expect(text({ schemaVersion: 'markdown-v1', document: { text: 'x' } })).toBe(false);
    expect(text({ schemaVersion: 'plain-text-v1', document: 'Hi' })).toBe(false);
  });
});

describe('markdown features', () => {
  it.each([
    ['Plain notes, 2 * 3 = 6.', { hasLinks: false, hasFormatting: false }],
    ['See [the plan](https://example.com).', { hasLinks: true, hasFormatting: false }],
    ['Spend is **up**.', { hasLinks: false, hasFormatting: true }],
    ['Spend is *up*.', { hasLinks: false, hasFormatting: true }],
    ['## Notes', { hasLinks: false, hasFormatting: true }],
    ['Intro\n- one\n- two', { hasLinks: false, hasFormatting: true }],
    ['1. one\n2. two', { hasLinks: false, hasFormatting: true }],
    ['Above\n\n---\n\nBelow', { hasLinks: false, hasFormatting: true }],
  ])('classifies %j', (markdown, expected) => {
    expect(markdownFeatures(markdown)).toEqual(expected);
  });
});
