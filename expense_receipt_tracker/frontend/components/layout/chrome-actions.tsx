"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Command, Sparkles } from "lucide-react"

import { useCommands } from "@/components/command-provider"
import { buttonVariants, Button } from "@/components/ui/button"
import { Tooltip } from "@/components/ui/tooltip"
import { useT } from "@/lib/i18n"

/**
 * The two app-wide affordances that sit at the head of every page: open the
 * assistant, and open the command palette.
 *
 * They live in `PageHeader` rather than the sidebar because the sidebar is a
 * list of *places* and these are *actions* — and because below `md` the
 * sidebar is a drawer, which would hide them behind a menu on exactly the
 * screens where a shortcut matters most.
 *
 * Both are icon-only, so both carry a Tooltip AND an `aria-label` with the
 * same text: the tooltip is for the pointer, the label for assistive tech and
 * for the tooltip's own accessible name.
 */
export function ChromeActions() {
  const t = useT()
  const pathname = usePathname()
  const { open } = useCommands()
  const assistantLabel = t("nav.chat")
  const commandsLabel = t("command.open")
  // On the assistant's own page the button would be a link to here. Keep the
  // slot's shape by showing it as the current page rather than removing it,
  // so the header does not shuffle as you navigate.
  const onAssistant = pathname === "/chat"

  return (
    <>
      <Tooltip label={assistantLabel}>
        <Link
          href="/chat"
          aria-label={assistantLabel}
          aria-current={onAssistant ? "page" : undefined}
          className={buttonVariants({ variant: onAssistant ? "default" : "outline", size: "icon" })}
        >
          <Sparkles className="size-4" aria-hidden />
        </Link>
      </Tooltip>
      <Tooltip label={commandsLabel}>
        <Button variant="outline" size="icon" aria-label={commandsLabel} onClick={open}>
          <Command className="size-4" aria-hidden />
        </Button>
      </Tooltip>
    </>
  )
}
