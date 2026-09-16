"use client"

import * as React from "react"
import { IconCheck, IconSelector, IconX, IconSearch } from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"

export interface Option {
  label: string
  value: string
  [key: string]: any
}

interface MultiSelectProps {
  options: Option[]
  selected: string[]
  onChange: (values: string[]) => void
  placeholder?: string
  className?: string
  trigger?: React.ReactNode
  renderOption?: (option: Option) => React.ReactNode
}

export function MultiSelect({
  options,
  selected,
  onChange,
  placeholder = "Select items...",
  className,
  trigger,
  renderOption,
}: MultiSelectProps) {
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState("")
  const [dropUp, setDropUp] = React.useState(false)
  const containerRef = React.useRef<HTMLDivElement>(null)

  const handleOpen = () => {
    if (!open && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom
      setDropUp(spaceBelow < 300) // 300px is roughly the max height of the dropdown
    }
    setOpen(!open)
  }

  const handleUnselect = (value: string) => {
    onChange(selected.filter((s) => s !== value))
  }

  const handleSelect = (value: string) => {
    if (selected.includes(value)) {
      handleUnselect(value)
    } else {
      onChange([...selected, value])
    }
  }

  const filteredOptions = options.filter((option) =>
    option.label.toLowerCase().includes(search.toLowerCase())
  )

  // Close on click outside
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  return (
    <div ref={containerRef} className={cn("relative", trigger ? "w-fit" : "w-full", className)}>
      <div onClick={handleOpen} className={cn(trigger ? "w-fit" : "w-full")}>
        {trigger || (
          <div
            className={cn(
              "flex min-h-10 w-full items-center justify-between rounded-lg border border-border bg-accent/20 p-2 hover:bg-accent/30 transition-colors cursor-pointer",
              open && "ring-1 ring-primary/50 border-primary/50"
            )}
          >
            <div className="flex flex-wrap gap-1">
              {selected.length === 0 && (
                <span className="text-sm text-muted-foreground ml-1">{placeholder}</span>
              )}
              {selected.map((value) => {
                const option = options.find((o) => o.value === value)
                return (
                  <Badge
                    key={value}
                    variant="secondary"
                    className="flex items-center gap-1 rounded-md px-1.5 py-0.5 bg-background border-border text-sm font-normal"
                  >
                    {option?.label}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleUnselect(value)
                      }}
                      className="rounded-full hover:bg-accent p-0.5"
                    >
                      <IconX className="size-2.5" />
                    </button>
                  </Badge>
                )
              })}
            </div>
            <IconSelector className="size-4 text-muted-foreground shrink-0 opacity-50" />
          </div>
        )}
      </div>

      {open && (
        <div className={cn(
          "absolute z-50 rounded-xl border border-border bg-card shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in duration-200",
          trigger ? "w-[320px] right-0" : "w-full left-0",
          dropUp ? "bottom-full mb-2" : "top-full mt-2"
        )}>
          <div className="flex items-center border-b border-border p-3">
            <IconSearch className="mr-2 size-4 text-muted-foreground opacity-50" />
            <input
              autoFocus
              className="flex h-6 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
              placeholder="Search models..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="max-h-[300px] overflow-y-auto overflow-x-hidden p-1 custom-scrollbar">
            {filteredOptions.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                No results found.
              </div>
            ) : (
              filteredOptions.map((option) => (
                <div
                  key={option.value}
                  onClick={() => handleSelect(option.value)}
                  className={cn(
                    "flex w-full cursor-pointer items-center rounded-lg px-2 py-1.5 hover:bg-accent transition-colors mb-0.5",
                    selected.includes(option.value) && "bg-accent/50"
                  )}
                >
                  <div className="flex-1 overflow-hidden">
                    {renderOption ? (
                      renderOption(option)
                    ) : (
                      <span className="text-sm font-medium">{option.label}</span>
                    )}
                  </div>
                  {selected.includes(option.value) && (
                    <div className="ml-2 flex items-center justify-center size-5 bg-primary rounded-full shrink-0">
                       <IconCheck className="size-3 text-primary-foreground" />
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
