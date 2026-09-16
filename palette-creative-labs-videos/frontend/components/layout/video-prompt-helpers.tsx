import React from "react"
import { IconCameraSelfie, IconBulb } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface VideoPromptHelpersProps {
  isInspirationsOpen: boolean
  setIsInspirationsOpen: (open: boolean) => void
  isPresetsOpen: boolean
  setIsPresetsOpen: (open: boolean) => void
}

export const VideoPromptHelpers = ({
  isInspirationsOpen,
  setIsInspirationsOpen,
  isPresetsOpen,
  setIsPresetsOpen
}: VideoPromptHelpersProps) => {
  return (
    <div className="w-full px-4 pb-3 relative z-40">
      <div className="flex gap-2 w-full">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setIsPresetsOpen(!isPresetsOpen)
            if (isInspirationsOpen) setIsInspirationsOpen(false)
          }}
          className={cn(
            "w-[50%] text-sm font-normal transition-colors",
            isPresetsOpen && "bg-accent/10 border-primary/40"
          )}
        >
          <IconCameraSelfie className={cn("text-muted-foreground", isPresetsOpen && "text-primary")} />
          Presets
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setIsInspirationsOpen(!isInspirationsOpen)
            if (isPresetsOpen) setIsPresetsOpen(false)
          }}
          className={cn(
            "w-[50%] text-sm font-normal transition-colors",
            isInspirationsOpen && "bg-accent/10 border-primary/40"
          )}
        >
          <IconBulb className={cn("text-muted-foreground", isInspirationsOpen && "text-primary")} />
          Inspirations
        </Button>
      </div>
    </div>
  )
}
