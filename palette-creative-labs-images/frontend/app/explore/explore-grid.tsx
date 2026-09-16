import React from "react"
import { cn } from "@/lib/utils"
import { favId } from "./utils"
import { type Favourite, type GridMode } from "./types"

interface Props {
  items: Favourite[]
  grid: GridMode
  compareMode: boolean
  selected: string[]
  onToggle: (id: string) => void
  onOpen: (fav: Favourite) => void
}

function useColumnCount(grid: GridMode): number {
  const getCount = React.useCallback(() => {
    if (grid !== "random") return grid as number
    if (typeof window === "undefined") return 4
    const w = window.innerWidth
    if (w >= 1280) return 5
    if (w >= 1024) return 4
    if (w >= 640) return 3
    return 2
  }, [grid])

  const [count, setCount] = React.useState(getCount)

  React.useEffect(() => {
    setCount(getCount())
    const update = () => setCount(getCount())
    window.addEventListener("resize", update)
    return () => window.removeEventListener("resize", update)
  }, [getCount])

  return count
}

export function ExploreGrid({ items, grid, compareMode, selected, onToggle, onOpen }: Props) {
  const numCols = useColumnCount(grid)

  const columns = React.useMemo(() => {
    const cols: Favourite[][] = Array.from({ length: numCols }, () => [])
    const fullRows = Math.floor(items.length / numCols)
    const remainder = items.length % numCols
    let idx = 0

    // Complete rows fill left to right
    for (let row = 0; row < fullRows; row++) {
      for (let col = 0; col < numCols; col++) {
        cols[col].push(items[idx++])
      }
    }

    // Leftover items fill the leftmost columns so the last row reads left to
    // right (empty space stays on the right).
    for (let col = 0; col < remainder; col++) {
      cols[col].push(items[idx++])
    }

    return cols
  }, [items, numCols])

  return (
    <div className="flex gap-3 items-start">
      {columns.map((col, ci) => (
        <div key={ci} className="flex-1 flex flex-col gap-3">
          {col.map((fav) => {
            const id = favId(fav)
            const selIndex = id ? selected.indexOf(id) : -1
            const isSelected = selIndex !== -1
            return (
              <div
                key={id || fav.url}
                onClick={() => {
                  if (compareMode) {
                    if (id) onToggle(id)
                  } else {
                    onOpen(fav)
                  }
                }}
                className={cn(
                  "relative overflow-hidden border border-border40 group cursor-pointer",
                  isSelected && "ring-1 ring-foreground"
                )}
              >
                <img
                  src={fav.url}
                  alt={fav.prompt || ""}
                  loading="lazy"
                  className="w-full h-auto block"
                />
                {compareMode && (
                  <span
                    className={cn(
                      "absolute top-2 left-2 size-6 rounded-full flex items-center justify-center text-[10px] font-bold tracking-wide",
                      isSelected
                        ? "bg-foreground text-background"
                        : "border-2 border-dashed border-white/70 bg-black/30"
                    )}
                  >
                    {isSelected ? selIndex + 1 : ""}
                  </span>
                )}
                {fav.group && (
                  <span
                    className="absolute top-2 right-2 size-3 rounded-full ring-2 ring-black/40"
                    style={{ backgroundColor: fav.group }}
                  />
                )}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
