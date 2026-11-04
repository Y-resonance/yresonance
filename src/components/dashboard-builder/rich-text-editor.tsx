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
  Maximize2Icon,
} from 'lucide-react';
import { Button } from '#/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '#/components/ui/dialog';
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

// Long text shouldn't depend on leaving the field to be saved. Pausing saves it, and so does
// typing without a pause for long enough.
const SAVE_AFTER_PAUSE_MS = 2_000;
const SAVE_WHILE_TYPING_MS = 10_000;

// The latest save of each widget's text, until it succeeds. A save can fail after the editor has
// closed, such as when clicking another widget saves on blur, so this outlives it. Reopening the
// widget restores the text, and its next blur or close retries.
const unsavedText = new Map<string, { markdown: string; failed: boolean }>();
const warnAboutUnsavedText = (event: BeforeUnloadEvent) => {
  if (unsavedText.size > 0) event.preventDefault();
};

// Recent text each widget has held, newest last. Dashboard responses can arrive late and carry
// older text, and loading it would make the next edit save over newer text. So the editor only
// follows text it has not seen, such as an agent's change. An agent restoring an exact earlier
// text is ignored as well, until the page reloads.
const knownText = new Map<string, string[]>();
function rememberText(widgetId: string, text: string) {
  const earlier = (knownText.get(widgetId) ?? []).filter((known) => known !== text);
  knownText.set(widgetId, [...earlier, text].slice(-50));
}

/**
 * WYSIWYG Markdown editor for text widgets in the inspector, which can pop out into a large dialog.
 * It is the default export so the inspector can lazy-load it: viewers and share links never
 * download Tiptap. It saves shortly after typing, on blur and when it closes, and only when the
 * user actually changed the text. `onCommit` resolves to whether the save worked.
 */
export default function RichTextEditor({
  widgetId,
  label,
  value,
  onCommit,
}: {
  widgetId: string;
  label: string;
  value: string;
  onCommit: (markdown: string, trigger?: 'autosave') => Promise<boolean>;
}) {
  const [expanded, setExpanded] = useState(false);
  const refocusAfterDialog = useRef(false);
  // Only user edits mark the document dirty; loading `value` does not, so focusing and leaving
  // an untouched (possibly legacy) document never saves it.
  const dirty = useRef(false);
  const pauseTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const typingTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const commitRef = useRef(onCommit);
  useEffect(() => {
    commitRef.current = onCommit;
  });

  async function save(editor: Editor, trigger?: 'autosave') {
    clearTimeout(pauseTimer.current);
    clearTimeout(typingTimer.current);
    typingTimer.current = undefined;
    if (!dirty.current && !unsavedText.get(widgetId)?.failed) return;
    dirty.current = false;
    // Leading spaces can mark an indented code block, so only the end is trimmed.
    const markdown = editor.getMarkdown().trimEnd();
    const entry = { markdown, failed: false };
    unsavedText.set(widgetId, entry);
    window.addEventListener('beforeunload', warnAboutUnsavedText);
    const saved = await commitRef.current(markdown, trigger);
    if (saved) rememberText(widgetId, markdown);
    // A newer save has replaced this entry and covers this text, so only the latest one decides.
    if (unsavedText.get(widgetId) !== entry) return;
    if (saved) unsavedText.delete(widgetId);
    else entry.failed = true;
  }

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
    // The canvas can briefly hold older text, so a known `value` opens at the newest text instead.
    content:
      unsavedText.get(widgetId)?.markdown ??
      (knownText.get(widgetId)?.includes(value.trimEnd())
        ? knownText.get(widgetId)?.at(-1)
        : value),
    contentType: 'markdown',
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': label,
        class: cn(richTextClasses, 'min-h-24 px-2.5 py-2 text-sm outline-none'),
      },
    },
    onUpdate: ({ editor }) => {
      dirty.current = true;
      clearTimeout(pauseTimer.current);
      pauseTimer.current = setTimeout(() => void save(editor, 'autosave'), SAVE_AFTER_PAUSE_MS);
      typingTimer.current ??= setTimeout(() => void save(editor, 'autosave'), SAVE_WHILE_TYPING_MS);
    },
    onBlur: ({ editor, event }) => {
      const target = event.relatedTarget;
      if (target instanceof Node && linkPopover.current?.contains(target)) return;
      void save(editor);
    },
  });

  // Follow outside changes, such as an agent updating the widget, unless the user is mid-edit or
  // the text is older than what the editor already has.
  useEffect(() => {
    const text = value.trimEnd();
    if (
      !editor ||
      dirty.current ||
      unsavedText.get(widgetId)?.failed ||
      knownText.get(widgetId)?.includes(text)
    )
      return;
    rememberText(widgetId, text);
    if (editor.getMarkdown().trimEnd() === text) return;
    editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false });
  }, [editor, value, widgetId]);

  // Browser back or forward can remove the editor with no blur to save on, such as while the
  // link popover has focus.
  useEffect(() => {
    if (!editor) return;
    return () => void save(editor);
  }, [editor]);

  useEffect(() => {
    const warnWhileEditing = (event: BeforeUnloadEvent) => {
      if (dirty.current) event.preventDefault();
    };
    window.addEventListener('beforeunload', warnWhileEditing);
    return () => window.removeEventListener('beforeunload', warnWhileEditing);
  }, []);

  // Focus has to wait until the editor is back in the inspector, so this runs after the dialog closed.
  useEffect(() => {
    if (expanded || !refocusAfterDialog.current) return;
    refocusAfterDialog.current = false;
    editor?.commands.focus();
  }, [expanded, editor]);

  const field = (
    <div
      className={cn(
        'rounded-lg border border-input transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30',
        expanded && 'flex min-h-0 flex-col',
      )}
    >
      {editor ? (
        <Toolbar
          editor={editor}
          linkPopover={linkPopover}
          onExpand={expanded ? undefined : () => setExpanded(true)}
        />
      ) : null}
      <EditorContent
        editor={editor}
        className={cn(
          expanded && 'flex min-h-0 flex-1 flex-col overflow-y-auto [&>.ProseMirror]:flex-1',
        )}
      />
    </div>
  );
  if (!expanded) return field;

  // The same editor moves into the dialog, so undo history and the cursor come along. The dialog
  // unmounts as soon as it closes, because only one place can hold the editor at a time.
  return (
    <>
      <div className="min-h-34 rounded-lg border border-input" />
      <Dialog
        open
        onOpenChange={(open) => {
          if (open) return;
          refocusAfterDialog.current = true;
          setExpanded(false);
        }}
      >
        <DialogContent
          className="h-[80dvh] grid-rows-[auto_minmax(0,1fr)] sm:max-w-3xl"
          // Focusing the element directly would put the cursor at the start of the text, and the
          // editor could read that before restoring its own selection. `view.focus` does both.
          initialFocus={() => {
            editor?.view.focus();
            return editor?.view.dom ?? null;
          }}
          // The effect above returns focus, once the editor is back in the inspector.
          finalFocus={false}
        >
          <DialogTitle>{label}</DialogTitle>
          {field}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Toolbar({
  editor,
  linkPopover,
  onExpand,
}: {
  editor: Editor;
  linkPopover: RefObject<HTMLDivElement | null>;
  onExpand?: () => void;
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
      {onExpand ? (
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          aria-label="Expand editor"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onExpand}
        >
          <Maximize2Icon />
        </Button>
      ) : null}
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
