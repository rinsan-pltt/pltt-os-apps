"use client"

import * as React from "react"
import { Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/**
 * The primary action row: run this tool, and start over.
 *
 * Seven workspaces built this by hand as `flex items-center gap-3` holding two
 * `size="lg"` buttons — and none of them had `flex-wrap`, so all seven
 * overflowed below about 380px. Fixing it here fixes it everywhere.
 *
 * `blockedReason` is the other reason this exists. Every workspace computed a
 * `canRun` boolean from between one and four conditions and then communicated
 * failure by grinding the button grey — a dead end with no stated cause. If a
 * caller can say why, the reason is rendered and wired to the button with
 * `aria-describedby`.
 */
export function RunBar({
  label,
  busyLabel,
  busy,
  disabled,
  blockedReason,
  onRun,
  onReset,
  className,
}: {
  label: string
  busyLabel: string
  busy: boolean
  disabled: boolean
  /** Why the run button is unavailable, when it is and the reason is knowable. */
  blockedReason?: string | null
  onRun: () => void
  onReset?: () => void
  className?: string
}) {
  const t = useT()
  const reasonId = React.useId()
  const showReason = !busy && disabled && !!blockedReason

  return (
    <div className={cn("space-y-2", className)}>
      {showReason && (
        <p id={reasonId} className="text-caption text-muted-foreground">
          {blockedReason}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="lg"
          onClick={onRun}
          disabled={busy || disabled}
          aria-describedby={showReason ? reasonId : undefined}
          className="min-w-0 flex-1 basis-full sm:basis-auto"
        >
          {busy ? (
            <>
              <Loader2 className="animate-spin" aria-hidden /> {busyLabel}
            </>
          ) : (
            label
          )}
        </Button>
        {onReset && (
          <Button size="lg" variant="ghost" onClick={onReset} disabled={busy}>
            {t("common.startOver")}
          </Button>
        )}
      </div>
    </div>
  )
}
