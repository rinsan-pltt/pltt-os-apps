import React from "react"

export function timeAgo(dateStr: string): string {
  const trimmed = dateStr.replace(/(\.\d{3})\d+/, "$1")
  const normalized = /[Zz]$|[+-]\d{2}:\d{2}$/.test(trimmed) ? trimmed : `${trimmed}Z`
  const diff = Date.now() - new Date(normalized).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s} seconds ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} minute${m !== 1 ? "s" : ""} ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} hour${h !== 1 ? "s" : ""} ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d} day${d !== 1 ? "s" : ""} ago`
  const w = Math.floor(d / 7)
  if (w < 5) return `${w} week${w !== 1 ? "s" : ""} ago`
  const mo = Math.floor(d / 30)
  return `${mo} month${mo !== 1 ? "s" : ""} ago`
}
import { IconHeart, IconHeartFilled, IconPencil, IconDownload, IconTrash } from "@tabler/icons-react"
import { cn } from "@/lib/utils"

export type ImageAction = {
  icon: React.ReactNode
  title: string
  className: string
  onClick: (e: React.MouseEvent) => void
}

export function buildImageActions(params: {
  imageId: string
  imageUrl: string
  prompt: string
  isFav: boolean
  onToggleFavourite: (id: string) => void
  onEdit?: (data: { prompt: string; imageUrl: string }) => void
  onDownload: (url: string, id: string, prompt: string) => void
  onDelete: (id: string) => void
  /** Translator from useT(); falls back to English labels when omitted. */
  t?: (key: string) => string
}): ImageAction[] {
  const { imageId, imageUrl, prompt, isFav, onToggleFavourite, onEdit, onDownload, onDelete, t } = params
  const tr = (key: string, fallback: string) => (t ? t(key) : fallback)
  return [
    {
      icon: isFav ? <IconHeartFilled className="size-4" /> : <IconHeart className="size-4" />,
      title: isFav ? tr("common.unfavourite", "Unfavourite") : tr("common.favourite", "Favourite"),
      className: cn("hover:bg-primary hover:text-white", isFav ? "text-red-400" : "text-white"),
      onClick: (e) => { e.stopPropagation(); onToggleFavourite(imageId) },
    },
    {
      icon: <IconPencil className="size-4" />,
      title: tr("common.edit", "Edit"),
      className: "text-white hover:bg-primary hover:text-white",
      onClick: (e) => { e.stopPropagation(); onEdit?.({ prompt, imageUrl }) },
    },
    {
      icon: <IconDownload className="size-4" />,
      title: tr("common.download", "Download"),
      className: "text-white hover:bg-primary hover:text-white",
      onClick: (e) => { e.stopPropagation(); onDownload(imageUrl, imageId, prompt) },
    },
    {
      icon: <IconTrash className="size-4" />,
      title: tr("common.delete", "Delete"),
      className: "text-white hover:bg-destructive hover:text-white",
      onClick: (e) => { e.stopPropagation(); onDelete(imageId) },
    },
  ]
}
