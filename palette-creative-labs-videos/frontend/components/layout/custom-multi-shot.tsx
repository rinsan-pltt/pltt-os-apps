"use client"

import React from "react"
import { IconTrash } from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface Shot {
  id: number
  prompt: string
  duration: string
}

interface CustomMultiShotProps {
  shots: Shot[]
  setShots: (shots: Shot[]) => void
  // Total video duration (seconds) the scenes must add up to — Kling splits this
  // total across the multi-prompt scenes (e.g. 15s → 5s+5s+5s or 3s+3s+4s+5s).
  totalDuration: number
}

const secs = (d: string) => parseInt(d, 10) || 0

export const CustomMultiShot = ({ shots, setShots, totalDuration }: CustomMultiShotProps) => {
  const used = shots.reduce((sum, s) => sum + secs(s.duration), 0)
  const remaining = totalDuration - used
  const balanced = used === totalDuration

  const addShot = () => {
    if (remaining <= 0) return
    const next = Math.min(remaining, totalDuration)
    setShots([...shots, { id: shots.length + 1, prompt: "", duration: `${next}s` }])
  }

  const updateShot = (index: number, field: keyof Shot, value: string) => {
    const newShots = [...shots]
    newShots[index] = { ...newShots[index], [field]: value } as Shot
    setShots(newShots)
  }

  const deleteShot = (index: number) => {
    if (shots.length > 1) {
      const newShots = shots
        .filter((_, i) => i !== index)
        .map((shot, i) => ({ ...shot, id: i + 1 }))
      setShots(newShots)
    }
  }

  return (
    <div className="flex flex-col min-h-0">
      {/* Scene budget header. */}
      <div className="flex items-center justify-between text-xs shrink-0 px-4 py-2 border-b border-border60 bg-background/60">
        <span className="uppercase tracking-widest text-muted-foreground">Scenes</span>
        <span
          className={cn(
            "font-semibold tabular-nums",
            balanced ? "text-primary" : used > totalDuration ? "text-destructive" : "text-muted-foreground",
          )}
          title="Sum of scene durations vs total"
        >
          {used}s / {totalDuration}s
        </span>
      </div>

      {/* Scene list — flows into the panel's single outer scroll (no nested scrollbar). */}
      <div className="px-4 py-2 flex flex-col gap-3">
      {shots.map((shot, index) => {
        // Cap this scene's options at what the other scenes leave available,
        // so no combination of picks can ever push the total over budget.
        const otherUsed = used - secs(shot.duration)
        const maxForShot = Math.max(totalDuration - otherUsed, secs(shot.duration))
        const durationOptions = Array.from({ length: maxForShot }, (_, i) => `${i + 1}s`)
        return (
        <div key={shot.id} className="relative rounded-xl border border-border overflow-hidden shrink-0 focus-within:border-primary/60 transition-colors">
          <div className="w-full flex items-center gap-2 px-4 py-2 border-b bg-muted/60">
            <span className="text-sm text-muted-foreground">Scene {shot.id}</span>
            <Select
              value={shot.duration}
              onValueChange={(val) => updateShot(index, "duration", val)}
            >
              <SelectTrigger className="w-auto h-7 gap-2 text-xs rounded-md shadow-none transition-colors">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {durationOptions.map((d) => (
                  <SelectItem key={d} value={d}>{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {shots.length > 1 && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => deleteShot(index)}
                className="ml-auto size-7 text-muted-foreground transition-colors"
              >
                <IconTrash className="size-4" />
              </Button>
            )}
          </div>
          <textarea
            value={shot.prompt}
            onChange={(e) => updateShot(index, "prompt", e.target.value)}
            className="w-full min-h-[120px] border-none resize-none p-4 text-base font-light placeholder:text-muted-foreground focus:ring-0 outline-none leading-relaxed"
            placeholder={`Describe scene ${shot.id}...`}
          />
        </div>
        )
      })}

      {remaining > 0 && (
        <Button
          variant="outline"
          size={"sm"}
          className="w-full text-sm font-normal shrink-0"
          onClick={addShot}
        >
          <span className="text-xl text-muted-foreground">+</span>
          <span>Add scene ({remaining}s left)</span>
        </Button>
      )}
      </div>
    </div>
  )
}
