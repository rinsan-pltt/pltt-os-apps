"use client"

import Link from "next/link"
import {
  AlignLeft,
  Archive,
  Camera,
  Combine,
  Crop,
  Droplets,
  EyeOff,
  FileArchive,
  FileCode,
  FileText,
  FileType,
  GitCompare,
  Globe,
  Hash,
  Image,
  Images,
  Languages,
  LayoutGrid,
  Lock,
  Pencil,
  PenTool,
  Presentation,
  RotateCw,
  ScanText,
  Scissors,
  Sparkles,
  SpellCheck,
  Table,
  Unlock,
  Wrench,
  type LucideIcon,
} from "lucide-react"

import { ArrowRight } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { FormatBadge } from "@/components/ui/format-badge"
import { useT, useRegistryText } from "@/lib/i18n"
import { categoryTone } from "@/lib/tool-tone"
import { acceptedFormats, OUTPUT_FORMAT, toolHref, type Tool } from "@/lib/tools"
import { cn } from "@/lib/utils"

const ICONS: Record<string, LucideIcon> = {
  AlignLeft,
  Archive,
  Camera,
  Combine,
  Crop,
  Droplets,
  EyeOff,
  FileArchive,
  FileCode,
  FileText,
  FileType,
  GitCompare,
  Globe,
  Hash,
  Image,
  Images,
  Languages,
  LayoutGrid,
  Lock,
  Pencil,
  PenTool,
  Presentation,
  RotateCw,
  ScanText,
  Scissors,
  Sparkles,
  SpellCheck,
  Table,
  Unlock,
  Wrench,
}

/** The lucide icon a tool declares, resolved against the map above.
 *  Exported because the section workspace's tool rail shows the same icons as
 *  these cards, and two copies of the map would drift apart. */
export function toolIcon(tool: Tool): LucideIcon {
  return ICONS[tool.icon] ?? FileText
}

export function ToolCard({ tool }: { tool: Tool }) {
  const Icon = toolIcon(tool)
  const t = useT()
  const reg = useRegistryText()
  const to = OUTPUT_FORMAT[tool.slug]
  // The first accepted format stands for the input. Multi-format tools
  // (`jpg-to-pdf` takes JPG/PNG/WEBP) show the one their name is about, which
  // is the first in the registry's `accept`. A `url` tool has no `accept` at
  // all — its input is a web address.
  const from = tool.kind === "url" ? "URL" : (acceptedFormats(tool.accept)[0] ?? "")
  return (
    <Link
      href={toolHref(tool.slug)}
      draggable={false}
      data-tool-card
      className={cn(
        // `h-full` fills the grid cell. Without it the link shrank to its own
        // content and a card with a shorter icon row (a 28px format pair
        // rather than a 40px tinted icon) sat 12px short of the row its
        // neighbours defined — visible as "PDF to PDF/A is a smaller card".
        "group flex h-full flex-col gap-3 rounded-xl border border-border bg-card p-surface",
        "shadow-[var(--dt-shadow-sm)]",
        // Named properties rather than `transition-all`, and driven by the
        // motion tokens — which a reduced-motion query zeroes, so the lift
        // stops for anyone who has asked for that.
        "transition-[transform,border-color,box-shadow] duration-[var(--dt-dur-fast)] ease-[var(--dt-ease-out)]",
        "hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[var(--dt-shadow-md)]",
        // Keyboard focus looks like hover — the same lift and border — rather
        // than an extra ring box around the card.
        "focus-visible:outline-none focus-visible:-translate-y-0.5 focus-visible:border-primary/60 focus-visible:shadow-[var(--dt-shadow-md)]",
      )}
    >
      {/* A fixed-height band, because the two icon styles are different sizes:
          a conversion shows a 28px format pair, everything else a 40px tinted
          square. Left to size itself the row made every convert card 12px
          shorter than its neighbours, and even once the card fills its cell it
          would put the titles on two different baselines across one row. */}
      <div className="flex h-10 items-center justify-between gap-2">
        {/* A conversion is defined by its in/out pair, so say it: `PDF -> W`
            reads before the name does. Tools whose output format matches their
            input — compress, rotate, merge, protect — keep the category-tinted
            icon, because "PDF -> PDF" is noise. */}
        {to && from ? (
          <span className="flex min-w-0 items-center gap-1.5">
            <FormatBadge format={from} />
            <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <FormatBadge format={to} />
            {/* The badges are visual; this is what a screen reader hears. */}
            <span className="sr-only">{t("tool.converts", { from, to })}</span>
          </span>
        ) : (
          <span
            aria-hidden
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-lg",
              categoryTone(tool.category),
            )}
          >
            <Icon className="size-5" />
          </span>
        )}
        {tool.badge && (
          <Badge className="shrink-0 border-primary/30 bg-primary/10 text-primary">
            {reg.badge(tool.badge)}
          </Badge>
        )}
      </div>
      {/* The text BLOCK is reserved (--dt-card-text-h), not each line, so the
          card's height never depends on how its text wraps while a one-line
          title keeps its description directly beneath it.

          Needed because each category renders its own <ul>: a long name that
          wraps at narrow card widths ("Translate Documents" at 222px) made
          only that section's rows 23px taller, so the page showed two card
          heights. `line-clamp-2` caps each line at the two the block allows. */}
      <div className="min-w-0 min-h-[var(--dt-card-text-h)]">
        <div className="line-clamp-2 text-heading group-hover:text-primary">
          {reg.toolTitle(tool)}
        </div>
        <p className="mt-1 line-clamp-2 text-pretty text-caption text-muted-foreground">
          {reg.toolDescription(tool)}
        </p>
      </div>
    </Link>
  )
}
