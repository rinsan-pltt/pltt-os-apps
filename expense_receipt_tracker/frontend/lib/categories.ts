/** Expense category + status registries.
 *  Slugs must stay in sync with backend/api/core/categories.py (CATEGORIES)
 *  and backend/api/core/models.py (STATUSES). Icon + color are frontend-only. */

export interface Category {
  slug: string
  label: string
  /** lucide icon name — resolved in category-badge.tsx */
  icon: string
  color: string
}

export const CATEGORIES: Category[] = [
  { slug: "meals", label: "Meals & Entertainment", icon: "Utensils", color: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-400" },
  { slug: "travel", label: "Travel", icon: "Plane", color: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-400" },
  { slug: "transportation", label: "Transportation", icon: "Car", color: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-400" },
  { slug: "lodging", label: "Lodging", icon: "BedDouble", color: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-400" },
  { slug: "office", label: "Office Supplies", icon: "Paperclip", color: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-400" },
  { slug: "software", label: "Software & Subscriptions", icon: "Laptop", color: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-400" },
  { slug: "utilities", label: "Utilities", icon: "Zap", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-400" },
  { slug: "marketing", label: "Marketing & Advertising", icon: "Megaphone", color: "bg-pink-100 text-pink-800 dark:bg-pink-950 dark:text-pink-400" },
  { slug: "professional", label: "Professional Services", icon: "Briefcase", color: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300" },
  { slug: "health", label: "Health & Wellness", icon: "HeartPulse", color: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-400" },
  { slug: "other", label: "Other", icon: "Receipt", color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-400" },
]

export const CATEGORY_BY_SLUG: Record<string, Category> = Object.fromEntries(
  CATEGORIES.map((c) => [c.slug, c]),
)

export function categoryLabel(slug: string): string {
  return CATEGORY_BY_SLUG[slug]?.label ?? slug
}

// Categories are user-editable, so a slug may be one a user just created and
// that isn't in the static registry above. Custom categories get the generic
// "Tag" icon and a stable color picked from this palette by hashing the slug —
// no per-category color picker needed, and the same slug always looks the same.
const CUSTOM_COLORS = [
  "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-400",
  "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-950 dark:text-fuchsia-400",
  "bg-lime-100 text-lime-800 dark:bg-lime-950 dark:text-lime-400",
  "bg-cyan-100 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-400",
  "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-400",
  "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-400",
]

function hashSlug(slug: string): number {
  let h = 0
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0
  return h
}

export function iconForSlug(slug: string): string {
  return CATEGORY_BY_SLUG[slug]?.icon ?? "Tag"
}

export function colorForSlug(slug: string): string {
  return CATEGORY_BY_SLUG[slug]?.color ?? CUSTOM_COLORS[hashSlug(slug) % CUSTOM_COLORS.length]
}

export interface Status {
  slug: "pending" | "submitted" | "reimbursed"
  label: string
  /** Dot colour. Statuses read as a neutral chip + coloured dot rather than a
   *  filled tint — with 11 category tints already on screen, filled status
   *  chips made colour meaningless, and "Reimbursed" emerald collided with the
   *  emerald primary button. */
  color: string
}

export const STATUSES: Status[] = [
  { slug: "pending", label: "Pending", color: "bg-warning" },
  { slug: "submitted", label: "Submitted", color: "bg-info" },
  { slug: "reimbursed", label: "Reimbursed", color: "bg-success" },
]

export const STATUS_BY_SLUG: Record<string, Status> = Object.fromEntries(
  STATUSES.map((s) => [s.slug, s]),
)
