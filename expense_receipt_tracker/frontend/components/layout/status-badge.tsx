"use client"

import { STATUS_BY_SLUG } from "@/lib/categories"
import { useRegistryText } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/** Status as a neutral chip with a coloured dot. The dot carries the meaning;
 *  the chip stays quiet so it never competes with the category tints or reads
 *  as a button. */
export function StatusBadge({ slug, className }: { slug: string; className?: string }) {
  const status = STATUS_BY_SLUG[slug]
  const reg = useRegistryText()
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-0.5 text-xs font-medium text-foreground",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn("size-1.5 shrink-0 rounded-full", status?.color ?? "bg-muted-foreground")}
      />
      {reg.status(slug)}
    </span>
  )
}
