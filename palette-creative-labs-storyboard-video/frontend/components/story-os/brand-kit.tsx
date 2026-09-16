"use client"

// Brand Kit — a shelf of assets (logos, character sheets, palettes, type and
// motion references) that's shared across every run rather than scoped to
// one story session. Upload once; a vision model auto-categorizes each
// asset into a shelf (see /brandkit/analyze) so nothing needs manual
// tagging. Persists via the same Asset table as Long Video reference images,
// just under a separate `type` — see assets.py's upload_brandkit_asset.

import * as React from "react"
import { IconLoader2, IconTrash } from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import { apiRequest } from "@/lib/api-helper"
import { uploadBrandKitAsset } from "@/lib/gcs-upload-helper"
import { usePosT, type PosKey } from "./i18n"
import { GhostBtn, PrimaryBtn } from "./ui"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

type BrandCategory = "logo" | "character" | "object" | "color_palette" | "typography" | "motion_preset" | "other"

const CATEGORY_LABEL_KEY: Record<BrandCategory, PosKey> = {
  logo: "bkCatLogo",
  character: "bkCatCharacter",
  object: "bkCatObject",
  color_palette: "bkCatColor",
  typography: "bkCatType",
  motion_preset: "bkCatMotion",
  other: "bkCatOther",
}

// "Use" hands a Brand Kit asset to Home as a story reference — Home's
// references speak the story-reference "kind" vocabulary (character/object/
// background/style/other, see story_video.py's _ANALYZE_SYSTEM), not Brand
// Kit's own category set, so this maps one onto the other at the boundary.
const CATEGORY_TO_REFERENCE_KIND: Record<BrandCategory, string> = {
  logo: "object",
  character: "character",
  object: "object",
  color_palette: "style",
  typography: "style",
  motion_preset: "style",
  other: "other",
}

export interface BrandKitUseRef {
  url: string
  name?: string
  description?: string
  kind?: string
}

interface BrandAsset {
  id: string
  url: string
  previewUrl: string
  category?: BrandCategory
  name?: string
  description?: string
  analyzing: boolean
  error?: string
}

export function BrandKitScreen({
  onError,
  onUseAssets,
}: {
  onError: (title: string, err: unknown) => void
  // Fires once for the whole batch — see the selection bar below the grid,
  // which lets the user tick several assets before sending them all at once.
  onUseAssets?: (refs: BrandKitUseRef[]) => void
}) {
  const { t } = usePosT()
  const [assets, setAssets] = React.useState<BrandAsset[]>([])
  const [cat, setCat] = React.useState<"all" | BrandCategory>("all")
  const [pendingDeleteId, setPendingDeleteId] = React.useState<string | null>(null)
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const seq = React.useRef(0)

  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const useSelected = () => {
    const refs = assets
      .filter((a) => selected.has(a.id))
      .map((a) => ({
        url: a.url,
        name: a.name,
        description: a.description,
        kind: CATEGORY_TO_REFERENCE_KIND[a.category ?? "other"],
      }))
    if (refs.length === 0) return
    onUseAssets?.(refs)
    setSelected(new Set())
  }

  // Load whatever's already been uploaded (Brand Kit is shared across every
  // run, so this isn't seeded from a session prop like the pipeline screens).
  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await apiRequest("/assets?type=brand_asset")
        if (cancelled) return
        const list = (res?.assets ?? []) as Array<{
          id: string
          url: string
          analysis?: { category?: string; name?: string; description?: string }
        }>
        setAssets(
          list.map((a) => ({
            id: a.id,
            url: a.url,
            previewUrl: a.url,
            category: (a.analysis?.category as BrandCategory) || undefined,
            name: a.analysis?.name,
            description: a.analysis?.description,
            analyzing: false,
          })),
        )
      } catch (err) {
        if (!cancelled) onError(t("bkAnalyzeFailed"), err)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const patch = (id: string, p: Partial<BrandAsset>) =>
    setAssets((prev) => prev.map((a) => (a.id === id ? { ...a, ...p } : a)))

  const addFiles = (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith("image/"))
    for (const file of images) {
      const localId = `local-${++seq.current}`
      const previewUrl = URL.createObjectURL(file)
      setAssets((prev) => [{ id: localId, url: previewUrl, previewUrl, analyzing: true }, ...prev])
      void (async () => {
        try {
          const uploaded = await uploadBrandKitAsset(file)
          patch(localId, { id: uploaded.id, url: uploaded.url })
          const res = await apiRequest("/brandkit/analyze", {
            method: "POST",
            body: JSON.stringify({ url: uploaded.url, asset_id: uploaded.id }),
          })
          patch(uploaded.id, {
            analyzing: false,
            category: (res?.analysis?.category as BrandCategory) || "other",
            name: res?.analysis?.name,
            description: res?.analysis?.description,
          })
        } catch (err) {
          // Still shelved under Other (with the error visible) rather than
          // silently vanishing — the upload itself may have succeeded even
          // though categorization failed.
          patch(localId, {
            analyzing: false,
            category: "other",
            error: err instanceof Error ? err.message : String(err),
          })
          onError(t("bkAnalyzeFailed"), err)
        }
      })()
    }
  }

  const deleteAsset = async (id: string) => {
    const target = assets.find((a) => a.id === id)
    setAssets((prev) => prev.filter((a) => a.id !== id))
    setSelected((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    if (target?.previewUrl.startsWith("blob:")) URL.revokeObjectURL(target.previewUrl)
    if (id.startsWith("local-")) return // upload never landed (or is still in flight)
    try {
      await apiRequest(`/assets/${id}`, { method: "DELETE" })
    } catch (err) {
      onError(t("bkDeleteAsset"), err)
    }
  }

  const categories = React.useMemo(
    () =>
      (["all", "logo", "character", "object", "color_palette", "typography", "motion_preset", "other"] as const).map((key) => ({
        key,
        label: key === "all" ? t("bkCatAll") : t(CATEGORY_LABEL_KEY[key]),
        count: key === "all" ? assets.length : assets.filter((a) => a.category === key).length,
      })),
    [assets, t],
  )

  const visible = cat === "all" ? assets : assets.filter((a) => a.category === cat)

  return (
    <div className="flex-1 grid min-h-0" style={{ gridTemplateColumns: "200px 1fr" }}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          addFiles(Array.from(e.target.files ?? []))
          e.target.value = ""
        }}
      />
      <aside className="border-r border-[var(--pos-b1)] bg-[var(--pos-s1)] p-2.5 flex flex-col gap-0.5 overflow-y-auto">
        <div className="text-xs font-semibold text-[var(--pos-t1)] px-2.5 pb-2.5">{t("bkTitle")}</div>
        {categories.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setCat(c.key)}
            className={cn(
              "flex items-center justify-between rounded-[6px] px-2.5 py-[7px] text-left cursor-pointer transition-colors",
              cat === c.key ? "bg-[var(--pos-s3)]" : "hover:bg-[var(--pos-s3)]",
            )}
          >
            <span
              className={cn(
                "text-xs font-medium",
                cat === c.key ? "text-[var(--pos-t1)]" : "text-[var(--pos-t2)]",
              )}
            >
              {c.label}
            </span>
            <span className="pos-mono text-[10.5px] text-[var(--pos-t3)]">{c.count}</span>
          </button>
        ))}
      </aside>

      <div className="overflow-y-auto p-6">
        <div className="flex items-baseline justify-between gap-3 mb-3.5">
          <div className="flex items-baseline gap-2.5">
            <span className="text-base font-semibold tracking-[-0.015em] text-[var(--pos-t1)]">
              {cat === "all" ? t("bkCatAll") : t(CATEGORY_LABEL_KEY[cat])}
            </span>
            <span className="text-[11.5px] text-[var(--pos-t3)]">{t("bkSub")}</span>
          </div>
          <GhostBtn onClick={() => fileInputRef.current?.click()}>{t("bkUpload")}</GhostBtn>
        </div>

        {selected.size > 0 && (
          <div className="flex items-center gap-3 mb-3.5 px-3 py-2 rounded-[8px] bg-[var(--pos-vioS)] border border-[var(--pos-vioB)]">
            <span className="text-xs font-medium text-[var(--pos-vioT)]">
              {t("bkSelectedCount", { n: selected.size })}
            </span>
            <div className="flex-1" />
            <GhostBtn onClick={() => setSelected(new Set())}>{t("cancel")}</GhostBtn>
            <PrimaryBtn onClick={useSelected}>{t("bkUseSelected", { n: selected.size })}</PrimaryBtn>
          </div>
        )}

        {visible.length === 0 ? (
          <div className="flex items-center justify-center border border-dashed border-[var(--pos-b2)] rounded-[10px] py-16 px-8 text-center text-sm text-[var(--pos-t3)]">
            {assets.length === 0 && cat === "all" ? t("bkEmptyAll") : t("bkEmpty")}
          </div>
        ) : (
          <div className="grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))" }}>
            {visible.map((a) => (
              <div
                key={a.id}
                className="rounded-[10px] border border-[var(--pos-b1)] bg-[var(--pos-s1)] overflow-hidden"
              >
                <div className="aspect-[4/3] bg-[var(--pos-s2)] flex items-center justify-center relative">
                  <img src={a.previewUrl} alt={a.name ?? ""} className="max-w-full max-h-full object-contain" />
                  {a.analyzing && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/45">
                      <IconLoader2 className="size-4 text-white pltt-animate-spin" />
                    </div>
                  )}
                </div>
                <div className="px-2.5 py-2">
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="text-xs font-medium text-[var(--pos-t1)] truncate" title={a.name}>
                      {a.name ?? "—"}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {!a.analyzing && onUseAssets && (
                        <button
                          type="button"
                          onClick={() => toggleSelected(a.id)}
                          className={cn(
                            "text-[10.5px] font-medium rounded-[4px] px-[7px] py-[2px] whitespace-nowrap cursor-pointer transition-colors",
                            selected.has(a.id)
                              ? "bg-[var(--pos-vio)] text-white"
                              : "text-[var(--pos-vioT)] bg-[var(--pos-vioS)] hover:brightness-110",
                          )}
                        >
                          {selected.has(a.id) ? `✓ ${t("bkUse")}` : t("bkUse")}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setPendingDeleteId(a.id)}
                        title={t("bkDeleteAsset")}
                        className="text-[var(--pos-t3)] hover:text-[var(--pos-t1)] cursor-pointer transition-colors"
                      >
                        <IconTrash className="size-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="pos-mono text-[10.5px] text-[var(--pos-t3)] mt-[3px]">
                    {a.analyzing ? t("bkAnalyzing") : a.category ? t(CATEGORY_LABEL_KEY[a.category]) : "—"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <AlertDialog open={!!pendingDeleteId} onOpenChange={(open) => !open && setPendingDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="uppercase tracking-widest text-sm">{t("bkDeleteAssetTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("bkDeleteAssetConfirm")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingDeleteId) void deleteAsset(pendingDeleteId)
                setPendingDeleteId(null)
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("bkDeleteAsset")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
