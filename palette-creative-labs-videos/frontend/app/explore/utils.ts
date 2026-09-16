import type { Favourite } from "./types"

export const favId = (f: Favourite): string => f.content_id ?? f.id ?? ""

export function mulberry32(seed: number) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function getCompareLayout(count: number): { cols: number; rows: number } {
  if (count <= 1) return { cols: 1, rows: 1 }
  if (count === 2) return { cols: 2, rows: 1 }
  const cols = Math.min(5, Math.ceil(count / 2))
  return { cols, rows: 2 }
}

export function timeAgo(dateStr?: string): string {
  if (!dateStr) return ""
  const trimmed = dateStr.replace(/(\.\d{3})\d+/, "$1")
  const normalized = /[Zz]$|[+-]\d{2}:\d{2}$/.test(trimmed) ? trimmed : `${trimmed}Z`
  const diff = Date.now() - new Date(normalized).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}
