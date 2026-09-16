"use client"

import * as React from "react"
import { IconCopy, IconCheck } from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import { toast } from "@/components/ui/sonner"
import { useT } from "@/lib/i18n"

/**
 * Small inline button that copies `text` to the clipboard and shows a transient
 * "Copied" confirmation in place. Renders nothing when there is no text.
 */
export function CopyPromptButton({
  text,
  className,
  showLabel = true,
  title,
  toastOnCopy = true,
}: {
  text?: string | null
  className?: string
  /** Show the "Copy"/"Copied" text label next to the icon. */
  showLabel?: boolean
  /** Tooltip/aria text for the idle state. Defaults to the generic "Copy". */
  title?: string
  /** Show a "Prompt copied" toast on success (like the image-copy action). */
  toastOnCopy?: boolean
}) {
  const { t } = useT()
  const idleLabel = title ?? t("common.copy")
  const [copied, setCopied] = React.useState(false)
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  if (!text) return null

  const handleCopy = async (e: React.MouseEvent) => {
    // Don't let the click bubble to a parent (e.g. opening the image detail).
    e.stopPropagation()
    e.preventDefault()
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Fallback for restricted clipboard contexts.
      const ta = document.createElement("textarea")
      ta.value = text
      ta.style.position = "fixed"
      ta.style.opacity = "0"
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand("copy")
      } catch {
        /* ignore */
      }
      document.body.removeChild(ta)
    }
    setCopied(true)
    if (toastOnCopy) toast.success(t("common.promptCopied"))
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setCopied(false), 1500)
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? t("common.copied") : idleLabel}
      title={copied ? t("common.copied") : idleLabel}
      className={cn(
        "inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer shrink-0",
        copied && "text-foreground",
        className,
      )}
    >
      {copied ? <IconCheck className="size-3" strokeWidth={2} /> : <IconCopy className="size-3" strokeWidth={1.5} />}
      {showLabel && (
        <span className="text-[10px] uppercase tracking-widest">
          {copied ? t("common.copied") : t("common.copy")}
        </span>
      )}
    </button>
  )
}
