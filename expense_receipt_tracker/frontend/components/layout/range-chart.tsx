"use client"

import * as React from "react"

import { BarChart, type Bar } from "@/components/layout/bar-chart"
import { useCategories, useCategoryLabel } from "@/components/categories-provider"
import { useFormatters } from "@/lib/format"
import { useT } from "@/lib/i18n"
import type { ExpenseSummary } from "@/lib/api"

/**
 * What the calendar's selection contains, as a chart.
 *
 * The x-axis follows the shape of the selection, because the interesting
 * variable changes with it:
 *
 *  - One day  -> CATEGORY on the x-axis. Every expense shares a date, so a date
 *                axis would be a single column; what varies is where it went.
 *  - A range  -> DATE on the x-axis. Categories are still in the donut beside
 *                this, and across a range what varies is which days it went on.
 *
 * Amounts come from `/expenses/summary` for the same window, converted into the
 * base currency at each expense's own date. That is why this reads the summary
 * rather than the expense rows: a client cannot total INR + USD, and these bars
 * sit directly under stat cards showing the same window — a second, client-side
 * conversion could disagree with them.
 */

/**
 * How many bars the plot aims for, and never exceeds.
 *
 * It is one number doing two jobs. As a TARGET it stops a thin selection from
 * drawing two or three slabs across the full plot width — bars divide the plot,
 * so the count is what gives them bar-like proportions. As a CEILING it stops a
 * wide selection from shaving them into unreadable slivers. Twelve matches the
 * monthly trend this card alternates with, so the two never look like different
 * charts.
 */
const TARGET_BARS = 12

// --- plain YYYY-MM-DD arithmetic. `setDate` rather than adding 86_400_000ms,
//     which lands on the wrong day across a DST boundary.
function toDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(y, m - 1, d)
}

function toIso(d: Date) {
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${d.getFullYear()}-${m}-${day}`
}

function shiftIso(iso: string, days: number) {
  const d = toDate(iso)
  d.setDate(d.getDate() + days)
  return toIso(d)
}

/** Inclusive day count. Rounded, so a DST hour cannot make it off by one. */
function spanDays(from: string, to: string) {
  return Math.round((toDate(to).getTime() - toDate(from).getTime()) / 86_400_000) + 1
}

function eachDay(from: string, to: string) {
  const out: string[] = []
  for (let iso = from; iso <= to; iso = shiftIso(iso, 1)) out.push(iso)
  return out
}

/**
 * Grow outward from the days that carry data until there are `target` dates.
 *
 * Used when a wide range holds only a handful of active days: showing just
 * those would draw three slabs, and showing every day in the range would draw
 * eighty slivers. Expanding by one day either side of each active day, in
 * rounds, keeps every active day on the chart and surrounds it with the dates
 * nearest to it.
 */
function padAroundData(dataDays: string[], from: string, to: string, target: number) {
  const chosen = new Set(dataDays)
  const total = spanDays(from, to)
  for (let radius = 1; chosen.size < target && radius < total; radius++) {
    for (const seed of dataDays) {
      for (const candidate of [shiftIso(seed, -radius), shiftIso(seed, radius)]) {
        if (candidate < from || candidate > to || chosen.has(candidate)) continue
        chosen.add(candidate)
        if (chosen.size >= target) break
      }
      if (chosen.size >= target) break
    }
  }
  return [...chosen].sort()
}

export function RangeChart({
  summary,
  singleDay,
  from,
  to,
}: {
  summary: ExpenseSummary
  /** True when the selection is one day, which picks the category axis. */
  singleDay: boolean
  /** Inclusive ISO bounds of the selection. */
  from: string
  to: string
}) {
  const t = useT()
  const { locale } = useFormatters()
  const { categories } = useCategories()
  const categoryLabel = useCategoryLabel()

  const dayLabel = React.useCallback(
    (iso: string) => {
      // No year: the range banner above already states the full dates, and a
      // year on every bar is what makes these labels too wide to read.
      return toDate(iso).toLocaleDateString(locale, { month: "short", day: "numeric" })
    },
    [locale],
  )

  const bars = React.useMemo<Bar[]>(() => {
    if (singleDay) {
      // Every category, not just the ones with spend that day. A day usually
      // touches one or two, and plotting only those gave a chart of one bar —
      // the zeros are what make "nothing went here" visible and what give the
      // plot its shape.
      const spent = new Map(summary.by_category.map((c) => [c.category, c.amount]))
      const rows = categories.map((c) => ({
        key: c.slug,
        label: categoryLabel(c.slug),
        value: spent.get(c.slug) ?? 0,
      }))
      // A category that has spend but is no longer in the registry (deleted
      // after the expense was filed) would otherwise vanish from its own total.
      for (const [slug, amount] of spent) {
        if (!rows.some((r) => r.key === slug)) {
          rows.push({ key: slug, label: categoryLabel(slug), value: amount })
        }
      }
      // Spend first, then the empties in registry order behind them.
      rows.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
      return rows.slice(0, TARGET_BARS)
    }

    const amounts = new Map((summary.by_day ?? []).map((d) => [d.day, d.amount]))
    const dataDays = [...amounts.keys()].sort()
    const total = spanDays(from, to)

    let days: string[]
    if (total <= TARGET_BARS) {
      // Short enough to show honestly: every date in the selection, empty ones
      // included, so the axis stays a real timeline.
      days = eachDay(from, to)
    } else if (dataDays.length >= TARGET_BARS) {
      // Too many active days to fit. Keep the biggest — they are the ones worth
      // reading — then put them back in date order so the axis still runs
      // left-to-right in time.
      days = [...dataDays]
        .sort((a, b) => (amounts.get(b) ?? 0) - (amounts.get(a) ?? 0))
        .slice(0, TARGET_BARS)
        .sort()
    } else {
      days = padAroundData(dataDays, from, to, TARGET_BARS)
    }

    return days.map((iso) => ({ key: iso, label: dayLabel(iso), value: amounts.get(iso) ?? 0 }))
  }, [singleDay, summary, categories, categoryLabel, dayLabel, from, to])

  if (bars.length === 0) {
    return <p className="text-body text-muted-foreground">{t("dashboard.rangeEmpty")}</p>
  }

  const peak = bars.reduce((a, b) => (b.value > a.value ? b : a), bars[0])

  return (
    <BarChart
      bars={bars}
      currency={summary.base_currency}
      fill
      ariaLabel={
        singleDay
          ? t("dashboard.rangeAriaCategories", { top: peak.label })
          : t("dashboard.rangeAriaDays", { top: peak.label })
      }
      caption={singleDay ? t("dashboard.rangeByCategory") : t("dashboard.rangeByDay")}
      keyHeader={singleDay ? t("form.category") : t("form.date")}
      valueHeader={t("form.amount")}
    />
  )
}
