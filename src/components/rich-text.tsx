import Markdown, { type Components } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import { cn } from '#/lib/utils';

// The supported Markdown subset. Anything else (code, quotes, tables, images) is unwrapped to its
// text, and raw HTML is skipped, so content written by agents or the API cannot inject markup.
const allowedElements = [
  'p',
  'br',
  'strong',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'a',
  'hr',
];

const allowedProtocols = new Set(['https:', 'mailto:']);

/** Keeps only https: and mailto: links. Anything else, including relative URLs, is dropped. */
export function safeLinkUrl(url: string) {
  try {
    return allowedProtocols.has(new URL(url).protocol) ? url : undefined;
  } catch {
    return undefined;
  }
}

const components: Components = {
  // Links without a safe target render as their plain text.
  a: ({ href, children }) =>
    href ? (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
};

/**
 * Typography for rendered Markdown, shared with the builder's editor so both look the same. Sizes
 * use `em` so the widget's text size scales headings too.
 */
export const richTextClasses = cn(
  'flex flex-col gap-[0.5em] break-words',
  '[&_h1]:text-[1.5em] [&_h1]:leading-tight [&_h1]:font-semibold',
  '[&_h2]:text-[1.25em] [&_h2]:leading-snug [&_h2]:font-semibold',
  '[&_h3]:text-[1.1em] [&_h3]:font-semibold [&_:is(h4,h5,h6)]:font-semibold',
  '[&_ol]:list-decimal [&_ul]:list-disc [&_:is(ol,ul)]:pl-[1.25em]',
  '[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_hr]:border-border',
);

/** Renders a text widget's Markdown document for viewers, share links, and the builder canvas. */
export function RichText({ markdown, className }: { markdown: string; className?: string }) {
  return (
    <div className={cn(richTextClasses, className)}>
      <Markdown
        remarkPlugins={[remarkBreaks]}
        allowedElements={allowedElements}
        unwrapDisallowed
        skipHtml
        urlTransform={safeLinkUrl}
        components={components}
      >
        {markdown}
      </Markdown>
    </div>
  );
}
