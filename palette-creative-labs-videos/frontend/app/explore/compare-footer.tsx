import React from "react"
import { Button } from "@/components/ui/button"
import type { Favourite } from "./types"
import { useT } from "@/lib/i18n"

interface Props {
  selected: string[]
  favById: Map<string, Favourite>
  onRemove: (id: string) => void
  onClear: () => void
  onOpenCompare: () => void
}

export function CompareFooter({ selected, favById, onRemove, onClear, onOpenCompare }: Props) {
  const { t } = useT()
  return (
    <div className="sticky bottom-0 mt-3 z-20">
      <div className="flex items-center gap-4 px-4 py-2 bg-secondary border border-border">
        <span className="text-xs font-semibold tracking-[0.2em] uppercase text-foreground shrink-0">
          {t("explore.compareSelected", { count: selected.length })}
        </span>
        <div className="flex items-center gap-2 flex-1 min-w-0 overflow-x-auto">
          {selected.map((id) => {
            const fav = favById.get(id)
            if (!fav) return null
            return (
              <div
                key={id}
                className="relative shrink-0 size-10 border border-border60 overflow-hidden group"
              >
                <img src={fav.url} alt="" className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onRemove(id)
                  }}
                  className="absolute inset-0 bg-black/60 text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                  aria-label={t("common.remove")}
                >
                  ×
                </button>
              </div>
            )
          })}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" className="tracking-[0.2em]" onClick={onClear}>
            {t("common.clear")}
          </Button>
          <Button variant="default" size="sm" className="tracking-[0.2em]" onClick={onOpenCompare}>
            {t("explore.viewCompare")}
          </Button>
        </div>
      </div>
    </div>
  )
}
