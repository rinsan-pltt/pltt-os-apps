"use client"

import {
  BedDouble,
  Briefcase,
  Car,
  HeartPulse,
  Laptop,
  Megaphone,
  Paperclip,
  Plane,
  Receipt,
  Tag,
  Utensils,
  Zap,
  type LucideIcon,
} from "lucide-react"

import { useCategoryLabel } from "@/components/categories-provider"
import { colorForSlug, iconForSlug } from "@/lib/categories"
import { cn } from "@/lib/utils"

const ICONS: Record<string, LucideIcon> = {
  Utensils,
  Plane,
  Car,
  BedDouble,
  Paperclip,
  Laptop,
  Zap,
  Megaphone,
  Briefcase,
  HeartPulse,
  Receipt,
  Tag,
}

export function CategoryBadge({ slug, className }: { slug: string; className?: string }) {
  const Icon = ICONS[iconForSlug(slug)] ?? Tag
  const label = useCategoryLabel()
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
        colorForSlug(slug),
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{label(slug)}</span>
    </span>
  )
}

/** Just the colour swatch — for dense contexts like the breakdown bars, where
 *  the label is already adjacent. */
export function CategoryDot({ slug, className }: { slug: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("size-2.5 shrink-0 rounded-full", colorForSlug(slug), className)}
    />
  )
}
