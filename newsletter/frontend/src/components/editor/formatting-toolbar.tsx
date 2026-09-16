"use client";

import { useEffect, useReducer } from "react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  Code,
  Eraser,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  Strikethrough,
  Subscript,
  Superscript,
  Underline,
  Undo2,
} from "lucide-react";
import { useActiveEditor } from "./active-editor";
import { cn } from "../../lib/cn";
import { useT } from "../../lib/i18n";
import {
  FONT_FAMILIES,
  FONT_SIZES,
  LINE_HEIGHTS,
} from "../../lib/tiptap-extensions";

const HIGHLIGHTS = ["#fde68a", "#bfdbfe", "#bbf7d0", "#fecaca"];

export function FormattingToolbar() {
  const { editor } = useActiveEditor();
  const [, force] = useReducer((x) => x + 1, 0);

  useEffect(() => {
    if (!editor) return;
    const update = () => force();
    editor.on("transaction", update);
    editor.on("selectionUpdate", update);
    return () => {
      editor.off("transaction", update);
      editor.off("selectionUpdate", update);
    };
  }, [editor]);

  const t = useT();

  const live = editor && !editor.isDestroyed ? editor : null;
  const off = !live;
  const ed = editor!; // guarded by `off` on every control

  const fontSize = (live?.getAttributes("textStyle").fontSize as string | undefined)?.replace("px", "") ?? "";
  const fontFamily = (live?.getAttributes("textStyle").fontFamily as string | undefined) ?? "";
  const lineHeight = (live?.getAttributes("paragraph").lineHeight as string | undefined) ?? "";

  return (
    <div
      className={cn(
        "flex items-center gap-0.5 overflow-x-auto border-b border-border bg-surface px-2 py-1.5 scroll-thin",
        off && "opacity-50",
      )}
      title={off ? t("fmt.disabledHint") : undefined}
    >
      <Btn icon={Undo2} title={t("fmt.undo")} disabled={off || !live?.can().undo()} onClick={() => ed.chain().focus().undo().run()} />
      <Btn icon={Redo2} title={t("fmt.redo")} disabled={off || !live?.can().redo()} onClick={() => ed.chain().focus().redo().run()} />
      <Sep />

      <Select
        value={fontFamily}
        disabled={off}
        className="w-24"
        onChange={(v) => ed.chain().focus().setMark("textStyle", { fontFamily: v || null }).run()}
        options={FONT_FAMILIES}
      />
      <Select
        value={fontSize}
        disabled={off}
        className="w-14"
        onChange={(v) => ed.chain().focus().setMark("textStyle", { fontSize: v ? `${v}px` : null }).run()}
        options={[{ label: t("fmt.sizePlaceholder"), value: "" }, ...FONT_SIZES.map((s) => ({ label: s, value: s }))]}
      />
      <Select
        value={lineHeight}
        disabled={off}
        className="w-16"
        title={t("fmt.lineSpacing")}
        onChange={(v) => ed.chain().focus().updateAttributes("paragraph", { lineHeight: v || null }).run()}
        options={LINE_HEIGHTS}
      />
      <Sep />

      <Btn icon={Bold} title={t("fmt.bold")} disabled={off} on={live?.isActive("bold")} onClick={() => ed.chain().focus().toggleBold().run()} />
      <Btn icon={Italic} title={t("fmt.italic")} disabled={off} on={live?.isActive("italic")} onClick={() => ed.chain().focus().toggleItalic().run()} />
      <Btn icon={Underline} title={t("fmt.underline")} disabled={off} on={live?.isActive("underline")} onClick={() => ed.chain().focus().toggleUnderline().run()} />
      <Btn icon={Strikethrough} title={t("fmt.strike")} disabled={off} on={live?.isActive("strike")} onClick={() => ed.chain().focus().toggleStrike().run()} />
      <Btn icon={Subscript} title={t("fmt.subscript")} disabled={off} on={live?.isActive("subscript")} onClick={() => ed.chain().focus().toggleSubscript().run()} />
      <Btn icon={Superscript} title={t("fmt.superscript")} disabled={off} on={live?.isActive("superscript")} onClick={() => ed.chain().focus().toggleSuperscript().run()} />
      <Sep />

      <label className={cn("grid size-7 place-items-center rounded text-fg-muted hover:bg-surface-2 hover:text-fg", off ? "pointer-events-none opacity-50" : "cursor-pointer")} title={t("fmt.textColor")}>
        <Baseline className="size-4" strokeWidth={2} />
        <input type="color" disabled={off} className="absolute size-0 opacity-0" onChange={(e) => ed.chain().focus().setColor(e.target.value).run()} />
      </label>
      {HIGHLIGHTS.map((c) => (
        <button
          key={c}
          type="button"
          title={t("fmt.highlight")}
          disabled={off}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => ed.chain().focus().toggleHighlight({ color: c }).run()}
          className="size-4 rounded-sm border border-border-strong disabled:opacity-50"
          style={{ background: c }}
        />
      ))}
      <Sep />

      <Btn icon={List} title={t("fmt.bulletList")} disabled={off} on={live?.isActive("bulletList")} onClick={() => ed.chain().focus().toggleBulletList().run()} />
      <Btn icon={ListOrdered} title={t("fmt.numberedList")} disabled={off} on={live?.isActive("orderedList")} onClick={() => ed.chain().focus().toggleOrderedList().run()} />
      <Btn icon={Quote} title={t("fmt.quote")} disabled={off} on={live?.isActive("blockquote")} onClick={() => ed.chain().focus().toggleBlockquote().run()} />
      <Btn icon={Code} title={t("fmt.code")} disabled={off} on={live?.isActive("code")} onClick={() => ed.chain().focus().toggleCode().run()} />
      <Sep />

      <Btn icon={AlignLeft} title={t("fmt.alignLeft")} disabled={off} on={live?.isActive({ textAlign: "left" })} onClick={() => ed.chain().focus().setTextAlign("left").run()} />
      <Btn icon={AlignCenter} title={t("fmt.alignCenter")} disabled={off} on={live?.isActive({ textAlign: "center" })} onClick={() => ed.chain().focus().setTextAlign("center").run()} />
      <Btn icon={AlignRight} title={t("fmt.alignRight")} disabled={off} on={live?.isActive({ textAlign: "right" })} onClick={() => ed.chain().focus().setTextAlign("right").run()} />
      <Btn icon={AlignJustify} title={t("fmt.justify")} disabled={off} on={live?.isActive({ textAlign: "justify" })} onClick={() => ed.chain().focus().setTextAlign("justify").run()} />
      <Sep />

      <Btn icon={Link2} title={t("fmt.link")} disabled={off} on={live?.isActive("link")} onClick={() => live && setLink(live, t)} />
      <Btn icon={Minus} title={t("fmt.divider")} disabled={off} onClick={() => ed.chain().focus().setHorizontalRule().run()} />
      <Btn icon={Eraser} title={t("fmt.clearFormatting")} disabled={off} onClick={() => ed.chain().focus().unsetAllMarks().run()} />
    </div>
  );
}

function setLink(
  editor: NonNullable<ReturnType<typeof useActiveEditor>["editor"]>,
  t: ReturnType<typeof useT>,
) {
  const prev = editor.getAttributes("link").href as string | undefined;
  const url = window.prompt(t("fmt.linkUrlPrompt"), prev ?? "https://");
  if (url === null) return;
  if (url === "") {
    editor.chain().focus().unsetLink().run();
    return;
  }
  editor.chain().focus().setLink({ href: url }).run();
}

function Select({
  value,
  options,
  onChange,
  disabled,
  className,
  title,
}: {
  value: string;
  options: { label: string; value: string }[];
  onChange: (v: string) => void;
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      title={title}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "h-7 shrink-0 rounded border border-border bg-surface px-1 text-xs text-fg disabled:opacity-50",
        className,
      )}
    >
      {options.map((o) => (
        <option key={o.label + o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function Btn({
  icon: Icon,
  title,
  on,
  disabled,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title?: string;
  on?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "grid h-7 min-w-7 shrink-0 place-items-center rounded px-1.5 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:pointer-events-none disabled:opacity-50",
        on && "bg-brand-100 text-brand-700 dark:bg-brand-400/15 dark:text-brand-300",
      )}
    >
      <Icon className="size-3.5" strokeWidth={2} />
    </button>
  );
}

function Sep() {
  return <span className="mx-0.5 h-4 w-px shrink-0 bg-border" />;
}
