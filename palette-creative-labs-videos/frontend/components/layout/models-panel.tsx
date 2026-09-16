"use client"

import React from "react"
import { IconCheck, IconCheckFilled, IconX } from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { useT } from "@/lib/i18n"

interface ModelsPanelProps {
  options: any[] // We can refine this type if needed
  selectedModels: string[]
  setSelectedModels: React.Dispatch<React.SetStateAction<string[]>>
  onClose: () => void
}

export const ModelsPanel = ({ options, selectedModels, setSelectedModels, onClose }: ModelsPanelProps) => {
  const { t } = useT()
  const panelRef = React.useRef<HTMLDivElement>(null)
  //const [isMultiModel, setIsMultiModel] = React.useState(selectedModels.length > 1)
  const [isMultiModel, setIsMultiModel] = React.useState(true)

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        onClose()
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [onClose])

  const toggleMultiModel = (enabled: boolean) => {
    setIsMultiModel(enabled)
    if (!enabled && selectedModels.length > 1) {
      // Fallback to auto if turning off multi-model
      setSelectedModels(["auto"])
    }
  }


  return (
    <div
      ref={panelRef}
      className="absolute left-full top-0 bottom-0 w-[400px] bg-card border-r border-border shadow z-50 animate-in fade-in slide-in-from-left-2 duration-200 flex flex-col overflow-hidden"
    >
      {/* Panel Header */}
      <div className="px-5 py-3 border-b border-border flex items-center justify-between shrink-0">
        <h3 className="font-semibold text-lg">{t("panels.modelLibrary")}</h3>
        <button
          onClick={onClose}
          className="hover:bg-accent/10 rounded-full transition-colors group"
        >
          <IconX className="size-5 text-muted-foreground group-hover:text-foreground transition-colors" />
        </button>
      </div>

      {/* Multi-model Switch */}
      {/* <div className="px-5 py-4 border-b border-border bg-accent/5 flex items-center justify-between">
        <div className="space-y-0.5">
          <Label htmlFor="multi-model" className=" font-medium">Multi Model Generation</Label>
          <p className="text-xs text-muted-foreground">Generate variations using multiple models at once.</p>
        </div>
        <Switch
          id="multi-model"
          checked={isMultiModel}
          onCheckedChange={toggleMultiModel}
        />
      </div> */}

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
        <div className="flex flex-col gap-2">
          {options.map((option) => {
            const isSelected = selectedModels.includes(option.value)
            return (
              <div
                key={option.value}
                onClick={() => {
                  if (isMultiModel) {
                    if (isSelected) {
                      if (selectedModels.length > 1) {
                        setSelectedModels(prev => prev.filter(m => m !== option.value))
                      }
                    } else {
                      if (option.value === "auto") {
                        // Selecting auto in multi-mode: clear others
                        setSelectedModels(["auto"])
                      } else {
                        // Selecting a specific model: remove auto if it exists
                        setSelectedModels(prev => {
                          const filtered = prev.filter(m => m !== "auto")
                          return [...filtered, option.value]
                        })
                      }
                    }
                  } else {
                    // Single model mode
                    setSelectedModels([option.value])
                  }
                }}

                className={cn(
                  "flex items-center border border-transparent gap-4 p-1.5 rounded-lg transition-all duration-200 cursor-pointer bg-primary/5 hover:border-primary/50 relative",
                  isSelected
                    ? " border-primary/40"
                    : ""
                )}
              >
                <div className={cn(
                  "size-11 p-1.5 rounded-lg bg-primary/5 flex items-center justify-center shrink-0 transition-all duration-300",
                )}>
                  {option.icon && <option.icon />}
                </div>

                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-sm font-medium truncate">
                    {option.label}
                  </span>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {option.options?.map((opt: any) => (
                      <span
                        key={opt}
                        className="text-xs bg-primary/5 text-muted-foreground font-medium px-1.5 py-0.5 rounded-md"
                      >
                        {opt}
                      </span>
                    ))}
                  </div>

                </div>

                {isSelected && (
                  <IconCheckFilled className="size-4 absolute right-4 text-primary" />
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

