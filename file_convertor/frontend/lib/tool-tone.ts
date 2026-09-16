import type { Category } from "@/lib/tools"

/**
 * The icon tile's tint, by category.
 *
 * The registry used to carry a `color` string per tool — 37 entries × 4 palette
 * classes = 148 hardcoded literals, across 21 different hues chosen
 * arbitrarily. Two problems with that: the registry was carrying styling, and
 * the colour meant nothing, so a wall of 37 cards read as a bag of sweets.
 *
 * Now the tint encodes the category, which is information the user can actually
 * use — and it matches the icon each category carries in the sidebar, so the
 * grid and the nav agree.
 *
 * These are the only raw palette literals left in the app, and that is
 * deliberate: semantic tokens (`--dt-success`, `--dt-destructive`) exist to
 * carry *meaning*, and a categorical scale needs seven mutually distinguishable
 * hues, which is a different job. Keeping them in one map means one place to
 * change and no drift.
 *
 * `-700`/`-300` rather than the old `-600`/`-400`: the icon is decorative (the
 * tool's name sits beside it), but it should still be clearly visible, and the
 * old pairing was thin in dark mode.
 */
const TONES: Record<Category, string> = {
  "Organize PDF": "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  "Optimize PDF": "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  "Convert PDF": "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  "Edit PDF": "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300",
  "PDF Security": "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  "PDF Intelligence": "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
  Images: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
}

const FALLBACK = "bg-muted text-muted-foreground"

export function categoryTone(category: string): string {
  return TONES[category as Category] ?? FALLBACK
}

/** Workflows are not categorised — they chain tools across categories — so they
 *  take the brand tint rather than borrowing a category's meaning. */
export const WORKFLOW_TONE = "bg-primary/10 text-primary"
