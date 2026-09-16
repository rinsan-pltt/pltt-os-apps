"use client";

import { useEffect, useRef } from "react";
import {
  AlignCenter,
  Baseline,
  Bold,
  Eraser,
  Italic,
  Link2,
  List,
  ListOrdered,
  Strikethrough,
  Underline as UnderlineIcon,
} from "lucide-react";
import { Color } from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import Placeholder from "@tiptap/extension-placeholder";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import { EditorContent, useEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import { useActiveEditor } from "./active-editor";
import { cn } from "../../lib/cn";
import { useT } from "../../lib/i18n";
import { FontFamily, FontSize, LineHeight } from "../../lib/tiptap-extensions";
import { useThemeHighlights } from "./theme-highlights";

/** Inline rich-text editor. Round-trips HTML so marks survive editing. */
export function RichText({
  value,
  onCommit,
  multiline = false,
  className,
  style,
  placeholder,
}: {
  value: string;
  onCommit: (html: string) => void;
  multiline?: boolean;
  className?: string;
  style?: React.CSSProperties;
  placeholder?: string;
}) {
  const { setEditor, clearIfActive } = useActiveEditor();
  const HIGHLIGHTS = useThemeHighlights();
  const t = useT();
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        link: { openOnClick: false, autolink: true },
      }),
      TextStyle,
      Color,
      FontSize,
      FontFamily,
      LineHeight,
      Subscript,
      Superscript,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["paragraph"] }),
      Placeholder.configure({ placeholder: placeholder ?? "" }),
    ],
    content: value || "",
    editorProps: {
      attributes: { class: cn("richtext outline-none", className) },
      handleKeyDown: multiline
        ? undefined
        : (_view, event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              (event.target as HTMLElement)?.blur?.();
              return true;
            }
            return false;
          },
    },
    onFocus: ({ editor }) => setEditor(editor),
    onBlur: ({ editor }) => {
      let html = editor.getHTML();
      if (!multiline) {
        html = html.replace(/^<p[^>]*>/, "").replace(/<\/p>\s*$/, "");
      }
      if (html !== value) onCommit(html);
    },
  });

  // keep the shared toolbar pointed at this editor while it's mounted; clear on unmount
  const editorRef = useRef(editor);
  editorRef.current = editor;
  useEffect(() => {
    return () => {
      if (editorRef.current) clearIfActive(editorRef.current);
    };
  }, [clearIfActive]);

  // sync external content changes (regenerate, switch block) without clobbering typing
  useEffect(() => {
    if (!editor || editor.isFocused) return;
    const current = multiline
      ? editor.getHTML()
      : editor.getHTML().replace(/^<p[^>]*>/, "").replace(/<\/p>\s*$/, "");
    if ((value || "") !== current) {
      editor.commands.setContent(value || "", { emitUpdate: false });
    }
  }, [value, editor, multiline]);

  if (!editor) {
    return (
      <div className={cn("richtext", className)} style={style}>
        <span dangerouslySetInnerHTML={{ __html: value }} />
      </div>
    );
  }

  return (
    <div style={style}>
      <BubbleMenu
        editor={editor}
        className="flex items-center gap-0.5 rounded-lg border border-border bg-surface p-1 shadow-lg"
      >
        <TBtn title={t("fmt.bold")} on={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold className="size-3.5" strokeWidth={2} />
        </TBtn>
        <TBtn title={t("fmt.italic")} on={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic className="size-3.5" strokeWidth={2} />
        </TBtn>
        <TBtn title={t("fmt.underline")} on={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
          <UnderlineIcon className="size-3.5" strokeWidth={2} />
        </TBtn>
        <TBtn title={t("fmt.strike")} on={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}>
          <Strikethrough className="size-3.5" strokeWidth={2} />
        </TBtn>
        <Sep />
        <TBtn title={t("richText.link")} on={editor.isActive("link")} onClick={() => setLink(editor, t)}>
          <Link2 className="size-3.5" strokeWidth={2} />
        </TBtn>
        {HIGHLIGHTS.map((c) => (
          <button
            key={c}
            type="button"
            title={t("richText.highlight")}
            onClick={() => editor.chain().focus().toggleHighlight({ color: c }).run()}
            className="size-4 rounded-sm border border-border-strong"
            style={{ background: c }}
          />
        ))}
        <label title={t("fmt.textColor")} className="ml-0.5 grid size-6 cursor-pointer place-items-center rounded text-fg-muted hover:bg-surface-2 hover:text-fg">
          <Baseline className="size-3.5" strokeWidth={2} />
          <input
            type="color"
            className="absolute size-0 opacity-0"
            onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
          />
        </label>
        {multiline ? (
          <>
            <Sep />
            <TBtn title={t("richText.bulletList")} on={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
              <List className="size-3.5" strokeWidth={2} />
            </TBtn>
            <TBtn title={t("fmt.numberedList")} on={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
              <ListOrdered className="size-3.5" strokeWidth={2} />
            </TBtn>
            <TBtn title={t("fmt.alignCenter")} on={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()}>
              <AlignCenter className="size-3.5" strokeWidth={2} />
            </TBtn>
          </>
        ) : null}
        <Sep />
        <TBtn title={t("richText.clear")} onClick={() => editor.chain().focus().unsetAllMarks().run()}>
          <Eraser className="size-3.5" strokeWidth={2} />
        </TBtn>
      </BubbleMenu>
      <EditorContent editor={editor} className={className} style={style} />
    </div>
  );
}

function setLink(editor: ReturnType<typeof useEditor>, t: ReturnType<typeof useT>) {
  if (!editor) return;
  const prev = editor.getAttributes("link").href as string | undefined;
  const url = window.prompt(t("richText.linkUrl"), prev ?? "https://");
  if (url === null) return;
  if (url === "") {
    editor.chain().focus().unsetLink().run();
    return;
  }
  editor.chain().focus().setLink({ href: url }).run();
}

function TBtn({
  on,
  title,
  onClick,
  children,
}: {
  on?: boolean;
  title?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "grid h-6 min-w-6 place-items-center rounded px-1 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg",
        on && "bg-brand-100 text-brand-700 dark:bg-brand-400/15 dark:text-brand-300",
      )}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <span className="mx-0.5 h-4 w-px bg-border" />;
}
