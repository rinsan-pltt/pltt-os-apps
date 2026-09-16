"use client"

import * as React from "react"
import { Download, GripVertical, Loader2, RotateCw, Trash2, Upload } from "lucide-react"

import { Alert } from "@/components/ui/alert"
import { BusyPanel } from "@/components/ui/busy-panel"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { FileDropzone } from "@/components/layout/file-dropzone"
import { downloadBlob, organizeApply, organizePreview, type OrganizePage } from "@/lib/api"
import { useT, useRegistryText } from "@/lib/i18n"
import type { Tool } from "@/lib/tools"

type Status = "idle" | "loading" | "ready" | "applying" | "error"

interface Card_ {
  key: string
  originalIndex: number
  thumbnail: string
  rotation: number
}

export function OrganizeWorkspace({ tool }: { tool: Tool }) {
  const t = useT()
  const reg = useRegistryText()
  const [files, setFiles] = React.useState<File[]>([])
  const [status, setStatus] = React.useState<Status>("idle")
  const [error, setError] = React.useState<string | null>(null)
  const [cards, setCards] = React.useState<Card_[]>([])
  const dragIndex = React.useRef<number | null>(null)

  const loadFile = async (next: File[]) => {
    setFiles(next)
    setError(null)
    if (next.length === 0) {
      setStatus("idle")
      setCards([])
      return
    }
    setStatus("loading")
    try {
      const preview = await organizePreview(next[0])
      setCards(
        preview.pages.map((p: OrganizePage) => ({
          key: `${p.index}`,
          originalIndex: p.index,
          thumbnail: p.thumbnail,
          rotation: 0,
        })),
      )
      setStatus("ready")
    } catch (e) {
      setError(e instanceof Error ? e.message : t("organize.couldNotOpenPdf"))
      setStatus("error")
    }
  }

  const rotate = (key: string) => {
    setCards((prev) => prev.map((c) => (c.key === key ? { ...c, rotation: (c.rotation + 90) % 360 } : c)))
  }

  const remove = (key: string) => {
    setCards((prev) => prev.filter((c) => c.key !== key))
  }

  const onDragStart = (index: number) => (e: React.DragEvent) => {
    dragIndex.current = index
    e.dataTransfer.effectAllowed = "move"
  }
  const onDragOver = (index: number) => (e: React.DragEvent) => {
    e.preventDefault()
    if (dragIndex.current === null || dragIndex.current === index) return
    setCards((prev) => {
      const next = [...prev]
      const [moved] = next.splice(dragIndex.current as number, 1)
      next.splice(index, 0, moved)
      dragIndex.current = index
      return next
    })
  }
  const onDragEnd = () => {
    dragIndex.current = null
  }

  const apply = async () => {
    if (cards.length === 0) return
    setStatus("applying")
    setError(null)
    try {
      const order = cards.map((c) => (c.rotation ? `${c.originalIndex}:${c.rotation}` : `${c.originalIndex}`)).join(",")
      const result = await organizeApply(files[0], order)
      downloadBlob(result.blob, result.filename)
      setStatus("ready")
    } catch (e) {
      setError(e instanceof Error ? e.message : t("organize.couldNotSave"))
      setStatus("error")
    }
  }

  if (status === "idle" || status === "loading" || (status === "error" && cards.length === 0)) {
    return (
      <div className="w-full max-w-2xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">{reg.toolTitle(tool)}</CardTitle>
            <CardDescription>{reg.toolDescription(tool)}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <FileDropzone accept={tool.accept} multiple={false} files={files} onFilesChange={loadFile} disabled={status === "loading"} />
            {/* Rendering every page's thumbnail is slow on a long PDF; this
                used to be a spinner with no progress bar. */}
            {status === "loading" && <BusyPanel label={t("organize.loadingThumbs")} />}
            {error && (
              <Alert tone="error">{error}</Alert>
            )}
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    // Wider than the 64rem this used to be: the whole point of this screen is
    // seeing pages at once, so on a large display the extra width should become
    // more thumbnails per row (6 -> 8) rather than margin. Bounded rather than
    // full-bleed because reordering is drag-and-drop, and dragging a page
    // across fourteen columns is worse than across eight. Safe to widen — the
    // reorder is index-based (`onDragStart(index)`), not coordinate-based.
    <div className="mx-auto w-full max-w-page space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{files[0]?.name}</h2>
          <p className="text-sm text-muted-foreground">
            {t("organize.dragHint")}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => loadFile([])} disabled={status === "applying"}>
            <Upload className="size-4" /> {t("organize.chooseDifferent")}
          </Button>
          <Button onClick={apply} disabled={status === "applying" || cards.length === 0}>
            {status === "applying" ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            {t("organize.saveDownload")}
          </Button>
        </div>
      </div>

      {error && (
        <Alert tone="error">{error}</Alert>
      )}

      <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(min(9rem,45%),1fr))]">
        {cards.map((card, index) => (
          <div
            key={card.key}
            draggable
            onDragStart={onDragStart(index)}
            onDragOver={onDragOver(index)}
            onDragEnd={onDragEnd}
            className="group relative cursor-grab overflow-hidden rounded-lg border bg-card shadow-sm active:cursor-grabbing"
          >
            <div className="flex items-center justify-between bg-muted/60 px-2 py-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <GripVertical className="size-3.5" /> {t("organize.page", { n: index + 1 })}
              </span>
              <span>{t("organize.orig", { n: card.originalIndex })}</span>
            </div>
            <img
              src={card.thumbnail}
              alt={`Page ${card.originalIndex}`}
              draggable={false}
              style={{ transform: `rotate(${card.rotation}deg)` }}
              className="h-auto w-full select-none object-contain p-2 transition-transform"
            />
            <div className="flex items-center justify-center gap-1 border-t border-border bg-card p-1.5 opacity-0 transition-opacity duration-[var(--dt-dur-instant)] group-hover:opacity-100 group-focus-within:opacity-100">
              <Button variant="ghost" size="icon" className="size-7" onClick={() => rotate(card.key)} aria-label={t("organize.rotatePage")}>
                <RotateCw className="size-4" />
              </Button>
              <Button variant="ghost" size="icon" className="size-7 text-destructive" onClick={() => remove(card.key)} aria-label={t("organize.deletePage")}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {cards.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {t("organize.allRemoved")}
        </p>
      )}
    </div>
  )
}
