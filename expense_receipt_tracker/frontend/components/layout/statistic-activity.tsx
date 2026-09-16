"use client"

import * as React from "react"
import { PieChart } from "lucide-react"

import { useCategoryLabel } from "@/components/categories-provider"
import { SectionCard } from "@/components/ui/section-card"
import { useFormatters } from "@/lib/format"
import { useExpenseCount, useT } from "@/lib/i18n"
import type { ExpenseSummary } from "@/lib/api"
import { colorForSlug } from "@/lib/categories"
import { cn } from "@/lib/utils"

/**
 * Where the money went, as a share of the whole.
 *
 * Reads `summary.by_category`, which the backend has already converted into the
 * org's base currency at each expense's own date — so unlike the reports chart
 * this one can show every category together without inventing an exchange rate.
 *
 * Segment colours come from `colorForSlug`, the same measured palette the
 * category chips use, so a slice and its badge always agree. Meaning is never
 * carried by colour alone: every slice is also named with its amount in the
 * legend, and the whole thing has a text equivalent for assistive tech.
 */

const RADIUS = 42
const STROKE = 15
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
const MAX_SLICES = 5

/* Everything below is in viewBox units, which is the whole point: the centre
   label lives INSIDE the <svg>, so it is scaled by the same transform as the
   ring and keeps its proportions at every rendered size. As an HTML overlay it
   was a fixed 28px, which overflowed the hole once the donut shrank on a short
   window and looked lost inside a large one. */
const HOLE_R = RADIUS - STROKE / 2
const SHARE_FONT = 19
const LABEL_FONT = 8.5
const SHARE_Y = 55
const LABEL_Y = 71
/** Average glyph advance for --font-sans, measured off the rendered <text>. */
const GLYPH_ADVANCE = 0.56
/** Keep ink clear of the ring rather than just touching it. */
const INSET = 3

/**
 * Width available inside the hole on the row a line of text sits on.
 *
 * The hole is a circle, so the usable width shrinks the further a line is from
 * the centre — the label sits 11 units low, where the chord is ~57 units, not
 * the 69 of the full diameter. Sizing against the diameter is what let a
 * truncated label poke out through the ring.
 */
function chordWidth(centerY: number, fontSize: number) {
  const dy = Math.abs(centerY - 60) + fontSize * 0.62
  const half = Math.sqrt(Math.max(0, HOLE_R ** 2 - dy ** 2))
  return Math.max(0, 2 * half - INSET)
}

const LABEL_BUDGET = Math.max(
  4,
  Math.floor(chordWidth(LABEL_Y, LABEL_FONT) / (LABEL_FONT * GLYPH_ADVANCE)),
)

function fitLabel(text: string) {
  return text.length > LABEL_BUDGET ? text.slice(0, LABEL_BUDGET - 1).trimEnd() + "\u2026" : text
}

export function StatisticActivity({
  summary,
  className,
}: {
  summary: ExpenseSummary
  /** The dashboard passes flex classes so this card can absorb the slack that
   *  would otherwise leave its column ending short of its neighbour. */
  className?: string
}) {
  const t = useT()
  const { money } = useFormatters()
  const categoryLabel = useCategoryLabel()
  const expenseCount = useExpenseCount()

  const { slices, total } = React.useMemo(() => {
    const rows = [...summary.by_category].sort((a, b) => b.amount - a.amount)
    const head = rows.slice(0, MAX_SLICES)
    const rest = rows.slice(MAX_SLICES)
    const restTotal = rest.reduce((sum, r) => sum + r.amount, 0)
    const all = restTotal > 0 ? [...head, { category: "__other", amount: restTotal, count: rest.length }] : head
    return { slices: all, total: rows.reduce((sum, r) => sum + r.amount, 0) }
  }, [summary])

  if (slices.length === 0 || total <= 0) return null

  const label = (slug: string) =>
    slug === "__other" ? t("dashboard.otherCategories") : categoryLabel(slug)

  const top = slices[0]
  const topShare = Math.round((top.amount / total) * 100)

  let offset = 0
  const arcs = slices.map((s) => {
    const fraction = s.amount / total
    const arc = {
      slug: s.category,
      length: fraction * CIRCUMFERENCE,
      offset,
      share: Math.round(fraction * 100),
      amount: s.amount,
      count: s.count,
    }
    offset += arc.length
    return arc
  })

  /**
   * A card with one or two slices has almost nothing to list, and the balanced
   * donut-beside-legend arrangement left most of the box empty. Below this
   * threshold the card switches to a diagonal composition: a noticeably larger
   * ring in the top-left, and the legend in the bottom-right starting level
   * with the ring's own midpoint, so the two together reach into all four
   * corners instead of sitting in a band across the middle.
   */
  const sparse = arcs.length <= 2

  return (
    <SectionCard
      icon={PieChart}
      title={t("dashboard.statisticActivity")}
      headingId="activity-heading"
      bodyClassName="mt-4 flex min-h-0 flex-1 flex-col justify-center @container"
      className={className}
    >
      {/* Side by side only where there is room, measured against THIS CARD
          rather than the viewport — the column it sits in is ~340px at xl but
          ~700px on a wide monitor, and viewport breakpoints got that backwards.
          Below the threshold a row left the legend ~180px and clipped every
          amount to "SGD 3,…", so it stacks instead of shrinking the type. */}
      <div
        className={cn(
          // Stacked and centred is the narrow-card fallback for both modes:
          // the diagonal needs two columns to be a diagonal at all.
          "flex flex-col items-center gap-block",
          sparse
            ? // Two equal rows, the ring spanning both. That is what puts the
              // legend's top edge exactly halfway down the ring — with 1fr
              // rows the ring's own height sets the total, so row 1 is always
              // half of it, whatever size the ring resolves to.
              "@md:grid @md:h-full @md:grid-cols-[auto_minmax(0,1fr)] @md:grid-rows-2 @md:items-start @md:gap-x-5 @md:gap-y-0"
            : "@md:flex-row @md:items-center @md:gap-6",
        )}
      >
        <div
          className={cn(
            "relative shrink-0",
            sparse && "@md:col-start-1 @md:row-start-1 @md:row-span-2 @md:h-full",
          )}
        >
          <svg
            viewBox="0 0 120 120"
            role="img"
            aria-label={t("dashboard.activityAria", {
              category: label(top.category),
              share: topShare,
            })}
            className={cn(
              sparse
                ? // Half again as large, bounded by a share of the CARD rather
                  // than a fixed rem: this column is ~350px at xl and ~700px on
                  // a wide monitor, so one fixed size is either timid on the
                  // wide one or crowds the legend off the narrow one.
                  //
                  // Two shares, because the two modes need different room. In
                  // the stacked mode the legend sits underneath at full width,
                  // so the ring can take 60% and fill the box. In the diagonal
                  // it sits beside the ring, and a legend row needs ~165px
                  // before the amounts start truncating — 50% leaves that at
                  // every width the diagonal applies to.
                  // Stacked: width is the only constraint, the legend is below.
                  // Diagonal: whichever of width-share or the card's own height
                  // runs out first. `aspect-square` keeps it circular while
                  // `max-h-full` clamps it, so on a wide-and-short card the ring
                  // grows until it touches top and bottom instead of leaving the
                  // lower half of the box empty. The ceiling is 2x rather than
                  // 1.5x so height is what limits it on a big display, not an
                  // arbitrary rem cap.
                  "size-[min(calc(var(--erx-donut-size)*1.5),60cqw)] @md:h-auto @md:max-h-full @md:w-[min(calc(var(--erx-donut-size)*2),50cqw)] @md:aspect-square"
                : "size-[var(--erx-donut-size)]",
            )}
          >
            {/* Only the arcs are rotated, so the label below stays upright.
                The rotation used to sit on the <svg> itself, which is why the
                label had to be a separate HTML layer. */}
            <g transform="rotate(-90 60 60)">
              <circle
                cx="60"
                cy="60"
                r={RADIUS}
                fill="none"
                strokeWidth={STROKE}
                className="stroke-muted"
              />
              {arcs.map((a) => (
                <circle
                  key={a.slug}
                  cx="60"
                  cy="60"
                  r={RADIUS}
                  fill="none"
                  strokeWidth={STROKE}
                  strokeLinecap="butt"
                  strokeDasharray={`${a.length} ${CIRCUMFERENCE - a.length}`}
                  strokeDashoffset={-a.offset}
                  // colorForSlug sets a text-* colour; stroke-current picks it
                  // up, so slices match their chips without a second palette.
                  className={cn(colorForSlug(a.slug), "bg-transparent stroke-current")}
                />
              ))}
            </g>
            <text
              x="60"
              y={SHARE_Y}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={SHARE_FONT}
              fontWeight="600"
              className="numeral fill-foreground"
            >
              {topShare}%
            </text>
            <text
              x="60"
              y={LABEL_Y}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={LABEL_FONT}
              className="fill-muted-foreground"
            >
              {fitLabel(label(top.category))}
            </text>
          </svg>
        </div>

        <ul
          className={cn(
            "w-full min-w-0 space-y-3",
            // Row 2 of 2 starts halfway down the card, and `self-end` pins the
            // legend to that row's bottom edge — so the data occupies the
            // bottom-right corner and the box has no dead band under it. When
            // the ring is tall enough to fill the height, that row boundary IS
            // the ring's midpoint.
            sparse && "@md:col-start-2 @md:row-start-2 @md:self-end",
          )}
        >
          {arcs.map((a) => (
            <li key={a.slug} className="flex items-center gap-inline">
              {/* colorForSlug hands back a PAIR of classes — a pale bg-*-100 and
                  a dark text-*-800 — and the arc above strokes with the dark
                  one. So the marker paints `currentColor` inline rather than
                  wearing the pale background: a class-based `bg-current` would
                  be same-specificity with the bg-*-100 and lose or win by
                  stylesheet order, and the swatch has to agree with its slice. */}
              <span
                aria-hidden
                style={{ backgroundColor: "currentColor" }}
                className={cn("size-2.5 shrink-0 rounded-sm", colorForSlug(a.slug))}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-medium numeral">
                  {money(a.amount, summary.base_currency)}
                </span>
                <span className="block truncate text-caption text-muted-foreground">
                  {label(a.slug)} · {expenseCount(a.count)}
                </span>
              </span>
              <span className="shrink-0 text-caption text-muted-foreground numeral">{a.share}%</span>
            </li>
          ))}
        </ul>
      </div>
    </SectionCard>
  )
}
