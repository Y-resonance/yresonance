import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  EditorContent,
  Extension,
  Node as TiptapNode,
  useEditor,
  useEditorState,
  type Editor,
} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Paragraph } from '@tiptap/extension-paragraph';
import { Markdown } from '@tiptap/markdown';
import {
  BoldIcon,
  Heading2Icon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
} from 'lucide-react';
import { Button } from '#/components/ui/button';
import { Input } from '#/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover';
import { richTextClasses, safeLinkUrl } from '#/components/rich-text';
import { cn } from '#/lib/utils';

// Markdown outside the supported subset (code, tables, images) has no editor node, so Tiptap would
// drop it on load and the next save would delete text viewers still see. These read-only nodes
// hold such source verbatim and write it back unchanged; editors can still delete them.
function literalNode(name: string, inline: boolean) {
  return TiptapNode.create({
    name,
    inline,
    group: inline ? 'inline' : 'block',
    atom: true,
    addAttributes: () => ({ markdown: { default: '' } }),
    parseHTML: () => [
      { tag: `[data-${name}]`, getAttrs: (element) => ({ markdown: element.textContent }) },
    ],
    renderHTML: ({ node }) => [
      inline ? 'code' : 'pre',
      {
        [`data-${name}`]: '',
        class: 'font-mono text-[0.9em] whitespace-pre-wrap text-muted-foreground',
      },
      String(node.attrs.markdown),
    ],
    renderMarkdown: (node) => String(node.attrs?.markdown ?? ''),
  });
}

function literalTokens(node: string, tokens: string[]) {
  return tokens.map((token) =>
    Extension.create({
      name: `${node}-${token}`,
      markdownTokenName: token,
      parseMarkdown: ({ raw = '' }) => ({
        type: node,
        attrs: { markdown: raw.replace(/\n+$/, '') },
      }),
    }),
  );
}

// Tiptap's paragraph lifts a lone image out to the document, where an inline node is invalid.
// Such a paragraph keeps the image inline instead; every other paragraph parses as usual.
const paragraph = Paragraph.extend({
  parseMarkdown(token, helpers) {
    const tokens = token.tokens ?? [];
    if (tokens.length === 1 && tokens[0]?.type === 'image')
      return helpers.createNode('paragraph', undefined, helpers.parseInline(tokens));
    return this.parent?.(token, helpers) ?? [];
  },
  // Four typed or pasted spaces would read back as a code block, which can't be edited.
  renderMarkdown(node, helpers, context) {
    return (this.parent?.(node, helpers, context) ?? '').replace(/^[ \t]+/, '');
  },
});

const literalMarkdown = [
  literalNode('literalInline', true),
  literalNode('literalBlock', false),
  ...literalTokens('literalInline', ['codespan', 'image']),
  ...literalTokens('literalBlock', ['code', 'table']),
];

/**
 * WYSIWYG Markdown editor for text widgets in the inspector. It is the default export so the
 * inspector can lazy-load it: viewers and share links never download Tiptap. Like the other
 * inspector fields it commits on blur, and only when the user actually changed the text.
 */
export default function RichTextEditor({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (markdown: string) => void;
}) {
  // Only user edits mark the document dirty; loading `value` does not, so focusing and leaving
  // an untouched (possibly legacy) document never saves it.
  const dirty = useRef(false);
  const commitRef = useRef(onCommit);
  useEffect(() => {
    commitRef.current = onCommit;
  });
  // Editing a link moves focus into its popover. That is still editing, so it does not commit.
  const linkPopover = useRef<HTMLDivElement>(null);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        paragraph: false,
        blockquote: false,
        code: false,
        codeBlock: false,
        strike: false,
        underline: false,
        link: {
          openOnClick: false,
          defaultProtocol: 'https',
          isAllowedUri: (url) => Boolean(safeLinkUrl(url)),
        },
      }),
      // Single newlines are line breaks, matching the viewer, so plain text keeps its lines.
      Markdown.configure({ markedOptions: { breaks: true } }),
      paragraph,
      ...literalMarkdown,
    ],
    content: value,
    contentType: 'markdown',
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': label,
        class: cn(richTextClasses, 'min-h-24 px-2.5 py-2 text-sm outline-none'),
      },
    },
    onUpdate: () => {
      dirty.current = true;
    },
    onBlur: ({ editor, event }) => {
      const target = event.relatedTarget;
      if (!dirty.current || (target instanceof Node && linkPopover.current?.contains(target)))
        return;
      dirty.current = false;
      // Leading spaces can mark an indented code block, so only the end is trimmed.
      commitRef.current(editor.getMarkdown().trimEnd());
    },
  });

  // Follow outside changes, such as an agent updating the widget, unless the user is mid-edit.
  useEffect(() => {
    if (!editor || dirty.current || editor.getMarkdown().trimEnd() === value.trimEnd()) return;
    editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false });
  }, [editor, value]);

  return (
    <div className="rounded-lg border border-input transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30">
      {editor ? <Toolbar editor={editor} linkPopover={linkPopover} /> : null}
      <EditorContent editor={editor} />
    </div>
  );
}

function Toolbar({
  editor,
  linkPopover,
}: {
  editor: Editor;
  linkPopover: RefObject<HTMLDivElement | null>;
}) {
  const active = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor.isActive('bold'),
      italic: editor.isActive('italic'),
      heading: editor.isActive('heading', { level: 2 }),
      bulletList: editor.isActive('bulletList'),
      orderedList: editor.isActive('orderedList'),
      link: editor.isActive('link'),
    }),
  });
  const chain = () => editor.chain().focus();
  return (
    <div className="flex items-center gap-0.5 border-b border-input p-1">
      <ToolbarButton label="Bold" pressed={active.bold} onClick={() => chain().toggleBold().run()}>
        <BoldIcon />
      </ToolbarButton>
      <ToolbarButton
        label="Italic"
        pressed={active.italic}
        onClick={() => chain().toggleItalic().run()}
      >
        <ItalicIcon />
      </ToolbarButton>
      <ToolbarButton
        label="Heading"
        pressed={active.heading}
        onClick={() => chain().toggleHeading({ level: 2 }).run()}
      >
        <Heading2Icon />
      </ToolbarButton>
      <ToolbarButton
        label="Bullet list"
        pressed={active.bulletList}
        onClick={() => chain().toggleBulletList().run()}
      >
        <ListIcon />
      </ToolbarButton>
      <ToolbarButton
        label="Numbered list"
        pressed={active.orderedList}
        onClick={() => chain().toggleOrderedList().run()}
      >
        <ListOrderedIcon />
      </ToolbarButton>
      <LinkButton editor={editor} pressed={active.link} popoverRef={linkPopover} />
    </div>
  );
}

function ToolbarButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      variant={pressed ? 'secondary' : 'ghost'}
      size="icon-sm"
      aria-label={label}
      aria-pressed={pressed}
      // Keep focus (and the selection) in the editor so the change applies to it.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function LinkButton({
  editor,
  pressed,
  popoverRef,
}: {
  editor: Editor;
  pressed: boolean;
  popoverRef: RefObject<HTMLDivElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string>();

  function apply() {
    // Bare domains are common when pasting, so they default to https.
    const trimmed = url.trim();
    const href = safeLinkUrl(/^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (!href) {
      setError('Use an https:// or mailto: link.');
      return;
    }
    const chain = editor.chain().focus().extendMarkRange('link');
    if (editor.state.selection.empty && !editor.isActive('link'))
      chain.insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] });
    else chain.setLink({ href });
    chain.run();
    setOpen(false);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) return;
        setUrl(editor.getAttributes('link').href ?? '');
        setError(undefined);
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant={pressed ? 'secondary' : 'ghost'}
            size="icon-sm"
            aria-label="Link"
            aria-pressed={pressed}
            onMouseDown={(event) => event.preventDefault()}
          />
        }
      >
        <LinkIcon />
      </PopoverTrigger>
      {/* Closing hands focus back to the editor, whose blur then commits the change. */}
      <PopoverContent
        ref={popoverRef}
        align="start"
        className="w-80"
        finalFocus={() => editor.view.dom}
      >
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            apply();
          }}
        >
          <Input
            aria-label="Link URL"
            placeholder="https://"
            value={url}
            aria-invalid={Boolean(error)}
            onChange={(event) => {
              setUrl(event.target.value);
              setError(undefined);
            }}
          />
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <div className="flex justify-end gap-2">
            {pressed ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  editor.chain().focus().extendMarkRange('link').unsetLink().run();
                  setOpen(false);
                }}
              >
                Remove
              </Button>
            ) : null}
            <Button type="submit" size="sm">
              Apply
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
