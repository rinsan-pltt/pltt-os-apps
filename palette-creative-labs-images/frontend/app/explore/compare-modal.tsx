import React from "react"
import { cn } from "@/lib/utils"
import { imageModelOptions } from "@/components/layout/video-helper"
import { favId, getCompareLayout } from "./utils"
import { COMPARE_COLS_CLASS, COMPARE_ROWS_CLASS, type Favourite } from "./types"
import { useT } from "@/lib/i18n"

export function CompareModal({ items, onClose }: { items: Favourite[]; onClose: () => void }) {
  const { t } = useT()
  const { cols, rows } = getCompareLayout(items.length)

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 bg-black/10 backdrop-blur-sm flex items-center justify-center p-8"
      onClick={onClose}
    >
      <div
        className="w-full h-full max-w-[1600px] max-h-[900px] bg-background border border-border flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-3 border-b border-border50">
          <span className="text-xs font-semibold tracking-[0.2em] uppercase text-foreground">
            {items.length === 1
              ? t("explore.compareCountSingular", { count: items.length })
              : t("explore.compareCountPlural", { count: items.length })}
          </span>
          <button
            onClick={onClose}
            className="size-8 inline-flex items-center justify-center border border-border40 hover:border-border text-foreground"
            aria-label={t("common.close")}
          >
            ×
          </button>
        </div>
        <div
          className={cn(
            "flex-1 grid gap-px bg-border overflow-hidden",
            COMPARE_COLS_CLASS[cols],
            COMPARE_ROWS_CLASS[rows]
          )}
        >
          {items.map((fav) => {
            const model = imageModelOptions.find((m) => m.value === fav.model_name)
            return (
              <div
                key={favId(fav) || fav.url}
                className="relative min-h-0 min-w-0 bg-black flex items-center justify-center overflow-hidden"
              >
                <img
                  src={fav.url}
                  alt={fav.prompt || ""}
                  className="max-w-full max-h-full object-contain"
                />
                {fav.group && (
                  <span
                    className="absolute top-3 right-3 size-3 rounded-full ring-2 ring-black/40"
                    style={{ backgroundColor: fav.group }}
                  />
                )}
                <div className="absolute bottom-2 left-2 max-w-[80%] inline-flex items-center gap-2 px-2 py-1 bg-black/85 text-xs uppercase tracking-[0.15em] shadow">
                  <span
                    className="size-2 rounded-full shrink-0"
                    style={{ backgroundColor: model?.color ?? "#94a3b8" }}
                  />
                  <span className="font-semibold text-white shrink-0">
                    {model?.label ?? fav.model_name ?? t("explore.unknownModel")}
                  </span>
                  {(fav.project_name || fav.prompt) && (
                    <>
                      <span className="text-white shrink-0">·</span>
                      <span className="text-white/80 truncate font-normal">
                        {fav.project_name ?? fav.prompt}
                      </span>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
