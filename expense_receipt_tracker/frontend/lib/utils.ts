import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}



export function todayIso(): string {
  const d = new Date()
  const month = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${d.getFullYear()}-${month}-${day}`
}

/**
 * Group amounts by currency.
 *
 * Adding a ₹785 receipt to a $12.40 one and printing "$797.40" is simply a
 * wrong number, which is what the reports total used to do. Callers render one
 * line per currency instead — the backend's summary endpoint is the only place
 * with exchange rates, and it is not available for arbitrary filtered lists.
 * Returned largest-first, and always at least one entry for a non-empty input.
 */
export function sumByCurrency<T extends { amount: number; currency: string }>(
  rows: T[],
): { currency: string; amount: number }[] {
  const totals = new Map<string, number>()
  for (const row of rows) {
    const code = (row.currency || "USD").toUpperCase()
    totals.set(code, (totals.get(code) ?? 0) + row.amount)
  }
  return Array.from(totals, ([currency, amount]) => ({ currency, amount })).sort(
    (a, b) => b.amount - a.amount,
  )
}
