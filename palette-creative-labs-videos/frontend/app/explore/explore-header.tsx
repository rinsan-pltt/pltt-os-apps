import React from "react"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n"
import { Button } from "@/components/ui/button"
import { FilterPill } from "./filter-pill"
import {
  MARK_COLORS,
  MAX_COMPARE,
  VIDEO_ENGINE_PILLS,
  type EngineFilter,
  type GridMode,
  type MarkFilter,
} from "./types"

interface Props {
  count: number
  engine: EngineFilter
  onSelectEngine: (v: EngineFilter) => void
  markFilter: MarkFilter
  setMarkFilter: (v: MarkFilter) => void
  grid: GridMode
  setGrid: (v: GridMode) => void
  onRandom: () => void
  compareMode: boolean
  selectedCount: number
  onEnterCompare: () => void
  onExitCompare: () => void
  onOpenCompare: () => void
}

export function ExploreHeader({
  count,
  engine,
  onSelectEngine,
  markFilter,
  setMarkFilter,
  grid,
  setGrid,
  onRandom,
  compareMode,
  selectedCount,
  onEnterCompare,
  onExitCompare,
  onOpenCompare,
}: Props) {
  const { t } = useT()
  return (
    <div className="border-b border-border50">
      {/* Row 1 — just the title. */}
      <div className="flex items-center gap-4 px-6 pt-3">
        <span className="text-xs font-semibold tracking-[0.2em] uppercase text-foreground shrink-0">
          {t("explore.title", { count })}
        </span>
        <div className="ml-auto flex items-center">
          {!compareMode ? (
            <Button
              variant="outline"
              size="xs"
              className="tracking-[0.2em] uppercase"
              onClick={onEnterCompare}
            >
              {t("explore.selectToCompare")}
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Button variant="default" size="sm" className="tracking-[0.2em]">
                {t("explore.selectCount", { count: selectedCount, max: MAX_COMPARE })}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="tracking-[0.2em]"
                onClick={onExitCompare}
              >
                {t("common.clear")}
              </Button>
              <Button
                variant="default"
                size="sm"
                className="tracking-[0.2em]"
                disabled={selectedCount === 0}
                onClick={onOpenCompare}
              >
                {t("explore.compare")}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Row 2 — "All Engines" + every video engine, one connected strip. */}
      <div className="flex items-center gap-4 px-6 pt-2">
        <div className="flex items-center">
          {VIDEO_ENGINE_PILLS.map((p, i) => (
            <FilterPill
              key={p.value}
              active={engine === p.value}
              onClick={() => onSelectEngine(p.value)}
              className={cn(i > 0 && "-ml-px")}
            >
              {p.label}
            </FilterPill>
          ))}
        </div>
      </div>

      {/* Row 3 */}
      <div className="flex items-center gap-4 px-6 pt-3 pb-3">
        <div className="flex items-center">
          <FilterPill active={markFilter === "all"} onClick={() => setMarkFilter("all")}>
            {t("common.all")}
          </FilterPill>
          <FilterPill
            active={markFilter === "none"}
            onClick={() => setMarkFilter("none")}
            className="-ml-px"
          >
            {t("explore.noMarks")}
          </FilterPill>
          <FilterPill
            active={markFilter === "marked"}
            onClick={() => setMarkFilter("marked")}
            className="-ml-px"
          >
            {t("explore.allMarks")}
          </FilterPill>
        </div>
        <div className="flex items-center">
          {MARK_COLORS.map((c, i) => (
            <Button
              key={c}
              variant="outline"
              size="xs"
              onClick={() => setMarkFilter(c)}
              aria-label={t("explore.markColor", { color: c })}
              className={cn(
                i > 0 && "-ml-px"
              )}
            >
              <span className="size-4 rounded-full" style={{ backgroundColor: c }} />
            </Button>
          ))}
        </div>
        <div className="ml-auto flex items-center">
          <FilterPill active={grid === "random"} onClick={onRandom}>
            {t("explore.random")}
          </FilterPill>
          {([1, 2, 3, 4, 5] as const).map((n) => (
            <FilterPill
              key={n}
              active={grid === n}
              onClick={() => setGrid(n)}
              className="-ml-px"
            >
              {String(n)}
            </FilterPill>
          ))}
        </div>
      </div>
    </div>
  )
}
