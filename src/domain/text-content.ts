import { z } from 'zod';

/**
 * Flattens a legacy structured text document (any JSON shape) into plain text. Strings pass
 * through unchanged, so plain-text documents keep their exact wording. Node `type` names are
 * structure, not text, so they are left out.
 */
export function textDocument(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textDocument).filter(Boolean).join('\n');
  if (value && typeof value === 'object')
    return Object.entries(value)
      .filter(([key]) => key !== 'type')
      .map(([, child]) => textDocument(child))
      .filter(Boolean)
      .join(' ');
  return '';
}

/** Text widget content as the API accepts and stores it. Never HTML. */
export const textContentSchema = z.object({
  schemaVersion: z.literal('markdown-v1'),
  document: z
    .string()
    .describe(
      'Markdown: headings, bold, italic, lists, https/mailto links, --- rules. Newline = line break. No HTML or images.',
    ),
});

const legacyTextDefinitionSchema = z.looseObject({
  type: z.literal('text'),
  content: z.object({
    schemaVersion: z.string().refine((version) => version !== 'markdown-v1'),
    document: z.unknown(),
  }),
});

/**
 * Reads a stored text widget saved before Markdown (`plain-text-v1`, `'1'`, or structured JSON) as
 * `markdown-v1`. Strings are kept as they are and structured documents are flattened to text once.
 * The next save of the dashboard stores the migrated form; there is no bulk migration. Other
 * definitions pass through untouched.
 */
export function migrateTextDefinition(definition: unknown) {
  const legacy = legacyTextDefinitionSchema.safeParse(definition);
  if (!legacy.success) return definition;
  return {
    ...legacy.data,
    content: { schemaVersion: 'markdown-v1', document: textDocument(legacy.data.content.document) },
  };
}

/**
 * Formatting a text widget uses, for adoption telemetry. Pattern based rather than a full parse,
 * which is precise enough to tell plain text from formatted text without shipping a parser to the
 * Worker.
 */
export function markdownFeatures(markdown: string) {
  return {
    hasLinks: /\[[^\]]*\]\([^)]+\)|<(?:https|mailto):[^>]+>/i.test(markdown),
    hasFormatting:
      /\*\*[^*]+\*\*|__[^_]+__|(^|[^*])\*[^*\s][^*]*\*|(^|\W)_[^_\s][^_]*_/.test(markdown) ||
      /^\s{0,3}(#{1,6}\s|[-*+]\s|\d+[.)]\s|([-*_])(\s*\2){2,}\s*$)/m.test(markdown),
  };
}
