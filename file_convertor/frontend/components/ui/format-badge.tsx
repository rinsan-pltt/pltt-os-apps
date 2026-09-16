import { cn } from "@/lib/utils"

/**
 * A file-type icon: the document glyph with a folded corner, in the format's
 * own colour, carrying its abbreviation — `PDF`, `W`, `JPG`.
 *
 * Conversion tools are defined by their in/out pair, and a single generic lucide
 * icon cannot express that. A `PDF → W` pair says what the tool does before you
 * have read its name, which is what you want when scanning thirty-seven cards.
 *
 * Drawn as an inline SVG rather than assembled from a tinted box plus text, so
 * it reads as a *file* at 28px: the folded corner is the thing that makes the
 * shape recognisable, and it cannot be done with a border-radius.
 *
 * The colours are the ones people already carry from their desktop — Word blue,
 * Excel green, PowerPoint orange, PDF red. That makes this a categorical scale
 * like `tool-tone.ts`, and the same reasoning applies: semantic tokens carry
 * *meaning*, while "this is a Word file" needs the hue Word has trained people
 * to expect. Solid fills, so one icon works on both palettes without a
 * dark-mode variant.
 *
 * Decorative: the callers state the transformation in text (`ToolCard`'s
 * `sr-only`), so the glyph is `aria-hidden`.
 */
interface FormatSpec {
  /** What is written on the page. 1–5 characters. */
  label: string
  /** The page fill. */
  fill: string
}

const FORMATS: Record<string, FormatSpec> = {
  PDF: { label: "PDF", fill: "#E5322D" },
  "PDF/A": { label: "PDF/A", fill: "#C2185B" },
  DOCX: { label: "W", fill: "#2B579A" },
  DOC: { label: "W", fill: "#2B579A" },
  ODT: { label: "W", fill: "#2B579A" },
  RTF: { label: "RTF", fill: "#2B579A" },
  XLSX: { label: "X", fill: "#217346" },
  XLS: { label: "X", fill: "#217346" },
  CSV: { label: "CSV", fill: "#217346" },
  PPTX: { label: "P", fill: "#D24726" },
  PPT: { label: "P", fill: "#D24726" },
  JPG: { label: "JPG", fill: "#7C3AED" },
  PNG: { label: "PNG", fill: "#7C3AED" },
  WEBP: { label: "WEBP", fill: "#7C3AED" },
  TXT: { label: "TXT", fill: "#64748B" },
  MD: { label: "MD", fill: "#334155" },
  HTML: { label: "HTML", fill: "#E37400" },
  HWP: { label: "HWP", fill: "#0891B2" },
  // `html-to-pdf` takes a web address, not a file, so it has no `accept` to
  // derive an input format from.
  URL: { label: "URL", fill: "#0284C7" },
}

const FALLBACK: FormatSpec = { label: "FILE", fill: "#64748B" }

/** The label has to fit inside a 24-unit-wide page, so longer abbreviations get
 *  a smaller face rather than a wider box — a box that grew with its text would
 *  break the card grid's rhythm. */
function labelSize(length: number): number {
  if (length <= 1) return 11
  if (length === 2) return 8.5
  if (length === 3) return 7
  if (length === 4) return 5.6
  return 4.6
}

export function formatLabel(format: string): string {
  return (FORMATS[format] ?? FALLBACK).label
}

export function FormatBadge({
  format,
  size = "md",
  className,
}: {
  format: string
  size?: "sm" | "md"
  className?: string
}) {
  const { label, fill } = FORMATS[format] ?? FALLBACK
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      focusable="false"
      className={cn("shrink-0", size === "sm" ? "size-6" : "size-7", className)}
    >
      {/* The page, with its top-right corner cut away. */}
      <path
        d="M5.5 2.25h8.19a1.5 1.5 0 0 1 1.06.44l5.06 5.06a1.5 1.5 0 0 1 .44 1.06v12.44a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 21.25V3.75a1.5 1.5 0 0 1 1.5-1.5Z"
        fill={fill}
      />
      {/* The fold itself: a lighter triangle where the corner turned over. It is
          what makes the shape read as paper rather than a rounded rectangle. */}
      <path d="M13.75 2.4v5.1a1.5 1.5 0 0 0 1.5 1.5h5.06L13.75 2.4Z" fill="#fff" fillOpacity="0.45" />
      <text
        x="12"
        y="17.4"
        textAnchor="middle"
        fill="#fff"
        fontSize={labelSize(label.length)}
        fontWeight="700"
        letterSpacing={label.length > 3 ? "-0.3" : "0"}
        // The card's own font, so the abbreviation matches the UI around it.
        fontFamily="inherit"
      >
        {label}
      </text>
    </svg>
  )
}
