"use client"

import { cn } from "@/lib/utils"

type ModelOption = {
  label: string
  value: string
  version?: string
  color?: string
  icon?: React.ElementType
}

type Props = {
  models: ModelOption[]
  selected: string[]
  onToggle: (value: string) => void
  // When true, tabs keep their natural width and the row grows past the
  // container (min-w-full fills it when there's room) so a parent with
  // overflow-x-auto can scroll. Default keeps the original shrink-to-fit
  // behaviour so other consumers (e.g. the video panel) are unaffected.
  scrollable?: boolean
}

export const ModelTabsHeader = ({ models, selected, onToggle, scrollable = false }: Props) => (
  <div className={cn("flex shrink-0", scrollable && "min-w-full w-max")}>
    {models.map((model) => {
      const isSelected = selected.includes(model.value)
      return (
        <button
          key={model.value}
          onClick={() => onToggle(model.value)}
          style={isSelected && model.color ? { borderBottomColor: model.color } : undefined}
          className={cn(
            "flex-1 flex flex-col items-start px-3 py-2.5 text-left transition-colors border-b-2 -mb-px",
            "border-r border-r-border40 last:border-r-0",
            scrollable ? "whitespace-nowrap" : "min-w-0",
            isSelected
              ? "bg-secondary border-b-current"
              : "border-b-transparent hover:bg-secondary/50"
          )}
        >
          <span className={cn("text-xs font-bold tracking-widest uppercase text-foreground", scrollable ? "whitespace-nowrap" : "truncate")}>{model.label}</span>
          {model.version && (
            <span className={cn("text-xs text-muted-foreground mt-0.5 tracking-wider uppercase", scrollable ? "whitespace-nowrap" : "truncate")}>{model.version}</span>
          )}
        </button>
      )
    })}
  </div>
)
