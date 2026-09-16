"use client"

import * as React from "react"
import { usePluginTranslations } from "@palettelab/sdk"

import { CATEGORY_BY_SLUG, STATUS_BY_SLUG } from "./categories"
import { translations } from "./translations"

/**
 * Translate function bound to this app's resources. The active language follows
 * Palette OS (`usePlatform().language`); there is no in-app toggle. Signature:
 * `t(key, values?, defaultValue?)` — a missing key falls back to `en`, then to
 * `defaultValue`, then to the key itself.
 */
export function useT() {
  const { t } = usePluginTranslations(translations)
  return t
}

/**
 * "1 expense" vs "3 expenses". `t()` has no plural support, so the caller picks
 * the form; English needs both, Korean uses one for either.
 */
export function useExpenseCount() {
  const t = useT()
  return (count: number) =>
    count === 1 ? t("common.expenseCountOne") : t("common.expenseCount", { count })
}

/**
 * Localized category/status labels. Fall back to the English label from
 * lib/categories.ts (then the slug), so an untranslated entry never breaks.
 */
export function useRegistryText() {
  const t = useT()
  // Memoised because this used to return a fresh object literal on every
  // render, which churned the identity of `useCategoryLabel`'s useCallback —
  // so every badge got a new function each render and React.memo on a ledger
  // row could never hit.
  return React.useMemo(
    () => ({
      category: (slug: string) =>
        t(`categoryLabels.${slug}`, undefined, CATEGORY_BY_SLUG[slug]?.label ?? slug),
      status: (slug: string) =>
        t(`statuses.${slug}`, undefined, STATUS_BY_SLUG[slug]?.label ?? slug),
    }),
    [t],
  )
}
