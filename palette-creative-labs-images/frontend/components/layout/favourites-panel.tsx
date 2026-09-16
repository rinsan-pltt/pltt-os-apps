"use client"

import React from "react"
import { IconHeartFilled } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { imageModelOptions } from "./video-helper"
import { useT } from "@/lib/i18n"

const allModels = imageModelOptions

type Props = {
  loading: boolean
  favourites: any[]
  onPreview: (item: any) => void
  onUnfavourite: (id: string) => void
}

export const FavouritesPanel = ({ loading, favourites, onPreview, onUnfavourite }: Props) => {
  const { t } = useT()
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="pltt-animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  if (favourites.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-center">
        <div>
          <p className="text-2xl mb-2 font-semibold">{t("panels.noFavourites")}</p>
          <p className="text-muted-foreground">{t("panels.noFavouritesHint")}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-2 max-w-[1200px] pb-4">
      {favourites.map((fav) => {
        const modelInfo = allModels.find((m) => m.value === fav.model_name)
        const Icon = modelInfo?.icon
        return (
          <div
            key={fav.content_id}
            onClick={() => onPreview(fav)}
            className="relative group break-inside-avoid mb-2 rounded-lg overflow-hidden border border-border50 cursor-zoom-in hover:border-primary/50 hover:shadow-xl hover:shadow-primary/10 transition-all duration-300"
          >
            {Icon && (
              <div className="p-1 absolute top-2 left-2 z-10 bg-black/60 backdrop-blur-md flex items-center rounded-md border border-white/10">
                <div className="size-4"><Icon /></div>
              </div>
            )}
            <div className="absolute top-2 right-2 z-20 opacity-0 group-hover:opacity-100 transition-all duration-300 translate-x-2 group-hover:translate-x-0">
              <Button
                variant="ghost" size="icon"
                className="size-9 rounded-lg bg-black/40 backdrop-blur-md border border-white/10 text-red-400 hover:bg-primary hover:text-white"
                title={t("panels.unfavourite")}
                onClick={(e) => { e.stopPropagation(); onUnfavourite(fav.content_id) }}
              >
                <IconHeartFilled className="size-4" />
              </Button>
            </div>
            <img
              src={fav.url}
              alt={fav.prompt}
              className="w-full h-auto block"
              loading="lazy"
            />
          </div>
        )
      })}
    </div>
  )
}
