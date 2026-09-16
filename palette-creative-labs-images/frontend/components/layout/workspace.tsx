"use client"

import React from "react"
import { IconAlertTriangle, IconX, IconRepeat, IconLayoutGrid, IconHeart } from "@tabler/icons-react"
import { buildImageActions } from "./workspace-helpers"
import { FavouritesPanel } from "./favourites-panel"
import { useT, useTimeAgo } from "@/lib/i18n"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { imageModelOptions } from "./video-helper"
import { Button } from "@/components/ui/button"
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
import { useAuth } from "@/components/providers/auth-provider"
import { apiRequest, sseUrl } from "@/lib/api-helper"
import { cn } from "@/lib/utils"


export const Workspace = ({
  refreshSignal,
  onEdit
}: {
  refreshSignal?: number
  onEdit?: (data: { prompt: string; imageUrl: string }) => void
}) => {
  const { user } = useAuth()
  const { t } = useT()
  const timeAgo = useTimeAgo()
  const [activeTab, setActiveTab] = React.useState<"creations" | "favourites">("creations")
  const [images, setImages] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState(true)
  const [reconnectKey, setReconnectKey] = React.useState(0)
  const [idToDelete, setIdToDelete] = React.useState<string | null>(null)
  const [previewImage, setPreviewImage] = React.useState<any | null>(null)
  const [favouriteIds, setFavouriteIds] = React.useState<Set<string>>(new Set())
  const [favourites, setFavourites] = React.useState<any[]>([])
  const [favouritesLoading, setFavouritesLoading] = React.useState(false)

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => e.key === "Escape" && setPreviewImage(null)
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [])

  React.useEffect(() => {
    if (!user) return

    const fetchImages = async () => {
      try {
        const data = await apiRequest("/images")
        setImages(data)
      } catch (error) {
        console.error("Failed to fetch images:", error)
      } finally {
        setLoading(false)
      }
    }

    fetchImages()

    // SSE channel is keyed on (org, user) for the global user-level stream.
    // The absolute URL has to be resolved via `sseUrl` because under
    // `pltt dev` the backend runs on a different port from the frontend.
    let eventSource: EventSource | null = null
    let cancelled = false

    const onImage = (e: MessageEvent) => {
      let eventData: any
      try { eventData = JSON.parse(e.data) } catch { return }
      if (!eventData?.id || eventData.status === "connected") return
      setImages((prev) => {
        const idx = prev.findIndex((img) => img.id === eventData.id)
        const url =
          eventData.all_generated_urls?.[0]?.url ||
          eventData.url ||
          (idx > -1 ? prev[idx].url : undefined)
        if (idx > -1) {
          const updated = [...prev]
          updated[idx] = { ...updated[idx], ...eventData, url }
          return updated
        }
        // First time we see this id — prepend regardless of status so we
        // don't drop a `completed` event that arrived before any `started`
        // (e.g. reconnect, StrictMode double-mount, or fast providers).
        return [{ ...eventData, url }, ...prev]
      })
    }

    sseUrl(user.id, "image").then(({ url, withCredentials }) => {
      if (cancelled) return
      eventSource = new EventSource(url, { withCredentials })
      eventSource.addEventListener("image_generation", onImage)
      eventSource.onerror = () => {
        eventSource?.close()
        setTimeout(() => setReconnectKey((k) => k + 1), 3000)
      }
    })

    return () => {
      cancelled = true
      eventSource?.close()
    }
  }, [reconnectKey, user?.id])

  React.useEffect(() => {
    if (!user) return
    const fetchFavourites = async () => {
      setFavouritesLoading(true)
      try {
        const data = await apiRequest("/favourites")
        setFavourites(data)
        setFavouriteIds(new Set(data.map((f: any) => f.content_id)))
      } catch (error) {
        console.error("Failed to fetch favourites:", error)
      } finally {
        setFavouritesLoading(false)
      }
    }
    fetchFavourites()
  }, [user])

  const handleToggleFavourite = async (imageId: string) => {
    const isFav = favouriteIds.has(imageId)
    try {
      if (isFav) {
        await apiRequest(`/favourites/${imageId}`, { method: "DELETE" })
        setFavouriteIds((prev) => { const next = new Set(prev); next.delete(imageId); return next })
        setFavourites((prev) => prev.filter((f) => f.content_id !== imageId))
      } else {
        const doc = await apiRequest("/favourites", {
          method: "POST",
          body: JSON.stringify({ content_id: imageId, content_type: "image" }),
        })
        setFavouriteIds((prev) => new Set(prev).add(imageId))
        setFavourites((prev) => [...prev, doc])
      }
    } catch (error) {
      console.error("Toggle favourite failed:", error)
    }
  }

  // Group by project_id (fall back to image id)
  const generationGroups = React.useMemo(() => {
    const groups: Record<string, any[]> = {}
    for (const img of images) {
      const key = img.project_id || img.id
      if (!groups[key]) groups[key] = []
      groups[key].push(img)
    }

    // Sort groups: in-progress first, then newest first
    const generatingStatuses = ["in_progress", "processing", "started"]
    return Object.entries(groups).sort(([, a], [, b]) => {
      const aGenerating = a.some((i) => generatingStatuses.includes(i.status))
      const bGenerating = b.some((i) => generatingStatuses.includes(i.status))
      if (aGenerating && !bGenerating) return -1
      if (!aGenerating && bGenerating) return 1
      const aTime = Math.max(...a.map((i) => new Date(i.created_at || 0).getTime()))
      const bTime = Math.max(...b.map((i) => new Date(i.created_at || 0).getTime()))
      return bTime - aTime
    })
  }, [images])

  const handleDelete = async (id: string) => {
    try {
      const data = await apiRequest(`/images/${id}`, { method: "DELETE" })
      if (data.status === "success") {
        setImages((prev) => prev.filter((img) => img.id !== id))
      }
    } catch (error: any) {
      console.error("Delete error:", error)
    } finally {
      setIdToDelete(null)
    }
  }

  const handleDownload = async (url: string, id: string, prompt: string) => {
    try {
      const response = await fetch(url)
      const blob = await response.blob()
      const blobUrl = window.URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = blobUrl
      const safePrompt = (prompt || "creation").slice(0, 30).replace(/[^a-z0-9]/gi, "_").toLowerCase()
      link.download = `${safePrompt}_${id.slice(0, 5)}.png`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(blobUrl)
    } catch {
      window.open(url, "_blank")
    }
  }

  return (
    <div className="flex-1 min-w-0 h-full flex flex-col border">
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "creations" | "favourites")} className="flex flex-col flex-1 min-h-0">
        <div className="px-6 pt-5 pb-3 flex items-center justify-between">
          <TabsList className="w-auto inline-flex overflow-hidden border">
            <TabsTrigger value="creations" className="flex items-center gap-1.5 text-base px-4 data-[state=active]:bg-secondary">
              <IconLayoutGrid className="size-4" />
              {t("workspace.creations")}
            </TabsTrigger>
            <TabsTrigger value="favourites" className="flex items-center gap-1.5 text-base px-4 data-[state=active]:bg-secondary">
              <IconHeart className="size-4" />
              {t("workspace.favourites")}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="favourites" className="flex-1 overflow-y-auto px-6 mt-0">
          <FavouritesPanel
            loading={favouritesLoading}
            favourites={favourites}
            onPreview={setPreviewImage}
            onUnfavourite={handleToggleFavourite}
          />
        </TabsContent>

        <TabsContent value="creations" className="flex-1 overflow-y-auto px-6 mt-0">
          {loading ? (
            <div className="h-full flex items-center justify-center">
              <div className="pltt-animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : generationGroups.length === 0 ? (
            <div className="h-full flex items-center justify-center text-center">
              <div>
                <p className="text-2xl mb-2 font-semibold">{t("workspace.noImages")}</p>
                <p className="text-muted-foreground">{t("workspace.noImagesHint")}</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4 max-w-[1200px]">
              {generationGroups.map(([genId, groupImages]) => {
                const representative = groupImages[0]
                const prompt = representative?.prompt || t("workspace.untitled")
                const aspectRatio = representative?.params?.aspect_ratio || representative?.aspect_ratio
                const createdAt = representative?.created_at

                // Collect unique models across all images in this group
                const allModels = imageModelOptions
                const uniqueModels = Array.from(
                  new Map(
                    groupImages.map((img) => {
                      const info = allModels.find((m) => m.value === img.model_name)
                      return [img.model_name, { info, label: info?.label || img.model_name || "—" }]
                    })
                  ).values()
                )

                return (
                  <div key={genId} className="dark:bg-neutral-900 bg-neutral-100 p-4 shadow-md" >
                    {/* Group header */}
                    <div className="flex items-center gap-3 mb-2.5 min-w-0">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <p className="text-sm text-foreground/80 truncate">{prompt}</p>
                        <button
                          onClick={() => onEdit?.({ prompt, imageUrl: "" })}
                          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors border p-0.5 rounded-md px-1 bg-secondary"
                          title={t("workspace.reusePrompt")}
                        >
                          <IconRepeat className="size-3" />
                        </button>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {aspectRatio && (
                          <span className="text-xs font-medium text-muted-foreground bg-muted border p-0.5 rounded-md px-1 bg-secondary">
                            {aspectRatio}
                          </span>
                        )}
                        {uniqueModels.length === 1 ? (() => {
                          const SingleIcon = uniqueModels[0].info?.icon
                          return (
                            <span className="text-xs font-medium text-muted-foreground bg-background px-2 py-0.5 rounded flex items-center gap-1">
                              {SingleIcon && <span className="size-3 inline-flex"><SingleIcon /></span>}
                              {uniqueModels[0].label}
                            </span>
                          )
                        })() : (
                          <div className="flex items-center gap-1">
                            {uniqueModels.map(({ info, label }) => (
                              info?.icon && (
                                <span key={label} title={label} className="size-5 inline-flex p-1 border rounded-md p-0.5 bg-secondary">
                                  <info.icon />
                                </span>
                              )
                            ))}
                          </div>
                        )}
                        {createdAt && (
                          <span className="text-sm text-muted-foreground whitespace-nowrap">
                            {timeAgo(createdAt)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Images grid */}
                    <div
                      className="grid gap-2 grid-cols-3"
                    // style={{
                    //   gridTemplateColumns: `repeat(${Math.min(groupImages.length, 4)}, minmax(0, 1fr))`
                    // }}
                    >
                      {groupImages.map((image) => {
                        const Icon = allModels.find((m) => m.value === image.model_name)?.icon
                        const isFav = favouriteIds.has(image.id)
                        const actions = buildImageActions({
                          imageId: image.id,
                          imageUrl: image.url,
                          prompt: image.prompt,
                          isFav,
                          onToggleFavourite: handleToggleFavourite,
                          onEdit,
                          onDownload: handleDownload,
                          onDelete: (id) => setIdToDelete(id),
                          t,
                        })
                        return (
                          <div
                            key={image.id}
                            onClick={() => image.status === "completed" && setPreviewImage(image)}
                            className={cn(
                              "relative group overflow-hidden border border-border50 transition-all duration-300",
                              image.status === "completed"
                                ? "cursor-zoom-in hover:border-primary/50 hover:shadow-xl hover:shadow-primary/10"
                                : ""
                            )}
                          >
                            {image.status === "completed" ? (
                              <>
                                {/* Model badge */}
                                {Icon && (
                                  <div className="p-1 absolute top-2 left-2 z-10 bg-black/60 backdrop-blur-md flex items-center rounded-md border border-white/10">
                                    <div className="size-4"><Icon /></div>
                                  </div>
                                )}

                                {/* Action buttons */}
                                <div className="absolute top-2 right-2 z-20 flex flex-col gap-1.5 opacity-0 group-hover:opacity-100 transition-all duration-300 translate-x-2 group-hover:translate-x-0">
                                  {actions.map(({ icon, title, className, onClick }) => (
                                    <Button
                                      key={title}
                                      variant="ghost"
                                      size={"iconSm"}
                                      className={cn("rounded-lg bg-black/40 backdrop-blur-md border border-white/10", className)}
                                      title={title}
                                      onClick={onClick}
                                    >
                                      {icon}
                                    </Button>
                                  ))}
                                </div>

                                {/* Image */}
                                <img
                                  src={image.url}
                                  alt={image.prompt}
                                  className="w-full h-auto object-cover"
                                  loading="lazy"
                                />

                                {/* Hover overlay */}
                                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-3 pointer-events-none">
                                  {image.image_references?.length > 0 && (
                                    <div className="flex gap-1.5">
                                      {image.image_references.map((ref: string, i: number) => (
                                        <img key={i} src={ref} alt={`ref-${i}`} className="w-10 h-10 rounded object-cover" />
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </>
                            ) : image.status === "failed" ? (
                              <div className="h-48 flex flex-col items-center justify-center p-6 bg-destructive/5 text-center">
                                <div className="mb-2 p-2.5 rounded-full bg-destructive/10 text-destructive">
                                  <IconAlertTriangle className="size-5" />
                                </div>
                                <p className="font-medium text-destructive text-sm">{t("workspace.failedToGenerate")}</p>
                                <p className="text-xs text-muted-foreground mt-1">{image.error_message || t("workspace.unexpectedError")}</p>
                              </div>
                            ) : (
                              <div className="h-48 flex flex-col items-center justify-center p-4 bg-muted">
                                <div className="animate-pulse w-8 h-8 rounded-full bg-primary/20 mb-3 flex items-center justify-center">
                                  <span className="w-1.5 h-1.5 rounded-full bg-primary animate-ping" />
                                </div>
                                <p className="text-sm font-medium text-center truncate w-full px-2">{image.prompt || t("workspace.generating")}</p>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Lightbox */}
      {previewImage && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-lg animate-in fade-in duration-200"
          onClick={() => setPreviewImage(null)}
        >
          <Button
            className="absolute top-8 right-8 z-10"
            onClick={() => setPreviewImage(null)}
            variant="outline"
            size="icon"
          >
            <IconX className="size-5" />
          </Button>
          <div
            className="relative max-w-[90%] max-h-[85%] flex flex-col items-center gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={previewImage.url}
              alt={previewImage.prompt}
              className="max-w-full max-h-full object-contain rounded-xl shadow-2xl"
            />
            {previewImage.prompt && (
              <p className="text-white text-base text-center max-w-xl leading-relaxed px-4">
                {previewImage.prompt}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Delete dialog */}
      <AlertDialog open={!!idToDelete} onOpenChange={(open) => !open && setIdToDelete(null)}>
        <AlertDialogContent className="bg-background/95 backdrop-blur-xl border-border50 rounded-2xl shadow-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xl font-bold">{t("workspace.deleteCreation")}</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground pt-2">
              {t("workspace.deleteCreationDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-3 sm:gap-2">
            <AlertDialogCancel className="rounded-xl border-border50 hover:bg-accent/50 transition-colors">
              {t("common.keepIt")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="rounded-xl bg-destructive hover:bg-destructive/90 text-white shadow-lg shadow-destructive/20 transition-all active:scale-95"
              onClick={() => idToDelete && handleDelete(idToDelete)}
            >
              {t("common.deleteForever")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
