/**
 * Pure ledger logic — no React, so it can be reasoned about (and tested) on its
 * own.
 *
 * The model is: `base` is the last thing the server said, `ops` are optimistic
 * changes not yet settled, and what the user sees is `base` projected through
 * `ops`. Ops leave only by committing or rolling back, never by a refetch —
 * otherwise a background refresh would resurrect a row the user just deleted.
 */

import type { Expense, ExpenseStatus } from "@/lib/api"

export type SortKey = "date" | "vendor" | "category" | "status" | "amount"
export type SortDir = "asc" | "desc"

/** Workflow order, not alphabetical — alphabetical sorts "reimbursed" before
 *  "submitted", which is meaningless to someone watching an expense progress.
 *  Mirrors `_STATUS_RANK` in backend/api/routes/expenses.py. */
export const STATUS_RANK: Record<string, number> = {
  pending: 0,
  submitted: 1,
  reimbursed: 2,
}

export type PendingOp =
  | { kind: "update"; token: number; id: string; before: Expense; after: Expense }
  | { kind: "delete"; token: number; ids: string[]; before: Expense[] }
  | {
      kind: "status"
      token: number
      ids: string[]
      before: Map<string, ExpenseStatus>
      status: ExpenseStatus
    }

export type LedgerPhase = "initial" | "loading" | "ready" | "refreshing" | "error"

export interface LedgerState {
  base: Expense[]
  ops: PendingOp[]
  phase: LedgerPhase
  error: string | null
  requestId: number
}

export type LedgerAction =
  | { type: "fetch:start"; requestId: number }
  | { type: "fetch:ok"; requestId: number; expenses: Expense[] }
  | { type: "fetch:fail"; requestId: number; message: string }
  | { type: "op:begin"; op: PendingOp }
  | { type: "op:settle"; token: number }

export const initialLedgerState: LedgerState = {
  base: [],
  ops: [],
  phase: "initial",
  error: null,
  requestId: 0,
}

export function ledgerReducer(state: LedgerState, action: LedgerAction): LedgerState {
  switch (action.type) {
    case "fetch:start":
      return {
        ...state,
        requestId: action.requestId,
        // Only the very first load blanks the view. Every later fetch is a
        // background refresh, so the ledger keeps its rows instead of flashing
        // back to skeletons on every edit, delete and keystroke.
        phase: state.phase === "initial" || state.phase === "loading" ? "loading" : "refreshing",
        error: null,
      }
    case "fetch:ok":
      // Drop responses from superseded requests: fast typing over a slow
      // network could otherwise paint an older result set last.
      if (action.requestId !== state.requestId) return state
      return { ...state, base: action.expenses, phase: "ready", error: null }
    case "fetch:fail":
      if (action.requestId !== state.requestId) return state
      return { ...state, phase: "error", error: action.message }
    case "op:begin":
      return { ...state, ops: [...state.ops, action.op] }
    case "op:settle":
      // Commit and rollback are the same state transition: the op stops being
      // applied on top of `base`. They differ only in whether the server was
      // told, which the caller handles.
      return { ...state, ops: state.ops.filter((op) => op.token !== action.token) }
    default:
      return state
  }
}

/** What the user actually sees: server truth with pending ops applied. */
export function projectRows(base: Expense[], ops: PendingOp[]): Expense[] {
  if (ops.length === 0) return base
  let rows = base
  for (const op of ops) {
    if (op.kind === "delete") {
      const gone = new Set(op.ids)
      rows = rows.filter((e) => !gone.has(e.id))
    } else if (op.kind === "update") {
      rows = rows.map((e) => (e.id === op.id ? op.after : e))
    } else {
      const target = new Set(op.ids)
      rows = rows.map((e) => (target.has(e.id) ? { ...e, status: op.status } : e))
    }
  }
  return rows
}

/** Ids hidden by a pending delete — used to prune selection state. */
export function pendingDeletedIds(ops: PendingOp[]): Set<string> {
  const ids = new Set<string>()
  for (const op of ops) if (op.kind === "delete") op.ids.forEach((id) => ids.add(id))
  return ids
}

/**
 * Row comparator.
 *
 * `categoryLabel` is required because categories must sort by the label the
 * user is actually reading — which is per-organisation (users rename them) and
 * per-language. The server knows neither, so this cannot be delegated to SQL.
 */
export function compareExpenses(
  key: SortKey,
  dir: SortDir,
  collator: Intl.Collator,
  categoryLabel: (slug: string) => string,
): (a: Expense, b: Expense) => number {
  const sign = dir === "asc" ? 1 : -1
  return (a, b) => {
    let d = 0
    switch (key) {
      case "amount":
        d = a.amount - b.amount
        break
      case "vendor":
        d = collator.compare(a.vendor, b.vendor)
        break
      case "category":
        d = collator.compare(categoryLabel(a.category), categoryLabel(b.category))
        break
      case "status":
        d = (STATUS_RANK[a.status] ?? 99) - (STATUS_RANK[b.status] ?? 99)
        break
      case "date":
      default:
        d = a.expense_date < b.expense_date ? -1 : a.expense_date > b.expense_date ? 1 : 0
    }
    if (d !== 0) return d * sign
    // Stable tiebreaker so equal values never shuffle between renders.
    return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0
  }
}
