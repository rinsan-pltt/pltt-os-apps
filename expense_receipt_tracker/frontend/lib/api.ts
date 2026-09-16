/**
 * Centralized API client for the Expense & Receipt Tracker plugin.
 *
 * All plugin backend routes live under
 * `/api/v1/plugins/expense-receipt-tracker/*` (the plugin id in
 * palette-plugin.json). `app/layout.tsx` calls `registerApiFetch(platform.apiFetch)`
 * at mount time and every request routes through that — in production the OS
 * provides its own credentialed fetcher; under `pltt dev` the simulator
 * provides one that targets the dynamic backend port. When no platform fetch
 * is registered (plain standalone dev against uvicorn) we fall back to
 * localhost:8000.
 */

import type { ReceiptStorageRef } from "@/lib/receipt-storage"

export type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>

const BASE = "/api/v1/plugins/expense-receipt-tracker"
const STANDALONE_BASE = "http://localhost:8000/api"

let _platformFetch: ApiFetch | null = null

export function registerApiFetch(fn: ApiFetch | undefined | null) {
  _platformFetch = fn ?? null
}

function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  if (_platformFetch) return _platformFetch(`${BASE}${path}`, init)
  return fetch(`${STANDALONE_BASE}${path}`, init)
}

async function errorDetail(resp: Response, fallback: string): Promise<string> {
  return (await errorBody(resp, fallback)).message
}

/**
 * A backend error, split into the sentence to show and whatever structure came
 * with it.
 *
 * `detail` arrives in three shapes: a plain string (most routes), FastAPI's
 * array of validation errors, and — where the client has to do more than print
 * a sentence — an object carrying a `message` plus extra fields. The category
 * name check uses the third so the page can mark the field that has to change
 * rather than leaving the user to find it among a dozen rows.
 */
async function errorBody(
  resp: Response,
  fallback: string,
): Promise<{ message: string; detail?: Record<string, unknown> }> {
  try {
    const body = await resp.json()
    const detail = body?.detail
    if (typeof detail === "string") return { message: detail }
    if (Array.isArray(detail)) {
      return {
        message: detail
          .map((e: { loc?: string[]; msg?: string }) => (e.loc ? `${e.loc.join(".")} — ${e.msg}` : e.msg))
          .join("; "),
      }
    }
    if (detail && typeof detail === "object") {
      const message = typeof detail.message === "string" ? detail.message : fallback
      return { message, detail: detail as Record<string, unknown> }
    }
  } catch {
    // non-JSON body
  }
  return { message: fallback }
}

async function request<T>(path: string, init: RequestInit, fallbackError: string): Promise<T> {
  let resp: Response
  try {
    resp = await apiFetch(path, init)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Could not reach the backend: ${msg}`)
  }
  if (!resp.ok) throw new Error(await errorDetail(resp, fallbackError))
  if (resp.status === 204) return undefined as T
  return (await resp.json()) as T
}

// -------------------------------------------------------------- Categories

export interface Category {
  slug: string
  label: string
  keywords: string[]
  is_default: boolean
  sort_order: number
}

/** A desired category in an apply request. Omit `slug` to create a new one;
 *  pass an existing `slug` to rename/update it (the slug stays stable). */
export interface CategoryInput {
  slug?: string
  label: string
  keywords: string[]
}

export function listCategories(): Promise<Category[]> {
  return request("/categories", { method: "GET" }, "Could not load categories.")
}

export interface ApplyCategoriesResult {
  categories: Category[]
  recategorized: number
}

/** One category name the backend refused, with the reason to show beside it. */
export interface InvalidCategory {
  label: string
  reason: string
}

/** Thrown when the backend rejects one or more category names. Carries the
 *  offending names so the editor can flag those rows; `message` is the banner. */
export class CategoryNameError extends Error {
  readonly invalid: InvalidCategory[]
  constructor(message: string, invalid: InvalidCategory[]) {
    super(message)
    this.name = "CategoryNameError"
    this.invalid = invalid
  }
}

function parseInvalid(detail: Record<string, unknown> | undefined): InvalidCategory[] {
  const raw = detail?.invalid
  if (!Array.isArray(raw)) return []
  return raw
    .filter(
      (e): e is InvalidCategory =>
        !!e && typeof e === "object" && typeof (e as InvalidCategory).label === "string",
    )
    .map((e) => ({ label: e.label, reason: String(e.reason ?? "") }))
}

export async function applyCategories(
  categories: CategoryInput[],
): Promise<ApplyCategoriesResult> {
  const fallback = "Could not update categories."
  let resp: Response
  try {
    resp = await apiFetch("/categories", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categories }),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Could not reach the backend: ${msg}`)
  }
  if (!resp.ok) {
    // Hand-rolled rather than routed through `request`, because a rejected
    // name has to reach the editor as data — which row to flag — and not just
    // as a sentence.
    const { message, detail } = await errorBody(resp, fallback)
    const invalid = parseInvalid(detail)
    throw invalid.length > 0 ? new CategoryNameError(message, invalid) : new Error(message)
  }
  return (await resp.json()) as ApplyCategoriesResult
}

// ---------------------------------------------------------------- Settings

export interface Settings {
  /** The base currency the dashboard totals are displayed in. */
  base_currency: string
}

export function getSettings(): Promise<Settings> {
  return request("/settings", { method: "GET" }, "Could not load settings.")
}

export function updateSettings(settings: Settings): Promise<Settings> {
  return request(
    "/settings",
    { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) },
    "Could not update settings.",
  )
}

// ---------------------------------------------------------------- Expenses

export type ExpenseStatus = "pending" | "submitted" | "reimbursed"

export interface Expense {
  id: string
  vendor: string
  amount: number
  currency: string
  category: string
  expense_date: string
  status: ExpenseStatus
  notes: string | null
  has_receipt: boolean
  receipt_original_name: string | null
  /** Durable storage URL when the receipt was uploaded to platform storage,
   *  else null (local-disk receipts stream via /expenses/{id}/receipt). */
  receipt_url: string | null
  created_at: string
  updated_at: string
}

export interface ExpenseFilters {
  category?: string
  status?: string
  q?: string
  dateFrom?: string
  dateTo?: string
}

export interface ExpenseMonth {
  /** Calendar month, "YYYY-MM", on the UTC boundary — the same clock the
   *  exchange rates were fetched against. */
  month: string
  /** Spend in that month, already in the summary's `base_currency`. */
  amount: number
  count: number
  reimbursed_amount: number
  /** A currency in this month had no available rate, so its raw amount was
   *  added as-is. This month's figure — and any delta against it — is
   *  unreliable. */
  approximate: boolean
}

export interface ExpenseDay {
  /** Calendar day, "YYYY-MM-DD". */
  day: string
  /** Spend on that day, in the summary's `base_currency`. */
  amount: number
  count: number
  /** A currency that day had no rate, so its raw amount was added as-is. */
  approximate: boolean
}

export interface ExpenseSummary {
  /** Currency the amounts below are expressed in (the org's base currency). */
  base_currency: string
  /** True when at least one expense was in a different currency and converted. */
  converted: boolean
  /** The other currencies that were converted into the base (e.g. ["INR"]). */
  converted_from: string[]
  /** True when some currency had no available rate and was added approximately. */
  approximate: boolean
  total_count: number
  total_amount: number
  pending_amount: number
  pending_count: number
  reimbursed_amount: number
  reimbursed_count: number
  by_category: { category: string; amount: number; count: number }[]
  /** The last 13 calendar months ending with the current one, oldest first,
   *  always exactly 13 entries. Months with no activity are present with zeros
   *  so a gap reads as a gap instead of vanishing. Amounts are already
   *  converted to `base_currency`, which is what lets the dashboard chart plot
   *  every currency at once instead of only the largest one.
   *
   *  Expenses older than the window — and future-dated ones — are excluded, so
   *  these do NOT sum to `total_amount`. Never derive a total from them. */
  by_month: ExpenseMonth[]
  /** Per-day totals for the requested window, ascending, days with activity
   *  only, already converted to `base_currency`.
   *
   *  Empty unless `dateFrom`/`dateTo` narrowed the request — unbounded it would
   *  be one entry per day the org has ever recorded, on a response the
   *  dashboard fetches on every load. Days with no activity are omitted: a
   *  window is chosen by clicking two days that HAVE expenses, so zero-filling
   *  a Jun-to-Sep pick would give ~84 bars of which two are non-zero. */
  by_day: ExpenseDay[]
}

function toQuery(filters: ExpenseFilters): string {
  const params = new URLSearchParams()
  if (filters.category && filters.category !== "all") params.set("category", filters.category)
  if (filters.status && filters.status !== "all") params.set("status", filters.status)
  if (filters.q) params.set("q", filters.q)
  if (filters.dateFrom) params.set("date_from", filters.dateFrom)
  if (filters.dateTo) params.set("date_to", filters.dateTo)
  const qs = params.toString()
  return qs ? `?${qs}` : ""
}

export function listExpenses(filters: ExpenseFilters = {}): Promise<Expense[]> {
  return request(`/expenses${toQuery(filters)}`, { method: "GET" }, "Could not load expenses.")
}

/**
 * Dashboard totals.
 *
 * The optional date window is what makes the calendar a filter: the amounts are
 * converted into the base currency server-side, so a mixed-currency range
 * cannot be totalled correctly on the client.
 *
 * Deliberately narrower than `ExpenseFilters` — only dates. The summary is also
 * what tells `/expenses/history` "there are no expenses at all" as opposed to
 * "none match your filters", and that distinction breaks the moment
 * category/status/q narrow it. If you need those, add a separate call.
 */
export function getExpenseSummary(window?: {
  dateFrom?: string
  dateTo?: string
}): Promise<ExpenseSummary> {
  const params = new URLSearchParams()
  if (window?.dateFrom) params.set("date_from", window.dateFrom)
  if (window?.dateTo) params.set("date_to", window.dateTo)
  const qs = params.toString()
  return request(
    `/expenses/summary${qs ? `?${qs}` : ""}`,
    { method: "GET" },
    "Could not load expense summary.",
  )
}

export function getExpense(id: string): Promise<Expense> {
  return request(`/expenses/${id}`, { method: "GET" }, "Could not load that expense.")
}

export interface ExpenseInput {
  vendor: string
  amount: number
  currency: string
  category: string
  expense_date: string
  status: ExpenseStatus
  notes?: string
}

/**
 * Create an expense. Prefer `storageRef` — a receipt already uploaded to durable
 * platform storage (see lib/receipt-storage.ts) — so the file survives server
 * restarts. When no ref is available (standalone dev / storage upload failed),
 * pass the raw `receipt` file and the backend saves it to local disk.
 */
export function createExpense(
  fields: ExpenseInput,
  receipt?: File | null,
  storageRef?: ReceiptStorageRef | null,
): Promise<Expense> {
  const form = new FormData()
  form.append("vendor", fields.vendor)
  form.append("amount", String(fields.amount))
  form.append("currency", fields.currency)
  form.append("category", fields.category)
  form.append("expense_date", fields.expense_date)
  form.append("status", fields.status)
  if (fields.notes) form.append("notes", fields.notes)
  if (storageRef) {
    form.append("receipt_object_path", storageRef.object_path)
    form.append("receipt_url", storageRef.file_url)
    form.append("receipt_original_name", storageRef.original_name)
    form.append("receipt_content_type", storageRef.content_type)
  } else if (receipt) {
    form.append("receipt", receipt)
  }
  return request("/expenses", { method: "POST", body: form }, "Could not save the expense.")
}

export function updateExpense(id: string, fields: Partial<ExpenseInput>): Promise<Expense> {
  return request(
    `/expenses/${id}`,
    { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields) },
    "Could not update the expense.",
  )
}

export function deleteExpense(id: string): Promise<void> {
  return request(`/expenses/${id}`, { method: "DELETE" }, "Could not delete the expense.")
}

export function bulkUpdateStatus(ids: string[], status: ExpenseStatus): Promise<{ updated: number }> {
  return request(
    "/expenses/bulk-status",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids, status }) },
    "Could not update those expenses.",
  )
}

export interface FileResult {
  blob: Blob
  filename: string
}

function filenameFromResponse(resp: Response, fallback: string): string {
  const header = resp.headers.get("content-disposition")
  if (header) {
    const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header)
    if (utf8) return decodeURIComponent(utf8[1])
    const plain = /filename="?([^";]+)"?/i.exec(header)
    if (plain) return plain[1]
  }
  return fallback
}

export async function getExpenseReceipt(id: string): Promise<FileResult> {
  let resp: Response
  try {
    resp = await apiFetch(`/expenses/${id}/receipt`, { method: "GET" })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Could not load the receipt: ${msg}`)
  }
  if (!resp.ok) throw new Error(await errorDetail(resp, "Could not load the receipt."))
  const blob = await resp.blob()
  return { blob, filename: filenameFromResponse(resp, "receipt") }
}

// ---------------------------------------------------------------- Receipts

export interface ReceiptDraft {
  vendor: string | null
  amount: number | null
  /** 3-letter ISO code the LLM read off the receipt, or null when it
   *  couldn't be identified — the form falls back to its "USD" default. */
  currency: string | null
  expense_date: string | null
  category: string
  raw_text_preview: string
  ocr_available: boolean
  /** True when an LLM helped read this receipt (OPENAI_KEY configured) —
   *  every field it returned was still checked against the document's own
   *  text before being used, same as the plain heuristic path. */
  llm_assisted: boolean
}

export async function scanReceipt(file: File): Promise<ReceiptDraft> {
  const form = new FormData()
  form.append("file", file)
  return request("/receipts/scan", { method: "POST", body: form }, "Could not scan that receipt.")
}

// ------------------------------------------------------------- Bulk import

export interface ImportRow {
  row: number
  vendor: string
  amount: number | null
  /** ISO code detected from the file (e.g. "INR"), or null when the file gave
   *  no currency signal — the review UI defaults those to USD. */
  currency: string | null
  expense_date: string | null
  category: string
  notes: string | null
  valid: boolean
}

export interface ImportPreview {
  rows: ImportRow[]
  valid_count: number
  total_count: number
}

export async function previewImport(file: File): Promise<ImportPreview> {
  const form = new FormData()
  form.append("file", file)
  return request("/imports/preview", { method: "POST", body: form }, "Could not read that file.")
}

export interface ImportCommitRow {
  vendor: string
  amount: number
  currency: string
  category: string
  expense_date: string
  status: ExpenseStatus
  notes?: string
}

export interface ImportCommitResult {
  created: number
  expenses: Expense[]
}

export function commitImport(rows: ImportCommitRow[]): Promise<ImportCommitResult> {
  return request(
    "/imports/commit",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows }) },
    "Could not import those expenses.",
  )
}

// ---------------------------------------------------------------- Reports

/** What the export endpoint can produce. `xlsx` is a real Office workbook
 *  (openpyxl server-side), not a CSV under another extension — Excel refuses
 *  those. */
export type ExportFormat = "csv" | "xlsx" | "pdf"

export interface ReportFilters {
  ids?: string[]
  category?: string
  status?: string
  dateFrom?: string
  dateTo?: string
  format: ExportFormat
  title?: string
}

export async function exportReport(filters: ReportFilters): Promise<FileResult> {
  const body = JSON.stringify({
    ids: filters.ids,
    category: filters.category,
    status: filters.status,
    date_from: filters.dateFrom,
    date_to: filters.dateTo,
    format: filters.format,
    title: filters.title ?? "Reimbursement Report",
  })
  let resp: Response
  try {
    resp = await apiFetch("/reports/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Could not reach the backend: ${msg}`)
  }
  if (!resp.ok) throw new Error(await errorDetail(resp, "Could not export the report."))
  const blob = await resp.blob()
  return { blob, filename: filenameFromResponse(resp, `reimbursement-report.${filters.format}`) }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// -------------------------------------------------------------------- Chat

export interface ChatMessage {
  role: "user" | "assistant"
  content: string
}

/**
 * A receipt the user attached to a chat message.
 *
 * The file itself never goes to `/chat` — the composer scans it with
 * `scanReceipt` and uploads it with `uploadReceiptToStorage` first, so this is
 * only the storage reference plus what the scan read. One extraction path for
 * the whole app, and the chat endpoint stays JSON.
 */
export interface ChatAttachment {
  id: string
  original_name?: string
  content_type?: string
  object_path?: string
  file_url?: string
  draft?: Record<string, unknown>
}

/** A write the assistant proposed that needs the user's approval first —
 *  deletes, bulk status changes, replacing the category set. Sent back verbatim
 *  in `confirm` to run it. */
export interface ChatPendingAction {
  tool: string
  args: Record<string, unknown>
  description: string
}

/** A report the assistant prepared. Snake_case because it is the export
 *  endpoint's own payload; `chatDownloadToFilters` maps it for `exportReport`. */
export interface ChatDownload {
  format: ExportFormat
  title?: string
  category?: string
  status?: string
  date_from?: string
  date_to?: string
}

export interface ChatReply {
  reply: string
  /** Past-tense lines for the writes that actually happened, so a change is
   *  never invisible. Empty for a pure question. */
  actions: string[]
  pending: ChatPendingAction | null
  download: ChatDownload | null
  /** Something was written, so the pages behind the chat are now stale. */
  changed: boolean
}

export function chatDownloadToFilters(download: ChatDownload): ReportFilters {
  return {
    format: download.format,
    title: download.title,
    category: download.category,
    status: download.status,
    dateFrom: download.date_from,
    dateTo: download.date_to,
  }
}

export function sendChat(payload: {
  messages: ChatMessage[]
  attachments?: ChatAttachment[]
  confirm?: ChatPendingAction | null
}): Promise<ChatReply> {
  return request(
    "/chat",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: payload.messages,
        attachments: payload.attachments ?? [],
        confirm: payload.confirm ?? null,
      }),
    },
    "Could not reach the assistant.",
  )
}
