import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RichText } from './rich-text';

const render = (markdown: string) =>
  renderToStaticMarkup(<RichText markdown={markdown} />)
    .replace(/^<div[^>]*>|<\/div>$/g, '')
    .trim();

describe('rich text rendering', () => {
  it('keeps plain text line breaks', () => {
    expect(render('Line 1\nLine 2')).toBe('<p>Line 1<br/>\nLine 2</p>');
  });

  it('renders the supported formatting', () => {
    expect(render('## Notes\n\n**Up** and *down*\n\n- one\n1. two\n\n---')).toBe(
      '<h2>Notes</h2>\n<p><strong>Up</strong> and <em>down</em></p>\n<ul>\n<li>one</li>\n</ul>\n<ol>\n<li>two</li>\n</ol>\n<hr/>',
    );
  });

  it('opens https and mailto links in a new tab', () => {
    expect(render('[Plan](https://example.com/plan) [Mail](mailto:team@example.com)')).toBe(
      '<p><a href="https://example.com/plan" target="_blank" rel="noopener noreferrer">Plan</a> <a href="mailto:team@example.com" target="_blank" rel="noopener noreferrer">Mail</a></p>',
    );
  });

  it.each([
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    'http://example.com',
    'data:text/html,x',
    '/dashboards/x',
  ])('renders a %s link as plain text', (url) => {
    expect(render(`[Click](${url})`)).toBe('<p><span>Click</span></p>');
  });

  it('does not render raw HTML or images', () => {
    expect(
      render('<script>alert(1)</script>\n\n<b>bold</b> ![x](https://example.com/x.png) `code`'),
    ).toBe('<p>bold  code</p>');
  });
});
