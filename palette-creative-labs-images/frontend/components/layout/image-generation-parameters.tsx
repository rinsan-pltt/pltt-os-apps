"use client"

import React from "react"
import { IconMaximize, IconLayersIntersect, IconAspectRatio } from "@tabler/icons-react"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface ImageGenerationParametersProps {
  aspectRatio: string
  setAspectRatio: (val: string) => void
  resolution: string
  setResolution: (val: string) => void
  numOutputs: string
  setNumOutputs: (val: string) => void
}

export const ImageGenerationParameters = ({
  aspectRatio,
  setAspectRatio,
  resolution,
  setResolution,
  numOutputs,
  setNumOutputs
}: ImageGenerationParametersProps) => {
  return (
    <div className="w-full mb-4 flex items-center justify-between shrink-0">
      <div className="flex gap-2 flex-wrap">
        <Select value={aspectRatio} onValueChange={setAspectRatio}>
          <SelectTrigger className="w-auto h-8 bg-background/50 border-border50 rounded-lg shadow-none focus:ring-0 px-2.5 gap-2 text-xs">
            <IconAspectRatio className="size-3 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Aspect Ratio</SelectLabel>
              <SelectItem value="1:1">1:1</SelectItem>
              <SelectItem value="16:9">16:9</SelectItem>
              <SelectItem value="9:16">9:16</SelectItem>
              <SelectItem value="4:3">4:3</SelectItem>
              <SelectItem value="3:4">3:4</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>

        <Select value={resolution} onValueChange={setResolution}>
          <SelectTrigger className="w-auto h-8 bg-background/50 border-border50 rounded-lg shadow-none focus:ring-0 px-2.5 gap-2 text-xs">
            <IconMaximize className="size-3 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Resolution</SelectLabel>
              <SelectItem value="auto">Auto</SelectItem>
              <SelectItem value="1k">1k</SelectItem>
              <SelectItem value="2k">2k</SelectItem>
              <SelectItem value="4k">4k</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>

        <Select value={numOutputs} onValueChange={setNumOutputs}>
          <SelectTrigger className="w-auto h-8 bg-background/50 border-border50 rounded-lg shadow-none focus:ring-0 px-2.5 gap-2 text-xs">
            <IconLayersIntersect className="size-3 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Outputs</SelectLabel>
              <SelectItem value="1">1</SelectItem>
              <SelectItem value="2">2</SelectItem>
              <SelectItem value="3">3</SelectItem>
              <SelectItem value="4">4</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
