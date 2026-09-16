"use client"

import * as React from "react"
import { usePlatform } from "@palettelab/sdk"

/**
 * Locale-aware formatters.
 *
 * The pure helpers in lib/utils.ts hardcode "en-US", which is wrong for the
 * Japanese and Korean users this app ships translations for — they saw
 * "Mar 4, 2026" and "$12.40" rendered US-style regardless of OS language.
 * These hooks bind Intl to `usePlatform().language`, the same source
 * `usePluginTranslations` reads, so money and dates follow the OS setting the
 * way the copy already does.
 */

// Palette hands us a bare language code; Intl wants a locale. Without the
// region, `new Intl.NumberFormat("ja")` still works but date and currency
// conventions fall back to defaults that are not what a Japanese user expects.
const LOCALE_BY_LANGUAGE: Record<string, string> = {
  en: "en-US",
  ja: "ja-JP",
  ko: "ko-KR",
}

export function useLocale(): string {
  const platform = usePlatform() as unknown as { language?: string | null }
  const language = platform?.language ?? "en"
  return LOCALE_BY_LANGUAGE[language] ?? language ?? "en-US"
}

export interface Formatters {
  locale: string
  /** Currency amount, e.g. "$12.40" / "₩1,200" / "₹785.00". */
  money: (amount: number, currency?: string) => string
  /** ISO yyyy-mm-dd → medium date in the active locale. */
  date: (iso: string) => string
  /** ISO yyyy-mm-dd → compact date (no year) for dense rows. */
  dateShort: (iso: string) => string
  /** Plain number with grouping, for counts. */
  number: (value: number) => string
}

export function useFormatters(): Formatters {
  const locale = useLocale()

  return React.useMemo<Formatters>(() => {
    const money = (amount: number, currency = "USD") => {
      try {
        return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount)
      } catch {
        // Unknown/invalid currency code (e.g. one an AI scan invented).
        return `${currency} ${amount.toFixed(2)}`
      }
    }

    const parse = (iso: string) => {
      const d = new Date(`${iso}T00:00:00`)
      return Number.isNaN(d.getTime()) ? null : d
    }

    return {
      locale,
      money,
      date: (iso) => {
        const d = parse(iso)
        if (!d) return iso
        return d.toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" })
      },
      dateShort: (iso) => {
        const d = parse(iso)
        if (!d) return iso
        return d.toLocaleDateString(locale, { month: "short", day: "numeric" })
      },
      number: (value) => new Intl.NumberFormat(locale).format(value),
    }
  }, [locale])
}
