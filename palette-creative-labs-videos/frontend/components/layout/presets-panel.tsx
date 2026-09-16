"use client"

import React from "react"
import { cn } from "@/lib/utils"
import { IconX, IconCheck, IconLoader2 } from "@tabler/icons-react"

interface Asset {
  url: string;
  id: string;
}

interface PresetsPanelProps {
  categories: any[]
  onSelect: (categoryId: string, option: string, meta?: { previewUrl?: string }) => void | Promise<void>
  onDeleteAsset?: (assetId: string) => void
  onClose: () => void
}

import { apiRequest } from "@/lib/api-helper"
import { useT } from "@/lib/i18n"

export const PresetsPanel = ({ categories, onSelect, onDeleteAsset, onClose }: PresetsPanelProps) => {
  const { t } = useT()
  const panelRef = React.useRef<HTMLDivElement>(null)
  const [selections, setSelections] = React.useState<Record<string, string>>({})
  const [assets, setAssets] = React.useState<Asset[]>([])
  const [loadingAssets, setLoadingAssets] = React.useState(false)

  // Fetch Assets
  React.useEffect(() => {
    const fetchAssets = async () => {
      setLoadingAssets(true)
      try {
        const data = await apiRequest("/assets")
        setAssets(data)
      } catch (err) {
        console.error("Failed to fetch assets:", err)
      } finally {
        setLoadingAssets(false)
      }
    }
    fetchAssets()
  }, [])

  const handleDeleteAsset = async (assetId: string) => {
    // Optimistic: remove immediately from UI
    const previous = assets
    setAssets(prev => prev.filter(a => a.id !== assetId))
    try {
      const data = await apiRequest(`/assets/${assetId}`, { method: "DELETE" })
      if (data.status !== "success") {
        // Rollback on failure
        setAssets(previous)
        console.error("Failed to delete asset:", data.message)
      } else {
        // Notify parent to remove from selections
        onDeleteAsset?.(assetId)
      }
    } catch (err) {
      setAssets(previous)
      console.error("Delete asset error:", err)
    }
  }

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        onClose()
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [onClose])

  // Picking options only marks them here — nothing is applied until the ✓
  // button confirms it; closing (X or click-outside) discards the picks.
  const toggleSelection = (categoryId: string, option: string) => {
    const isSelected = selections[categoryId] === option
    setSelections(prev => ({
      ...prev,
      [categoryId]: isSelected ? "" : option
    }))
  }

  const hasSelection = Object.values(selections).some(Boolean)

  const applySelections = async () => {
    // Sequential so each prompt rewrite builds on the previous one.
    for (const [categoryId, option] of Object.entries(selections)) {
      if (option) await onSelect(categoryId, option)
    }
    onClose()
  }

  return (
    <div
      ref={panelRef}
      className="absolute inset-0 bg-card border-r border-border shadow z-50 animate-in fade-in slide-in-from-right-2 duration-200 flex flex-col overflow-hidden"
    >
      {/* Panel Header */}
      <div className="px-5 py-3 border-b border-border flex items-center justify-between shrink-0">
        <h3 className="font-semibold text-lg">{t("panels.presets")}</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={applySelections}
            disabled={!hasSelection}
            aria-label={t("common.apply")}
            title={t("common.apply")}
            className="hover:bg-accent/10 rounded-full transition-colors group disabled:opacity-30 disabled:pointer-events-none"
          >
            <IconCheck className="size-5 text-muted-foreground group-hover:text-primary transition-colors" />
          </button>
          <button
            onClick={onClose}
            className="hover:bg-accent/10 rounded-full transition-colors group"
          >
            <IconX className="size-5 text-muted-foreground group-hover:text-foreground transition-colors" />
          </button>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
        <div className="flex flex-col gap-8">

          {/* Example presets */}
          {categories.map(category => (
            <div key={category.id} className="flex flex-col gap-3">
              <span className="text-sm font-semibold">{category.title}</span>
              <div className="flex flex-col gap-2">
                {category.options.map((option: string) => {
                  const isSelected = selections[category.id] === option;
                  return (
                    <button
                      key={option}
                      onClick={() => toggleSelection(category.id, option)}
                      className={cn(
                        "px-3 py-2 text-sm text-left leading-relaxed rounded-lg border transition-all duration-200 cursor-pointer",
                        isSelected
                          ? "border-primary text-primary"
                          : "bg-transparent text-foreground border-border hover:bg-accent/10 hover:border-border/80"
                      )}
                    >
                      {option}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}

          {/* Assets Section — your saved reference images. */}
          <div className="flex flex-col gap-3">
            <span className=" font-semibold flex items-center gap-2">
              {t("panels.assets")}
              {loadingAssets && <IconLoader2 className="size-3 pltt-animate-spin text-muted-foreground" />}
            </span>
            <div className="max-h-[300px] overflow-y-auto custom-scrollbar pr-1 sidebar-root">
              <div className="grid grid-cols-3 gap-2">
                {assets.length > 0 ? (
                  assets.map(asset => (
                    <div key={asset.id} className="group/asset relative aspect-square rounded-md overflow-hidden border border-border50 hover:border-primary/50 transition-all">
                      <button
                        onClick={() => onSelect("assets", asset.id, { previewUrl: asset.url })}
                        className="w-full h-full cursor-pointer"
                      >
                        <img src={asset.url} className="w-full h-full object-cover transition-transform group-hover/asset:scale-110" alt="Saved asset" />
                      </button>
                      {/* Delete button */}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteAsset(asset.id) }}
                        className="absolute top-1 right-1 size-5 bg-black/70 rounded-full flex items-center justify-center text-white opacity-0 group-hover/asset:opacity-100 transition-opacity hover:bg-red-600 z-10"
                        title={t("panels.removeAsset")}
                      >
                        <IconX className="size-3" />
                      </button>
                    </div>
                  ))
                ) : !loadingAssets ? (
                  <p className="text-sm text-muted-foreground col-span-3 py-2 font-medium">{t("panels.noAssets")}</p>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

