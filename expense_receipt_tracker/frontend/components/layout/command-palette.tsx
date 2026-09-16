"use client"

import * as React from "react"
import { Search } from "lucide-react"

import { Dialog } from "@/components/ui/dialog"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export interface CommandAction {
  id: string
  label: string
  group: string
  /** Extra words to match on, so "mark paid" can find "Reimbursed". */
  keywords?: string
  run: () => void
}

/**
 * Built on the existing Dialog, which already provides the focus trap, Escape,
 * scroll lock and focus restore — so this adds no new modal machinery.
 *
 * The listbox follows the combobox pattern: DOM focus never leaves the input,
 * and the highlighted option is communicated with `aria-activedescendant`.
 */
export function CommandPalette({
  open,
  onOpenChange,
  actions,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  actions: CommandAction[]
}) {
  const t = useT()
  const [query, setQuery] = React.useState("")
  const [active, setActive] = React.useState(0)
  const listId = React.useId()
  const optionId = (i: number) => `${listId}-opt-${i}`

  React.useEffect(() => {
    if (open) {
      setQuery("")
      setActive(0)
    }
  }, [open])

  const matches = React.useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return actions
    return actions.filter((a) =>
      `${a.label} ${a.group} ${a.keywords ?? ""}`.toLowerCase().includes(needle),
    )
  }, [actions, query])

  React.useEffect(() => {
    setActive((prev) => Math.min(prev, Math.max(0, matches.length - 1)))
  }, [matches.length])

  const commit = (index: number) => {
    const action = matches[index]
    if (!action) return
    onOpenChange(false)
    action.run()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActive((i) => (i + 1) % Math.max(1, matches.length))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActive((i) => (i - 1 + matches.length) % Math.max(1, matches.length))
    } else if (e.key === "Enter") {
      e.preventDefault()
      commit(active)
    }
  }

  // Group headings, preserving the order actions were supplied in.
  const groups: { name: string; items: { action: CommandAction; index: number }[] }[] = []
  matches.forEach((action, index) => {
    const bucket = groups.find((g) => g.name === action.group)
    if (bucket) bucket.items.push({ action, index })
    else groups.push({ name: action.group, items: [{ action, index }] })
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("command.title")} wide>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <input
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={matches.length ? optionId(active) : undefined}
          aria-autocomplete="list"
          aria-label={t("command.placeholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t("command.placeholder")}
          className="h-11 w-full rounded-lg border border-input bg-card pl-9 pr-3 text-body-lg text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-body"
        />
      </div>

      <ul
        id={listId}
        role="listbox"
        aria-label={t("command.resultsAria")}
        className="mt-3 max-h-80 overflow-y-auto"
      >
        {groups.map((group) => (
          <li key={group.name}>
            <p className="px-2 pb-1 pt-3 text-overline uppercase text-muted-foreground">
              {group.name}
            </p>
            <ul>
              {group.items.map(({ action, index }) => (
                <li
                  key={action.id}
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === active}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => commit(index)}
                  className={cn(
                    "cursor-pointer rounded-lg px-2 py-2 text-body transition-colors duration-[var(--erx-dur-instant)]",
                    index === active ? "bg-accent text-accent-foreground" : "text-foreground",
                  )}
                >
                  {action.label}
                </li>
              ))}
            </ul>
          </li>
        ))}
        {matches.length === 0 && (
          <li className="px-2 py-6 text-center text-body text-muted-foreground">
            {t("command.noResults")}
          </li>
        )}
      </ul>

      <p aria-live="polite" className="sr-only">
        {t("command.resultCount", { count: matches.length })}
      </p>
    </Dialog>
  )
}
