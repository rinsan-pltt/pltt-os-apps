"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { CommandPalette, type CommandAction } from "@/components/layout/command-palette"
import { useHotkeys } from "@/hooks/use-hotkeys"
import { useT } from "@/lib/i18n"

/**
 * The command palette, app-wide.
 *
 * It used to be mounted by the dashboard alone, so ⌘K and the toolbar's
 * commands button existed on exactly one route. Owning it here means the
 * shortcut and the button work from every page, which is the only way the
 * button is worth showing on every page.
 *
 * Navigation actions are supplied here — the provider knows the routes. A page
 * with an action of its own (the dashboard's "Add expense" opens a dialog that
 * only the dashboard holds) registers it with `useRegisterCommands` while it
 * is mounted, and it disappears from the palette when the page unmounts.
 */

interface CommandsContextValue {
  open: () => void
  /** Register page-scoped actions for as long as the caller is mounted. */
  register: (id: string, actions: CommandAction[]) => () => void
}

const CommandsContext = React.createContext<CommandsContextValue | null>(null)

/** No-op fallback, for the same reason `useToast` has one: the Palette router
 *  renders not-found.tsx outside the root layout, so it has no providers, and a
 *  missing provider must never take a page down. */
const NO_COMMANDS: CommandsContextValue = { open: () => {}, register: () => () => {} }

export function useCommands(): CommandsContextValue {
  return React.useContext(CommandsContext) ?? NO_COMMANDS
}

/**
 * Add actions to the palette while this component is mounted.
 *
 * Memoise `actions` at the call site — this re-registers whenever the array's
 * identity changes, and a fresh array every render would write to the
 * provider's state in a loop.
 */
export function useRegisterCommands(id: string, actions: CommandAction[]) {
  const { register } = useCommands()
  React.useEffect(() => register(id, actions), [id, actions, register])
}

const NAV_ROUTES = [
  { href: "/", labelKey: "nav.dashboard" },
  { href: "/chat", labelKey: "nav.chat" },
  { href: "/expenses/history", labelKey: "nav.expenseHistory" },
  { href: "/receipts/scan", labelKey: "nav.scanReceipt" },
  { href: "/expenses/status", labelKey: "nav.updateStatus" },
  { href: "/categories", labelKey: "nav.categories" },
  { href: "/reports", labelKey: "nav.reports" },
] as const

export function CommandsProvider({ children }: { children: React.ReactNode }) {
  const t = useT()
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [extra, setExtra] = React.useState<Record<string, CommandAction[]>>({})

  const register = React.useCallback((id: string, actions: CommandAction[]) => {
    setExtra((prev) => ({ ...prev, [id]: actions }))
    return () =>
      setExtra((prev) => {
        if (!(id in prev)) return prev
        const next = { ...prev }
        delete next[id]
        return next
      })
  }, [])

  const value = React.useMemo(
    () => ({ open: () => setOpen(true), register }),
    [register],
  )

  const actions = React.useMemo<CommandAction[]>(() => {
    const navigate = NAV_ROUTES.map(({ href, labelKey }) => ({
      id: "nav:" + href,
      group: t("command.groupNavigate"),
      label: t(labelKey),
      run: () => router.push(href),
    }))
    // Page-scoped actions first: they are what the user came for on the page
    // they are looking at.
    return [...Object.values(extra).flat(), ...navigate]
  }, [extra, router, t])

  useHotkeys([{ combo: "mod+k", run: () => setOpen((v) => !v), allowInInput: true }])

  return (
    <CommandsContext.Provider value={value}>
      {children}
      <CommandPalette open={open} onOpenChange={setOpen} actions={actions} />
    </CommandsContext.Provider>
  )
}
