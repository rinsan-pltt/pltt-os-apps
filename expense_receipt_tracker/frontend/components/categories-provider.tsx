"use client"

import * as React from "react"

import { listCategories, type Category } from "@/lib/api"
import { CATEGORY_BY_SLUG } from "@/lib/categories"
import { useRegistryText } from "@/lib/i18n"

interface CategoriesContextValue {
  categories: Category[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

const CategoriesContext = React.createContext<CategoriesContextValue | null>(null)

/** Fetches the org's (editable) categories once and shares them across the app
 *  so filters, pickers and badges all reflect the current set. */
export function CategoriesProvider({ children }: { children: React.ReactNode }) {
  const [categories, setCategories] = React.useState<Category[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const refresh = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setCategories(await listCategories())
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load categories.")
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    refresh()
  }, [refresh])

  return (
    <CategoriesContext.Provider value={{ categories, loading, error, refresh }}>
      {children}
    </CategoriesContext.Provider>
  )
}

export function useCategories(): CategoriesContextValue {
  const ctx = React.useContext(CategoriesContext)
  if (!ctx) throw new Error("useCategories must be used within a CategoriesProvider")
  return ctx
}

/**
 * Returns a `label(slug)` function. A default category that hasn't been renamed
 * shows its localized label (e.g. Korean); a renamed or custom category shows
 * the user's chosen name. Unknown slugs fall back to the registry text.
 */
export function useCategoryLabel(): (slug: string) => string {
  const { categories } = useCategories()
  const reg = useRegistryText()
  const bySlug = React.useMemo(
    () => Object.fromEntries(categories.map((c) => [c.slug, c])),
    [categories],
  )
  return React.useCallback(
    (slug: string) => {
      const cat = bySlug[slug]
      if (!cat) return reg.category(slug)
      const def = CATEGORY_BY_SLUG[slug]
      // Untouched default → localized label; otherwise the user's label.
      if (cat.is_default && def && cat.label === def.label) return reg.category(slug)
      return cat.label
    },
    [bySlug, reg],
  )
}
