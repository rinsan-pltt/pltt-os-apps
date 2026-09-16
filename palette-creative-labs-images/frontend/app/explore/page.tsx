"use client"

import React from "react"
import { AppShell } from "@/components/layout/app-shell"
import { apiRequest } from "@/lib/api-helper"
import { CompareFooter } from "./compare-footer"
import { CompareModal } from "./compare-modal"
import { ExploreGrid } from "./explore-grid"
import { ExploreHeader } from "./explore-header"
import { ImageDetailModal } from "./image-detail-modal"
import { MAX_COMPARE, type EngineFilter, type Favourite, type GridMode, type MarkFilter } from "./types"
import { favId, mulberry32 } from "./utils"
import { useT } from "@/lib/i18n"

const PAGE_SIZE = 20

export default function ExplorePage() {
  const { t } = useT()
  const [favourites, setFavourites] = React.useState<Favourite[]>([])
  const [total, setTotal] = React.useState(0)
  const [page, setPage] = React.useState(1)
  const [hasMore, setHasMore] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [engine, setEngine] = React.useState<EngineFilter>("all")
  const [markFilter, setMarkFilter] = React.useState<MarkFilter>("all")
  const [grid, setGrid] = React.useState<GridMode>(4)
  const [compareMode, setCompareMode] = React.useState(false)
  const [selected, setSelected] = React.useState<string[]>([])
  const [compareOpen, setCompareOpen] = React.useState(false)
  const [detail, setDetail] = React.useState<Favourite | null>(null)
  const [shuffledIds, setShuffledIds] = React.useState<string[]>([])
  const sentinelRef = React.useRef<HTMLDivElement>(null)

  const buildParams = React.useCallback(
    (pageNum: number) => {
      const p = new URLSearchParams({ page: String(pageNum), page_size: String(PAGE_SIZE) })
      if (engine !== "all") p.set("model_name", engine)
      // "marked" is applied client-side; others map directly to API params
      if (markFilter === "none") p.set("group", "null")
      else if (markFilter !== "all" && markFilter !== "marked") p.set("group", markFilter)
      return p.toString()
    },
    [engine, markFilter]
  )

  // Reset + initial fetch whenever filters change
  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    setShuffledIds([])
    apiRequest(`/favourites?${buildParams(1)}`)
      .then((data) => {
        if (cancelled) return
        const items: Favourite[] = data.items ?? []
        setFavourites(items)
        setTotal(data.total ?? 0)
        setPage(1)
        setHasMore(1 < (data.total_pages ?? 1))
      })
      .catch((e) => console.error("Failed to fetch favourites:", e))
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [engine, markFilter]) // intentionally omitting buildParams to avoid double-run

  // Load next page
  const loadMore = React.useCallback(async () => {
    if (!hasMore || loadingMore || loading) return
    setLoadingMore(true)
    try {
      const data = await apiRequest(`/favourites?${buildParams(page + 1)}`)
      const items: Favourite[] = data.items ?? []
      setFavourites((prev) => [...prev, ...items])
      setTotal(data.total ?? 0)
      setPage(page + 1)
      setHasMore(page + 1 < (data.total_pages ?? 1))
    } catch (e) {
      console.error("Failed to load more favourites:", e)
    } finally {
      setLoadingMore(false)
    }
  }, [hasMore, loadingMore, loading, page, buildParams])

  // IntersectionObserver on sentinel div
  React.useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) loadMore() },
      { threshold: 0.1 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [loadMore])

  const favById = React.useMemo(() => {
    const m = new Map<string, Favourite>()
    favourites.forEach((f) => {
      const id = favId(f)
      if (id) m.set(id, f)
    })
    return m
  }, [favourites])

  // Only "marked" filter stays client-side; all others are pushed to the API
  const filtered = React.useMemo(() => {
    if (markFilter === "marked") return favourites.filter((f) => !!f.group)
    return favourites
  }, [favourites, markFilter])

  const displayed = React.useMemo(() => {
    if (grid !== "random" || shuffledIds.length === 0) return filtered
    const idToFav = new Map(filtered.map((f) => [favId(f) || f.url, f]))
    const ordered = shuffledIds.map((id) => idToFav.get(id)).filter(Boolean) as Favourite[]
    const seen = new Set(shuffledIds)
    const tail = filtered.filter((f) => !seen.has(favId(f) || f.url))
    return [...ordered, ...tail]
  }, [filtered, grid, shuffledIds])

  const toggleSelected = (id: string) => {
    if (!id) return
    setSelected((prev) => {
      const deduped = Array.from(new Set(prev))
      if (deduped.includes(id)) return deduped.filter((x) => x !== id)
      if (deduped.length >= MAX_COMPARE) return deduped
      return [...deduped, id]
    })
  }

  const exitCompareMode = () => {
    setCompareMode(false)
    setSelected([])
  }

  const enterCompareMode = () => {
    setCompareMode(true)
    setSelected([])
  }

  const handleRandom = () => {
    setGrid("random")
    const arr = [...filtered]
    const rng = mulberry32(Date.now() & 0xffffffff)
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }
    setShuffledIds(arr.map((f) => favId(f) || f.url))
  }

  const handleGroupChange = (id: string, group: string | null) => {
    setFavourites((prev) => prev.map((f) => (favId(f) === id ? { ...f, group } : f)))
    setDetail((prev) => (prev && favId(prev) === id ? { ...prev, group } : prev))
  }

  const handleDelete = (id: string) => {
    setFavourites((prev) => prev.filter((f) => favId(f) !== id))
    setSelected((prev) => prev.filter((x) => x !== id))
  }

  return (
    <AppShell>
      <div className="flex flex-col flex-1 overflow-hidden bg-background">
        <ExploreHeader
          count={total}
          engine={engine}
          setEngine={setEngine}
          markFilter={markFilter}
          setMarkFilter={setMarkFilter}
          grid={grid}
          setGrid={setGrid}
          onRandom={handleRandom}
          compareMode={compareMode}
          selectedCount={selected.length}
          onEnterCompare={enterCompareMode}
          onExitCompare={exitCompareMode}
          onOpenCompare={() => setCompareOpen(true)}
        />

        <div className="flex-1 overflow-auto p-3">
          {loading ? (
            <div className="h-full flex items-center justify-center text-xs uppercase tracking-widest text-muted-foreground">
              {t("explore.loading")}
            </div>
          ) : displayed.length === 0 ? (
            <div className="h-full flex items-center justify-center text-xs uppercase tracking-widest text-muted-foreground">
              {t("explore.noFavouritesFilter")}
            </div>
          ) : (
            <>
              <ExploreGrid
                items={displayed}
                grid={grid}
                compareMode={compareMode}
                selected={selected}
                onToggle={toggleSelected}
                onOpen={setDetail}
              />
              <div ref={sentinelRef} className="h-10 flex items-center justify-center mt-4">
                {loadingMore && (
                  <span className="text-xs uppercase tracking-widest text-muted-foreground">
                    {t("common.loading")}
                  </span>
                )}
              </div>
            </>
          )}

          {compareMode && selected.length > 0 && (
            <CompareFooter
              selected={selected}
              favById={favById}
              onRemove={toggleSelected}
              onClear={exitCompareMode}
              onOpenCompare={() => setCompareOpen(true)}
            />
          )}
        </div>
      </div>

      {compareOpen && (
        <CompareModal
          items={selected.map((id) => favById.get(id)).filter(Boolean) as Favourite[]}
          onClose={() => setCompareOpen(false)}
        />
      )}

      {detail && (
        <ImageDetailModal
          fav={detail}
          onClose={() => setDetail(null)}
          onGroupChange={handleGroupChange}
          onDelete={handleDelete}
          {...(() => {
            const idx = displayed.findIndex((f) => favId(f) === favId(detail))
            return {
              onPrev: idx > 0 ? () => setDetail(displayed[idx - 1]) : undefined,
              onNext: idx >= 0 && idx < displayed.length - 1 ? () => setDetail(displayed[idx + 1]) : undefined,
            }
          })()}
        />
      )}
    </AppShell>
  )
}
