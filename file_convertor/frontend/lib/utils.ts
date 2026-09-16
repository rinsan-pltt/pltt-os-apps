import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * The app's type scale, declared in `globals.css` as `--text-display` …
 * `--text-micro` and used as `text-heading`, `text-caption`, and so on.
 *
 * tailwind-merge has to be told about these. It does not read the stylesheet,
 * so it falls back to matching `text-*` against its `text-color` group — and
 * then a single `cn("text-micro", "text-primary")` looks like two colours,
 * keeps the last one and silently DROPS the font size. The element inherits
 * whatever size its parent had, which is how the "New!" pill ended up
 * rendering at 16px instead of 11px while its class list still said
 * `text-micro` in the source.
 *
 * Registering them as `font-size` puts them in their own group: a size and a
 * colour no longer conflict (either order), while two sizes still collapse to
 * the last one, which is the behaviour callers expect.
 */
const FONT_SIZES = ["display", "title", "heading", "body", "ui", "caption", "micro"]

const twMerge = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: FONT_SIZES }] } },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}
