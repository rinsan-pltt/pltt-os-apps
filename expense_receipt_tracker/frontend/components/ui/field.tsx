"use client"

import * as React from "react"

import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

/**
 * Label + control + hint/error, wired together.
 *
 * The render-prop hands the control a `useId`-generated id, so the same field
 * can appear twice on a page (the reports filters and the expense form both
 * used a hardcoded `id="category"`, which silently broke label association
 * whenever both were mounted). It also attaches `aria-describedby` and
 * `aria-invalid`, so a validation message is announced instead of just turning
 * red.
 */
export function Field({
  label,
  hint,
  error,
  className,
  children,
}: {
  label: React.ReactNode
  hint?: React.ReactNode
  error?: React.ReactNode
  className?: string
  children: (props: {
    id: string
    "aria-describedby": string | undefined
    "aria-invalid": boolean | undefined
  }) => React.ReactNode
}) {
  const id = React.useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ")

  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children({
        id,
        "aria-describedby": describedBy || undefined,
        "aria-invalid": error ? true : undefined,
      })}
      {hint && (
        <p id={hintId} className="text-caption text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-caption font-medium text-destructive-text">
          {error}
        </p>
      )}
    </div>
  )
}
