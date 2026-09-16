"use client"

import * as React from "react"
import { AlertCircle, CheckCircle2, Loader2, Lock, Plus, Trash2 } from "lucide-react"

import { AppShell } from "@/components/layout/app-shell"
import { PageHeader } from "@/components/layout/page-header"
import { useCategories } from "@/components/categories-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/components/ui/toast"
import { applyCategories, CategoryNameError, type CategoryInput } from "@/lib/api"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

interface EditableRow {
  key: string
  slug?: string
  label: string
  keywords: string
  isOther: boolean
}

let _uid = 0
const newKey = () => `new-${_uid++}`

/**
 * The category rows: two per line when the card is wide enough, one when it
 * isn't.
 *
 * `@2xl` (42rem) is the smallest card that fits two without cramping them. A
 * row holds a name field above a keywords field, with a 40px delete button and
 * the row's own padding beside them, so the threshold leaves each of the pair
 * ~330px and each field ~258px — still wide enough to read a keyword list in.
 * Below it the fields get too narrow to edit and one full-width row per line is
 * the better answer.
 *
 * Note the query measures the container's CONTENT box, so CardContent's own
 * padding is already subtracted: measured on this page the second column
 * appears at a 1044px window (675px of content) with the 248px sidebar in
 * place, and one step down (`@xl`) would have started it at ~955px with 208px
 * fields, which is too tight to edit in.
 *
 * Grid rather than columns, so the two rows on a line share a height and their
 * borders line up; the taller of the pair (the one with keyword chips) sets it.
 */
const ROW_GRID = "grid grid-cols-1 gap-3 @2xl:grid-cols-2"

const normalizeKeywords = (value: string) =>
  value
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean)

export default function CategoriesPage() {
  const t = useT()
  const { toast } = useToast()
  const { categories, loading, error: loadError, refresh } = useCategories()
  const [rows, setRows] = React.useState<EditableRow[]>([])
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [result, setResult] = React.useState<number | null>(null)
  // Names the backend refused, keyed by the row they came from, so the reason
  // sits under the field that has to change. An error naming a category is no
  // help on a page of a dozen two-column rows.
  const [rejected, setRejected] = React.useState<Record<string, string>>({})

  // Seed the editor from the current categories. The provider doesn't refetch
  // in the background, so this only re-runs on load and after a successful
  // apply (which calls refresh) — it won't clobber in-progress edits.
  React.useEffect(() => {
    setRows(
      categories.map((c) => ({
        key: c.slug,
        slug: c.slug,
        label: c.label,
        keywords: c.keywords.join(", "),
        isOther: c.slug === "other",
      })),
    )
  }, [categories])

  // Whether the editor differs from the saved categories. Used to disable
  // "Apply changes" when there's nothing to apply, so the button shows its
  // disabled theme until the user actually edits, adds, or removes something.
  const currentSignature = React.useMemo(
    () =>
      JSON.stringify(
        rows.map((r) => ({
          slug: r.slug ?? null,
          label: r.label.trim(),
          keywords: normalizeKeywords(r.keywords),
        })),
      ),
    [rows],
  )
  const savedSignature = React.useMemo(
    () => JSON.stringify(categories.map((c) => ({ slug: c.slug, label: c.label, keywords: c.keywords }))),
    [categories],
  )
  const hasChanges = currentSignature !== savedSignature

  // Rows the user has not finished filling in.
  //
  // A name is required on every row: `apply` already refuses a blank one, so
  // leaving the button live just to answer the click with an error is worse
  // than not offering the click.
  //
  // Keywords are required only on rows being CREATED. Existing categories
  // legitimately carry none — "Other" is the fallback bucket and has no
  // keywords at all — so demanding them everywhere would disable Apply
  // permanently for everyone. On a new row they are the thing that makes the
  // category do any work when AI classification is unavailable.
  const isNewRow = (r: EditableRow) => !r.slug
  const incomplete = React.useMemo(
    () =>
      rows.filter(
        (r) => !r.label.trim() || (isNewRow(r) && normalizeKeywords(r.keywords).length === 0),
      ),
    [rows],
  )

  // A disabled button with no stated reason is a dead end, so name the thing
  // that is missing. Most specific first: an empty name is the harder stop.
  const blockedReason = rows.some((r) => !r.label.trim())
    ? t("categories.emptyName")
    : incomplete.length > 0
      ? t("categories.needKeywords")
      : null

  const update = (key: string, patch: Partial<EditableRow>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
    // Retract the verdict the moment the name changes: leaving it up would
    // keep the field marked invalid while the user types the fix.
    if ("label" in patch) {
      setRejected((prev) => {
        if (!(key in prev)) return prev
        const next = { ...prev }
        delete next[key]
        return next
      })
    }
  }

  const addRow = () =>
    setRows((prev) => [...prev, { key: newKey(), label: "", keywords: "", isOther: false }])

  const removeRow = (key: string) => {
    setRows((prev) => prev.filter((r) => r.key !== key))
    setRejected((prev) => {
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  const apply = async () => {
    const cleaned = rows.map((r) => ({ ...r, label: r.label.trim() }))
    if (cleaned.some((r) => !r.label)) {
      setError(t("categories.emptyName"))
      return
    }
    const seen = new Set<string>()
    for (const r of cleaned) {
      const k = r.label.toLowerCase()
      if (seen.has(k)) {
        setError(t("categories.duplicate", { name: r.label }))
        return
      }
      seen.add(k)
    }

    // Rows with no slug are the ones being created, so this is what the user
    // just *did* — as opposed to `res.recategorized`, which is what it caused.
    const addedCount = cleaned.filter(isNewRow).length

    const payload: CategoryInput[] = cleaned.map((r) => ({
      slug: r.slug,
      label: r.label,
      keywords: r.keywords
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean),
    }))

    setSaving(true)
    setError(null)
    setResult(null)
    setRejected({})
    try {
      const res = await applyCategories(payload)
      setResult(res.recategorized)
      // The toast names the action; the inline line below reports the knock-on
      // re-categorisation. Two different facts, so neither repeats the other.
      toast(
        addedCount === 0
          ? t("categories.toastUpdated")
          : addedCount === 1
            ? t("categories.toastAdded")
            : t("categories.toastAddedMany", { count: addedCount }),
      )
      await refresh()
    } catch (e) {
      if (e instanceof CategoryNameError) {
        // Match verdicts back to rows by the trimmed name that was sent. Two
        // rows cannot share a name — `apply` rejects duplicates above — so the
        // first unclaimed match is the right one.
        const byRow: Record<string, string> = {}
        for (const item of e.invalid) {
          const row = cleaned.find((r) => r.label === item.label && !(r.key in byRow))
          if (row) byRow[row.key] = item.reason
        }
        setRejected(byRow)
        setError(e.message)
        // They asked for a notification on the click, and the banner sits at
        // the bottom of a scrollable card — the toast is what they see.
        toast(
          e.invalid.length === 1
            ? t("categories.toastRejectedOne")
            : t("categories.toastRejected", { count: e.invalid.length }),
          // The save did not happen, so this is not a confirmation.
          { tone: "error" },
        )
      } else {
        setError(e instanceof Error ? e.message : t("categories.couldNotSave"))
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <AppShell>
      <div className="w-full min-w-72 space-y-section px-gutter py-page-y">
        <PageHeader title={t("categories.title")} description={t("categories.subtitle")} />

        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle>{t("categories.heading")}</CardTitle>
              <CardDescription>{t("categories.hint")}</CardDescription>
            </div>
            {hasChanges && (
              <span className="shrink-0 rounded-full bg-warning-subtle px-2.5 py-1 text-xs font-medium text-warning">
                {t("categories.unsaved")}
              </span>
            )}
          </CardHeader>
          <CardContent className="@container space-y-3">
            {/* The provider's load error was previously fetched and never shown. */}
            {loadError && (
              <p role="alert" className="flex items-center gap-2 text-sm text-destructive-text">
                <AlertCircle className="size-4 shrink-0" aria-hidden /> {loadError}
              </p>
            )}

            {loading && rows.length === 0 ? (
              // Same grid as the real list, so the skeleton doesn't promise a
              // one-column page and then reflow into two.
              <div className={ROW_GRID}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-24 w-full rounded-lg" />
                ))}
              </div>
            ) : (
              <>
                <ul className={ROW_GRID}>
                  {rows.map((row) => {
                    const parsed = normalizeKeywords(row.keywords)
                    const refusedReason = rejected[row.key]
                    const reasonId = `cat-reason-${row.key}`
                    return (
                      <li
                        key={row.key}
                        // A row nested inside the card: one radius step down,
                        // so the inner corner doesn't fight the larger outer one.
                        className={cn(
                          "rounded-lg border p-3",
                          refusedReason
                            ? "border-destructive/50 bg-destructive-subtle"
                            : "border-border bg-surface-sunken/40",
                        )}
                      >
                        <div className="flex items-start gap-2">
                          <div className="flex-1 space-y-2">
                            <Input
                              value={row.label}
                              onChange={(e) => update(row.key, { label: e.target.value })}
                              placeholder={t("categories.namePlaceholder")}
                              disabled={saving}
                              aria-label={t("categories.nameAria")}
                              aria-invalid={refusedReason ? true : undefined}
                              aria-describedby={refusedReason ? reasonId : undefined}
                            />
                            {/* The reason, under the field it is about. Colour
                                is not carrying this on its own: the text is the
                                message, and aria-invalid says the same thing to
                                assistive tech. */}
                            {refusedReason && (
                              <p
                                id={reasonId}
                                className="flex items-start gap-1.5 text-caption font-medium text-destructive-text"
                              >
                                <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden />
                                <span className="min-w-0">{refusedReason}</span>
                              </p>
                            )}
                            <Input
                              value={row.keywords}
                              onChange={(e) => update(row.key, { keywords: e.target.value })}
                              // Not "(optional)" on a row being created — the
                              // placeholder would be telling the user the
                              // opposite of what the Apply button is enforcing.
                              placeholder={
                                isNewRow(row)
                                  ? t("categories.keywordsPlaceholderRequired")
                                  : t("categories.keywordsPlaceholder")
                              }
                              disabled={saving}
                              aria-label={t("categories.keywordsAria")}
                              className="h-9 text-xs"
                            />
                          </div>
                          {row.isOther ? (
                            // "Other" is the fallback bucket the backend needs,
                            // so it can't be deleted. Say that, rather than
                            // showing a dead bin icon and hoping for the best.
                            <span
                              className="flex size-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground"
                              title={t("categories.otherProtected")}
                            >
                              <Lock className="size-4" aria-hidden />
                              <span className="sr-only">{t("categories.otherProtected")}</span>
                            </span>
                          ) : (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => removeRow(row.key)}
                              disabled={saving}
                              aria-label={t("categories.removeNamed", {
                                name: row.label || t("categories.untitled"),
                              })}
                              className="hover:text-destructive-text"
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          )}
                        </div>
                        {parsed.length > 0 && (
                          <ul className="mt-2 flex flex-wrap gap-1">
                            {parsed.map((keyword, i) => (
                              <li
                                key={`${keyword}-${i}`}
                                className="rounded-full bg-muted px-2 py-0.5 text-[0.6875rem] text-muted-foreground"
                              >
                                {keyword}
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    )
                  })}
                </ul>

                <Button
                  type="button"
                  variant="outline"
                  onClick={addRow}
                  disabled={saving}
                  className="w-full"
                >
                  <Plus className="size-4" aria-hidden /> {t("categories.add")}
                </Button>
              </>
            )}

            {error && (
              <p role="alert" className="flex items-center gap-2 text-sm font-medium text-destructive-text">
                <AlertCircle className="size-4 shrink-0" aria-hidden /> {error}
              </p>
            )}
            {result !== null && (
              <p role="status" className="flex items-center gap-2 text-sm text-success">
                <CheckCircle2 className="size-4 shrink-0" aria-hidden />{" "}
                {t("categories.applied", { count: result })}
              </p>
            )}

            {/* Pinned to the bottom of the scrollport. The category list runs to
                a dozen rows and grows every time "Add category" is pressed, so
                the primary action was scrolling off the end of a list the user
                was still editing — and the row you just added is the one that
                puts it out of reach.
      
                Sticky needs two things here. The negative margins cancel
                CardContent's padding so the bar spans the card edge to edge and
                its own rounded bottom lines up with the card's, rather than a
                narrower box floating inside it. And no ancestor may clip: Card
                carries `rounded-xl` WITHOUT `overflow-hidden`, which is what
                makes this work — the same constraint the status page documents
                for its own footer. */}
            <div className="sticky bottom-0 z-10 -mx-surface -mb-surface flex flex-wrap items-center justify-end gap-x-3 gap-y-2 rounded-b-xl border-t border-border bg-card px-surface py-3">
              {hasChanges && blockedReason && (
                <p id="apply-blocked" className="min-w-0 flex-1 text-caption text-muted-foreground">
                  {blockedReason}
                </p>
              )}
              <Button
                type="button"
                size="lg"
                onClick={apply}
                disabled={saving || !hasChanges || incomplete.length > 0}
                aria-describedby={hasChanges && blockedReason ? "apply-blocked" : undefined}
              >
                {saving ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden /> {t("categories.applying")}
                  </>
                ) : (
                  t("categories.apply")
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  )
}
