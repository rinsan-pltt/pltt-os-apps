"use client"

import React from "react"
import { cn } from "@/lib/utils"
import { IconX } from "@tabler/icons-react"
import { useT } from "@/lib/i18n"
interface InspirationsPanelProps {
  categories: any[]
  onSelect: (categoryId: string, option: string) => void
  onClose: () => void
}

export const InspirationsPanel = ({ categories, onSelect, onClose }: InspirationsPanelProps) => {
  const { t } = useT()
  const panelRef = React.useRef<HTMLDivElement>(null)
  const [selections, setSelections] = React.useState<Record<string, string>>({})

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        onClose()
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [onClose])

  const toggleSelection = (categoryId: string, option: string) => {
    const isSelected = selections[categoryId] === option
    setSelections(prev => ({
      ...prev,
      [categoryId]: isSelected ? "" : option
    }))
    
    if (!isSelected) {
      onSelect(categoryId, option)
    }
  }

  return (
    <div 
      ref={panelRef}
      className="absolute left-full top-0 bottom-0 w-[400px] bg-card border-r border-border shadow z-50 animate-in fade-in slide-in-from-left-2 duration-200 flex flex-col overflow-hidden"
    >
      {/* Panel Header */}
      <div className=" px-5 py-3 border-b border-border flex items-center justify-between shrink-0">
        <h3 className="font-semibold text-lg">{t("panels.inspirations")}</h3>
        <button
          onClick={onClose}
          className=" hover:bg-accent/10 rounded-full transition-colors group"
        >
          <IconX className="size-5 text-muted-foreground group-hover:text-foreground transition-colors" />
        </button>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
        <div className="flex flex-col gap-8">
          {categories.map(category => (
            <div key={category.id} className="flex flex-col gap-3">
              <span className="text-sm font-semibold">{category.title}</span>
              <div className="flex flex-wrap gap-2">
                {category.options.map((option: string) => {
                  const isSelected = selections[category.id] === option;
                  return (
                    <button
                      key={option}
                      onClick={() => toggleSelection(category.id, option)}
                      className={cn(
                        "px-3 py-1.5 text-sm rounded-lg border transition-all duration-200 cursor-pointer",
                        isSelected
                          ? "border-primary text-primary border-primary"
                          : "bg-transparent text-foreground border-border hover:bg-accent/10 hover:border-border/80"
                      )}
                    >
                      {option}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
