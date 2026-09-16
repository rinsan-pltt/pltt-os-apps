import * as React from "react"

import { Select } from "@/components/ui/select"
import { CURRENCIES } from "@/lib/currencies"

/** Dropdown of common currencies (USD, INR, KRW, CNY, …). If `value` isn't one
 *  of the listed codes — e.g. a currency an AI scan detected — it's prepended
 *  so the current selection is always shown rather than silently dropped. */
export function CurrencySelect({
  id,
  value,
  onChange,
  disabled,
  className,
}: {
  id?: string
  value: string
  onChange: (code: string) => void
  disabled?: boolean
  className?: string
}) {
  const options = React.useMemo(() => {
    const known = CURRENCIES.some((c) => c.code === value)
    return known || !value ? CURRENCIES : [{ code: value, name: value }, ...CURRENCIES]
  }, [value])

  return (
    <Select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={className}
    >
      {options.map((c) => (
        <option key={c.code} value={c.code}>
          {c.code} — {c.name}
        </option>
      ))}
    </Select>
  )
}
