"use client"

import * as React from "react"
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Baseline,
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  Bold,
  Eraser,
  Heading1,
  Heading2,
  ImagePlus,
  Italic,
  List,
  ListOrdered,
  PaintBucket,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  Table,
  TableCellsMerge,
  TableCellsSplit,
  Trash2,
  Underline,
  Undo2,
  WrapText,
} from "lucide-react"

import { preserveScroll } from "@/lib/dom-selection"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import {
  cellIndex,
  clearCellFormatting,
  clearCells,
  deleteColumn,
  deleteRow,
  gridOf,
  insertColumn,
  insertRow,
  mergeCells,
  selectedCells,
  setCellStyle,
  toggleCellStyle,
  unmergeCell,
} from "@/lib/grid-edit"

/** "sheet" = a spreadsheet's cell grid, "page" = a document/slide page. The
 *  two need different tools, so the toolbox swaps its contents rather than
 *  showing controls that cannot do anything to what's open. */
export type ToolboxMode = "sheet" | "page"

function ToolButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      // The editor's selection is what every command acts on, and focusing a
      // button would collapse it — so the press must never take focus.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors",
        "hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:opacity-40",
      )}
    >
      {children}
    </button>
  )
}

/** A color swatch button wrapping a hidden native picker. */
function ColorButton({
  label,
  value,
  onPick,
  onOpen,
  disabled,
  children,
}: {
  label: string
  value: string
  onPick: (color: string) => void
  onOpen: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <label
      title={label}
      aria-label={label}
      onPointerDown={onOpen}
      className={cn(
        "relative inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors",
        "hover:bg-muted hover:text-foreground",
        disabled && "pointer-events-none opacity-40",
      )}
    >
      {children}
      <span
        aria-hidden
        className="absolute inset-x-1 bottom-0.5 h-1 rounded-sm border border-border"
        style={{ background: value }}
      />
      <input
        type="color"
        value={value}
        disabled={disabled}
        onChange={(e) => onPick(e.target.value)}
        className="absolute size-0 opacity-0"
      />
    </label>
  )
}

function Divider() {
  return <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-border" />
}

export function EditorToolbox({
  mode,
  positioned,
  editorRef,
  activeCell,
  onChanged,
  onInsertImage,
}: {
  mode: ToolboxMode
  /** True for pages rebuilt from a PDF render (PDFs, Word, slides): every
   *  element sits at its own absolute coordinates, and the exporter re-places
   *  exactly those. Block-level insertions — headings, lists, a new table —
   *  have no coordinates, so they would look right on screen and then be
   *  missing from the download. They are offered only on flowing pages
   *  (plain text, and reconstructed documents), where the export path lays
   *  the markup out itself. Inline formatting is safe either way: it lives
   *  inside an element that is already placed. */
  positioned: boolean
  editorRef: React.RefObject<HTMLDivElement | null>
  /** The grid cell the caret is in — sheet tools act on it (and on any wider
   *  selection around it), so they stay disabled until there is one. */
  activeCell: HTMLTableCellElement | null
  onChanged: () => void
  onInsertImage: () => void
}) {
  const t = useT()
  const [textColor, setTextColor] = React.useState("#111827")
  const [fillColor, setFillColor] = React.useState("#fde68a")
  // A color picker takes focus away from the editor, so what the command
  // should act on is captured the moment the swatch is pressed.
  const savedRange = React.useRef<Range | null>(null)
  const savedCells = React.useRef<HTMLTableCellElement[]>([])

  const rememberSelection = React.useCallback(() => {
    const selection = window.getSelection()
    savedRange.current =
      selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null
    const table = gridOf(activeCell)
    savedCells.current = table ? selectedCells(table, activeCell) : []
  }, [activeCell])

  const restoreSelection = React.useCallback(() => {
    // Selection first, THEN focus without scrolling: focusing first parks the
    // caret at the top of the document and the browser scrolls up to it.
    preserveScroll(editorRef.current, () => {
      const range = savedRange.current
      if (range) {
        const selection = window.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
      }
      editorRef.current?.focus({ preventScroll: true })
    })
  }, [editorRef])

  /** Run a built-in rich-text command on the current selection. `execCommand`
   *  is deprecated but remains the only cross-browser way to edit a
   *  `contenteditable`'s inline markup, which is what this editor is. */
  const exec = React.useCallback(
    (command: string, value?: string) => {
      preserveScroll(editorRef.current, () => {
        editorRef.current?.focus({ preventScroll: true })
        document.execCommand(command, false, value)
      })
      onChanged()
    },
    [editorRef, onChanged],
  )

  // ------------------------------------------------------------ sheet tools

  const cellsToEdit = React.useCallback((): HTMLTableCellElement[] => {
    const table = gridOf(activeCell)
    return table ? selectedCells(table, activeCell) : []
  }, [activeCell])

  /** Put the caret back in `td` after a structural change, so typing carries
   *  on where the user was rather than nowhere. */
  const focusCell = (td: HTMLTableCellElement | null) => {
    if (!td?.isConnected) return
    const range = document.createRange()
    range.selectNodeContents(td)
    range.collapse(true)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }

  const structural = (run: (table: HTMLTableElement, row: number, col: number) => void) => () => {
    const table = gridOf(activeCell)
    const at = activeCell ? cellIndex(activeCell) : null
    if (!table || !at) return
    preserveScroll(editorRef.current, () => run(table, at.row, at.col))
    onChanged()
  }

  const styleCells = (property: string, value: string) => () => {
    const cells = cellsToEdit()
    if (cells.length === 0) return
    toggleCellStyle(cells, property, value)
    onChanged()
  }

  const sheetTools = (
    <>
      <ToolButton label={t("edit.tb.undo")} onClick={() => exec("undo")}>
        <Undo2 className="size-4" />
      </ToolButton>
      <ToolButton label={t("edit.tb.redo")} onClick={() => exec("redo")}>
        <Redo2 className="size-4" />
      </ToolButton>
      <Divider />

      {/* Rows and columns */}
      <ToolButton
        label={t("edit.tb.rowAbove")}
        disabled={!activeCell}
        onClick={structural((table, row) => insertRow(table, row, "above"))}
      >
        <BetweenHorizontalStart className="size-4" />
      </ToolButton>
      <ToolButton
        label={t("edit.tb.rowBelow")}
        disabled={!activeCell}
        onClick={structural((table, row) => insertRow(table, row, "below"))}
      >
        <BetweenHorizontalEnd className="size-4" />
      </ToolButton>
      <ToolButton
        label={t("edit.tb.colLeft")}
        disabled={!activeCell}
        onClick={structural((table, _row, col) => insertColumn(table, col, "left"))}
      >
        <BetweenVerticalStart className="size-4" />
      </ToolButton>
      <ToolButton
        label={t("edit.tb.colRight")}
        disabled={!activeCell}
        onClick={structural((table, _row, col) => insertColumn(table, col, "right"))}
      >
        <BetweenVerticalEnd className="size-4" />
      </ToolButton>
      <ToolButton
        label={t("edit.tb.deleteRow")}
        disabled={!activeCell}
        onClick={structural((table, row) => deleteRow(table, row))}
      >
        <span className="flex items-center gap-px">
          <Trash2 className="size-3.5" />
          <span className="text-[10px] font-semibold leading-none">R</span>
        </span>
      </ToolButton>
      <ToolButton
        label={t("edit.tb.deleteCol")}
        disabled={!activeCell}
        onClick={structural((table, _row, col) => deleteColumn(table, col))}
      >
        <span className="flex items-center gap-px">
          <Trash2 className="size-3.5" />
          <span className="text-[10px] font-semibold leading-none">C</span>
        </span>
      </ToolButton>
      <Divider />

      {/* Cells */}
      <ToolButton
        label={t("edit.tb.merge")}
        disabled={!activeCell}
        onClick={() => {
          const table = gridOf(activeCell)
          if (!table) return
          const anchor = cellsToEdit()[0] ?? null
          if (mergeCells(table, cellsToEdit())) {
            focusCell(anchor)
            onChanged()
          }
        }}
      >
        <TableCellsMerge className="size-4" />
      </ToolButton>
      <ToolButton
        label={t("edit.tb.unmerge")}
        disabled={!activeCell}
        onClick={() => {
          const table = gridOf(activeCell)
          if (!table || !activeCell) return
          if (unmergeCell(table, activeCell)) {
            focusCell(activeCell)
            onChanged()
          }
        }}
      >
        <TableCellsSplit className="size-4" />
      </ToolButton>
      <ToolButton
        label={t("edit.tb.clearCells")}
        disabled={!activeCell}
        onClick={() => {
          const cells = cellsToEdit()
          if (cells.length === 0) return
          clearCells(cells)
          onChanged()
        }}
      >
        <Eraser className="size-4" />
      </ToolButton>
      <Divider />

      {/* Cell formatting — set on the cell itself, which is what the .xlsx
          export reads back (markup inside a cell would not survive). */}
      <ToolButton label={t("edit.tb.bold")} disabled={!activeCell} onClick={styleCells("font-weight", "700")}>
        <Bold className="size-4" />
      </ToolButton>
      <ToolButton label={t("edit.tb.italic")} disabled={!activeCell} onClick={styleCells("font-style", "italic")}>
        <Italic className="size-4" />
      </ToolButton>
      <ToolButton
        label={t("edit.tb.underline")}
        disabled={!activeCell}
        onClick={styleCells("text-decoration", "underline")}
      >
        <Underline className="size-4" />
      </ToolButton>
      <ToolButton label={t("edit.tb.alignLeft")} disabled={!activeCell} onClick={styleCells("text-align", "left")}>
        <AlignLeft className="size-4" />
      </ToolButton>
      <ToolButton label={t("edit.tb.alignCenter")} disabled={!activeCell} onClick={styleCells("text-align", "center")}>
        <AlignCenter className="size-4" />
      </ToolButton>
      <ToolButton label={t("edit.tb.alignRight")} disabled={!activeCell} onClick={styleCells("text-align", "right")}>
        <AlignRight className="size-4" />
      </ToolButton>
      <ToolButton
        label={t("edit.tb.wrapText")}
        disabled={!activeCell}
        onClick={styleCells("white-space", "pre-wrap")}
      >
        <WrapText className="size-4" />
      </ToolButton>
      <ColorButton
        label={t("edit.tb.textColor")}
        value={textColor}
        disabled={!activeCell}
        onOpen={rememberSelection}
        onPick={(color) => {
          setTextColor(color)
          const cells = savedCells.current.length > 0 ? savedCells.current : cellsToEdit()
          if (cells.length === 0) return
          setCellStyle(cells, "color", color)
          onChanged()
        }}
      >
        <Baseline className="size-4" />
      </ColorButton>
      <ColorButton
        label={t("edit.tb.fillColor")}
        value={fillColor}
        disabled={!activeCell}
        onOpen={rememberSelection}
        onPick={(color) => {
          setFillColor(color)
          const cells = savedCells.current.length > 0 ? savedCells.current : cellsToEdit()
          if (cells.length === 0) return
          setCellStyle(cells, "background-color", color)
          onChanged()
        }}
      >
        <PaintBucket className="size-4" />
      </ColorButton>
      <ToolButton
        label={t("edit.tb.clearFormat")}
        disabled={!activeCell}
        onClick={() => {
          const cells = cellsToEdit()
          if (cells.length === 0) return
          clearCellFormatting(cells)
          onChanged()
        }}
      >
        <RemoveFormatting className="size-4" />
      </ToolButton>
    </>
  )

  // ----------------------------------------------------------- page tools

  /** A 3x3 table at the caret — the same markup LibreOffice's own export
   *  produces, so it exports like any other table in the document. */
  const insertTable = () => {
    const rows = 3
    const cols = 3
    const cells = `<td style="border:1px solid #999;padding:4px 8px;"><br></td>`.repeat(cols)
    const html = `<table style="border-collapse:collapse;width:100%;"><tbody>${`<tr>${cells}</tr>`.repeat(rows)}</tbody></table><p><br></p>`
    exec("insertHTML", html)
  }

  const pageTools = (
    <>
      <ToolButton label={t("edit.tb.undo")} onClick={() => exec("undo")}>
        <Undo2 className="size-4" />
      </ToolButton>
      <ToolButton label={t("edit.tb.redo")} onClick={() => exec("redo")}>
        <Redo2 className="size-4" />
      </ToolButton>
      <Divider />

      <ToolButton label={t("edit.tb.bold")} onClick={() => exec("bold")}>
        <Bold className="size-4" />
      </ToolButton>
      <ToolButton label={t("edit.tb.italic")} onClick={() => exec("italic")}>
        <Italic className="size-4" />
      </ToolButton>
      <ToolButton label={t("edit.tb.underline")} onClick={() => exec("underline")}>
        <Underline className="size-4" />
      </ToolButton>
      <ToolButton label={t("edit.tb.strike")} onClick={() => exec("strikeThrough")}>
        <Strikethrough className="size-4" />
      </ToolButton>
      <Divider />

      {!positioned && (
        <>
          <ToolButton label={t("edit.tb.heading1")} onClick={() => exec("formatBlock", "<h1>")}>
            <Heading1 className="size-4" />
          </ToolButton>
          <ToolButton label={t("edit.tb.heading2")} onClick={() => exec("formatBlock", "<h2>")}>
            <Heading2 className="size-4" />
          </ToolButton>
          <ToolButton label={t("edit.tb.paragraph")} onClick={() => exec("formatBlock", "<p>")}>
            <span className="text-[11px] font-semibold leading-none">¶</span>
          </ToolButton>
          <ToolButton label={t("edit.tb.bullets")} onClick={() => exec("insertUnorderedList")}>
            <List className="size-4" />
          </ToolButton>
          <ToolButton label={t("edit.tb.numbers")} onClick={() => exec("insertOrderedList")}>
            <ListOrdered className="size-4" />
          </ToolButton>
          <Divider />
        </>
      )}

      <ToolButton label={t("edit.tb.alignLeft")} onClick={() => exec("justifyLeft")}>
        <AlignLeft className="size-4" />
      </ToolButton>
      <ToolButton label={t("edit.tb.alignCenter")} onClick={() => exec("justifyCenter")}>
        <AlignCenter className="size-4" />
      </ToolButton>
      <ToolButton label={t("edit.tb.alignRight")} onClick={() => exec("justifyRight")}>
        <AlignRight className="size-4" />
      </ToolButton>
      <Divider />

      <ColorButton
        label={t("edit.tb.textColor")}
        value={textColor}
        onOpen={rememberSelection}
        onPick={(color) => {
          setTextColor(color)
          restoreSelection()
          exec("foreColor", color)
        }}
      >
        <Baseline className="size-4" />
      </ColorButton>
      <ColorButton
        label={t("edit.tb.highlight")}
        value={fillColor}
        onOpen={rememberSelection}
        onPick={(color) => {
          setFillColor(color)
          restoreSelection()
          exec("hiliteColor", color)
        }}
      >
        <PaintBucket className="size-4" />
      </ColorButton>
      <ToolButton label={t("edit.tb.clearFormat")} onClick={() => exec("removeFormat")}>
        <RemoveFormatting className="size-4" />
      </ToolButton>
      <Divider />

      {!positioned && (
        <ToolButton label={t("edit.tb.insertTable")} onClick={insertTable}>
          <Table className="size-4" />
        </ToolButton>
      )}
      <ToolButton label={t("edit.tb.insertImage")} onClick={onInsertImage}>
        <ImagePlus className="size-4" />
      </ToolButton>
    </>
  )

  return (
    <div
      role="toolbar"
      aria-label={t("edit.tb.label")}
      className="flex flex-wrap items-center gap-0.5 border-t px-1 pt-1.5"
    >
      {mode === "sheet" ? sheetTools : pageTools}
      {mode === "sheet" && !activeCell && (
        <span className="ml-1.5 text-xs text-muted-foreground">{t("edit.tb.pickCell")}</span>
      )}
    </div>
  )
}
