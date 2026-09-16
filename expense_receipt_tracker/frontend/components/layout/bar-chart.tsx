"use client"

import * as React from "react"

import { useFormatters } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * The dashboard's bar plot, in one place.
 *
 * Extracted when the calendar's range view needed the same chart with a
 * different x-axis (categories for one day, dates for a range). It was that or
 * a second copy of the axis maths, the ghost bars, the container-query label
 * thinning and the screen-reader table — four things that would then have to be
 * kept in step by hand.
 *
 * Callers supply bars already aggregated and already in ONE currency. That is
 * deliberate: the amounts come from `/expenses/summary`, which converts at each
 * expense's own date, and nothing here should be tempted to add two currencies.
 */

/** Round a peak up to the next 1/2/2.5/5/10 x power of ten, so the axis reads
 *  $0 / $5K / $10K / $15K rather than $0 / $4.3K / $8.6K / $12.9K. Bars are
 *  scaled against this, so the tallest stops just under the top gridline. */
function niceCeil(value: number) {
  if (!(value > 0)) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const n = value / magnitude
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10
  return step * magnitude
}

export interface Bar {
  /** Stable react key. */
  key: string
  /** Axis label. Kept short by the caller; thinned automatically when tight. */
  label: string
  value: number
}

export function BarChart({
  bars,
  currency,
  ariaLabel,
  caption,
  keyHeader,
  valueHeader,
  fill = false,
  className,
}: {
  bars: Bar[]
  currency: string
  /** One sentence describing the shape, for anyone who can't see it. */
  ariaLabel: string
  /** Caption of the screen-reader table that carries the exact figures. */
  caption: string
  keyHeader: string
  valueHeader: string
  /** Take whatever height the container gives, down to a small floor. Off in
   *  plain block flow, where nothing grows the box and the minimum IS the
   *  height. */
  fill?: boolean
  className?: string
}) {
  const { money, locale } = useFormatters()

  const peak = Math.max(...bars.map((b) => b.value), 1)
  const axisMax = niceCeil(peak)
  // Four gridlines, top to bottom.
  const ticks = [1, 0.75, 0.5, 0.25, 0].map((f) => f * axisMax)

  // Axis ticks. Compact + narrowSymbol ("$12K", not "SGD 12,480") because the
  // gutter is ~40px wide and the label repeats four times down it; without the
  // symbol the axis states no unit at all.
  const compactMoney = React.useMemo(() => {
    for (const options of [
      { notation: "compact", maximumFractionDigits: 1, style: "currency", currency, currencyDisplay: "narrowSymbol" },
      { notation: "compact", maximumFractionDigits: 1, style: "currency", currency },
      { notation: "compact", maximumFractionDigits: 1 },
    ] as Intl.NumberFormatOptions[]) {
      try {
        const fmt = new Intl.NumberFormat(locale, options)
        return (value: number) => fmt.format(value)
      } catch {
        // An unknown or malformed currency code throws on construction; fall
        // through to the next, progressively less specific, format.
      }
    }
    return (value: number) => String(Math.round(value))
  }, [locale, currency])

  return (
    // @container: the label thinning keys off THIS CARD's width, the only thing
    // that actually determines how much room a label gets. The same chart is a
    // third of the dashboard on a phone and most of a 2560px window elsewhere.
    <div className={cn("@container flex min-h-0 flex-1 flex-col", className)}>
      {/* One grid, not three boxes whose heights have to be kept in sync by
          hand. Row 1 is minmax(0,1fr) so the plot absorbs whatever height the
          card is given. Ticks and bars share row 1, so a gridline can never
          drift from its bar; labels sit in row 2 in the bars' own column, so
          they can't drift either. */}
      <div
        className={cn(
          "grid flex-1 grid-cols-[minmax(3.5rem,auto)_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto] gap-x-3",
          fill ? "min-h-24" : "min-h-32 lg:min-h-44 2xl:min-h-56",
        )}
      >
        {/* The axis. `justify-between` over a box the exact height of the plot
            puts each label on its own gridline with no magic offsets;
            -translate-y-1/2 centres the text ON the line rather than hanging
            below it. */}
        <div
          aria-hidden
          className="flex flex-col items-end justify-between whitespace-nowrap text-micro text-muted-foreground numeral"
        >
          {ticks.map((value, i) => (
            <span
              key={i}
              className="-translate-y-1/2 leading-none first:translate-y-0 last:-translate-y-full"
            >
              {compactMoney(value)}
            </span>
          ))}
        </div>

        {/* No per-bar maximum, and so no `justify-center` to compensate for one:
            `flex-1` alone divides the plot evenly, so the series occupies the
            same width whether it is one bar or twelve and only the bar width
            changes. */}
        <div role="img" aria-label={ariaLabel} className="flex min-w-0 items-end gap-1.5">
          {bars.map((b) => (
            <div key={b.key} className="relative flex h-full min-w-0 flex-1 items-end">
              {/* The ghost bar gives an empty or near-empty column a visible
                  footprint, so a flat stretch reads as "nothing spent" rather
                  than as a broken chart. */}
              <span aria-hidden className="absolute inset-0 rounded-t-lg bg-muted/70" />
              {/* A zero draws NOTHING. A minimum-height sliver would read as
                  "a little was spent" — the one thing this must not imply. The
                  floor still applies to real amounts, so a genuinely tiny bar
                  stays visible. */}
              {b.value > 0 && (
                <span
                  className="relative w-full rounded-t-lg bg-primary/75"
                  style={{ height: `${Math.max(1.5, (b.value / axisMax) * 100)}%` }}
                />
              )}
            </div>
          ))}
        </div>

        {/* Row 2, column 1: empty, holding the labels clear of the axis. */}
        <div aria-hidden />
        {/* Below 28rem of card width only every third label is shown, and the
            survivors stop clipping so they can spill into their now-blank
            neighbours. `invisible` rather than `hidden` keeps every box in
            place, so the labels that remain stay centred under their own bar. */}
        <div className="mt-2 flex min-w-0 gap-1.5 overflow-hidden text-micro text-muted-foreground @max-md:[&>span:not(:nth-child(3n+1))]:invisible">
          {bars.map((b) => (
            <span
              key={b.key}
              className="min-w-0 flex-1 truncate text-center @max-md:overflow-visible"
            >
              {b.label}
            </span>
          ))}
        </div>
      </div>

      {/* The figures, for anyone the shape doesn't serve. `sr-only` goes on a
          WRAPPER, not the <table>: an absolutely positioned `display:table`
          does not blockify, so it treats the 1x1 clamp as a minimum and lays
          out at full size, adding phantom scroll height to the page. */}
      <div className="sr-only">
        <table>
          <caption>{caption}</caption>
          <thead>
            <tr>
              <th scope="col">{keyHeader}</th>
              <th scope="col">{valueHeader}</th>
            </tr>
          </thead>
          <tbody>
            {bars.map((b) => (
              <tr key={b.key}>
                <th scope="row">{b.label}</th>
                <td>{money(b.value, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
