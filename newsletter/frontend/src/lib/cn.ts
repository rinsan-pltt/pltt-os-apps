export type ClassValue = string | false | null | undefined;

/** Minimal classnames join — no external dependency. */
export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}
