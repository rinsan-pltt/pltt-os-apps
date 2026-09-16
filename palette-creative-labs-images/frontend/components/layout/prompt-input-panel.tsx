"use client"

import React from "react"
import { IconPhotoPlus, IconX } from "@tabler/icons-react"
import { useT } from "@/lib/i18n"

// A reference item is either:
// - a URL string (from Edit button or direct URL)
// - an AssetRef (from Assets panel — carries ID for backend + preview URL for UI)
// - a File (local upload pending GCS)
export interface AssetRef {
  assetId: string
  previewUrl: string
}

export type ReferenceItem = string | AssetRef | File

interface PromptInputPanelProps {
  prompt: string
  setPrompt: React.Dispatch<React.SetStateAction<string>>
  referenceItems: ReferenceItem[]
  setReferenceItems: React.Dispatch<React.SetStateAction<ReferenceItem[]>>
  isReferenceDisabled: boolean
}

export const PromptInputPanel = ({
  prompt,
  setPrompt,
  referenceItems,
  setReferenceItems,
  isReferenceDisabled,
}: PromptInputPanelProps) => {
  const { t } = useT()
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  // Generate preview URL for any item
  const getPreviewUrl = (item: ReferenceItem): string => {
    if (typeof item === "string") return item
    if (item instanceof File) return URL.createObjectURL(item)
    return item.previewUrl  // AssetRef
  }

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    const remaining = 5 - referenceItems.length
    const toAdd = Array.from(files).slice(0, remaining)
    setReferenceItems(prev => [...prev, ...toAdd].slice(0, 5))
    // Reset input so same file can be re-selected
    e.target.value = ""
  }

  const removeItem = (index: number) => {
    setReferenceItems(prev => prev.filter((_, i) => i !== index))
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 relative overflow-hidden">
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept="image/*"
        multiple
        onChange={handleImageSelect}
      />
      <div className="grid grid-cols-3 gap-2 mb-4">
        {referenceItems.map((item, idx) => {
          const preview = getPreviewUrl(item)
          const isFile = item instanceof File
          return (
            <div key={idx} className="relative group/img aspect-square rounded-lg overflow-hidden border bg-muted/50">
              <img src={preview} className="w-full h-full object-cover" alt={`Ref ${idx}`} />
              <button
                onClick={() => removeItem(idx)}
                className="absolute cursor-pointer top-1 right-1 size-5 bg-black/60 rounded-full flex items-center justify-center text-white opacity-0 group-hover/img:opacity-100 transition-opacity"
              >
                <IconX className="size-3" />
              </button>
            </div>
          )
        })}

        {referenceItems.length < 5 && (
          <button
            onClick={() => !isReferenceDisabled && fileInputRef.current?.click()}
            disabled={isReferenceDisabled}
            className={`text-muted-foreground bg-muted/50 aspect-square rounded-lg border border-dashed flex flex-col items-center justify-center gap-1 transition-all ${isReferenceDisabled
                ? "opacity-70 cursor-not-allowed"
                : "hover:border-primary/50 cursor-pointer"
              }`}
          >
            <IconPhotoPlus className="size-6" />
            <span className="text-sm font-medium">{t("prompt.add")}</span>
          </button>
        )}
      </div>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        className="flex-1 p-4 w-full bg-transparent border-none resize-none text-xl font-light placeholder:text-muted-foreground focus:ring-0 outline-none leading-relaxed"
        placeholder={t("prompt.placeholder")}
      />
    </div>
  )
}
