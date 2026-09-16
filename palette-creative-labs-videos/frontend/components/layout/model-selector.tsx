import { IconChevronRight } from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import React from "react"

interface ModelSelectorProps {
  options: any[]
  selectedModels: string[]
  setSelectedModels: React.Dispatch<React.SetStateAction<string[]>>
  isModelsOpen: boolean
  setIsModelsOpen: (open: boolean) => void
}

export const ModelSelector = ({
  options,
  selectedModels,
  setSelectedModels,
  isModelsOpen,
  setIsModelsOpen
}: ModelSelectorProps) => {
  const primaryModel = options.find(m => m.value === selectedModels[0])

  return (
    <div className="p-4 border-b border-border50 shrink-0 bg-background relative z-50">
      <div className="relative w-full">
        {/* Trigger Card */}
        <div
          onClick={() => setIsModelsOpen(!isModelsOpen)}
          className={cn(
            "flex items-center justify-between p-2 rounded-2xl border transition-all duration-300 group cursor-pointer hover:bg-accent/5 bg-accent/5",
            isModelsOpen ? "border-primary/60 bg-accent/10 shadow-sm" : "border-border"
          )}
        >
          <div className="flex items-center gap-4 flex-1 min-w-0">
            <div className={cn(
              "size-10 p-1 rounded-xl bg-secondary flex items-center justify-center shrink-0 transition-all duration-300",
            )}>
              {primaryModel?.icon && <primaryModel.icon />}
            </div>

            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-sm font-medium truncate text-foreground flex items-center gap-2">
                <span className="truncate">
                  {selectedModels.slice(0, 2).map(m => options.find(o => o.value === m)?.label).join(", ")}
                </span>
                {selectedModels.length > 2 && (
                  <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded-md font-bold shrink-0">
                    +{selectedModels.length - 2}
                  </span>
                )}
              </span>
              <span className="text-xs text-muted-foreground truncate">
                {selectedModels.length > 1 ? `${selectedModels.length} Models Selected` : primaryModel?.description}
              </span>
            </div>
          </div>

          <IconChevronRight className={cn(
            "size-4 text-muted-foreground transition-transform duration-200 mr-2 shrink-0",
          )} />
        </div>
      </div>
    </div>
  )
}
