"use client"

import * as React from "react"
import { Eye, EyeOff } from "lucide-react"

import { Input } from "@/components/ui/input"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/**
 * A password field with an eye button to reveal what was typed.
 *
 * Protecting a PDF with a mistyped password locks the user out of their own
 * file, and a masked field gives no way to check it before running.
 *
 * Given `minLength`/`maxLength`, it also states the allowed length under the
 * field and marks the field invalid once a typed value falls outside it. The
 * caller still blocks the run — this only makes the reason visible where the
 * typing happens.
 */
const PasswordInput = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "minLength" | "maxLength"> & {
    minLength?: number
    maxLength?: number
  }
>(({ className, disabled, minLength, maxLength, value, id, ...props }, ref) => {
  const t = useT()
  const [visible, setVisible] = React.useState(false)
  const label = visible ? t("common.hidePassword") : t("common.showPassword")
  const hintId = React.useId()

  const length = typeof value === "string" ? [...value].length : 0
  const bounded = minLength !== undefined && maxLength !== undefined
  const outOfBounds =
    length > 0 && ((minLength !== undefined && length < minLength) || (maxLength !== undefined && length > maxLength))

  return (
    <div className="grid gap-1.5">
      <div className="relative">
        <Input
          ref={ref}
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          disabled={disabled}
          maxLength={maxLength}
          aria-invalid={outOfBounds || undefined}
          aria-describedby={bounded ? hintId : undefined}
          className={cn("pr-10", className)}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          disabled={disabled}
          aria-label={label}
          aria-pressed={visible}
          title={label}
          className="absolute right-2 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
        >
          {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
        </button>
      </div>
      {bounded && (
        <p id={hintId} className={cn("text-caption", outOfBounds ? "text-destructive" : "text-muted-foreground")}>
          {t("tool.passwordLength", { min: minLength, max: maxLength })}
          {length > 0 && ` · ${length}/${maxLength}`}
        </p>
      )}
    </div>
  )
})
PasswordInput.displayName = "PasswordInput"

export { PasswordInput }
