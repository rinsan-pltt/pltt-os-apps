"use client"

import * as React from "react"
import { Coins } from "lucide-react"

import { useSettings } from "@/components/settings-provider"
import { Select } from "@/components/ui/select"
import { useToast } from "@/components/ui/toast"
import { CURRENCIES } from "@/lib/currencies"
import { useT } from "@/lib/i18n"

/** Compact header control for the app-wide base currency. Changing it re-fetches
 *  the dashboard totals (via the summary endpoint) in the chosen currency, with
 *  other-currency expenses converted at each expense date's exchange rate. */
export function BaseCurrencyPicker() {
  const t = useT()
  const { toast } = useToast()
  const { baseCurrency, loading, setBaseCurrency } = useSettings()

  // Always include the current value even if it's not in the common list, so
  // the selection is never silently dropped.
  const options = React.useMemo(() => {
    const known = CURRENCIES.some((c) => c.code === baseCurrency)
    return known || !baseCurrency
      ? CURRENCIES
      : [{ code: baseCurrency, name: baseCurrency }, ...CURRENCIES]
  }, [baseCurrency])

  return (
    <label className="flex select-none items-center gap-1.5" title={t("settings.baseCurrency")}>
      <Coins className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="sr-only">{t("settings.baseCurrency")}</span>
      <Select
        aria-label={t("settings.baseCurrency")}
        value={baseCurrency}
        disabled={loading}
        onChange={(e) => {
          // setBaseCurrency reverts its optimistic update and re-throws on
          // failure. This used to be a bare `void`, so a failed currency change
          // silently reverted with no explanation and an unhandled rejection.
          setBaseCurrency(e.target.value).catch((error: unknown) => {
            toast(error instanceof Error ? error.message : t("settings.couldNotChange"), {
              tone: "error",
            })
          })
        }}
        className="h-9 w-[4.5rem] rounded-lg px-2 text-xs font-medium"
      >
        {options.map((c) => (
          <option key={c.code} value={c.code}>
            {c.code}
          </option>
        ))}
      </Select>
    </label>
  )
}
