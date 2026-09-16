"use client"

import * as React from "react"

import { getSettings, updateSettings } from "@/lib/api"

interface SettingsContextValue {
  /** The base currency the dashboard totals are shown in (e.g. "USD"). */
  baseCurrency: string
  /** Bumps after each successful save so consumers (the dashboard totals) can
   *  re-fetch once the new base currency is actually persisted. */
  revision: number
  loading: boolean
  error: string | null
  /** Persist a new base currency and update the shared state on success. */
  setBaseCurrency: (code: string) => Promise<void>
  /** Re-read the settings from the server and bump `revision`.
   *
   *  For changes this provider did not make. The chat assistant can set the
   *  base currency (`set_base_currency`), and without this the sidebar picker
   *  and every total would keep showing the old currency until a full reload. */
  refresh: () => Promise<void>
}

const SettingsContext = React.createContext<SettingsContextValue | null>(null)

const DEFAULT_BASE_CURRENCY = "USD"

/** Loads the org's plugin settings (base currency) once and shares them across
 *  the app so the dashboard totals and the currency picker stay in sync. */
export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [baseCurrency, setBaseCurrencyState] = React.useState(DEFAULT_BASE_CURRENCY)
  const [revision, setRevision] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const refresh = React.useCallback(async () => {
    setError(null)
    try {
      const settings = await getSettings()
      setBaseCurrencyState(settings.base_currency || DEFAULT_BASE_CURRENCY)
      setRevision((r) => r + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load settings.")
    }
  }, [])

  React.useEffect(() => {
    let cancelled = false
    getSettings()
      .then((s) => {
        if (!cancelled) setBaseCurrencyState(s.base_currency || DEFAULT_BASE_CURRENCY)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load settings.")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const setBaseCurrency = React.useCallback(async (code: string) => {
    setError(null)
    // Capture the value before the change so we can revert on failure, then
    // optimistically reflect the choice.
    let previous = DEFAULT_BASE_CURRENCY
    setBaseCurrencyState((prev) => {
      previous = prev
      return code
    })
    try {
      const saved = await updateSettings({ base_currency: code })
      setBaseCurrencyState(saved.base_currency)
      // Only now is the new base currency persisted — signal consumers to
      // re-fetch their (now-correctly-converted) totals.
      setRevision((r) => r + 1)
    } catch (e) {
      setBaseCurrencyState(previous)
      setError(e instanceof Error ? e.message : "Could not update settings.")
      throw e
    }
  }, [])

  return (
    <SettingsContext.Provider value={{ baseCurrency, revision, loading, error, setBaseCurrency, refresh }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings(): SettingsContextValue {
  const ctx = React.useContext(SettingsContext)
  if (!ctx) throw new Error("useSettings must be used within a SettingsProvider")
  return ctx
}
