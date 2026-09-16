"use client"

import React from "react"
import { IconMaximize, IconSparkles, IconClock, IconVolume, IconVolume3, IconLock } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface VideoGenerationParametersProps {
  aspectRatio: string
  setAspectRatio: (v: string) => void
  availableAspectRatios: string[]
  // Locked while a start frame is attached — the ratio follows the image.
  aspectLocked?: boolean
  resolution: string
  setResolution: (v: string) => void
  availableResolutions: string[]
  duration: string
  setDuration: (v: string) => void
  availableDurations: string[]
  audioEnabled: boolean
  setAudioEnabled: (v: boolean) => void
}

export const VideoGenerationParameters = ({
  aspectRatio,
  setAspectRatio,
  availableAspectRatios,
  aspectLocked = false,
  resolution,
  setResolution,
  availableResolutions,
  duration,
  setDuration,
  availableDurations,
  audioEnabled,
  setAudioEnabled,
}: VideoGenerationParametersProps) => {
  const { t } = useT()

  return (
    <div className="w-full mb-4 flex items-center justify-between gap-2 shrink-0">
      <div className="flex gap-2 items-center flex-nowrap min-w-0">
        {/* Locked (start frame attached): the value can't be changed through
            ANY path — trigger disabled, items disabled, and the change
            handler itself ignores input. */}
        <Select
          value={aspectRatio}
          onValueChange={(v) => {
            if (!aspectLocked) setAspectRatio(v)
          }}
          disabled={aspectLocked}
        >
          <SelectTrigger
            style={{ width: 90 }}
            title={aspectLocked ? t("video.aspectLockedHint") : undefined}
            className="h-8 shrink-0 bg-background/50 border-border50 rounded-lg shadow-none focus:ring-0 px-2 gap-1.5 text-xs disabled:opacity-80 disabled:cursor-not-allowed"
          >
            {aspectLocked ? (
              <IconLock className="size-3 text-muted-foreground shrink-0" />
            ) : (
              <IconMaximize className="size-3 text-muted-foreground shrink-0" />
            )}
            <SelectValue />
          </SelectTrigger>
          <SelectContent side="top" sideOffset={6}>
            <SelectGroup>
              <SelectLabel>{t("video.aspectRatio")}</SelectLabel>
              {availableAspectRatios.map((a) => (
                <SelectItem key={a} value={a} disabled={aspectLocked && a !== aspectRatio}>
                  {a}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>

        <Select value={resolution} onValueChange={setResolution}>
          <SelectTrigger style={{ width: 98 }} className="h-8 shrink-0 bg-background/50 border-border50 rounded-lg shadow-none focus:ring-0 px-2 gap-1.5 text-xs">
            <IconSparkles className="size-3 text-muted-foreground shrink-0" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent side="top" sideOffset={6}>
            <SelectGroup>
              <SelectLabel>{t("video.resolution")}</SelectLabel>
              {availableResolutions.map((r) => (
                <SelectItem key={r} value={r}>{r}</SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>

        <Select value={duration} onValueChange={setDuration}>
          <SelectTrigger style={{ width: 84 }} className="h-8 shrink-0 bg-background/50 border-border50 rounded-lg shadow-none focus:ring-0 px-2 gap-1.5 text-xs">
            <IconClock className="size-3 text-muted-foreground shrink-0" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent side="top" sideOffset={6}>
            <SelectGroup>
              <SelectLabel>{t("video.duration")}</SelectLabel>
              {availableDurations.map((d) => (
                <SelectItem key={d} value={d}>{d}</SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      {/* Audio toggle — right-justified so its right edge lines up with the
          Generate button and the prompt box (all sit at the panel gutter). */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => setAudioEnabled(!audioEnabled)}
        // Fixed width via inline style (not a Tailwind class) so it holds even
        // with the app's precompiled CSS — toggling On/Off no longer changes
        // the cell width. Left-aligned so the icon stays put.
        style={{ width: 68 }}
        className={cn(
          // Match the Select triggers: same height, padding and text size. The
          // `sm` button size ships a tall `py-5`, so override it (py-0) to h-8.
          "h-8 py-0 justify-start rounded-lg border-border50 shadow-none px-2.5 gap-2 text-xs transition-colors shrink-0",
        )}
      >
        {audioEnabled ? <IconVolume className="size-3" /> : <IconVolume3 className="size-3" />}
        {audioEnabled ? t("video.on") : t("video.off")}
      </Button>
    </div>
  )
}
