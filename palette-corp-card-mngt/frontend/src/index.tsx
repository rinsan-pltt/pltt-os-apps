"use client"

import { Fragment, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPaletteClient, usePlatform } from "@palettelab/sdk"
import type { OrgMember, PlatformContext, PluginComponentProps } from "@palettelab/sdk"

const API = "/api/v1/plugins/corporate-card-system"
const TRIP_PRE_SPEND_TOLERANCE_RATIO = 0.15
const TRIP_PRE_SPEND_TOLERANCE_MIN = 1000
const CHART_COLORS = ["#5b5bd6", "#8b8bf0", "#2e2e6b", "#b4842c", "#c7cad1"]
const TAX_PROFILES: Record<string, { type: string; defaultRate: string; rates: string[] }> = {
  KRW: { type: "VAT", defaultRate: "10", rates: ["0", "10"] },
  INR: { type: "GST", defaultRate: "18", rates: ["0", "5", "12", "18", "28", "40"] },
}

/* The organisation roles Palette OS assigns. The app has no roles of its own. */
type Role = "viewer" | "member" | "admin" | "owner"
type Tab = "dashboard" | "inbox" | "cards" | "submit" | "pre_spend" | "usage" | "monitoring" | "anomalies" | "history" | "approvals" | "analytics" | "upload" | "erp" | "qa" | "members"
type Lang = "ko" | "en" | "ja"
type NavCount = "pending" | "inbox" | "claims" | "anomalies" | "pre_spend" | "monitoring"
type AppPermission = "submit_claim" | "request_pre_spend" | "view_own_claims" | "approve_claims" | "monitor_team" | "monitor_spend" | "view_bi" | "manage_statements" | "export_erp" | "manage_roles" | "view_history" | "view_members" | "ask_policy"
type RoleAssignmentRow = {
  member_id: string
  app_role: Role
  permissions: AppPermission[]
  assigned_by_member_id?: string | null
  assigned_at?: string | null
}

type AssistantTurn = {
  role: "user" | "assistant"
  content: string
  /* Which engine answered, so a local fallback answer is never passed off as
     a model's. Absent on the user's own turns. */
  source?: string
}

type AppMember = OrgMember & {
  title?: string
  /* Locality reporting from /members. `locality_from_platform` is what the
     Palette OS profile carries (authoritative); `locality_override` is what an
     admin recorded in this app while the profile has none. `locality_source`
     says which one the policy engine is actually using. */
  locality_from_platform?: "IN" | "KR" | null
  locality_override?: "IN" | "KR" | null
  locality_entered_value?: string | null
  effective_locality?: "IN" | "KR" | null
  locality_source?: "platform" | "app" | null
  app_role?: Role
  app_permissions?: AppPermission[]
  app_role_source?: "assigned" | "default" | string
  assigned_by_member_id?: string | null
  assigned_at?: string | null
}

type Card = {
  id: number
  member_id: string
  member_name: string
  label: string
  last4: string
  monthly_limit?: number
  monthly_limit_cents: number
  status: string
  created_at?: string | null
}

type ApprovalStep = {
  id: number
  step_order: number
  approver_member_id: string | null
  approver_name: string
  approver_title: string | null
  reason: string
  source?: string
  resolver_source?: string
  state: string
  decision_memo: string | null
  decision_source?: string
  decided_by_member_id?: string | null
  decided_at?: string | null
}

type PolicyFinding = {
  code?: string
  severity?: string
  message?: string
  action?: string
}

type PolicyEvaluation = {
  status?: "compliant" | "warning" | "blocked" | "exception_required" | string
  hard_blocks?: PolicyFinding[]
  warnings?: PolicyFinding[]
  required_actions?: PolicyFinding[]
  routing_hints?: {
    requires_manager_review?: boolean
    requires_finance_review?: boolean
    requires_tax_review?: boolean
    requires_pre_approval?: boolean
  }
  receipt_status?: string
  pre_approval_id?: number | null
  evaluated_at?: string
  policy_version?: string
}

type ApprovalHistoryEntry = {
  event?: string
  at?: string
  member_id?: string
  comment?: string
  previous_business_purpose?: string
  previous_steps?: ApprovalStep[]
}

type ApprovalSnapshot = {
  source?: string
  resolver_source?: string
  warnings?: string[]
  history?: ApprovalHistoryEntry[]
  approvers?: Array<{
    step: number
    member_id: string | null
    name: string
    title?: string | null
    reason: string
  }>
}

type Claim = {
  id: number
  requester_member_id: string
  requester_name: string
  vendor: string
  amount?: number
  amount_cents: number
  currency: string
  employee_locality?: "IN" | "KR" | string | null
  tax_amount?: number
  tax_amount_cents: number
  tax_type: string | null
  tax_rate_percent: number | null
  tax_included: boolean
  supplier_gstin?: string | null
  supplier_business_registration_number?: string | null
  supplier_legal_name?: string | null
  invoice_number?: string | null
  invoice_date?: string | null
  place_of_supply?: string | null
  payment_method?: string | null
  fx_evidence_url?: string | null
  fx_evidence_description?: string | null
  cash_receipt_reference?: string | null
  invoice_evidence?: Record<string, string | null>
  category: string
  business_purpose: string
  transaction_date: string | null
  card_last4: string | null
  cost_center: string | null
  project_code: string | null
  attendees: string[]
  receipt_file_url: string | null
  receipt_status: string
  missing_receipt_reason: string | null
  pre_approval_id: number | null
  policy_status: string
  policy_evaluation: PolicyEvaluation
  erp_export_id: number | null
  state: string
  approval_snapshot: ApprovalSnapshot
  created_at: string
  steps: ApprovalStep[]
}

type ResubmitDraft = {
  claim: Claim
  businessPurpose: string
  comment: string
  missingReceiptReason: string
  supplier_gstin: string
  supplier_business_registration_number: string
  supplier_legal_name: string
  invoice_number: string
  invoice_date: string
  place_of_supply: string
  payment_method: string
  fx_evidence_url: string
  fx_evidence_description: string
  cash_receipt_reference: string
}

type StatementUpload = {
  id: number
  filename: string
  row_count: number
  matched_count: number
  missing_count: number
  uploaded_by_member_id: string | null
  created_at: string
}

type StatementRow = {
  id: number
  upload_id: number
  transaction_date: string | null
  card_last4: string | null
  cardholder_member_id: string | null
  cardholder_name: string | null
  vendor: string
  amount?: number
  amount_cents: number
  currency: string
  category: string
  match_status: string
  match_claim_id: number | null
  match_pre_approval_id: number | null
  reconciliation: {
    status?: string
    reason?: string
    confidence?: number
    claim_id?: number
    pre_approval_id?: number
    duplicate_of_statement_row_id?: number
    required_actions?: string[]
  }
  created_at: string
}

type PreSpendRequest = {
  id: number
  requester_member_id: string
  requester_name: string
  request_type: "purchase" | "business_trip" | string
  vendor: string
  amount?: number
  amount_cents: number
  currency: string
  employee_locality?: "IN" | "KR" | string | null
  supplier_gstin?: string | null
  supplier_business_registration_number?: string | null
  supplier_legal_name?: string | null
  invoice_number?: string | null
  invoice_date?: string | null
  place_of_supply?: string | null
  payment_method?: string | null
  fx_evidence_url?: string | null
  fx_evidence_description?: string | null
  cash_receipt_reference?: string | null
  category: string
  business_purpose: string
  expected_purchase_date: string | null
  trip_area: string | null
  trip_start_date: string | null
  trip_end_date: string | null
  budget_items: PreSpendBudgetItem[]
  cost_center: string | null
  project_code: string | null
  attendees: string[]
  state: string
  approval_snapshot: ApprovalSnapshot
  policy_evaluation: PolicyEvaluation
  linked_claim_id: number | null
  decided_by_member_id: string | null
  decision_memo: string | null
  decided_at: string | null
  created_at: string
}

type PreSpendBudgetItem = {
  category: string
  label: string
  amount?: number
  amount_cents: number
}

type ErpExport = {
  id: number
  filename: string
  row_count: number
  total_amount?: number
  total_amount_cents: number
  generated_by_member_id: string | null
  created_at: string
}

type PolicyQuestion = {
  id: number
  asked_by_member_id: string | null
  question: string
  answer: string
  source: string
  created_at: string
}

type ReceiptAnalysisLineItem = {
  description?: string | null
  category?: string | null
  tags?: string[]
  quantity?: number | string | null
  unit_price?: number | null
  line_total?: number | null
}

type ReceiptAnalysisResult = {
  status: string
  source_file?: string
  analysis?: {
    merchant?: { name?: string | null; address?: string | null; business_number?: string | null; tax_id?: string | null }
    document?: { transaction_date?: string | null; currency?: string | null; card_last4?: string | null; receipt_number?: string | null; invoice_number?: string | null; payment_method?: string | null }
    amounts?: { subtotal?: number | null; tax?: number | null; total?: number | null; paid?: number | null }
    line_items?: ReceiptAnalysisLineItem[]
    corporate_card_hints?: {
      suggested_account_code?: string | null
      suggested_account_name?: string | null
      allocation_required?: boolean
      allocation_reason?: string | null
      policy_flags?: string[]
    }
    extraction_warnings?: string[]
    raw_text?: string
  }
  draft?: {
    vendor?: string | null
    amount?: number | string | null
    currency?: string | null
    tax_amount?: number | string | null
    tax_type?: string | null
    tax_rate_percent?: number | string | null
    tax_included?: boolean
    supplier_gstin?: string | null
    supplier_business_registration_number?: string | null
    supplier_legal_name?: string | null
    invoice_number?: string | null
    invoice_date?: string | null
    place_of_supply?: string | null
    payment_method?: string | null
    fx_evidence_url?: string | null
    fx_evidence_description?: string | null
    cash_receipt_reference?: string | null
    transaction_date?: string | null
    card_last4?: string | null
    category?: string | null
    allocation_required?: boolean
    allocation_reason?: string | null
    policy_flags?: string[]
    line_items?: ReceiptAnalysisLineItem[]
  }
}

type Summary = {
  cards: Card[]
  claims: Claim[]
  pending_for_me: Claim[]
  statement_uploads: StatementUpload[]
  statement_rows: StatementRow[]
  missing_claims: StatementRow[]
  erp_exports: ErpExport[]
  policy_questions: PolicyQuestion[]
  pre_spend_requests: PreSpendRequest[]
  counts: {
    cards: number
    claims: number
    pending: number
    approved: number
    rejected: number
    needs_info: number
    policy_blocked: number
    pre_spend_pending: number
    statement_rows: number
    missing_claims: number
  }
}

type MonitoringOverview = {
  total_claims: number
  total_spend?: number
  total_spend_cents: number
  approved_spend?: number
  approved_spend_cents: number
  pending_spend?: number
  pending_spend_cents: number
  blocked_claims: number
  needs_info_claims: number
  missing_receipt_claims: number
  exception_claims: number
  statement_missing_claims: number
  unexported_approved_claims: number
  pending_over_7_days: number
  needs_info_over_7_days: number
  pre_spend_pending: number
}

type MonitoringPeriod = {
  period: string
  claims: number
  spend?: number
  spend_cents: number
  approved?: number
  approved_cents: number
  pending?: number
  pending_cents: number
  blocked: number
  exceptions: number
  missing_receipts: number
}

type MonitoringEmployee = {
  member_id: string
  name: string
  claims: number
  spend?: number
  spend_cents: number
  approved?: number
  approved_cents: number
  pending?: number
  pending_cents: number
  blocked: number
  warnings: number
  exceptions: number
  missing_receipts: number
  late_claims: number
  projected_month_spend?: number
  projected_month_spend_cents: number
}

type MonitoringCategory = {
  category: string
  claims: number
  spend?: number
  spend_cents: number
  blocked: number
  warnings: number
}

type MonitoringFinding = {
  code: string
  severity: string
  count: number
  spend?: number
  spend_cents: number
  sample_message: string
}

type MonitoringPredictions = {
  month_to_date?: number
  month_to_date_cents: number
  projected_month_end?: number
  projected_month_end_cents: number
  year_to_date?: number
  year_to_date_cents: number
  projected_year_end?: number
  projected_year_end_cents: number
  average_monthly_spend?: number
  average_monthly_spend_cents: number
  risk_claims_next_30_days: number
  top_employee_projection: MonitoringEmployee | null
}

type Monitoring = {
  generated_at: string
  scope: string
  overview: MonitoringOverview
  monthly: MonitoringPeriod[]
  yearly: MonitoringPeriod[]
  employees: MonitoringEmployee[]
  categories: MonitoringCategory[]
  findings: MonitoringFinding[]
  predictions: MonitoringPredictions
}

const blankSummary: Summary = {
  cards: [],
  claims: [],
  pending_for_me: [],
  statement_uploads: [],
  statement_rows: [],
  missing_claims: [],
  erp_exports: [],
  policy_questions: [],
  pre_spend_requests: [],
  counts: { cards: 0, claims: 0, pending: 0, approved: 0, rejected: 0, needs_info: 0, policy_blocked: 0, pre_spend_pending: 0, statement_rows: 0, missing_claims: 0 },
}

const blankMonitoring: Monitoring = {
  generated_at: "",
  scope: "company",
  overview: {
    total_claims: 0,
    total_spend_cents: 0,
    approved_spend_cents: 0,
    pending_spend_cents: 0,
    blocked_claims: 0,
    needs_info_claims: 0,
    missing_receipt_claims: 0,
    exception_claims: 0,
    statement_missing_claims: 0,
    unexported_approved_claims: 0,
    pending_over_7_days: 0,
    needs_info_over_7_days: 0,
    pre_spend_pending: 0,
  },
  monthly: [],
  yearly: [],
  employees: [],
  categories: [],
  findings: [],
  predictions: {
    month_to_date_cents: 0,
    projected_month_end_cents: 0,
    year_to_date_cents: 0,
    projected_year_end_cents: 0,
    average_monthly_spend_cents: 0,
    risk_claims_next_30_days: 0,
    top_employee_projection: null,
  },
}

const blankSettlementForm = {
  vendor: "",
  amount: "",
  currency: "KRW",
  tax_amount: "",
  tax_type: "VAT",
  tax_rate_percent: "10",
  tax_included: true,
  supplier_gstin: "",
  supplier_business_registration_number: "",
  supplier_legal_name: "",
  invoice_number: "",
  invoice_date: "",
  place_of_supply: "",
  payment_method: "corporate_card",
  fx_evidence_url: "",
  fx_evidence_description: "",
  cash_receipt_reference: "",
  category: "meals",
  business_purpose: "",
  transaction_date: "",
  card_last4: "",
  cost_center: "",
  project_code: "",
  attendees: "",
  receipt_status: "attached",
  missing_receipt_reason: "",
  pre_approval_id: "",
}

/* Fields the receipt analysis fills in. Replacing the receipt resets exactly
   these, because analyzeReceiptUpload() merges over whatever is already in the
   form (`draft.vendor || current.vendor`) -- so without clearing them first, a
   second receipt that happens not to carry a field would silently inherit the
   first receipt's value and the claim would describe two different purchases.
   Everything NOT listed here (business purpose, cost centre, project code,
   attendees, pre-approval link) is the person's own work and survives. */
const RECEIPT_DERIVED_FIELDS = [
  "vendor",
  "amount",
  "tax_amount",
  "supplier_gstin",
  "supplier_business_registration_number",
  "supplier_legal_name",
  "invoice_number",
  "invoice_date",
  "cash_receipt_reference",
  "transaction_date",
  "card_last4",
] as const

const blankPreSpendForm = {
  request_type: "purchase",
  vendor: "",
  amount: "",
  currency: "KRW",
  supplier_gstin: "",
  supplier_business_registration_number: "",
  supplier_legal_name: "",
  invoice_number: "",
  invoice_date: "",
  place_of_supply: "",
  payment_method: "corporate_card",
  fx_evidence_url: "",
  fx_evidence_description: "",
  cash_receipt_reference: "",
  category: "equipment",
  business_purpose: "",
  expected_purchase_date: "",
  trip_area: "",
  trip_start_date: "",
  trip_end_date: "",
  budget_stay: "",
  budget_travel: "",
  budget_food: "",
  budget_other: "",
  cost_center: "",
  project_code: "",
  attendees: "",
}

const blankCardForm = {
  member_id: "",
  label: "",
  last4: "",
  monthly_limit: "",
}

const tripBudgetFields = [
  { key: "budget_stay", category: "lodging", ko: "숙박", en: "Stay", ja: "宿泊" },
  { key: "budget_travel", category: "travel", ko: "교통", en: "Travel", ja: "交通" },
  { key: "budget_food", category: "meals", ko: "식비", en: "Food", ja: "食費" },
  { key: "budget_other", category: "other", ko: "기타", en: "Other", ja: "その他" },
] as const

const roleOptions: Role[] = ["viewer", "member", "admin", "owner"]
const roleManagerRoles: Role[] = ["admin", "owner"]
/* Mirrors APP_ROLE_PERMISSIONS in backend/api/main.py. */
const memberPermissions: AppPermission[] = ["submit_claim", "request_pre_spend", "view_own_claims", "view_history", "view_members", "ask_policy"]
const adminPermissions: AppPermission[] = [...memberPermissions, "approve_claims", "monitor_team", "monitor_spend", "view_bi", "manage_statements", "export_erp", "manage_roles"]
const rolePermissionMap: Record<Role, AppPermission[]> = {
  viewer: ["view_own_claims", "view_members", "ask_policy"],
  member: memberPermissions,
  admin: adminPermissions,
  owner: adminPermissions,
}

function isRoleManager(role: Role) {
  return roleManagerRoles.includes(role)
}

function normalizeRole(value: string | null | undefined): Role {
  const role = String(value ?? "").trim().toLowerCase()
  return (roleOptions as string[]).includes(role) ? (role as Role) : "member"
}

function roleLabel(role: Role) {
  return titleCase(role)
}

const roleProfiles: Record<Role, { label: string; labelKo: string; labelJa: string; short: string; sub: string; subKo: string; subJa: string; avatar: string; scope: string; scopeKo: string; scopeJa: string }> = {
  viewer: {
    label: "Viewer",
    labelKo: "뷰어",
    labelJa: "閲覧者",
    short: "View",
    sub: "Read-only access",
    subKo: "읽기 전용 권한",
    subJa: "閲覧専用の権限",
    avatar: "VW",
    scope: "Reads own settlements and policy answers.",
    scopeKo: "본인 정산 내역과 정책 답변을 조회합니다.",
    scopeJa: "本人の精算履歴とポリシーの回答を閲覧します。",
  },
  member: {
    label: "Member",
    labelKo: "멤버",
    labelJa: "メンバー",
    short: "Member",
    sub: "Settlement requests and personal usage",
    subKo: "정산 신청과 본인 사용 현황",
    subJa: "精算申請と本人の利用状況",
    avatar: "MB",
    scope: "Personal card usage, receipt filing, and settlement requests.",
    scopeKo: "본인 카드 사용, 영수증 정산, 신청 업무를 처리합니다.",
    scopeJa: "本人のカード利用、領収書の精算、申請業務を行います。",
  },
  admin: {
    label: "Admin",
    labelKo: "관리자",
    labelJa: "管理者",
    short: "Admin",
    sub: "Approvals, monitoring, and company-wide management",
    subKo: "결재와 전사 관리",
    subJa: "決裁と全社管理",
    avatar: "AD",
    scope: "Approvals, company-wide spend, statements, ERP export, and app roles.",
    scopeKo: "결재, 전사 사용, 카드 내역, ERP 출력, 앱 역할을 관리합니다.",
    scopeJa: "決裁、全社の利用状況、カード明細、ERP出力、アプリのロールを管理します。",
  },
  owner: {
    label: "Owner",
    labelKo: "소유자",
    labelJa: "オーナー",
    short: "Owner",
    sub: "Full organization access",
    subKo: "조직 전체 권한",
    subJa: "組織全体の権限",
    avatar: "OW",
    scope: "Everything an admin can do, for the organization they own.",
    scopeKo: "소유한 조직에서 관리자 권한을 모두 사용합니다.",
    scopeJa: "所有する組織で管理者のすべての権限を利用できます。",
  },
}


/* `section: true` marks the first item of a visual group. The flag has always
   been in this data but was never rendered — the sidebar now uses it, together
   with the `.sb-section-label` rule that was likewise defined and unused.
   `sectionKo/sectionEn` name the group the item opens. */
/* Icon set.
 *
 * The app had no icon system — two hand-written inline SVGs (search, bell) and
 * single ASCII characters standing in as glyphs on the dashboard tiles. These
 * follow the existing `.icon` contract already in the stylesheet: 16x16 view
 * box, `fill:none`, `stroke:currentColor`, so they inherit colour from the
 * button they sit in and need no per-icon styling.
 *
 * Drawn as paths rather than pulled from a library: this plugin bundles to a
 * single file and has no icon dependency, and 14 glyphs do not justify adding
 * one.
 */
type IconName =
  | "dashboard" | "inbox" | "card" | "receipt" | "check" | "chart" | "pulse"
  | "alert" | "history" | "stamp" | "bars" | "upload" | "export" | "people"
  | "sparkle" | "search" | "bell" | "chevron" | "panel"

const ICON_PATHS: Record<IconName, string[]> = {
  dashboard: ["M2.5 2.5h4.6v4.6H2.5zM8.9 2.5h4.6v2.8H8.9zM8.9 7.1h4.6v6.4H8.9zM2.5 8.9h4.6v4.6H2.5z"],
  inbox: ["M2 9.2 3.4 3.1h9.2L14 9.2v3.2a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z", "M2 9.2h3.3l.8 1.6h3.8l.8-1.6H14"],
  card: ["M2 4.6h12v7.2a.8.8 0 0 1-.8.8H2.8a.8.8 0 0 1-.8-.8z", "M2 7h12", "M4.3 10.3h2.4"],
  receipt: ["M3.6 2.2h8.8v12l-1.7-1.1-1.5 1.1-1.6-1.1-1.5 1.1-1.5-1.1-1 .7z", "M5.8 5.6h4.4", "M5.8 8.2h4.4"],
  check: ["M3.2 8.4 6.3 11.5l6.5-7"],
  chart: ["M2.6 13.4V2.6", "M2.6 13.4h10.8", "M5.2 11V7.4", "M8 11V4.6", "M10.8 11V8.8"],
  pulse: ["M1.8 8h3l1.7-4.4 2.6 8.8L11 8h3.2"],
  alert: ["M8 2.4 14.2 13H1.8z", "M8 6.6v3", "M8 11.3v.1"],
  history: ["M8 4v4.3l2.8 1.7", "M2.2 8a5.8 5.8 0 1 0 1.9-4.3", "M2 2.6v3h3"],
  stamp: ["M5 7.2V4.9a3 3 0 0 1 6 0v2.3", "M2.8 7.2h10.4v2.6H2.8z", "M3.8 11.4h8.4v2H3.8z"],
  bars: ["M3 13.2V6.8", "M6.4 13.2V3.2", "M9.8 13.2V8.6", "M13.2 13.2V5.4"],
  upload: ["M8 10.6V2.8", "M5.2 5.6 8 2.8l2.8 2.8", "M2.6 10.2v2a1 1 0 0 0 1 1h8.8a1 1 0 0 0 1-1v-2"],
  export: ["M9.4 2.8h3.8v3.8", "M13.2 2.8 8 8", "M12.4 9v3.2a1 1 0 0 1-1 1H3.6a1 1 0 0 1-1-1V4.4a1 1 0 0 1 1-1H7"],
  people: ["M10.6 13.4v-1.2a2.6 2.6 0 0 0-2.6-2.6H4.6A2.6 2.6 0 0 0 2 12.2v1.2", "M6.3 7.1a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6", "M14 13.4v-1.2a2.6 2.6 0 0 0-2-2.5", "M10.4 2.6a2.6 2.6 0 0 1 0 5"],
  sparkle: ["M8 2.2 9.3 6 13 7.3 9.3 8.6 8 12.4 6.7 8.6 3 7.3 6.7 6z", "M12.4 2.2v2.2", "M13.5 3.3h-2.2"],
  search: ["M11.4 7a4.4 4.4 0 1 1-8.8 0 4.4 4.4 0 0 1 8.8 0", "M10.3 10.3 14 14"],
  bell: ["M8 2.1a3.4 3.4 0 0 0-3.4 3.4v2.2L3.4 10.3h9.2l-1.2-2.6V5.5A3.4 3.4 0 0 0 8 2.1Z", "M6.5 12.1a1.6 1.6 0 0 0 3 0"],
  chevron: ["m5.8 3.4 4.4 4.6-4.4 4.6"],
  panel: ["M2.6 3.4h10.8v9.2H2.6z", "M6.4 3.4v9.2"],
}

function Icon({ name, className = "icon" }: { name: IconName; className?: string }) {
  /* Falls back to an empty path set rather than throwing: an unknown glyph
     should cost one icon, not the whole app. (It took the entire render down
     once already, via a nav item that was missing its `icon` field.) */
  const paths = ICON_PATHS[name] ?? []
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {paths.map((d, index) => (
        <path key={index} d={d} />
      ))}
    </svg>
  )
}

const navItems: Array<{
  tab: Tab
  label: string
  labelKo: string
  labelJa: string
  section?: boolean
  sectionKo?: string
  sectionEn?: string
  sectionJa?: string
  icon: IconName
  roles: Role[]
  count?: NavCount
}> = [
  { tab: "dashboard", label: "Dashboard", labelKo: "대시보드", labelJa: "ダッシュボード", icon: "dashboard", section: true, sectionKo: "개요", sectionEn: "Overview", sectionJa: "概要", roles: ["viewer", "member", "admin", "owner"] },
  { tab: "inbox", label: "Inbox", labelKo: "Inbox", labelJa: "Inbox", icon: "inbox", roles: ["viewer", "member", "admin", "owner"], count: "inbox" },
  { tab: "cards", label: "Cards", labelKo: "법인카드", labelJa: "法人カード", icon: "card", roles: ["viewer", "member", "admin", "owner"] },
  { tab: "submit", label: "Submit settlement", labelKo: "정산 신청", labelJa: "精算申請", section: true, sectionKo: "지출", sectionEn: "Spending", sectionJa: "支出", icon: "receipt", roles: ["member", "admin", "owner"] },
  { tab: "pre_spend", label: "Pre-spend approval", labelKo: "사전 사용 승인", labelJa: "事前利用承認", icon: "check", roles: ["member", "admin", "owner"], count: "pre_spend" },
  { tab: "usage", label: "Usage overview", labelKo: "사용 현황", labelJa: "利用状況", icon: "chart", roles: ["viewer", "member", "admin", "owner"] },
  { tab: "monitoring", label: "Monitoring", labelKo: "모니터링", labelJa: "モニタリング", icon: "pulse", roles: ["admin", "owner"], count: "monitoring" },
  { tab: "anomalies", label: "My anomalies", labelKo: "내 이상거래", labelJa: "自分の異常取引", icon: "alert", roles: ["member", "admin", "owner"], count: "anomalies" },
  { tab: "history", label: "Settlement history", labelKo: "정산 내역", labelJa: "精算履歴", icon: "history", roles: ["viewer", "member", "admin", "owner"], count: "claims" },
  { tab: "approvals", label: "Approval queue", labelKo: "결재 승인", labelJa: "決裁承認", section: true, sectionKo: "결재", sectionEn: "Approvals", sectionJa: "決裁", icon: "stamp", roles: ["admin", "owner"], count: "pending" },
  { tab: "analytics", label: "Statistics", labelKo: "통계", labelJa: "統計", icon: "bars", roles: ["admin", "owner"] },
  { tab: "upload", label: "Card statement upload", labelKo: "카드 사용내역 업로드", labelJa: "カード利用明細のアップロード", section: true, sectionKo: "회계", sectionEn: "Accounting", sectionJa: "会計", icon: "upload", roles: ["admin", "owner"] },
  { tab: "erp", label: "ERP export", labelKo: "ERP 출력", labelJa: "ERP出力", icon: "export", roles: ["admin", "owner"] },
  { tab: "members", label: "Org members", labelKo: "조직 멤버", labelJa: "組織メンバー", section: true, sectionKo: "조직", sectionEn: "Organization", sectionJa: "組織", icon: "people", roles: ["viewer", "member", "admin", "owner"] },
  { tab: "qa", label: "Q&A", labelKo: "Q&A", labelJa: "Q&A", icon: "sparkle", roles: ["viewer", "member", "admin", "owner"] },
]

const rejectionReasons = [
  {
    value: "missing_context",
    ko: "업무 목적 또는 참석자/프로젝트 정보가 부족합니다.",
    en: "Business purpose or attendee/project context is missing.",
    ja: "業務目的または参加者・プロジェクト情報が不足しています。",
  },
  {
    value: "receipt_unclear",
    ko: "증빙이 없거나 영수증 내용이 불명확합니다.",
    en: "Receipt is missing or the evidence is unclear.",
    ja: "証憑がないか、領収書の内容が不明瞭です。",
  },
  {
    value: "policy_exception",
    ko: "규정 예외로 판단되어 추가 소명이 필요합니다.",
    en: "This appears to be a policy exception and needs more explanation.",
    ja: "規程の例外と判断されるため、追加の説明が必要です。",
  },
  {
    value: "wrong_category",
    ko: "계정과목 또는 분류를 수정해야 합니다.",
    en: "Account/category needs correction.",
    ja: "勘定科目または分類の修正が必要です。",
  },
]

function text(lang: Lang, ko: string, en: string, ja: string) {
  if (lang === "ko") return ko
  if (lang === "ja") return ja
  return en
}

const LANG_LOCALES: Record<Lang, string> = { en: "en-US", ko: "ko-KR", ja: "ja-JP" }

function langLocale(lang: Lang) {
  return LANG_LOCALES[lang] ?? "en-US"
}

/* Module-level formatters (money, compactDate, ...) are called from many
   helpers that have no `lang` in scope. They take an optional `lang`, and fall
   back to the UI language the app last rendered with, which App keeps in sync. */
let currentFormatLang: Lang = "en"

function setFormatLang(lang: Lang) {
  currentFormatLang = lang
}

function resolvePlatformLanguage(language?: string | null): Lang {
  const normalized = String(language || "").trim().toLowerCase()
  if (normalized.startsWith("ko")) return "ko"
  if (normalized.startsWith("ja")) return "ja"
  if (normalized.startsWith("en")) return "en"
  return "en"
}

type ColorMode = "light" | "dark"

function prefersColorScheme(): ColorMode {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
  } catch {
    return "light"
  }
}

/**
 * Light/dark driven by the Palette OS appearance.
 *
 * Palette OS (>= @palettelab/sdk 0.1.24) reports the active mode through
 * `usePlatform().colorMode` and updates it live when the OS switches. Older
 * hosts don't send it, so we fall back to `prefers-color-scheme`.
 *
 * The local override takes precedence so the "d" shortcut still works in the
 * dev simulator, where `setColorMode` does not echo back into
 * `platform.colorMode`. In Palette OS `setColorMode` drives a real OS
 * appearance change that flows back through `colorMode`, keeping both in sync.
 */
function usePaletteColorMode(platform: PlatformContext): [ColorMode, (mode: ColorMode) => void] {
  const [fallback, setFallback] = useState<ColorMode>(prefersColorScheme)
  const [override, setOverride] = useState<ColorMode | null>(null)

  useEffect(() => {
    let media: MediaQueryList
    try {
      media = window.matchMedia("(prefers-color-scheme: dark)")
    } catch {
      return
    }
    const onChange = () => setFallback(media.matches ? "dark" : "light")
    onChange()
    media.addEventListener?.("change", onChange)
    return () => media.removeEventListener?.("change", onChange)
  }, [])

  const platformMode = (platform as { colorMode?: ColorMode }).colorMode
  const mode: ColorMode = override ?? platformMode ?? fallback

  const setMode = useCallback(
    (next: ColorMode) => {
      setOverride(next)
      ;(platform as { setColorMode?: (mode: ColorMode) => void }).setColorMode?.(next)
    },
    [platform],
  )

  // Press "d" to toggle. Ignored while typing in a field or when combined with
  // a modifier, so it never fights with text entry or shortcuts.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "d" && event.key !== "D") return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable) return
      event.preventDefault()
      setMode(mode === "dark" ? "light" : "dark")
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [mode, setMode])

  return [mode, setMode]
}

const styles = `
:host {
  display: block;
  height: 100%;
}
/* Accent + neutrals.
   The token NAMES are historical (this app started on a Starbucks-style green)
   and are deliberately left alone: ~1,700 lines of CSS below reference them, so
   retuning the values here restyles the whole app and keeps the change to one
   block. Previous green values are kept in the comment so the old identity is
   one edit away:
     --sb-green #006241  --sb-green-accent #00754a  --sb-green-dark #1e3932
     --sb-green-deeper #003e29  --sb-green-light #d4e9e2
     --cream #f2f0eb  --ceramic #edebe9  --surface-2 #f9f9f9  --line #e7e7e7 */
.cc-app {
  --sb-green: #5b5bd6;
  --sb-green-accent: #4f4fcf;
  --sb-green-dark: #2e2e6b;
  --sb-green-deeper: #242456;
  --sb-green-light: #eef0fd;
  --gold: #b4842c;
  /* --page is the ground the shell sits on; --surface is the floating panel
     and every card inside it. Keeping them distinct is what lets the working
     area read as a raised sheet instead of a full-bleed wash. */
  --page: #f2f3f6;
  --cream: #f8f9fb;
  --ceramic: #eff1f5;
  --surface: #ffffff;
  --surface-2: #fafbfc;
  --line: #eaecf0;
  --line-2: #d8dce3;
  --text: #101828;
  --text-2: #475467;
  --text-3: #667085;
  --text-4: #98a2b3;
  --danger: #c82014;
  --danger-soft: rgba(200, 32, 20, 0.07);
  --warn: #b25e09;
  --warn-soft: rgba(178, 94, 9, 0.1);
  --ok: #1f8a5b;
  --ok-soft: rgba(31, 138, 91, 0.11);
  --info: #2563eb;
  --info-soft: rgba(37, 99, 235, 0.1);
  --focus-ring: rgba(91, 91, 214, 0.22);
  --shadow-card: 0 1px 2px rgba(16, 24, 40, 0.04);
  --shadow-panel: 0 1px 3px rgba(16, 24, 40, 0.06), 0 8px 24px -12px rgba(16, 24, 40, 0.10);
  --shadow-raised: 0 1px 2px rgba(16, 24, 40, 0.06), 0 1px 1px rgba(16, 24, 40, 0.04);
  --radius-sm: 8px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-panel: 16px;
  /* Motion. The file had none at all before this restyle; every duration below
     is routed through these so the reduced-motion block can zero them once. */
  --dur-fast: 120ms;
  --dur-base: 180ms;
  --ease: cubic-bezier(0.22, 0.61, 0.36, 1);
  color: var(--text);
  background: var(--cream);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Apple SD Gothic Neo", "Noto Sans KR", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Meiryo", "Noto Sans JP", sans-serif;
  font-size: 13.5px;
  line-height: 1.5;
  letter-spacing: -0.01em;
  /* Fill whatever the host hands us, and depend on nothing above this element:
     the platform scopes plugin CSS under [data-palette-plugin-root] and
     rewrites html/body/:root into it, so the app can never give its own
     ancestors a height.
     Inside the OS the plugin root is a tab pane with a definite height, so
     max-height:100% resolves and clamps the shell to the pane. The pltt dev
     simulator mounts into a min-height:100vh wrapper with NO definite height,
     where a
     percentage height computes to auto (the shell used to collapse to its
     content and leave the simulator background showing beneath it) and a
     percentage max-height computes to none -- so the viewport height wins
     there. One declaration block, correct under both hosts. */
  height: 100vh;
  height: 100dvh;
  max-height: 100%;
  min-height: 0;
  overflow-y: auto;
}

/* Dark appearance. Driven by Palette OS via usePlatform().colorMode — the
   class is applied to the token root, so every var(--token) below flips with
   it. Brand green stays saturated enough to keep #fff foregrounds legible. */
.cc-app.dark {
  --sb-green: #8b8bf0;
  --sb-green-accent: #a0a0f5;
  --sb-green-dark: #2b2b5c;
  --sb-green-deeper: #1f1f45;
  --sb-green-light: rgba(139, 139, 240, 0.16);
  --gold: #d9b978;
  --focus-ring: rgba(139, 139, 240, 0.30);
  --page: #0c0d10;
  --cream: #101114;
  --ceramic: #17191d;
  --surface: #1a1c21;
  --surface-2: #1f2228;
  --line: #2a2e35;
  --line-2: #383d46;
  --text: rgba(255, 255, 255, 0.92);
  --text-2: rgba(255, 255, 255, 0.72);
  --text-3: rgba(255, 255, 255, 0.56);
  --text-4: rgba(255, 255, 255, 0.38);
  --danger: #ff6f61;
  --danger-soft: rgba(255, 111, 97, 0.13);
  --warn: #e29a45;
  --warn-soft: rgba(226, 154, 69, 0.14);
  --ok: #3fbc8b;
  --ok-soft: rgba(63, 188, 139, 0.15);
  --info: #6ba4ff;
  --info-soft: rgba(107, 164, 255, 0.14);
  --shadow-card: 0 1px 2px rgba(0, 0, 0, 0.5), 0 1px 3px rgba(0, 0, 0, 0.4);
  color-scheme: dark;
}
/* The few rules that hardcode a light value instead of a token. */
.cc-app.dark .sb-item:hover {
  background: rgba(255, 255, 255, 0.06);
}
.cc-app.dark .upload-zone {
  background: linear-gradient(180deg, var(--surface-2), var(--ceramic));
}
.cc-app.dark .warning {
  background: var(--warn-soft);
  color: var(--warn);
}
.cc-app.dark input,
.cc-app.dark select,
.cc-app.dark textarea {
  color-scheme: dark;
}
/* Surfaces whose base rule hardcodes paper-white. Their text comes from
   --text, which flips to near-white in dark mode, so the panel has to flip with
   it or the text lands on white. --panel-dark is the neutral bubble grey
   sampled from the reference (ChatGPT dark, #2b2b2b). */
.cc-app.dark {
  --panel-dark: #2b2b2b;
}
.cc-app.dark .bubble-bot {
  background: var(--panel-dark);
  color: var(--text);
}
.cc-app.dark .chip.suggest {
  background: var(--surface);
}
.cc-app.dark .receipt-paper-wrap {
  background: linear-gradient(180deg, var(--ceramic), var(--cream));
}
.cc-app.dark .receipt-paper {
  background: var(--panel-dark);
  color: var(--text);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.45);
}
.cc-app.dark .receipt-paper::before,
.cc-app.dark .receipt-paper::after {
  background: repeating-linear-gradient(90deg, transparent 0 10px, rgba(255, 255, 255, 0.14) 10px 20px);
}
.cc-app.dark .receipt-paper hr {
  border-top-color: rgba(255, 255, 255, 0.28);
}
.cc-app.dark .receipt-note {
  color: var(--text-3);
}
.cc-app.dark .approval-step {
  background: var(--surface);
}
.cc-app.dark .button-danger {
  background: var(--surface);
}
.cc-app.dark .donut::after,
.cc-app.dark .bi-donut::after {
  background: var(--surface);
}
/* ---- Docked assistant ---------------------------------------------------- */
.assistant {
  min-width: 0;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-panel);
  box-shadow: var(--shadow-panel);
  /* Collapsed the column is 0px wide; visibility keeps the contents out of the
     tab order and the accessibility tree without a second render path. */
  visibility: hidden;
  opacity: 0;
  transition: opacity var(--dur-base) var(--ease), visibility 0s linear var(--dur-base);
}
.app-shell.assistant-open .assistant {
  visibility: visible;
  opacity: 1;
  transition: opacity var(--dur-base) var(--ease), visibility 0s;
}
.assistant-head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 14px 14px 13px;
  border-bottom: 1px solid var(--line);
  flex: 0 0 auto;
}
.assistant-mark {
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  border-radius: var(--radius-sm);
  background: var(--sb-green-light);
  color: var(--sb-green);
  display: grid;
  place-items: center;
}
.assistant-head-text {
  flex: 1;
  min-width: 0;
}
.assistant-title {
  color: var(--text);
  font-size: 13.5px;
  font-weight: 750;
}
.assistant-sub {
  margin-top: 2px;
  color: var(--text-3);
  font-size: 11.5px;
  line-height: 16px;
}
.assistant-close {
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-3);
  display: grid;
  place-items: center;
  cursor: pointer;
}
.assistant-close:hover {
  background: var(--ceramic);
  color: var(--text);
}
.assistant-thread {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: var(--cream);
}
.assistant-intro-lead {
  margin: 0 0 12px;
  color: var(--text-2);
  font-size: 12.5px;
  line-height: 19px;
}
.assistant-suggests {
  display: grid;
  gap: 7px;
}
.assistant-suggest {
  text-align: left;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text-2);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}
.assistant-suggest:hover {
  border-color: var(--sb-green);
  color: var(--sb-green);
}
.assistant-turn {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
.assistant-turn.is-user {
  align-items: flex-end;
}
/* The thread is narrow, so the bubbles take nearly all of it -- the 78% cap
   used in the wide Q&A pane would waste a third of the panel here. */
.assistant-turn .bubble-bot,
.assistant-turn .bubble-user {
  max-width: 94%;
  padding: 11px 13px;
  font-size: 12.5px;
  line-height: 19px;
}
.assistant-line {
  margin: 0;
}
.assistant-line:not(:last-child) {
  margin-bottom: 7px;
}
/* An empty line in the model's reply is a paragraph break, not a gap to keep. */
.assistant-line:empty {
  display: none;
}
.assistant-thinking {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.assistant-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--text-4);
  animation: assistant-pulse 1.1s infinite ease-in-out;
}
.assistant-dot:nth-child(2) { animation-delay: 0.15s; }
.assistant-dot:nth-child(3) { animation-delay: 0.3s; }
@keyframes assistant-pulse {
  0%, 80%, 100% { opacity: 0.25; }
  40% { opacity: 1; }
}
.assistant-error {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: var(--danger-soft);
  color: var(--danger);
  font-size: 12px;
}
.assistant-retry {
  margin-left: auto;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-weight: 800;
  text-decoration: underline;
  cursor: pointer;
}
.assistant-compose {
  flex: 0 0 auto;
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid var(--line);
  background: var(--surface);
}
.assistant-input {
  flex: 1;
  min-width: 0;
  max-height: 132px;
  resize: none;
  padding: 9px 11px;
  border: 1px solid var(--line-2);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 12.5px;
  line-height: 18px;
}
.assistant-send {
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  border: 0;
  border-radius: var(--radius-sm);
  background: var(--sb-green);
  color: #fff;
  display: grid;
  place-items: center;
  cursor: pointer;
}
.assistant-send:disabled {
  background: var(--line-2);
  cursor: not-allowed;
}
.topbar-ai.on {
  border-color: var(--sb-green);
  background: var(--sb-green-light);
  color: var(--sb-green);
}
/* Visible only to assistive technology -- used for the field label and the
   pending-answer announcement. */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
/* Focus. There were zero :focus-visible rules before this: interactive
   elements fell back to the UA ring, a 1px browser blue that reads as a
   foreign object against this palette. One rule, every control. */
.cc-app :focus-visible {
  outline: 2px solid var(--sb-green);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}
/* Honour the OS setting for everything this restyle animates. */
@media (prefers-reduced-motion: reduce) {
  .cc-app {
    --dur-fast: 0ms;
    --dur-base: 0ms;
  }
  .cc-app *,
  .cc-app *::before,
  .cc-app *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
.cc-app * {
  box-sizing: border-box;
}
.app-shell {
  display: grid;
  /* The rail/sidebar swap animates the COLUMN, not a class on the sidebar:
     interpolating grid-template-columns slides the panel and reflows the
     working area with it, where a width class change jumps in one frame. */
  transition: grid-template-columns var(--dur-base) var(--ease);
  height: 100%;
  min-height: 0;
  /* The working area is a sheet floating on the page ground, with the nav
     rail sitting directly on that ground -- the arrangement the reference
     uses. Padding insets the sheet; box-sizing keeps it inside the shell. */
  gap: 10px;
  padding: 10px 10px 10px 4px;
  background: var(--page);
}
/* The assistant is a column of the shell, so opening it REFLOWS the working
   area instead of covering it: the whole point is to read the table and ask
   about it at the same time. Routed through custom properties so the rail's
   collapsed state and the panel's open state compose without four rules. */
.app-shell {
  grid-template-columns: var(--rail, 248px) minmax(0, 1fr) var(--aside, 0px);
}
.app-shell:has(.sidebar.collapsed) {
  --rail: 64px;
}
.app-shell.assistant-open {
  --aside: 384px;
}

.sidebar {
  background: transparent;
  border-right: 0;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
.sb-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 56px;
  padding: 0 10px;
  flex: 0 0 auto;
}
.sb-brand-mark {
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  border-radius: var(--radius-sm);
  background: var(--sb-green);
  color: #fff;
  display: grid;
  place-items: center;
}
.sb-brand-name {
  flex: 1;
  min-width: 0;
  font-size: 13.5px;
  font-weight: 850;
  letter-spacing: -0.015em;
  white-space: nowrap;
  overflow: hidden;
  opacity: 1;
  transition: opacity var(--dur-fast) var(--ease);
}
.sb-collapse {
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-3);
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}
.sb-collapse:hover {
  background: var(--ceramic);
  color: var(--text);
}
/* Collapsed: the brand name and every nav label fold away, leaving a 64px icon
   rail. The label keeps its own overflow so nothing spills mid-transition. */
.sidebar.collapsed .sb-brand {
  padding: 0 10px;
  justify-content: center;
}
.sidebar.collapsed .sb-brand-name,
.sidebar.collapsed .sb-collapse {
  display: none;
}
.sidebar.collapsed .sb-item {
  padding: 8px 0;
  justify-content: center;
}
.sidebar.collapsed .sb-label {
  display: none;
}
.sidebar.collapsed .sb-count {
  position: absolute;
  top: 3px;
  right: 6px;
  min-width: 16px;
  padding: 0 4px;
  font-size: 9.5px;
}
.sidebar.collapsed .sb-footer .sb-user-info {
  display: none;
}
.sidebar.collapsed .sb-user-row {
  justify-content: center;
  padding: 4px 0;
}
.avatar,
.role-mark {
  background: var(--sb-green);
  color: #fff;
  display: grid;
  place-items: center;
  font-weight: 800;
}
.sb-section-label {
  margin: 14px 12px 4px;
  color: var(--text-4);
  font-size: 9.5px;
  font-weight: 850;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.sb-nav > .sb-section-label:first-child {
  margin-top: 4px;
}
/* Claims the .sb-user-info hook, which the markup has always used and the
   stylesheet never defined. */
.sb-user-info {
  min-width: 0;
  flex: 1;
}
.sb-nav {
  flex: 1;
  overflow-y: auto;
  padding: 12px 10px;
  display: grid;
  align-content: start;
  gap: 2px;
}
.sb-item {
  position: relative;
  width: 100%;
  min-height: 36px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-2);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  font: inherit;
  font-weight: 650;
  text-align: left;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}
.sb-item .icon {
  flex: 0 0 auto;
  opacity: 0.75;
}
.sb-item.active .icon {
  opacity: 1;
}
.sb-item:hover:not(.active) {
  background: rgba(0, 0, 0, 0.04);
  color: var(--text);
}
.sb-item.active {
  background: var(--surface);
  border-color: var(--line);
  color: var(--text);
  box-shadow: var(--shadow-raised);
}
.sb-label {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sb-count {
  min-width: 20px;
  border-radius: 999px;
  padding: 1px 7px;
  background: var(--ceramic);
  color: var(--text-2);
  font-size: 10.5px;
  font-weight: 800;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.sb-count.urgent {
  background: var(--danger);
  color: #fff;
}
.sb-item.active .sb-count {
  background: var(--sb-green);
  color: #fff;
}
.sb-footer {
  padding: 10px 10px 12px;
  border-top: 1px solid var(--line);
}
.sb-user-row {
  display: flex;
  gap: 10px;
  padding: 4px 12px;
  align-items: center;
}
.avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  font-size: 10px;
}
.sb-user-name {
  font-size: 12.5px;
  font-weight: 800;
}
.sb-user-mail {
  color: var(--text-3);
  font-size: 10.5px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.main {
  min-width: 0;
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  scrollbar-gutter: stable;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-panel);
  box-shadow: var(--shadow-panel);
}
.topbar {
  height: 65px;
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 20px;
  background: var(--surface);
  border-bottom: 1px solid var(--line);
  border-radius: var(--radius-panel) var(--radius-panel) 0 0;
}
.topbar-heading {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1 1 auto;
}
.topbar-page-icon {
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  border-radius: var(--radius-sm);
  background: var(--ceramic);
  color: var(--text-2);
  display: grid;
  place-items: center;
}
.topbar-heading-text {
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.topbar-ai {
  gap: 6px;
}
.topbar-eyebrow {
  color: var(--text-3);
  font-size: 11px;
  font-weight: 750;
  letter-spacing: 0.02em;
}
.topbar-page {
  color: var(--text);
  font-size: 16px;
  font-weight: 800;
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* Fixed-basis controls: the action rail keeps one width whatever page, role,
   or locale is selected, so nothing in the bar resizes as you navigate. */
.topbar-actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
}
.btn-primary,
.btn-secondary {
  height: 34px;
  min-width: 150px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 16px;
  border-radius: 6px;
  font: inherit;
  font-weight: 750;
  white-space: nowrap;
  cursor: pointer;
}
.btn-primary {
  border: 1px solid var(--sb-green);
  background: var(--sb-green);
  color: #fff;
}
.btn-primary:hover:not(:disabled) {
  background: var(--sb-green-accent);
  border-color: var(--sb-green-accent);
  border-color: var(--sb-green-deeper);
}
.btn-secondary {
  border: 1px solid var(--line-2);
  background: var(--surface);
  color: var(--text-2);
}
.btn-secondary:hover:not(:disabled) {
  background: var(--surface-2);
  color: var(--text);
}
.btn-primary:disabled,
.btn-secondary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.topbar-clear {
  min-width: 88px;
}
.topbar-search {
  flex: 0 0 240px;
  width: 240px;
  height: 34px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 11px;
  border: 1px solid var(--line-2);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text-3);
}
/* The WRAPPER shows focus, not the input inside it. A text input matches
   :focus-visible on click as well as on keyboard, so the global focus ring was
   being drawn inside the 240px pill -- a boxed-in outline around the text with
   nowhere to go. The wrapper takes a ring the input then must not repeat. */
.topbar-search:focus-within {
  border-color: var(--sb-green);
  box-shadow: 0 0 0 3px var(--focus-ring);
}
.cc-app .topbar-search input:focus-visible {
  outline: none;
}
.topbar-search input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
}
.icon {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.kbd-hint {
  flex: 0 0 auto;
  min-width: 18px;
  padding: 1px 5px;
  border: 1px solid var(--line-2);
  border-radius: 5px;
  background: var(--surface);
  color: var(--text-4);
  font-family: inherit;
  font-size: 10.5px;
  font-weight: 700;
  line-height: 15px;
  text-align: center;
}
.topbar-search:focus-within .kbd-hint {
  opacity: 0;
}
.topbar-bell {
  position: relative;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border: 1px solid var(--line-2);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text-2);
  cursor: pointer;
}
.topbar-bell:hover {
  background: var(--surface-2);
  color: var(--text);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
.topbar-bell-count {
  position: absolute;
  top: -6px;
  right: -6px;
  min-width: 17px;
  height: 17px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--danger);
  color: #fff;
  border: 2px solid var(--surface);
  font-size: 10px;
  line-height: 13px;
  display: grid;
  place-items: center;
}
/* Full bleed. The working area IS the page: a centred 1320px cap left wide
   displays with dead gutters while the tables inside scrolled in a narrow
   column. Horizontal padding matches the topbar's so the page heading and the
   content beneath it share one left edge at every breakpoint. */
.content {
  padding: 22px 20px 72px;
}
.page-head {
  margin-bottom: 16px;
}
.eyebrow {
  margin: 0 0 8px;
  color: var(--sb-green);
  font-size: 12px;
  font-weight: 850;
  text-transform: uppercase;
}
.page-title {
  margin: 0;
  color: var(--text);
  font-size: 18px;
  line-height: 26px;
  font-weight: 750;
  letter-spacing: -0.015em;
}
.page-desc {
  margin: 5px 0 0;
  color: var(--text-3);
  font-size: 14px;
  line-height: 22px;
  max-width: 780px;
}
.role-strip {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  margin-bottom: 18px;
  background: var(--surface);
  border-left: 3px solid var(--sb-green);
  border-radius: 8px;
  box-shadow: var(--shadow-card);
  color: var(--text-2);
}
.role-mark {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  font-size: 10px;
}
.hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 24px;
  align-items: center;
  padding: 23px 26px 24px;
  margin-bottom: 18px;
  border-radius: 12px;
  background: var(--sb-green-dark);
  color: #fff;
}
.hero-eyebrow {
  color: var(--gold);
  font-size: 11px;
  font-weight: 850;
  text-transform: uppercase;
  margin-bottom: 8px;
}
.hero-title {
  margin: 0;
  color: #fff;
  font-size: 22px;
  line-height: 1.32;
  font-weight: 800;
}
.hero-sub {
  margin: 8px 0 0;
  color: rgba(255, 255, 255, 0.72);
  max-width: 600px;
}
.hero-cta {
  display: inline-flex;
  min-height: 42px;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 22px;
  border: 0;
  border-radius: 999px;
  background: #fff;
  color: var(--sb-green);
  font: inherit;
  font-weight: 850;
  cursor: pointer;
  white-space: nowrap;
}
.grid {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: 16px;
}
.col-12 { grid-column: span 12; }
.col-8 { grid-column: span 8; }
.col-7 { grid-column: span 7; }
.col-6 { grid-column: span 6; }
.col-5 { grid-column: span 5; }
.col-4 { grid-column: span 4; }
.col-3 { grid-column: span 3; }
.dash-card,
.card,
.metric,
.quick {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: none;
}
.dash-card,
.card {
  padding: 18px 22px 20px;
}
.card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
.card-title {
  color: var(--text);
  font-size: 14px;
  font-weight: 800;
  line-height: 20px;
}
.card-sub {
  margin-top: 3px;
  color: var(--text-3);
  font-size: 11.5px;
  line-height: 16px;
}
.card-link {
  border: 0;
  background: transparent;
  color: var(--sb-green);
  font: inherit;
  font-size: 12px;
  font-weight: 850;
  cursor: pointer;
}
.metric {
  padding: 12px;
  background: var(--surface-2);
  border: 1px solid var(--line);
  box-shadow: none;
}
/* The figure sits in its own inset panel. It is what separates a KPI tile
   from a bordered box with a big number in it: the label reads as a caption
   on the tile, the figure as the content it captions. */
.metric-body {
  margin-top: 10px;
  padding: 12px 12px 13px;
  border-radius: var(--radius-sm);
  background: var(--surface);
  border: 1px solid var(--line);
}
.metric-foot {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 9px;
  min-height: 21px;
}
.metric-pill {
  display: inline-flex;
  align-items: center;
  min-height: 21px;
  padding: 0 7px;
  border-radius: 6px;
  background: var(--ok-soft);
  color: var(--ok);
  font-size: 11px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.metric-pill.warn { background: var(--warn-soft); color: var(--warn); }
.metric-pill.danger { background: var(--danger-soft); color: var(--danger); }
.metric-pill.info { background: var(--info-soft); color: var(--info); }
.metric-pill.mute { background: var(--ceramic); color: var(--text-3); }
.metric-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}
.metric-icon {
  width: 24px;
  height: 24px;
  flex: 0 0 auto;
  border-radius: var(--radius-sm);
  background: var(--ceramic);
  color: var(--text-3);
  display: grid;
  place-items: center;
}
/* Cards page cells. */
.cell-person {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.cell-person-text {
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.card-digits {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: 0.02em;
}
.usage-head,
.usage-cell .bar-track {
  max-width: 320px;
}
.usage-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
}
.usage-amount {
  color: var(--text);
  font-size: 12.5px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
/* The limit is context for the amount, not a second figure: same line, lighter
   weight and colour, so the eye lands on what was spent. */
.usage-limit {
  color: var(--text-3);
  font-weight: 550;
}
.usage-pct {
  font-size: 12px;
  font-weight: 750;
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}
.usage-pct.warn { color: var(--warn); }
.usage-pct.over { color: var(--danger); }
.bar-fill.warn { background: var(--warn); }
.bar-fill.over { background: var(--danger); }
th.num,
td.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.metric-label {
  color: var(--text-2);
  font-size: 12.5px;
  font-weight: 700;
  letter-spacing: 0;
}
.metric-value {
  color: var(--text);
  font-size: 28px;
  line-height: 34px;
  font-weight: 800;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}
.metric-value.ok { color: var(--ok); }
.metric-value.warn { color: var(--warn); }
.metric-value.danger { color: var(--danger); }
.metric-value.info { color: var(--info); }
.metric-sub {
  color: var(--text-3);
  font-size: 11.5px;
  line-height: 16px;
}
.quick-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}
.quick {
  border: 0;
  padding: 16px;
  text-align: left;
  font: inherit;
  cursor: pointer;
}
.quick:hover {
  transform: translateY(-1px);
}
.quick-icon {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  background: var(--sb-green-light);
  color: var(--sb-green);
  display: grid;
  place-items: center;
  margin-bottom: 10px;
}
.quick-title {
  display: block;
  font-size: 13.5px;
  font-weight: 850;
}
.quick-sub {
  /* display:block is load-bearing: these are <span> elements, and on an inline box
     the margin-top below is ignored — which ran the title and subtitle
     together on the dashboard. */
  display: block;
  margin-top: 3px;
  color: var(--text-3);
  font-size: 11.5px;
  line-height: 1.45;
}
.list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin: 6px -10px -4px;
}
.list-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px;
  border-radius: 8px;
}
.list-row.clickable {
  cursor: pointer;
}
.list-row.clickable:hover {
  background: var(--cream);
}
.list-main {
  flex: 1;
  min-width: 0;
}
.line-1 {
  color: var(--text);
  font-size: 13px;
  font-weight: 800;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.line-2 {
  color: var(--text-3);
  font-size: 11.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.row-meta {
  color: var(--text);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  font-weight: 800;
  text-align: right;
}
.empty {
  padding: 24px 8px;
  text-align: center;
  color: var(--text-3);
}
.pill {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  border-radius: 6px;
  padding: 0 8px;
  background: var(--ceramic);
  color: var(--text-2);
  font-size: 11.5px;
  font-weight: 750;
  text-transform: capitalize;
  white-space: nowrap;
}
.pill.pending,
.pill.warn,
.pill.missing,
.pill.pre_approval_matched,
.pill.needs_info,
.pill.warning,
.pill.exception_required {
  background: var(--warn-soft);
  color: var(--warn);
}
.pill.approved,
.pill.ok,
.pill.active,
.pill.matched,
.pill.claim_created,
.pill.compliant,
.pill.exception_approved,
.pill.used {
  background: var(--ok-soft);
  color: var(--ok);
}
.pill.duplicate {
  background: var(--info-soft);
  color: var(--info);
}
.pill.rejected,
.pill.blocked,
.pill.danger {
  background: var(--danger-soft);
  color: var(--danger);
}
.pill.info {
  background: var(--info-soft);
  color: var(--info);
}
.button,
.button-secondary,
.button-danger,
.icon-button {
  border-radius: 999px;
  border: 1px solid transparent;
  min-height: 36px;
  padding: 0 14px;
  font: inherit;
  font-weight: 850;
  cursor: pointer;
}
.button {
  background: var(--sb-green-accent);
  color: #fff;
}
.button:hover {
  background: var(--sb-green-dark);
}
.button-secondary {
  background: var(--surface);
  border-color: var(--line-2);
  color: var(--text);
}
.button-danger {
  background: #fff;
  border-color: rgba(200, 32, 20, 0.28);
  color: var(--danger);
}
.button:disabled,
.button-secondary:disabled,
.button-danger:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.42);
}
.modal-panel {
  width: min(960px, 100%);
  max-height: min(760px, calc(100vh - 48px));
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
  box-shadow: 0 24px 70px rgba(15, 23, 42, 0.28);
  overflow: hidden;
}
.confirm-panel {
  width: min(440px, 100%);
  max-height: none;
  display: block;
  padding: 22px 22px 18px;
}
.confirm-title {
  font-size: 12.5px;
  font-weight: 900;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.confirm-desc {
  margin-top: 10px;
  color: var(--text-2);
  font-size: 12.5px;
  line-height: 1.5;
}
.confirm-footer {
  margin-top: 20px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.button-destructive {
  min-height: 36px;
  padding: 0 16px;
  border: 1px solid var(--danger);
  border-radius: 999px;
  background: var(--danger);
  color: #fff;
  font: inherit;
  font-weight: 850;
  cursor: pointer;
}
.button-destructive:hover:not(:disabled) {
  filter: brightness(0.93);
}
.button-destructive:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 16px 18px;
  border-bottom: 1px solid var(--line);
}
.modal-title {
  min-width: 0;
  font-weight: 900;
}
.modal-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.modal-form {
  display: grid;
  gap: 14px;
  padding: 18px;
  overflow-y: auto;
}
.modal-note {
  color: var(--text-2);
  font-size: 12.5px;
  line-height: 1.45;
}
.receipt-preview {
  min-height: 420px;
  display: grid;
  place-items: center;
  padding: 18px;
  background: var(--cream);
}
.receipt-preview img,
.receipt-preview iframe {
  width: 100%;
  height: min(620px, calc(100vh - 190px));
  border: 0;
  border-radius: 6px;
  background: #fff;
  object-fit: contain;
}
.receipt-preview img {
  width: auto;
  max-width: 100%;
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}
/* Pushed to the trailing edge: filters narrow what is on screen, the action
   adds to it, and keeping them at opposite ends stops the primary button
   from reading as one more filter. */
.toolbar-action {
  margin-left: auto;
  gap: 6px;
}
.chip-count {
  color: var(--text-4);
  font-weight: 750;
  font-variant-numeric: tabular-nums;
}
.chip.active .chip-count {
  color: inherit;
  opacity: 0.7;
}
.chip-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 18px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 0 12px;
  border: 1px solid var(--line-2);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text-2);
  font: inherit;
  font-size: 12.5px;
  font-weight: 650;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease);
}
.chip:hover:not(.active) {
  background: var(--surface-2);
}
.chip.active {
  border-color: var(--sb-green);
  background: var(--sb-green-light);
  color: var(--sb-green);
}
.field {
  display: grid;
  gap: 6px;
  color: var(--text-2);
  font-size: 12px;
  font-weight: 850;
}
.input,
.select,
.textarea {
  width: 100%;
  min-height: 38px;
  border: 1px solid var(--line-2);
  border-radius: 4px;
  background: var(--surface);
  color: var(--text);
  padding: 0 10px;
  font: inherit;
  outline: 0;
}
.textarea {
  min-height: 92px;
  padding: 9px 10px;
  resize: vertical;
}
.input:focus,
.select:focus,
.textarea:focus {
  border-color: var(--sb-green-accent);
  box-shadow: 0 0 0 3px rgba(0, 117, 74, 0.12);
}
.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.form-grid .wide {
  grid-column: 1 / -1;
}
.budget-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}
.budget-field {
  display: grid;
  gap: 5px;
  color: var(--text-3);
  font-size: 11px;
  font-weight: 850;
}
.field-note {
  color: var(--text-3);
  font-size: 11.5px;
  font-weight: 750;
}
.upload-zone {
  min-height: 176px;
  border: 1px dashed var(--line-2);
  border-radius: 12px;
  background: linear-gradient(180deg, #fff, var(--surface-2));
  display: grid;
  place-items: center;
  padding: 22px;
  text-align: center;
}
.upload-icon {
  width: 44px;
  height: 44px;
  margin: 0 auto 10px;
  border-radius: 50%;
  background: var(--sb-green-light);
  color: var(--sb-green);
  display: grid;
  place-items: center;
  font-size: 22px;
  font-weight: 900;
}
.file-name {
  color: var(--text);
  font-weight: 800;
  word-break: break-word;
}
.hidden-file {
  display: none;
}
.stepper {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 16px;
}
.stepper.v9 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0;
  padding: 18px 22px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: var(--shadow-card);
}
.step-card {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 12px;
  border-radius: 12px;
  background: var(--surface);
  box-shadow: var(--shadow-card);
}
.stepper.v9 .step-card {
  box-shadow: none;
  border-radius: 0;
  padding: 8px 16px;
  position: relative;
}
.stepper.v9 .step-card:not(:last-child)::after {
  content: "";
  position: absolute;
  right: -8px;
  top: 50%;
  width: 46%;
  height: 1px;
  background: var(--line);
  transform: translateY(-50%);
}
.step-card.done .step-num,
.step-card.active .step-num {
  background: var(--sb-green);
  color: #fff;
}
.step-card.idle .step-num {
  background: var(--surface);
  color: var(--text-3);
  border: 1px solid var(--line-2);
}
.step-num {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--sb-green);
  color: #fff;
  font-weight: 850;
}
.step-title {
  font-weight: 850;
}
.step-sub {
  color: var(--text-3);
  font-size: 11.5px;
}
.submit-split,
.usage-main-grid,
.anomaly-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
}
.field-required {
  margin-left: 4px;
  color: var(--warn);
  font-size: 10.5px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.locality-cell {
  min-width: 0;
}
.locality-edit {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
.locality-edit .input {
  min-width: 0;
  flex: 1;
}
.receipt-head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}
/* Sits under the drop zone rather than inside it: the zone is one big label,
   and a button nested in a label steals the click that opens the picker. */
.upload-draft-note {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 12px;
  padding: 11px 13px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--text-2);
  font-size: 12px;
  line-height: 18px;
}
.upload-draft-note > span {
  flex: 1;
  min-width: 220px;
}
.receipt-paper-wrap {
  min-height: 430px;
  background: linear-gradient(180deg, #fbfbfb, #f0f0f0);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
}
.receipt-paper {
  width: min(350px, 88%);
  background: #fff;
  color: #333;
  padding: 28px 34px;
  box-shadow: 0 12px 28px rgba(0,0,0,.08);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 1.6;
  position: relative;
}
.receipt-paper::before,
.receipt-paper::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  height: 8px;
  background: repeating-linear-gradient(90deg, transparent 0 10px, rgba(0,0,0,.08) 10px 20px);
}
.receipt-paper::before { top: 0; }
.receipt-paper::after { bottom: 0; }
.receipt-note {
  color: #666;
}
.receipt-line {
  display: flex;
  justify-content: space-between;
  gap: 16px;
}
.receipt-paper hr {
  border: 0;
  border-top: 1px dashed #aaa;
  margin: 12px 0;
}
.chat-card {
  min-height: 560px;
  display: flex;
  flex-direction: column;
}
.chat-area {
  flex: 1;
  min-height: 360px;
  background: var(--ceramic);
  padding: 26px;
  display: grid;
  align-content: start;
  gap: 14px;
  border-top: 1px solid var(--line);
}
.bubble-bot,
.bubble-user {
  max-width: 78%;
  border-radius: 16px;
  padding: 16px 18px;
  box-shadow: var(--shadow-card);
}
.bubble-bot {
  background: #fff;
  justify-self: start;
  border-bottom-left-radius: 4px;
}
.bubble-user {
  background: var(--sb-green);
  color: #fff;
  justify-self: end;
  border-bottom-right-radius: 4px;
}
.bubble-meta {
  font-size: 10px;
  font-weight: 900;
  letter-spacing: .14em;
  color: var(--sb-green);
  margin-bottom: 8px;
}
.chip-row.wrap {
  flex-wrap: wrap;
}
.chip.suggest {
  background: #fff;
}
.submit-form-panel {
  margin-top: 16px;
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr);
  gap: 16px;
}
.paid-total {
  text-align: center;
  padding: 22px 0 20px;
  border-bottom: 1px solid var(--line);
  margin-bottom: 20px;
}
.paid-total .amount {
  font-size: 48px;
  line-height: 1;
  font-weight: 900;
  color: var(--text);
}
.ai-suggestion {
  margin-top: 20px;
  padding: 14px 16px;
  background: var(--ok-soft);
  border-left: 3px solid var(--sb-green);
}
.scope-banner {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 12px 14px;
  border-left: 3px solid var(--sb-green);
  background: var(--surface);
  box-shadow: var(--shadow-card);
  margin-bottom: 16px;
}
.scope-banner.warn {
  border-left-color: var(--warn);
  background: var(--warn-soft);
}
.view-scope {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  background: var(--surface);
  border: 1px solid var(--line);
  padding: 4px 4px 4px 14px;
  margin-bottom: 16px;
}
.view-scope-label {
  font-size: 10px;
  font-weight: 800;
  color: var(--text-3);
  text-transform: uppercase;
  letter-spacing: .14em;
  padding-right: 10px;
  border-right: 1px solid var(--line);
}
.line-chart {
  height: 250px;
  display: flex;
  align-items: end;
  gap: 10px;
  padding: 18px 8px 8px;
}
.line-chart-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  min-width: 28px;
}
.line-chart-bar {
  width: 100%;
  min-height: 18px;
  background: linear-gradient(180deg, var(--sb-green-accent), var(--sb-green-dark));
}
.line-chart-label {
  font-size: 10px;
  color: var(--text-3);
}
.donut-wrap {
  display: grid;
  grid-template-columns: 190px minmax(0, 1fr);
  gap: 22px;
  align-items: center;
  min-height: 250px;
}
.donut {
  width: 180px;
  height: 180px;
  border-radius: 50%;
  background: conic-gradient(var(--sb-green) 0 36%, #cba258 36% 64%, #1e3932 64% 84%, #b8c4bd 84% 94%, #e2ded6 94% 100%);
  position: relative;
}
.donut::after {
  content: "";
  position: absolute;
  inset: 42px;
  border-radius: 50%;
  background: #fff;
}
.donut-center {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  text-align: center;
  z-index: 1;
  font-weight: 900;
}
.legend-list {
  display: grid;
  gap: 8px;
}
.legend-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-2);
}
.legend-dot {
  width: 10px;
  height: 10px;
  background: var(--sb-green);
}
.row-warn td {
  background: var(--warn-soft);
}
.row-danger td {
  background: var(--danger-soft);
}
.anomaly-detail {
  padding: 18px 22px;
  border-left: 3px solid var(--warn);
  background: var(--surface-2);
}
.anomaly-detail.danger {
  border-left-color: var(--danger);
}
.warning {
  border: 1px solid rgba(178, 94, 9, 0.28);
  border-radius: 8px;
  background: #fff9e9;
  padding: 10px;
  color: #7b4b00;
  font-size: 12.5px;
  line-height: 1.45;
}
/* One rule set, ten tables. Every table in this app — two components and eight
   inline ones — renders through .table-wrap > table, so the reference's row
   rhythm lands everywhere at once. */
.table-wrap {
  overflow-x: auto;
  border-radius: var(--radius-md);
  border: 1px solid var(--line);
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--surface-2);
  color: var(--text-3);
  font-size: 12px;
  font-weight: 650;
  letter-spacing: 0;
  text-align: left;
  padding: 11px 14px;
  border-bottom: 1px solid var(--line);
  white-space: nowrap;
}
td {
  padding: 11px 14px;
  border-bottom: 1px solid var(--line);
  /* Centred, because most cells here are a one- or two-line unit (avatar and
     name, amount and bar) that should sit against its neighbours' midline. */
  vertical-align: middle;
}
tbody tr:hover td {
  background: var(--surface-2);
}
/* No rule under the final row: the wrapper's own border closes the table, and
   doubling them reads as a stray line. */
tbody tr:last-child td {
  border-bottom: 0;
}
tr.clickable {
  cursor: pointer;
}
tr.clickable:hover td {
  background: var(--cream);
}
.detail-row {
  background: var(--cream);
}
.approval-detail {
  padding: 16px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: 14px;
}
.detail-box {
  background: var(--surface);
  border-radius: 10px;
  padding: 14px;
  border: 1px solid var(--line);
}
.approval-line {
  display: grid;
  gap: 8px;
}
.approval-step {
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr) auto;
  gap: 8px;
  align-items: start;
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fff;
}
.approval-index {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--sb-green-light);
  color: var(--sb-green);
  display: grid;
  place-items: center;
  font-weight: 900;
}
/* Who signed, not just who was asked to. Carries more weight than the
   resolver source above it, so it takes the stronger text colour. */
.approval-decider {
  margin-top: 4px;
  font-size: 11.5px;
  line-height: 1.5;
}
.approval-decider-who {
  color: var(--text);
  font-weight: 700;
}
.approval-decider-when {
  color: var(--text-3);
  /* Wraps as one unit -- a date broken across lines ("Sep / 17") reads as
     two values in a column that is meant to be scanned. */
  white-space: nowrap;
}
/* A decision taken in the named approver's place is the exception in an
   approval trail, so it is tagged rather than left to be inferred from two
   names that do not match. */
.approval-delegated {
  display: inline-flex;
  align-items: center;
  margin-left: 6px;
  padding: 0 6px;
  border-radius: 5px;
  background: var(--warn-soft);
  color: var(--warn);
  font-size: 10.5px;
  font-weight: 750;
  white-space: nowrap;
}
.approval-memo {
  margin-top: 4px;
  color: var(--text-2);
  font-size: 11.5px;
  line-height: 1.4;
}
.activity-list {
  display: grid;
  gap: 8px;
  margin-top: 14px;
}
.activity-item {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface-2);
  padding: 10px;
}
.rejection-panel {
  display: grid;
  margin-top: 12px;
  border: 1px solid rgba(200, 32, 20, 0.22);
  border-radius: 8px;
  background: var(--danger-soft);
  overflow: hidden;
}
.rejection-panel.compact {
  margin-top: 0;
}
.rejection-toggle {
  width: 100%;
  border: 0;
  background: transparent;
  color: inherit;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 12px;
  text-align: left;
  font: inherit;
  cursor: pointer;
}
.rejection-toggle:hover {
  background: rgba(200, 32, 20, 0.04);
}
.rejection-body {
  display: grid;
  gap: 10px;
  padding: 0 12px 12px;
}
.rejection-title {
  color: var(--danger);
  font-size: 12px;
  font-weight: 900;
  text-transform: uppercase;
}
.rejection-text {
  white-space: pre-wrap;
  color: var(--text);
  font-size: 12.5px;
  line-height: 1.45;
}
.history-entry {
  display: grid;
  gap: 5px;
  padding-top: 9px;
  border-top: 1px solid rgba(200, 32, 20, 0.14);
}
.pager-row {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 4px;
}
.pager-label {
  color: var(--text-3);
  font-size: 11.5px;
  font-weight: 800;
}
.bars {
  display: grid;
  gap: 12px;
}
.bar-row {
  display: grid;
  grid-template-columns: 130px minmax(0, 1fr) 80px;
  gap: 10px;
  align-items: center;
}
/* Segmented meter. The mask is painted over the track AND its fill, so both
   the spent and remaining parts break into the same ticks -- a solid bar
   reads as one blob, where ticks let you count roughly how much is left.
   Masking rather than marking up means every bar already in the app (cards,
   monitoring, analytics, budgets) picks this up untouched. */
.bar-track {
  height: 10px;
  border-radius: 2px;
  background: var(--ceramic);
  overflow: hidden;
  -webkit-mask-image: repeating-linear-gradient(90deg, #000 0 3px, transparent 3px 5px);
  mask-image: repeating-linear-gradient(90deg, #000 0 3px, transparent 3px 5px);
}
.bar-fill {
  height: 100%;
  border-radius: 0;
  background: var(--sb-green);
  transition: width var(--dur-base) var(--ease);
}
.mini-chart {
  height: 180px;
  display: flex;
  align-items: end;
  gap: 10px;
  padding-top: 10px;
}
.chart-bar {
  flex: 1;
  min-width: 18px;
  border-radius: 8px 8px 0 0;
  background: linear-gradient(180deg, var(--sb-green-accent), var(--sb-green-dark));
}
.placeholder-panel {
  min-height: 220px;
  display: grid;
  place-items: center;
  text-align: center;
  color: var(--text-3);
}
.bi-grid {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: 16px;
  margin-top: 16px;
}
.bi-chart {
  width: 100%;
  height: auto;
  min-height: 260px;
  display: block;
}
.bi-axis {
  stroke: var(--line-2);
  stroke-width: 1;
}
.bi-gridline {
  stroke: var(--line);
  stroke-width: 1;
}
.bi-area {
  fill: rgba(0, 98, 65, 0.1);
}
.bi-line {
  fill: none;
  stroke: var(--sb-green);
  stroke-width: 4;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.bi-line.forecast {
  stroke: var(--gold);
  stroke-dasharray: 8 7;
}
.bi-point {
  fill: #fff;
  stroke: var(--sb-green);
  stroke-width: 3;
}
.bi-point.forecast {
  stroke: var(--gold);
}
.bi-label {
  fill: var(--text-3);
  font-size: 12px;
  font-weight: 800;
}
.bi-value {
  fill: var(--text);
  font-size: 13px;
  font-weight: 900;
}
.bi-heatmap {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  padding: 16px;
}
.bi-risk-cell {
  min-height: 98px;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 12px;
  display: grid;
  align-content: space-between;
  background: var(--surface-2);
}
.bi-risk-cell.medium {
  background: var(--warn-soft);
  border-color: rgba(178, 94, 9, 0.24);
}
.bi-risk-cell.high {
  background: var(--danger-soft);
  border-color: rgba(200, 32, 20, 0.24);
}
.bi-risk-value {
  font-size: 28px;
  line-height: 1;
  font-weight: 950;
}
.bi-risk-label {
  color: var(--text-2);
  font-size: 12px;
  font-weight: 850;
}
/* These labels carry slash-joined compounds ("Receipt/declaration") that the
   line breaker treats as one long word, so they overflowed the tile. */
.bi-risk-label,
.bi-risk-sub {
  min-width: 0;
  overflow-wrap: anywhere;
}
.bi-risk-sub {
  color: var(--text-3);
  font-size: 11px;
}
.bi-split {
  display: grid;
  grid-template-columns: 190px minmax(0, 1fr);
  gap: 18px;
  align-items: center;
  padding: 18px;
}
.bi-donut {
  width: 174px;
  aspect-ratio: 1;
  border-radius: 50%;
  position: relative;
  background: var(--ceramic);
}
.bi-donut::after {
  content: "";
  position: absolute;
  inset: 42px;
  border-radius: 50%;
  background: #fff;
}
.bi-donut-center {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: grid;
  place-items: center;
  text-align: center;
  font-weight: 950;
}
.bi-insight-list {
  display: grid;
  gap: 10px;
}
.bi-insight-row {
  display: grid;
  grid-template-columns: 12px minmax(0, 1fr) auto;
  gap: 9px;
  align-items: center;
}
.bi-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--sb-green);
}
@media (max-width: 1180px) {
  .app-shell {
    grid-template-columns: 204px minmax(0, 1fr);
  }
  .topbar {
    padding: 0 16px;
  }
  .content {
    padding: 24px 16px 72px;
  }
  .topbar-search {
    flex: 0 0 176px;
    width: 176px;
  }
}
@media (max-width: 920px) {
  .app-shell.assistant-open {
    --aside: 0px;
  }
  .assistant {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(384px, 100vw);
    z-index: 40;
    border-radius: var(--radius-panel) 0 0 var(--radius-panel);
    transform: translateX(100%);
    transition: transform var(--dur-base) var(--ease), opacity var(--dur-base) var(--ease), visibility 0s linear var(--dur-base);
  }
  .app-shell.assistant-open .assistant {
    transform: translateX(0);
  }
  .app-shell {
    grid-template-columns: 1fr;
    height: auto;
    min-height: 100%;
  }
  .sidebar {
    height: auto;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius-panel);
    box-shadow: var(--shadow-panel);
    padding-bottom: 6px;
  }
  .sb-nav {
    display: flex;
    overflow-x: auto;
    flex-direction: row;
    gap: 6px;
  }
  /* Below this width the sidebar is a horizontal strip, where a vertical group
     heading has nothing to head and the collapse toggle has nothing to
     collapse. The brand row keeps the app name. */
  .sb-section-label {
    display: none;
  }
  .sb-collapse {
    display: none;
  }
  .sb-item {
    flex: 0 0 auto;
  }
  .sb-brand {
    height: 56px;
  }
  .sb-footer {
    display: none;
  }
  .main {
    height: auto;
    overflow: visible;
  }
  .topbar {
    height: auto;
    min-height: 65px;
    flex-wrap: wrap;
    padding: 12px 16px;
  }
  .topbar-heading {
    flex: 1 0 100%;
  }
  .topbar-actions {
    flex: 1 1 100%;
    flex-wrap: wrap;
  }
  .topbar-search {
    flex: 1 1 180px;
    width: auto;
  }
  .content {
    padding: 22px 16px 60px;
  }
  .hero,
  .approval-detail {
    grid-template-columns: 1fr;
  }
  .grid,
  .quick-grid,
  .bi-grid,
  .stepper,
  .form-grid,
  .budget-grid,
  .submit-split,
  .submit-form-panel,
  .usage-main-grid,
  .anomaly-layout {
    grid-template-columns: 1fr;
  }
  .donut-wrap {
    grid-template-columns: 1fr;
    justify-items: center;
  }
  .bi-heatmap,
  .bi-split {
    grid-template-columns: 1fr;
  }
  .bi-chart {
    min-height: 220px;
  }
  .col-3,
  .col-4,
  .col-5,
  .col-6,
  .col-7,
  .col-8,
  .col-12 {
    grid-column: span 1;
  }
}
`

function money(amount: number, currency = "KRW", lang: Lang = currentFormatLang) {
  return new Intl.NumberFormat(langLocale(lang), {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount)
}

function parseAmountInput(value: string) {
  return Number.parseFloat(value.replace(/,/g, ""))
}

function amountOf(item: { amount?: number | null; amount_cents?: number | null }) {
  return Number(item.amount ?? item.amount_cents ?? 0)
}

function taxAmountOf(item: { tax_amount?: number | null; tax_amount_cents?: number | null }) {
  return Number(item.tax_amount ?? item.tax_amount_cents ?? 0)
}

function monthlyLimitOf(card?: { monthly_limit?: number | null; monthly_limit_cents?: number | null } | null) {
  return Number(card?.monthly_limit ?? card?.monthly_limit_cents ?? 0)
}

function currencyForLocality(locality: "IN" | "KR" | null) {
  if (locality === "IN") return "INR"
  if (locality === "KR") return "KRW"
  return null
}

const DRAFT_STORAGE_PREFIX = "corporate-card-system:settlement-draft:"
const NAV_COLLAPSE_KEY = "corporate-card-system:nav-collapsed"

type SettlementDraft = {
  form: typeof blankSettlementForm
  analysis: ReceiptAnalysisResult | null
  saved_at: string
}

/* Settlement drafts live in the viewer's browser: the backend only stores
   submitted claims (every claim row starts at `pending`), so "Save draft" keeps
   the typed and extracted fields per member until they come back to finish.
   Storage can be unavailable inside the OS host frame, so every access is
   guarded and a failure is reported instead of silently dropping the draft. */
function readSettlementDraft(memberId: string): SettlementDraft | null {
  try {
    const raw = window.localStorage.getItem(`${DRAFT_STORAGE_PREFIX}${memberId}`)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SettlementDraft
    return parsed && typeof parsed === "object" && parsed.form ? parsed : null
  } catch {
    return null
  }
}

function writeSettlementDraft(memberId: string, draft: SettlementDraft) {
  try {
    window.localStorage.setItem(`${DRAFT_STORAGE_PREFIX}${memberId}`, JSON.stringify(draft))
    return true
  } catch {
    return false
  }
}

function clearSettlementDraft(memberId: string) {
  try {
    window.localStorage.removeItem(`${DRAFT_STORAGE_PREFIX}${memberId}`)
  } catch {
    /* nothing stored, nothing to clear */
  }
}

/* Mirrors `_default_app_role_for_member` in backend/api/main.py. The roster now
   comes straight from the platform, so the role shown next to a member who has
   no explicit assignment has to match the one the backend will enforce. */
function defaultAppRoleForMember(member: AppMember): Role {
  const memberId = String(member.id ?? "")
  const platformRole = String(member.role ?? "").toLowerCase()
  const title = String(member.title ?? member.name ?? "").toLowerCase()
  return normalizeRole(member.role)
}

function mergeAppRoles(roster: AppMember[], assignments: RoleAssignmentRow[]): AppMember[] {
  const byMember = new Map(assignments.map((item) => [item.member_id, item]))
  return roster.map((member) => {
    const assignment = byMember.get(String(member.id))
    const appRole = assignment?.app_role ?? defaultAppRoleForMember(member)
    return {
      ...member,
      app_role: appRole,
      app_permissions: assignment?.permissions?.length ? assignment.permissions : rolePermissionMap[appRole],
      app_role_source: assignment ? "assigned" : "default",
      assigned_by_member_id: assignment?.assigned_by_member_id ?? null,
      assigned_at: assignment?.assigned_at ?? null,
    }
  })
}

function localizedSettlementForm(locality: "IN" | "KR" | null) {
  const currency = currencyForLocality(locality) || blankSettlementForm.currency
  const defaults = taxDefaults(currency)
  return {
    ...blankSettlementForm,
    currency,
    tax_type: defaults.tax_type,
    tax_rate_percent: defaults.tax_rate_percent,
  }
}

function localizedPreSpendForm(locality: "IN" | "KR" | null) {
  return {
    ...blankPreSpendForm,
    currency: currencyForLocality(locality) || blankPreSpendForm.currency,
  }
}

function spendOf(item: { spend?: number | null; spend_cents?: number | null }) {
  return Number(item.spend ?? item.spend_cents ?? 0)
}

function approvedOf(item: { approved?: number | null; approved_cents?: number | null }) {
  return Number(item.approved ?? item.approved_cents ?? 0)
}

function pendingOf(item: { pending?: number | null; pending_cents?: number | null }) {
  return Number(item.pending ?? item.pending_cents ?? 0)
}

function projectedMonthSpendOf(item: { projected_month_spend?: number | null; projected_month_spend_cents?: number | null }) {
  return Number(item.projected_month_spend ?? item.projected_month_spend_cents ?? 0)
}

function predictionOf(item: MonitoringPredictions, key: keyof MonitoringPredictions, legacyKey: keyof MonitoringPredictions) {
  const direct = item[key]
  if (typeof direct === "number") return direct
  const legacy = item[legacyKey]
  return typeof legacy === "number" ? legacy : 0
}

function taxProfile(currency: string) {
  return TAX_PROFILES[currency.toUpperCase()]
}

function taxDefaults(currency: string) {
  const profile = taxProfile(currency)
  return {
    tax_type: profile?.type || "",
    tax_rate_percent: profile?.defaultRate || "",
  }
}

function expectedTaxAmount(total: number, rate: number, included: boolean) {
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(rate) || rate <= 0) return 0
  return included ? Math.round((total * rate) / (100 + rate)) : Math.round((total * rate) / 100)
}

function tripBudgetTolerance(amount: number) {
  return Math.max(TRIP_PRE_SPEND_TOLERANCE_MIN, Math.round(amount * TRIP_PRE_SPEND_TOLERANCE_RATIO))
}

function tripBudgetItemsFromForm(form: typeof blankPreSpendForm): PreSpendBudgetItem[] {
  return tripBudgetFields
    .map((field) => {
      const amount = parseAmountInput(String(form[field.key] || ""))
      const rounded = Number.isFinite(amount) && amount > 0 ? Math.round(amount) : 0
      return {
        category: field.category,
        label: field.en,
        amount: rounded,
        amount_cents: rounded,
      }
    })
    .filter((item) => amountOf(item) > 0)
}

function budgetTotal(items: PreSpendBudgetItem[] = []) {
  return items.reduce((sum, item) => sum + amountOf(item), 0)
}

function linkedClaimsForPreSpend(claims: Claim[], item: PreSpendRequest) {
  return claims.filter((claim) => claim.pre_approval_id === item.id && claim.state !== "rejected")
}

function linkedAmountForPreSpend(claims: Claim[], item: PreSpendRequest) {
  return linkedClaimsForPreSpend(claims, item).reduce((sum, claim) => sum + amountOf(claim), 0)
}

function remainingTripPreSpend(claims: Claim[], item: PreSpendRequest) {
  const amount = amountOf(item)
  return amount + tripBudgetTolerance(amount) - linkedAmountForPreSpend(claims, item)
}

function tripDateRange(item: PreSpendRequest) {
  if (item.trip_start_date && item.trip_end_date) return `${compactDate(item.trip_start_date)}-${compactDate(item.trip_end_date)}`
  return compactDate(item.trip_start_date || item.trip_end_date || item.expected_purchase_date || "")
}

function preSpendDisplayName(item: PreSpendRequest) {
  if (item.request_type === "business_trip") return item.trip_area || item.vendor
  return item.vendor
}

function preSpendBudgetLabel(item: PreSpendRequest, currency = item.currency) {
  const items = item.budget_items || []
  if (!items.length) return ""
  return items.map((budget) => `${budget.label || titleCase(budget.category)} ${money(amountOf(budget), currency)}`).join(" · ")
}

function preSpendOptionLabel(item: PreSpendRequest, claims: Claim[]) {
  if (item.request_type !== "business_trip") return `#${item.id} ${item.vendor} · ${money(amountOf(item), item.currency)}`
  const remaining = Math.max(0, remainingTripPreSpend(claims, item))
  return `#${item.id} Trip · ${preSpendDisplayName(item)} · ${money(remaining, item.currency)} remaining`
}

function browserSafeReceiptUrl(value?: string | null) {
  if (!value) return null
  if (value.startsWith("/") || /^https?:\/\//i.test(value)) return value
  return null
}

function receiptFileName(value: string) {
  try {
    const url = new URL(value, "http://palette.local")
    return decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || "receipt")
  } catch {
    return value.split("?")[0].split("/").filter(Boolean).pop() || "receipt"
  }
}

function receiptPreviewKind(value: string) {
  const name = receiptFileName(value).toLowerCase()
  if (/\.(png|jpe?g|webp|gif|bmp)$/.test(name)) return "image"
  if (/\.pdf$/.test(name)) return "pdf"
  return "download"
}

function compactDate(value: string, lang: Lang = currentFormatLang) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(langLocale(lang), { month: "short", day: "2-digit" }).format(date)
}

function initials(name?: string) {
  return (name || "PL")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "PL"
}

function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

/* Mirrors LOCALITY_ALIASES / LOCALITY_CITY_ALIASES in backend/api/main.py.
   The backend is the authority -- it decides whether a claim is accepted -- but
   this copy decides whether the form SAYS you are blocked and which locality
   evidence fields it renders. They have to agree: a profile the backend accepts
   while the form still shows "submission is blocked" is worse than either
   answer on its own. Keep both lists in step. */
const LOCALITY_COUNTRY_ALIASES: Record<string, "IN" | "KR"> = {
  IN: "IN", IND: "IN", INDIA: "IN", BHARAT: "IN",
  KR: "KR", KO: "KR", KOR: "KR", KOREA: "KR",
  "SOUTH KOREA": "KR", "REPUBLIC OF KOREA": "KR",
}
const LOCALITY_CITY_ALIASES: Record<string, "IN" | "KR"> = {
  SEOUL: "KR", BUSAN: "KR", PUSAN: "KR", INCHEON: "KR", DAEGU: "KR",
  DAEJEON: "KR", GWANGJU: "KR", ULSAN: "KR", SEJONG: "KR", SUWON: "KR",
  SEONGNAM: "KR", BUNDANG: "KR", PANGYO: "KR", GANGNAM: "KR",
  YONGIN: "KR", GOYANG: "KR", ANYANG: "KR", BUCHEON: "KR",
  CHEONGJU: "KR", JEONJU: "KR", POHANG: "KR", CHANGWON: "KR", JEJU: "KR",
  MUMBAI: "IN", BOMBAY: "IN", DELHI: "IN", GURGAON: "IN", GURUGRAM: "IN",
  NOIDA: "IN", BENGALURU: "IN", BANGALORE: "IN", HYDERABAD: "IN",
  CHENNAI: "IN", MADRAS: "IN", KOLKATA: "IN", CALCUTTA: "IN",
  PUNE: "IN", AHMEDABAD: "IN", JAIPUR: "IN", KOCHI: "IN", COCHIN: "IN",
  ERNAKULAM: "IN", THIRUVANANTHAPURAM: "IN", TRIVANDRUM: "IN",
  CHANDIGARH: "IN", INDORE: "IN", NAGPUR: "IN", SURAT: "IN",
  LUCKNOW: "IN", COIMBATORE: "IN", VISAKHAPATNAM: "IN",
  BHUBANESWAR: "IN", MYSURU: "IN", MYSORE: "IN", VADODARA: "IN",
  BARODA: "IN", NASHIK: "IN", GANDHINAGAR: "IN",
}

function normalizeEmployeeLocality(value: unknown): "IN" | "KR" | null {
  if (!value) return null
  if (typeof value === "object" && value !== null) {
    for (const key of ["country_code", "country", "code", "name", "locality", "location"]) {
      const normalized = normalizeEmployeeLocality((value as Record<string, unknown>)[key])
      if (normalized) return normalized
    }
    return null
  }
  const cleaned = String(value).replace(/[^A-Za-z ]+/g, " ").replace(/\s+/g, " ").trim().toUpperCase()
  if (!cleaned) return null
  if (LOCALITY_COUNTRY_ALIASES[cleaned]) return LOCALITY_COUNTRY_ALIASES[cleaned]
  /* Word order, not "does any IN token appear first": a country named anywhere
     in the string beats a city inferred from it, and the answer must not depend
     on which list happens to be tested first. */
  const words = cleaned.split(" ").filter(Boolean)
  for (const word of words) {
    if (LOCALITY_COUNTRY_ALIASES[word]) return LOCALITY_COUNTRY_ALIASES[word]
  }
  if (cleaned.includes("SOUTH KOREA") || cleaned.includes("REPUBLIC OF KOREA")) return "KR"
  if (cleaned.includes("INDIA")) return "IN"
  if (LOCALITY_CITY_ALIASES[cleaned]) return LOCALITY_CITY_ALIASES[cleaned]
  for (const word of words) {
    if (LOCALITY_CITY_ALIASES[word]) return LOCALITY_CITY_ALIASES[word]
  }
  return null
}

function memberLocality(member?: AppMember | null): "IN" | "KR" | null {
  if (!member) return null
  const record = member as unknown as Record<string, unknown>
  for (const key of ["country_code", "country", "locality", "location", "office_country", "office_location", "work_location", "region", "timezone"]) {
    const normalized = normalizeEmployeeLocality(record[key])
    if (normalized) return normalized
  }
  return normalizeEmployeeLocality(record.profile)
}

const invoiceEvidenceKeys = [
  "supplier_gstin",
  "supplier_business_registration_number",
  "supplier_legal_name",
  "invoice_number",
  "invoice_date",
  "place_of_supply",
  "payment_method",
  "fx_evidence_url",
  "fx_evidence_description",
  "cash_receipt_reference",
] as const

type InvoiceEvidenceKey = typeof invoiceEvidenceKeys[number]
type InvoiceEvidenceField = { key: InvoiceEvidenceKey; ko: string; en: string; ja: string; type?: string }

function invoiceFieldsFor(locality: "IN" | "KR" | null, currency: string): InvoiceEvidenceField[] {
  const shared: InvoiceEvidenceField[] = [
    { key: "supplier_legal_name", ko: "공급자명", en: "Supplier legal name", ja: "供給者名" },
    { key: "invoice_number", ko: "증빙 번호", en: "Invoice/receipt number", ja: "証憑番号" },
    { key: "invoice_date", ko: "발행일", en: "Issue date", ja: "発行日", type: "date" },
    { key: "payment_method", ko: "결제 수단", en: "Payment method", ja: "支払方法" },
  ]
  const fields: InvoiceEvidenceField[] = locality === "IN"
    ? [
        { key: "supplier_gstin", ko: "공급자 GSTIN", en: "Supplier GSTIN", ja: "供給者GSTIN" },
        ...shared,
        { key: "place_of_supply", ko: "공급 장소", en: "Place of supply", ja: "供給地" },
      ]
    : locality === "KR"
      ? [
          { key: "supplier_business_registration_number", ko: "사업자등록번호", en: "Business registration no.", ja: "事業者登録番号" },
          ...shared,
          { key: "cash_receipt_reference", ko: "현금영수증/전자세금계산서 참조", en: "Cash receipt/e-tax reference", ja: "現金領収証/電子税金計算書の参照" },
        ]
      : shared
  const localCurrency = locality === "IN" ? "INR" : locality === "KR" ? "KRW" : ""
  if (localCurrency && currency !== localCurrency) {
    fields.push(
      { key: "fx_evidence_url", ko: "환율 증빙 URL", en: "FX evidence URL", ja: "為替証憑URL" },
      { key: "fx_evidence_description", ko: "환율 증빙 설명", en: "FX evidence note", ja: "為替証憑の説明" },
    )
  }
  return fields
}

function invoiceEvidencePayload(form: Partial<Record<InvoiceEvidenceKey, string | null | undefined>>) {
  return Object.fromEntries(invoiceEvidenceKeys.map((key) => [key, form[key]?.trim() || null]))
}

function resubmitDraftFromClaim(claim: Claim): ResubmitDraft {
  return {
    claim,
    businessPurpose: claim.business_purpose,
    comment: "",
    missingReceiptReason: claim.missing_receipt_reason || "",
    supplier_gstin: claim.supplier_gstin || "",
    supplier_business_registration_number: claim.supplier_business_registration_number || "",
    supplier_legal_name: claim.supplier_legal_name || "",
    invoice_number: claim.invoice_number || "",
    invoice_date: claim.invoice_date || "",
    place_of_supply: claim.place_of_supply || "",
    payment_method: claim.payment_method || "",
    fx_evidence_url: claim.fx_evidence_url || "",
    fx_evidence_description: claim.fx_evidence_description || "",
    cash_receipt_reference: claim.cash_receipt_reference || "",
  }
}

function normalizeCategory(value?: string | null) {
  const raw = (value || "").toLowerCase()
  if (/(meal|food|restaurant|dinner|lunch|복리|식|회의)/.test(raw)) return "meals"
  if (/(travel|transport|fuel|hotel|lodging|taxi|여비|교통|출장|숙박)/.test(raw)) return "travel"
  if (/(software|saas|cloud|subscription|수수료|소프트웨어|클라우드)/.test(raw)) return "software"
  if (/(equipment|asset|비품|자산|장비)/.test(raw)) return "equipment"
  return "general"
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}`
}

function recentMonthlySpend(claims: Claim[], lang: Lang = currentFormatLang) {
  const anchor = new Date()
  anchor.setDate(1)
  anchor.setHours(0, 0, 0, 0)

  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(anchor)
    date.setMonth(anchor.getMonth() - (5 - index))
    return {
      key: monthKey(date),
      label: new Intl.DateTimeFormat(langLocale(lang), { month: "short" }).format(date),
      amount: 0,
    }
  })
  const byKey = new Map(months.map((month) => [month.key, month]))
  claims.forEach((claim) => {
    const date = new Date(claim.created_at)
    if (Number.isNaN(date.getTime())) return
    const month = byKey.get(monthKey(date))
    if (month) month.amount += amountOf(claim)
  })
  return months
}

function donutGradient(rows: Array<[string, number]>, total: number) {
  let cursor = 0
  const stops = rows.map(([, amount], index) => {
    const start = cursor
    const end = index === rows.length - 1 ? 100 : cursor + (amount / total) * 100
    cursor = end
    return `${CHART_COLORS[index % CHART_COLORS.length]} ${start}% ${end}%`
  })
  return `conic-gradient(${stops.join(", ")})`
}

function percent(numerator: number, denominator: number) {
  if (!denominator) return 0
  return Math.round((numerator / denominator) * 100)
}

/* ---- Cards page: per-card spend derivation ----------------------------
 *
 * Everything here is computed in the browser from the /summary payload that
 * already ships. No new route, no new column, no schema change.
 *
 * There is no foreign key from a claim to a card, so the join key is
 * (member_id, last4) — last4 alone is not enough because two members can hold
 * cards ending in the same four digits. This mirrors the rule the backend
 * already uses in `_active_card_for_member` (backend/api/main.py), including
 * its tie-break, so this page and policy evaluation agree about which card a
 * transaction sits on.
 *
 * The governing principle is that a figure we cannot derive renders as an
 * em dash, never as a number. "Unknown" and "zero" are different claims about
 * the world, and on a spend-control screen conflating them is the expensive
 * kind of wrong.
 */

/* A figure that cannot be derived at all -> render "—". */
type CardMetricBlocker =
  | "duplicate_last4"  /* this member owns another card with the same last 4 */
  | "no_local_spend"   /* every transaction is in a currency the limit cannot absorb */

/* A figure that IS shown but is partial or a lower bound -> annotate, don't hide. */
type CardMetricCaveat =
  | "foreign_currency"
  | "member_unattributed"  /* owner has claims with no card_last4 and owns >1 card */
  | "sole_card_inferred"   /* claims with no card_last4 landed here: it is the only card */

type CardMetrics = {
  card: Card
  spend: number | null
  txCount: number | null
  usedPct: number | null
  approvedSpend: number
  pendingSpend: number
  limit: number
  blocker: CardMetricBlocker | null
  caveats: CardMetricCaveat[]
  foreignTxCount: number
  unattributedCount: number
  unattributedAmount: number
}

type CardMetricsResult = {
  rows: CardMetrics[]
  /* Residue, so the arithmetic closes and the reader can see why the per-card
     rows do not sum to the period total. */
  unattributed: { count: number; amount: number }
  orphan: { count: number; amount: number; last4s: string[] }
  periodSpend: number
}

const CARD_KEY_SEPARATOR = "::"

function cardKeyOf(memberId?: string | null, last4?: string | null) {
  return String(memberId ?? "").trim() + CARD_KEY_SEPARATOR + String(last4 ?? "").trim().slice(-4)
}

function monthKeyOf(date: Date) {
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0")
}

/* The period a transaction falls in, as YYYY-MM.
 *
 * Transaction date first, filing date as the fallback — a monthly LIMIT has to
 * follow the date the money was spent, so a claim filed in October for a
 * September dinner counts in September.
 *
 * The month is read off the string rather than through `new Date`, because
 * `new Date("2026-09-01")` parses as UTC midnight and lands in August for any
 * viewer west of UTC — silently the wrong month. */
function spendPeriodKey(item: { transaction_date?: string | null; created_at?: string | null }): string | null {
  const typed = String(item.transaction_date ?? "").trim()
  const bare = /^(\d{4})[-./]?(\d{1,2})[-./]?(\d{1,2})$/.exec(typed)
  if (bare) {
    const month = Number(bare[2])
    if (month >= 1 && month <= 12) return bare[1] + "-" + String(month).padStart(2, "0")
  }
  if (typed) {
    const parsed = new Date(typed)
    if (!Number.isNaN(parsed.getTime())) return monthKeyOf(parsed)
  }
  const created = new Date(String(item.created_at ?? ""))
  return Number.isNaN(created.getTime()) ? null : monthKeyOf(created)
}

/* Which card wins when a member has more than one match: active first, then
   newest. Same ordering the backend applies. */
function preferredCard(list: Card[]) {
  return [...list].sort(
    (a, b) => Number(b.status === "active") - Number(a.status === "active") || b.id - a.id,
  )[0]
}

/* `claims` must ALREADY be role-scoped by the caller. This function does not
   know who is looking, deliberately: the existing "Used %" tile is wrong
   precisely because it divides an organisation-wide total by one card's limit.
 *
 * Spend counts every claim state — pending, approved, rejected alike. That is
 * the app's existing convention (see totalSpend), not a new one invented here. */
function buildCardMetrics(input: {
  cards: Card[]
  claims: Claim[]
  periodKey: string
  limitCurrency: string
}): CardMetricsResult {
  const { cards, claims, periodKey, limitCurrency } = input

  const byKey = new Map<string, Card[]>()
  const byMember = new Map<string, Card[]>()
  cards.forEach((card) => {
    const keyList = byKey.get(cardKeyOf(card.member_id, card.last4))
    if (keyList) keyList.push(card)
    else byKey.set(cardKeyOf(card.member_id, card.last4), [card])
    const memberList = byMember.get(String(card.member_id))
    if (memberList) memberList.push(card)
    else byMember.set(String(card.member_id), [card])
  })

  type Bucket = {
    local: number
    txCount: number
    foreignTxCount: number
    approved: number
    pending: number
    inferred: boolean
  }
  const blank = (): Bucket => ({ local: 0, txCount: 0, foreignTxCount: 0, approved: 0, pending: 0, inferred: false })
  const buckets = new Map<number, Bucket>(cards.map((card) => [card.id, blank()]))

  const unattributedByMember = new Map<string, { count: number; amount: number }>()
  let unattributedCount = 0
  let unattributedAmount = 0
  let orphanCount = 0
  let orphanAmount = 0
  const orphanLast4s = new Set<string>()
  let periodSpend = 0

  claims.forEach((claim) => {
    if (spendPeriodKey(claim) !== periodKey) return
    const amount = amountOf(claim)
    const currency = String(claim.currency || limitCurrency).toUpperCase()
    periodSpend += amount

    const memberId = String(claim.requester_member_id)
    const last4 = String(claim.card_last4 ?? "").trim().slice(-4)

    let target: Card | undefined
    let inferred = false
    if (last4) {
      target = preferredCard(byKey.get(cardKeyOf(memberId, last4)) ?? [])
    } else {
      /* No card_last4. Attribute only when the member owns exactly one card,
         where there is nothing to guess. With two or more, a guess would
         silently move the moment a card is added. */
      const owned = byMember.get(memberId) ?? []
      if (owned.length === 1) {
        target = owned[0]
        inferred = true
      }
    }

    if (!target) {
      if (last4) {
        orphanCount += 1
        orphanAmount += amount
        orphanLast4s.add(last4)
      } else {
        unattributedCount += 1
        unattributedAmount += amount
        const entry = unattributedByMember.get(memberId) ?? { count: 0, amount: 0 }
        entry.count += 1
        entry.amount += amount
        unattributedByMember.set(memberId, entry)
      }
      return
    }

    const bucket = buckets.get(target.id) ?? blank()
    buckets.set(target.id, bucket)
    bucket.txCount += 1
    if (inferred) bucket.inferred = true
    if (currency !== limitCurrency) {
      bucket.foreignTxCount += 1
      return
    }
    bucket.local += amount
    if (claim.state === "approved") bucket.approved += amount
    else if (claim.state === "pending") bucket.pending += amount
  })

  const rows: CardMetrics[] = cards.map((card) => {
    const bucket = buckets.get(card.id) ?? blank()
    const limit = monthlyLimitOf(card)
    const siblings = byKey.get(cardKeyOf(card.member_id, card.last4)) ?? []
    const isDuplicate = siblings.length > 1 && preferredCard(siblings).id !== card.id
    const onlyForeign = bucket.txCount > 0 && bucket.foreignTxCount === bucket.txCount
    const blocker: CardMetricBlocker | null =
      isDuplicate ? "duplicate_last4" : onlyForeign ? "no_local_spend" : null

    const residue = unattributedByMember.get(String(card.member_id))
    const caveats: CardMetricCaveat[] = []
    if (!blocker) {
      if (bucket.foreignTxCount > 0) caveats.push("foreign_currency")
      if (residue) caveats.push("member_unattributed")
      if (bucket.inferred) caveats.push("sole_card_inferred")
    }

    return {
      card,
      spend: blocker ? null : bucket.local,
      txCount: blocker ? null : bucket.txCount,
      /* Not clamped to 100: clamping hides exactly the condition an admin needs
         to see. The bar's width clamps separately, so an over-limit card reads
         "134%" against a full bar. */
      usedPct: blocker || limit <= 0 ? null : Math.round((bucket.local / limit) * 100),
      approvedSpend: bucket.approved,
      pendingSpend: bucket.pending,
      limit,
      blocker,
      caveats,
      foreignTxCount: bucket.foreignTxCount,
      unattributedCount: residue?.count ?? 0,
      unattributedAmount: residue?.amount ?? 0,
    }
  })

  return {
    rows,
    unattributed: { count: unattributedCount, amount: unattributedAmount },
    orphan: { count: orphanCount, amount: orphanAmount, last4s: [...orphanLast4s].sort() },
    periodSpend,
  }
}

function periodLabel(period: string) {
  if (/^\d{4}-\d{2}$/.test(period)) {
    const [year, month] = period.split("-")
    return `${month}/${year.slice(2)}`
  }
  return period
}

function findingTone(severity?: string): "ok" | "warn" | "danger" | "info" {
  if (severity === "blocked" || severity === "hard_block") return "danger"
  if (severity === "action" || severity === "required" || severity === "warning") return "warn"
  return "info"
}

function monitoringRiskTotal(overview: MonitoringOverview) {
  return overview.blocked_claims + overview.needs_info_claims + overview.missing_receipt_claims + overview.statement_missing_claims
}

function buildPurposeFromAnalysis(result: ReceiptAnalysisResult, lang: Lang) {
  const merchant = result.draft?.vendor || result.analysis?.merchant?.name
  const items = result.analysis?.line_items?.map((item) => item.description).filter(Boolean).slice(0, 2)
  if (lang === "ko") {
    if (items?.length) return `${items.join(" + ")} 구매`
    if (merchant) return `${merchant} 법인카드 사용`
    return ""
  }
  if (lang === "ja") {
    if (items?.length) return `${items.join(" + ")} の購入`
    if (merchant) return `${merchant} での法人カード利用`
    return ""
  }
  if (items?.length) return `${items.join(" + ")} purchase`
  if (merchant) return `${merchant} corporate card spend`
  return ""
}

function hasReceiptAnalysisSignal(result: ReceiptAnalysisResult | null) {
  if (!result) return false
  const analysis = result.analysis
  const draft = result.draft
  return Boolean(
    draft?.vendor ||
      draft?.amount != null ||
      draft?.transaction_date ||
      draft?.card_last4 ||
      draft?.category ||
      analysis?.merchant?.name ||
      analysis?.document?.transaction_date ||
      analysis?.document?.card_last4 ||
      analysis?.amounts?.total != null ||
      analysis?.amounts?.paid != null ||
      analysis?.line_items?.length ||
      analysis?.corporate_card_hints?.suggested_account_name ||
      analysis?.corporate_card_hints?.suggested_account_code ||
      analysis?.extraction_warnings?.length,
  )
}

function uniqueText(values: Array<string | null | undefined>) {
  const seen = new Set<string>()
  return values
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .filter((value) => {
      const key = value.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

function findingMessage(item: PolicyFinding | string | undefined) {
  if (!item) return ""
  if (typeof item === "string") return item
  return item.message || item.code || ""
}

function policyFindings(evaluation?: PolicyEvaluation) {
  if (!evaluation) return []
  return [
    ...(evaluation.hard_blocks ?? []),
    ...(evaluation.required_actions ?? []),
    ...(evaluation.warnings ?? []),
  ].filter((item) => findingMessage(item))
}

function claimPolicyFindings(claim: Claim) {
  return policyFindings(claim.policy_evaluation)
}

function policyTone(status?: string) {
  if (status === "blocked") return "danger"
  if (status === "exception_required" || status === "warning") return "warn"
  if (status === "exception_approved" || status === "compliant") return "ok"
  return "info"
}

function policyLabel(status?: string) {
  return titleCase(status || "not evaluated")
}

function apiErrorMessage(data: any, fallback: string) {
  const findings = policyFindings(data?.detail?.policy_evaluation)
  if (findings.length) return findings.map(findingMessage).join(" ")
  if (typeof data?.detail === "string") return data.detail
  if (typeof data?.detail?.message === "string") return data.detail.message
  if (typeof data?.message === "string") return data.message
  return fallback
}

function purposeSuggestionsFromAnalysis(result: ReceiptAnalysisResult, lang: Lang) {
  const merchant = result.draft?.vendor || result.analysis?.merchant?.name
  const items = result.analysis?.line_items?.map((item) => item.description).filter(Boolean).slice(0, 2) as string[] | undefined
  const account = result.analysis?.corporate_card_hints?.suggested_account_name || result.analysis?.corporate_card_hints?.suggested_account_code
  const category = normalizeCategory(result.draft?.category || account || "")
  return uniqueText([
    buildPurposeFromAnalysis(result, lang),
    items?.length ? text(lang, `${items.join(" + ")} 구매`, `${items.join(" + ")} purchase`, `${items.join(" + ")} の購入`) : undefined,
    merchant ? text(lang, `${merchant} 업무 지출`, `${merchant} business expense`, `${merchant} 業務経費`) : undefined,
    account ? text(lang, `${account} 계정 정산`, `${titleCase(category)} expense for ${account}`, `${account} 勘定の精算`) : undefined,
  ]).slice(0, 3)
}

/* Topbar search. Every value a row shows is worth matching — a vendor, a person,
   a category, a card's last four, an amount typed with or without separators, a
   date — so the haystack is built from the row's own fields and compared
   loosely: "12,000", "12000" and "STARBUCKS" all hit the same claim. */
function searchMatches(query: string, values: Array<string | number | null | undefined>) {
  if (!query) return true
  const haystack = values
    .filter((value) => value !== null && value !== undefined && value !== "")
    .map((value) => String(value).toLowerCase())
    .join(" ")
  const digits = haystack.replace(/[^0-9]/g, "")
  const numericQuery = query.replace(/[^0-9]/g, "")
  if (haystack.includes(query)) return true
  return numericQuery.length > 0 && numericQuery === query.replace(/[\s,]/g, "") && digits.includes(numericQuery)
}

function claimSearchValues(claim: Claim) {
  return [
    claim.vendor,
    claim.requester_name,
    claim.requester_member_id,
    claim.category,
    claim.business_purpose,
    claim.state,
    claim.policy_status,
    claim.currency,
    claim.transaction_date,
    claim.card_last4,
    claim.cost_center,
    claim.project_code,
    claim.invoice_number,
    claim.supplier_legal_name,
    amountOf(claim),
    claim.id,
  ]
}

function claimHistory(claim: Claim) {
  return Array.isArray(claim.approval_snapshot.history) ? claim.approval_snapshot.history : []
}

function rejectedSteps(steps: ApprovalStep[] | undefined) {
  return (Array.isArray(steps) ? steps : []).filter((step) => step.state === "rejected" && step.decision_memo)
}

function latestRejectionMemo(claim: Claim) {
  return rejectedSteps(claim.steps).at(-1)?.decision_memo?.trim() ?? ""
}

function hasRejectionHistory(claim: Claim) {
  return Boolean(latestRejectionMemo(claim) || claimHistory(claim).length)
}

function AssistantText({ line }: { line: string }) {
  const parts = line.split(/(\*\*[^*]+\*\*)/g).filter(Boolean)
  return (
    <>
      {parts.map((part, index) =>
        part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
          <strong key={index}>{part.slice(2, -2)}</strong>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  )
}

function MemberLocalityCell({
  lang,
  member,
  canEdit,
  saving,
  onSave,
}: {
  lang: Lang
  member: AppMember
  canEdit: boolean
  saving: boolean
  onSave: (value: string) => void
}) {
  const fromPlatform = member.locality_from_platform ?? null
  const [draft, setDraft] = useState(member.locality_entered_value ?? "")
  /* Re-sync when the roster reloads, so a saved value is echoed back rather
     than leaving the box showing what was typed before the round trip. */
  useEffect(() => {
    setDraft(member.locality_entered_value ?? "")
  }, [member.locality_entered_value])

  /* The platform profile wins when it has a value, so the app field would do
     nothing -- show what the SDK reported instead of an input that lies. */
  if (fromPlatform) {
    return (
      <div className="locality-cell">
        <span className="pill ok">{fromPlatform}</span>
        <div className="line-2">{text(lang, "Palette OS 프로필", "From Palette OS profile", "Palette OS プロフィール")}</div>
      </div>
    )
  }

  if (!canEdit) {
    return (
      <div className="locality-cell">
        {member.effective_locality ? (
          <>
            <span className="pill info">{member.effective_locality}</span>
            <div className="line-2">{text(lang, "앱에서 지정", "Set in this app", "アプリで設定")}</div>
          </>
        ) : (
          <>
            <span className="pill warn">{text(lang, "미설정", "Not set", "未設定")}</span>
            <div className="line-2">{text(lang, "관리자만 설정할 수 있습니다", "Admins can set this", "管理者のみ設定できます")}</div>
          </>
        )}
      </div>
    )
  }

  const dirty = draft.trim() !== (member.locality_entered_value ?? "").trim()
  return (
    <div className="locality-cell">
      <div className="locality-edit">
        <input
          className="input"
          value={draft}
          disabled={saving}
          placeholder={text(lang, "예: KR, Seoul", "e.g. KR, Seoul", "例: KR, Seoul")}
          aria-label={text(lang, `${member.name || member.id} 근무 지역`, `Work locality for ${member.name || member.id}`, `${member.name || member.id} の勤務地域`)}
          onChange={(event) => setDraft(event.target.value)}
          /* Enter saves, Escape reverts -- the row is a table cell, not a form,
             so there is no submit button to fall back on. */
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              if (dirty) onSave(draft)
            } else if (event.key === "Escape") {
              event.preventDefault()
              setDraft(member.locality_entered_value ?? "")
            }
          }}
        />
        <button className="button-secondary" type="button" disabled={saving || !dirty} onClick={() => onSave(draft)}>
          {text(lang, "저장", "Save", "保存")}
        </button>
      </div>
      <div className="line-2">
        {member.locality_override
          ? text(lang, `앱에서 지정 · ${member.locality_override}`, `Set in this app · ${member.locality_override}`, `アプリで設定 · ${member.locality_override}`)
          : text(lang, "프로필에 지역 정보가 없습니다", "No locality on the Palette OS profile", "プロフィールに地域情報がありません")}
      </div>
    </div>
  )
}

function PageHead({ eyebrow, title, desc }: { eyebrow: string; title: string; desc: string }) {
  /* `eyebrow` is still accepted so no call site had to change, but it is not
     rendered: the topbar already carries it, and repeating it under the topbar
     cost every page a line of chrome that said nothing new. */
  void eyebrow
  return (
    <div className="page-head">
      <h1 className="page-title">{title}</h1>
      <p className="page-desc">{desc}</p>
    </div>
  )
}

function RoleStrip({ role, lang }: { role: Role; lang: Lang }) {
  const profile = roleProfiles[role]
  return (
    <div className="role-strip">
      <span className="role-mark">{profile.avatar}</span>
      <span>
        <strong>{text(lang, profile.labelKo, profile.label, profile.labelJa)}</strong> - {text(lang, profile.scopeKo, profile.scope, profile.scopeJa)}
      </span>
    </div>
  )
}

function StatusPill({ state }: { state: string }) {
  return <span className={`pill ${state}`}>{titleCase(state)}</span>
}

function EmptyState({ children }: { children: string }) {
  return <div className="empty">{children}</div>
}

function PolicyPanel({ lang, claim }: { lang: Lang; claim: Claim }) {
  const findings = claimPolicyFindings(claim)
  const invoiceDetails = [
    claim.employee_locality ? text(lang, `직원 지역 ${claim.employee_locality}`, `Employee locality ${claim.employee_locality}`, `従業員の地域 ${claim.employee_locality}`) : null,
    claim.supplier_gstin ? text(lang, `GSTIN ${claim.supplier_gstin}`, `GSTIN ${claim.supplier_gstin}`, `GSTIN ${claim.supplier_gstin}`) : null,
    claim.supplier_business_registration_number ? text(lang, `사업자 ${claim.supplier_business_registration_number}`, `Business reg. ${claim.supplier_business_registration_number}`, `事業者登録番号 ${claim.supplier_business_registration_number}`) : null,
    claim.supplier_legal_name ? text(lang, `공급자 ${claim.supplier_legal_name}`, `Supplier ${claim.supplier_legal_name}`, `供給者 ${claim.supplier_legal_name}`) : null,
    claim.invoice_number ? text(lang, `증빙 ${claim.invoice_number}`, `Invoice ${claim.invoice_number}`, `証憑 ${claim.invoice_number}`) : null,
    claim.invoice_date ? text(lang, `발행일 ${claim.invoice_date}`, `Issue date ${claim.invoice_date}`, `発行日 ${claim.invoice_date}`) : null,
    claim.place_of_supply ? text(lang, `공급 장소 ${claim.place_of_supply}`, `Place of supply ${claim.place_of_supply}`, `供給地 ${claim.place_of_supply}`) : null,
    claim.payment_method ? text(lang, `결제 ${claim.payment_method}`, `Payment ${claim.payment_method}`, `支払方法 ${claim.payment_method}`) : null,
    claim.cash_receipt_reference ? text(lang, `영수증 참조 ${claim.cash_receipt_reference}`, `Receipt ref ${claim.cash_receipt_reference}`, `領収書参照 ${claim.cash_receipt_reference}`) : null,
  ].filter(Boolean)
  return (
    <div className="ai-suggestion" style={{ marginTop: 12 }}>
      <div className="bubble-meta">{text(lang, "정책 검토", "Policy review", "ポリシー審査")}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span className={`pill ${policyTone(claim.policy_status)}`}>{policyLabel(claim.policy_status)}</span>
        <span className={`pill ${policyTone(claim.policy_evaluation.status)}`}>{policyLabel(claim.policy_evaluation.status)}</span>
        <span className="pill info">{titleCase(claim.receipt_status || "receipt unknown")}</span>
        {claim.pre_approval_id ? <span className="pill ok">{text(lang, `사전승인 #${claim.pre_approval_id}`, `Pre-spend #${claim.pre_approval_id}`, `事前承認 #${claim.pre_approval_id}`)}</span> : null}
      </div>
      {findings.length ? (
        <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
          {findings.slice(0, 5).map((item, index) => (
            <div className="line-2" key={`${findingMessage(item)}-${index}`}>
              <strong>{item.severity === "blocked" ? "!" : "-"}</strong> {findingMessage(item)}
              {item.action ? <span> {item.action}</span> : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="line-2" style={{ marginTop: 8 }}>{text(lang, "정책 예외가 없습니다.", "No policy findings.", "ポリシー例外はありません。")}</div>
      )}
      {invoiceDetails.length ? (
        <div className="line-2" style={{ marginTop: 8 }}>{invoiceDetails.join(" · ")}</div>
      ) : null}
      <div className="line-2" style={{ marginTop: 8 }}>
        {[
          claim.transaction_date ? text(lang, `거래일 ${claim.transaction_date}`, `Transaction ${claim.transaction_date}`, `取引日 ${claim.transaction_date}`) : null,
          claim.card_last4 ? text(lang, `카드 ${claim.card_last4}`, `Card ${claim.card_last4}`, `カード ${claim.card_last4}`) : null,
          claim.cost_center ? text(lang, `코스트센터 ${claim.cost_center}`, `Cost center ${claim.cost_center}`, `コストセンター ${claim.cost_center}`) : null,
          claim.project_code ? text(lang, `프로젝트 ${claim.project_code}`, `Project ${claim.project_code}`, `プロジェクト ${claim.project_code}`) : null,
        ].filter(Boolean).join(" · ")}
      </div>
    </div>
  )
}

export default function CorporateCardApp(_props: PluginComponentProps) {
  const platform = usePlatform()
  const { apiFetch, showToast } = platform
  const [summary, setSummary] = useState<Summary>(blankSummary)
  const [monitoring, setMonitoring] = useState<Monitoring>(blankMonitoring)
  /* Identity is the signed-in Palette OS user: `platform.user` and the org role
     the OS assigns them. An admin can override the app role for a member, so the
     effective role is that override when one exists, else the OS role. */
  const [roleOverride, setRoleOverride] = useState<Role | null>(null)
  const [tab, setTab] = useState<Tab>("dashboard")
  const [cardStatusFilter, setCardStatusFilter] = useState<"all" | "active" | "inactive">("all")
  const searchInputRef = useRef<HTMLInputElement>(null)
  /* "/" jumps to search. Same guards as the "d" colour-mode shortcut above:
     ignored while typing and when combined with a modifier. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/") return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable) return
      event.preventDefault()
      searchInputRef.current?.focus()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])
  /* Collapsed-rail preference. Read lazily from localStorage so the first paint
     is already correct — a sidebar that snaps shut after mount reads as a bug.
     Storage can throw (private mode, blocked site data), so every access is
     guarded and simply falls back to expanded. */
  const [navCollapsed, setNavCollapsed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(NAV_COLLAPSE_KEY) === "collapsed"
    } catch {
      return false
    }
  })
  useEffect(() => {
    try {
      window.localStorage.setItem(NAV_COLLAPSE_KEY, navCollapsed ? "collapsed" : "expanded")
    } catch {
      // Preference just won't persist; the toggle still works this session.
    }
  }, [navCollapsed])
  const [segment, setSegment] = useState("pending")
  const [expandedClaimId, setExpandedClaimId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [warning, setWarning] = useState("")
  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [submitStage, setSubmitStage] = useState<"scan" | "review" | "form">("scan")
  const [receiptAnalysis, setReceiptAnalysis] = useState<ReceiptAnalysisResult | null>(null)
  const [receiptAnalyzing, setReceiptAnalyzing] = useState(false)
  const [fileInputKey, setFileInputKey] = useState(0)
  const [search, setSearch] = useState("")
  const [lang, setLang] = useState<Lang>(() => resolvePlatformLanguage(platform.language))
  setFormatLang(lang)
  const [colorMode] = usePaletteColorMode(platform)
  const [statementFileName, setStatementFileName] = useState("")
  /* Remount key for the statement picker, for the same reason the receipt one
     has one: without it, choosing the same filename twice fires no change
     event, so "clear, then re-pick that file" silently does nothing. */
  const [statementFileKey, setStatementFileKey] = useState(0)
  const [statementCsv, setStatementCsv] = useState("")
  const [statementImporting, setStatementImporting] = useState(false)
  const [erpResult, setErpResult] = useState<{ filename: string; csv: string; row_count: number; total_amount?: number; total_amount_cents: number } | null>(null)
  const [qaQuestion, setQaQuestion] = useState("")
  const [qaLoading, setQaLoading] = useState(false)
  /* The assistant is docked beside the working area rather than being a tab of
     its own: its whole value is answering ABOUT the screen you are on, which a
     full-page takeover would hide. */
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [assistantInput, setAssistantInput] = useState("")
  const [assistantThread, setAssistantThread] = useState<AssistantTurn[]>([])
  const [assistantLoading, setAssistantLoading] = useState(false)
  const [assistantError, setAssistantError] = useState<string | null>(null)
  const assistantSuggestions = useMemo(
    () => [
      text(lang, "한도를 초과한 카드가 있나요?", "Which cards are over their limit?", "利用限度額を超えているカードはありますか？"),
      text(lang, "내 결재 대기 건은 몇 건인가요?", "What is waiting on my approval?", "自分の決裁待ちは何件ありますか？"),
      text(lang, "정산은 어떻게 신청하나요?", "How do I file a settlement?", "精算はどのように申請しますか？"),
      text(lang, "사전 승인이 필요한 경우는?", "When do I need pre-spend approval?", "事前承認が必要なのはどのような場合ですか？"),
    ],
    [lang],
  )
  const assistantInputRef = useRef<HTMLTextAreaElement | null>(null)
  const assistantThreadRef = useRef<HTMLDivElement | null>(null)
  const assistantTriggerRef = useRef<HTMLButtonElement | null>(null)
  const [members, setMembers] = useState<AppMember[]>([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [membersError, setMembersError] = useState("")
  const [form, setForm] = useState(blankSettlementForm)
  const [preSpendForm, setPreSpendForm] = useState(blankPreSpendForm)
  const [cardForm, setCardForm] = useState(blankCardForm)
  const [quickResubmitDraft, setQuickResubmitDraft] = useState<ResubmitDraft | null>(null)
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  const restoredDraftFor = useRef<string | null>(null)
  const [expandedAnomalyId, setExpandedAnomalyId] = useState<string | null>(null)
  const activeMemberId = platform.user.id
  const activeMemberName = platform.user.name || platform.user.email || activeMemberId
  const platformRole = normalizeRole(platform.orgRole)
  const role: Role = roleOverride ?? platformRole
  const activeMember = members.find((member) => member.id === activeMemberId)
  const activeLocality = memberLocality(activeMember)
  const activeLocalCurrency = currencyForLocality(activeLocality) || form.currency
  const canManageRoles = isRoleManager(role)
  /* viewer/member see their own corporate-card activity; admin/owner see the
     organisation's and can act on it. */
  /* Member id -> display name for the approval trail. Falls back to the raw id
     rather than hiding the fact that someone decided: an audit line that omits
     an unknown approver is worse than one that names them by id. */
  const memberLabel = useCallback(
    (memberId?: string | null) => {
      const id = String(memberId ?? "").trim()
      if (!id) return ""
      const match = members.find((member) => String(member.id) === id)
      return match?.name || id
    },
    [members],
  )
  const isPersonalScope = role === "viewer" || role === "member"
  const isOversightScope = role === "admin" || role === "owner"

  function appFetch(input: string, init: RequestInit = {}) {
    return apiFetch(input, init)
  }

  const searchQuery = search.trim().toLowerCase()
  const filteredClaims = useMemo(() => {
    if (!searchQuery) return summary.claims
    return summary.claims.filter((claim) => searchMatches(searchQuery, claimSearchValues(claim)))
  }, [searchQuery, summary.claims])
  const filteredPendingForMe = useMemo(() => {
    const ids = new Set(filteredClaims.map((claim) => claim.id))
    return summary.pending_for_me.filter((claim) => ids.has(claim.id))
  }, [filteredClaims, summary.pending_for_me])
  const ownClaims = useMemo(
    () => filteredClaims.filter((claim) => claim.requester_member_id === activeMemberId),
    [filteredClaims, activeMemberId],
  )
  const ownMissingClaims = useMemo(
    () => summary.missing_claims.filter((row) => row.cardholder_member_id === activeMemberId),
    [summary.missing_claims, activeMemberId],
  )
  const myAnomalyCount = useMemo(
    () =>
      ownMissingClaims.length +
      ownClaims.filter((claim) => claim.state === "rejected" || claim.state === "needs_info" || claimPolicyFindings(claim).length > 0).length,
    [ownClaims, ownMissingClaims],
  )
  /* ---- Cards page scope + metrics ------------------------------------
     Both the card list AND the claim universe are scoped. Scoping only the
     cards while feeding org-wide claims into the derivation would reproduce
     the bug that makes the Usage page's "Used %" wrong. */
  const visibleCards = useMemo(
    () => (isPersonalScope ? summary.cards.filter((card) => card.member_id === activeMemberId) : summary.cards),
    [summary.cards, isPersonalScope, activeMemberId],
  )
  /* A plain string, so it is a stable dependency and still rolls over at month
     end without a remount. */
  const cardPeriodKey = monthKeyOf(new Date())
  const cardMetrics = useMemo(
    () =>
      buildCardMetrics({
        cards: visibleCards,
        claims: isPersonalScope ? ownClaims : filteredClaims,
        periodKey: cardPeriodKey,
        limitCurrency: "KRW",
      }),
    [visibleCards, isPersonalScope, ownClaims, filteredClaims, cardPeriodKey],
  )

  const totalSpend = useMemo(() => filteredClaims.reduce((sum, claim) => sum + amountOf(claim), 0), [filteredClaims])
  const pendingSpend = useMemo(
    () => filteredClaims.filter((claim) => claim.state === "pending").reduce((sum, claim) => sum + amountOf(claim), 0),
    [filteredClaims],
  )
  const approvedSpend = useMemo(
    () => filteredClaims.filter((claim) => claim.state === "approved").reduce((sum, claim) => sum + amountOf(claim), 0),
    [filteredClaims],
  )
  const visibleStatementRows = useMemo(() => {
    if (!searchQuery) return summary.statement_rows
    return summary.statement_rows.filter((row) =>
      searchMatches(searchQuery, [
        row.vendor,
        row.cardholder_name,
        row.cardholder_member_id,
        row.category,
        row.match_status,
        row.currency,
        row.card_last4,
        row.transaction_date,
        amountOf(row),
      ]),
    )
  }, [summary.statement_rows, searchQuery])
  const activeCard = summary.cards.find((card) => card.status === "active" && card.member_id === activeMemberId) ?? summary.cards.find((card) => card.status === "active") ?? summary.cards[0]
  const inboxClaims = isPersonalScope
    ? filteredClaims.filter((claim) => claim.requester_member_id === activeMemberId && (claim.state === "rejected" || claim.state === "needs_info" || claim.policy_status === "blocked"))
    : filteredPendingForMe
  const approvalClaims = isOversightScope ? filteredClaims : filteredPendingForMe
  const visibleApprovals = approvalClaims.filter((claim) => segment === "all" || claim.state === segment)
  const categories = useMemo(() => {
    const grouped = new Map<string, number>()
    filteredClaims.forEach((claim) => grouped.set(claim.category, (grouped.get(claim.category) ?? 0) + amountOf(claim)))
    return Array.from(grouped.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
  }, [filteredClaims])
  const visiblePreSpendRequests = useMemo(() => {
    const scoped = isPersonalScope
      ? summary.pre_spend_requests.filter((item) => item.requester_member_id === activeMemberId)
      : summary.pre_spend_requests
    if (!searchQuery) return scoped
    return scoped.filter((item) =>
      searchMatches(searchQuery, [
        item.vendor,
        item.requester_name,
        item.category,
        item.business_purpose,
        item.state,
        item.request_type,
        item.trip_area,
        item.currency,
        amountOf(item),
      ]),
    )
  }, [summary.pre_spend_requests, role, activeMemberId, searchQuery])

  async function load() {
    setLoading(true)
    try {
      const [summaryResponse, monitoringResponse] = await Promise.all([
        appFetch(`${API}/summary`),
        appFetch(`${API}/monitoring`),
      ])
      if (!summaryResponse.ok) throw new Error(text(lang, "법인카드 데이터를 불러올 수 없습니다", "Could not load corporate card data", "法人カードのデータを読み込めません"))
      setSummary(await summaryResponse.json())
      if (monitoringResponse.ok) {
        setMonitoring(await monitoringResponse.json())
      } else {
        setMonitoring(blankMonitoring)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : text(lang, "법인카드 데이터를 불러올 수 없습니다", "Could not load corporate card data", "法人カードのデータを読み込めません")
      showToast(message, "error")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [apiFetch, activeMemberId])

  useEffect(() => {
    void loadMembers(false)
  }, [apiFetch])

  useEffect(() => {
    const assigned = members.find((member) => member.id === activeMemberId)?.app_role
    setRoleOverride(assigned ? normalizeRole(assigned) : null)
  }, [members, activeMemberId])

  useEffect(() => {
    // A role change can take away the open tab.
    if (!navItems.some((item) => item.tab === tab && item.roles.includes(role))) {
      setTab("dashboard")
    }
  }, [role])

  useEffect(() => {
    setLang(resolvePlatformLanguage(platform.language))
  }, [platform.language])

  useEffect(() => {
    if (tab !== "submit" || restoredDraftFor.current === activeMemberId) return
    restoredDraftFor.current = activeMemberId
    if (form.vendor || form.amount || form.business_purpose || receiptAnalysis) return
    const draft = readSettlementDraft(activeMemberId)
    if (!draft) return
    setForm({ ...blankSettlementForm, ...draft.form })
    setReceiptAnalysis(draft.analysis ?? null)
    setSubmitStage(draft.analysis ? "form" : "scan")
    showToast(text(lang, "임시저장된 신청서를 불러왔습니다", "Restored your saved draft", "一時保存した申請書を復元しました"), "success")
  }, [tab, activeMemberId])

  useEffect(() => {
    if (!clearConfirmOpen) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) setClearConfirmOpen(false)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [clearConfirmOpen, saving])

  useEffect(() => {
    if (tab === "members" && members.length === 0 && !membersLoading) {
      void loadMembers()
    }
  }, [tab])

  useEffect(() => {
    if (!activeLocality) return
    setForm((current) => {
      if (current.vendor || current.amount || current.business_purpose) return current
      const defaults = localizedSettlementForm(activeLocality)
      return {
        ...current,
        currency: defaults.currency,
        tax_type: current.tax_type || defaults.tax_type,
        tax_rate_percent: current.tax_rate_percent || defaults.tax_rate_percent,
      }
    })
    setPreSpendForm((current) => {
      if (current.vendor || current.amount || current.business_purpose || current.trip_area) return current
      return { ...current, currency: localizedPreSpendForm(activeLocality).currency }
    })
  }, [activeLocality])

  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hostname === "localhost" && window.location.port === "7321") {
      return
    }
    const palette = createPaletteClient(platform)
    const refresh = () => {
      void load()
    }
    const targets = [
      "hierarchy/v1#employee.changed",
      "hierarchy/v1#unit.changed",
      "hierarchy/v1#reporting.changed",
      "hierarchy/v1#hierarchy.changed",
      "policy/v1#policy.changed",
    ]
    const unsubscribers = targets.map((target) => palette.events.on(target, refresh))
    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe())
    }
  }, [platform, apiFetch, activeMemberId])

  async function clearWorkspace() {
    setSaving(true)
    try {
      const response = await appFetch(`${API}/dev/clear`, { method: "DELETE" })
      if (!response.ok) throw new Error(text(lang, "데이터를 삭제할 수 없습니다", "Could not clear data", "データを削除できません"))
      setSummary(blankSummary)
      setMonitoring(blankMonitoring)
      setExpandedClaimId(null)
      setErpResult(null)
      showToast(text(lang, "법인카드 데이터가 삭제되었습니다", "Corporate-card data cleared", "法人カードのデータを削除しました"), "success")
      await load()
    } catch (error) {
      const message = error instanceof Error ? error.message : text(lang, "데이터를 삭제할 수 없습니다", "Could not clear data", "データを削除できません")
      showToast(message, "error")
    } finally {
      setSaving(false)
      setClearConfirmOpen(false)
    }
  }

  function navCount(kind?: NavCount) {
    if (kind === "pending") return summary.counts.pending
    if (kind === "inbox") return inboxClaims.length
    if (kind === "claims") return summary.counts.claims
    if (kind === "anomalies") return myAnomalyCount
    if (kind === "pre_spend") return summary.counts.pre_spend_pending
    if (kind === "monitoring") return monitoring.overview.blocked_claims + monitoring.overview.needs_info_claims + monitoring.overview.statement_missing_claims + monitoring.overview.pre_spend_pending
    return 0
  }

  /* The organisation roster comes from the SDK client, which reads
     /api/v1/org/members with the signed-in user's session and returns every
     member of the active organisation. The app backend's own view
     (`ctx.members.list()`) is kept as a fallback for runtimes where the
     platform client is unavailable, such as the local simulator. */
  async function organizationRoster(): Promise<AppMember[] | null> {
    try {
      const roster = await createPaletteClient(platform).organization.listMembers()
      return Array.isArray(roster) && roster.length > 0 ? (roster as AppMember[]) : null
    } catch (error) {
      console.warn("[corporate-card-system] platform roster unavailable, falling back to the app backend", error)
      return null
    }
  }

  async function appRoleAssignments(): Promise<RoleAssignmentRow[]> {
    try {
      const response = await apiFetch(`${API}/role-assignments`)
      if (!response.ok) return []
      const rows = await response.json()
      return Array.isArray(rows) ? rows as RoleAssignmentRow[] : []
    } catch {
      return []
    }
  }

  async function loadMembers(showErrors = true) {
    setMembersLoading(true)
    setMembersError("")
    try {
      if (platform.permissions && !platform.permissions.includes("members:read")) {
        throw new Error("App does not declare required permission: members:read")
      }
      const [roster, assignments] = await Promise.all([organizationRoster(), appRoleAssignments()])
      if (roster) {
        // Same rule the backend applies: a viewer only sees their own row.
        const merged = mergeAppRoles(roster, assignments)
        const mine = merged.find((member) => member.id === activeMemberId)
        setMembers(mine && normalizeRole(mine.app_role) === "viewer" ? [mine] : merged)
        return
      }
      const response = await apiFetch(`${API}/members`)
      if (!response.ok) throw new Error(text(lang, "조직 멤버를 불러올 수 없습니다", "Could not load organization members", "組織メンバーを読み込めません"))
      setMembers(await response.json())
    } catch (error) {
      const message = error instanceof Error ? error.message : text(lang, "조직 멤버를 불러올 수 없습니다", "Could not load organization members", "組織メンバーを読み込めません")
      setMembersError(message)
      if (showErrors) showToast(message, "error")
    } finally {
      setMembersLoading(false)
    }
  }

  async function setMemberLocality(memberId: string, value: string) {
    setSaving(true)
    try {
      const response = await appFetch(`${API}/member-locality/${encodeURIComponent(memberId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locality: value }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(apiErrorMessage(data, text(lang, "지역을 저장하지 못했습니다", "Could not save the locality", "地域を保存できませんでした")))
      showToast(
        data.locality
          ? text(lang, `지역을 ${data.locality}(으)로 저장했습니다`, `Locality saved as ${data.locality}`, `地域を ${data.locality} として保存しました`)
          : text(lang, "지역 설정을 해제했습니다", "Locality cleared", "地域設定を解除しました"),
        "success",
      )
      await loadMembers()
    } catch (error) {
      showToast(error instanceof Error ? error.message : text(lang, "지역을 저장하지 못했습니다", "Could not save the locality", "地域を保存できませんでした"), "error")
    } finally {
      setSaving(false)
    }
  }

  async function assignMemberRole(memberId: string, nextRole: Role) {
    setSaving(true)
    try {
      const response = await appFetch(`${API}/role-assignments/${encodeURIComponent(memberId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app_role: nextRole, permissions: rolePermissionMap[nextRole] }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(apiErrorMessage(data, text(lang, "역할을 저장할 수 없습니다", "Could not save role assignment", "ロールを保存できません")))
      }
      showToast(text(lang, "앱 역할과 권한을 저장했습니다", "Saved app role and permissions", "アプリのロールと権限を保存しました"), "success")
      await loadMembers(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : text(lang, "역할을 저장할 수 없습니다", "Could not save role assignment", "ロールを保存できません")
      showToast(message, "error")
    } finally {
      setSaving(false)
    }
  }

  function cardLast4FromInput(value: string) {
    const digits = value.replace(/\D/g, "")
    return digits.slice(-4)
  }

  async function createMemberCard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const member = members.find((item) => item.id === cardForm.member_id)
    const last4 = cardLast4FromInput(cardForm.last4 || cardForm.label)
    const monthlyLimit = parseAmountInput(cardForm.monthly_limit)
    if (!member) {
      showToast(text(lang, "카드를 지정할 멤버를 선택하세요", "Choose a member for the card", "カードを割り当てるメンバーを選択してください"), "error")
      return
    }
    if (!/^\d{4}$/.test(last4)) {
      showToast(text(lang, "카드 끝자리 4자리를 입력하세요", "Enter exactly 4 card ending digits", "カード番号の下4桁を入力してください"), "error")
      return
    }
    if (!Number.isFinite(monthlyLimit) || monthlyLimit < 0) {
      showToast(text(lang, "월 한도를 올바르게 입력하세요", "Enter a valid monthly limit", "月間利用限度額を正しく入力してください"), "error")
      return
    }
    const label = (cardForm.label.trim() || `Corporate card ****${last4}`).replace(/\d{5,}/g, (match) => `****${match.slice(-4)}`)
    setSaving(true)
    try {
      const response = await appFetch(`${API}/cards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
	          member_id: member.id,
	          member_name: member.name || member.email || member.id,
	          label,
	          last4,
	          monthly_limit: Math.round(monthlyLimit),
	        }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(apiErrorMessage(data, text(lang, "카드를 생성할 수 없습니다", "Could not create card", "カードを作成できません")))
      }
      setCardForm(blankCardForm)
      showToast(text(lang, "법인카드를 등록했습니다", "Corporate card added", "法人カードを登録しました"), "success")
      await load()
    } catch (error) {
      const message = error instanceof Error ? error.message : text(lang, "카드를 생성할 수 없습니다", "Could not create card", "カードを作成できません")
      showToast(message, "error")
    } finally {
      setSaving(false)
    }
  }

  async function deactivateMemberCard(cardId: number) {
    setSaving(true)
    try {
      const response = await appFetch(`${API}/cards/${cardId}/deactivate`, { method: "POST" })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(apiErrorMessage(data, text(lang, "카드를 비활성화할 수 없습니다", "Could not deactivate card", "カードを無効化できません")))
      }
      showToast(text(lang, "법인카드를 비활성화했습니다", "Corporate card deactivated", "法人カードを無効化しました"), "success")
      await load()
    } catch (error) {
      const message = error instanceof Error ? error.message : text(lang, "카드를 비활성화할 수 없습니다", "Could not deactivate card", "カードを無効化できません")
      showToast(message, "error")
    } finally {
      setSaving(false)
    }
  }

  async function resolveApprovalPath(amount: number, category: string, receiptUrl: string | null): Promise<ApprovalSnapshot> {
    const taxAmount = Number.isFinite(parseAmountInput(form.tax_amount)) ? Math.max(0, Math.round(parseAmountInput(form.tax_amount))) : 0
	    const response = await appFetch(`${API}/approval-path/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requester_member_id: activeMemberId,
	        amount,
	        currency: form.currency,
	        tax_amount: taxAmount,
        tax_type: form.tax_type || null,
        tax_rate_percent: Number.isFinite(parseAmountInput(form.tax_rate_percent)) ? parseAmountInput(form.tax_rate_percent) : null,
        tax_included: form.tax_included,
        category,
        workflow_type: "corporate_card_settlement",
        vendor: form.vendor,
        business_purpose: form.business_purpose,
        transaction_date: form.transaction_date || receiptAnalysis?.draft?.transaction_date || null,
        card_last4: (form.card_last4 || receiptAnalysis?.draft?.card_last4 || "").slice(-4) || null,
        cost_center: form.cost_center || null,
        project_code: form.project_code || null,
        attendees: form.attendees.split(",").map((item) => item.trim()).filter(Boolean),
        receipt_file_url: receiptUrl,
	        receipt_status: receiptUrl ? "attached" : form.receipt_status,
	        missing_receipt_reason: form.missing_receipt_reason || null,
	        ...invoiceEvidencePayload(form),
	        pre_approval_id: form.pre_approval_id ? Number(form.pre_approval_id) : null,
      }),
    })
    if (!response.ok) {
      return {
        source: "local_json_hierarchy",
        resolver_source: "local_json_hierarchy",
        approvers: [],
        warnings: [text(lang, "조직도 서비스에서 결재선을 찾을 수 없습니다.", "The hierarchy service could not resolve an approval path.", "組織図サービスで決裁ルートを特定できませんでした。")],
      }
    }
    return response.json()
  }

  async function uploadReceiptFile(file: File): Promise<string> {
    const body = new FormData()
    body.append("file", file)
    const response = await appFetch(`${API}/receipts/upload`, { method: "POST", body })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(data.detail ?? text(lang, "증빙 파일을 업로드할 수 없습니다", "Could not upload receipt file", "証憑ファイルをアップロードできません"))
    }
    if (typeof data.url !== "string" || !data.url) {
      throw new Error(text(lang, "증빙 파일 URL을 받을 수 없습니다", "Receipt upload did not return a file URL", "証憑ファイルの URL を取得できません"))
    }
    return data.url
  }

  function saveSettlementDraft() {
    if (!writeSettlementDraft(activeMemberId, { form, analysis: receiptAnalysis, saved_at: new Date().toISOString() })) {
      showToast(text(lang, "이 브라우저에서는 임시저장을 사용할 수 없습니다", "This browser blocked draft storage", "このブラウザでは一時保存を利用できません"), "error")
      return
    }
    restoredDraftFor.current = activeMemberId
    showToast(
      receiptFile
        ? text(lang, "임시저장했습니다. 다시 열 때 증빙 파일을 첨부하세요.", "Draft saved. Re-attach the receipt file when you reopen it.", "一時保存しました。再度開く際は証憑ファイルを添付してください。")
        : text(lang, "임시저장했습니다.", "Draft saved.", "一時保存しました。"),
      "success",
    )
  }

  async function submitClaim(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const amount = Number.parseFloat(form.amount.replace(/,/g, ""))
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast(text(lang, "올바른 금액을 입력하세요", "Enter a valid amount", "正しい金額を入力してください"), "error")
      return
    }
    const taxAmount = parseAmountInput(form.tax_amount)
	    const taxAmountValue = Number.isFinite(taxAmount) && taxAmount > 0 ? Math.round(taxAmount) : 0
    const taxRate = parseAmountInput(form.tax_rate_percent)
    const taxRatePercent = Number.isFinite(taxRate) ? taxRate : null
	    if (taxAmountValue > Math.round(amount)) {
      showToast(text(lang, "세액은 총액보다 클 수 없습니다", "Tax amount cannot exceed the total", "税額は合計金額を超えることはできません"), "error")
      return
    }

    setSaving(true)
    setWarning("")
    try {
	      const amountValue = Math.round(amount)
      let receiptUrl: string | null = null
      if (receiptFile) {
        try {
          receiptUrl = await uploadReceiptFile(receiptFile)
        } catch (error) {
          throw new Error(error instanceof Error ? error.message : text(lang, "증빙 파일을 업로드할 수 없습니다", "Could not upload receipt file", "証憑ファイルをアップロードできません"))
        }
      }
      const receiptStatus = receiptUrl ? "attached" : form.receipt_status
	      const approvalSnapshot = await resolveApprovalPath(amountValue, form.category, receiptUrl)

      const response = await appFetch(`${API}/claims`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
	          vendor: form.vendor,
	          amount: amountValue,
	          currency: form.currency,
	          tax_amount: taxAmountValue,
          tax_type: form.tax_type || null,
          tax_rate_percent: taxRatePercent,
          tax_included: form.tax_included,
          category: form.category,
          business_purpose: form.business_purpose,
          requester_name: activeMemberName,
          transaction_date: form.transaction_date || receiptAnalysis?.draft?.transaction_date || null,
          card_last4: (form.card_last4 || receiptAnalysis?.draft?.card_last4 || "").slice(-4) || null,
          cost_center: form.cost_center || null,
          project_code: form.project_code || null,
          attendees: form.attendees.split(",").map((item) => item.trim()).filter(Boolean),
	          receipt_file_url: receiptUrl,
	          receipt_status: receiptStatus,
	          missing_receipt_reason: form.missing_receipt_reason || null,
	          ...invoiceEvidencePayload(form),
	          pre_approval_id: form.pre_approval_id ? Number(form.pre_approval_id) : null,
          receipt_analysis: receiptAnalysis?.analysis ?? {},
          approval_snapshot: approvalSnapshot,
        }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(apiErrorMessage(data, text(lang, "정산 신청을 생성할 수 없습니다", "Could not create settlement claim", "精算申請を作成できません")))
      }
      const warnings = approvalSnapshot.warnings ?? []
      if (warnings.length) setWarning(warnings.join(" "))
      clearSettlementDraft(activeMemberId)
      restoredDraftFor.current = activeMemberId
      setForm(localizedSettlementForm(activeLocality))
      setReceiptFile(null)
      setReceiptAnalysis(null)
      setSubmitStage("scan")
      setFileInputKey((key) => key + 1)
      setTab("history")
      showToast(text(lang, "정산 신청이 생성되었습니다", "Settlement claim created", "精算申請を作成しました"), "success")
      await load()
    } catch (error) {
      const message = error instanceof Error ? error.message : text(lang, "정산 신청을 생성할 수 없습니다", "Could not create settlement claim", "精算申請を作成できません")
      showToast(message, "error")
    } finally {
      setSaving(false)
    }
  }

  async function analyzeReceiptUpload(file: File | null) {
    if (!file) return
    setReceiptFile(file)
    setReceiptAnalysis(null)
    setWarning("")
    setReceiptAnalyzing(true)
    setSubmitStage("review")
    try {
      const body = new FormData()
      body.append("file", file)
      body.append("notes", "Corporate-card settlement receipt. Extract merchant, total, tax, card last4, line items, categories, tags, and policy flags.")
      const response = await appFetch(`${API}/receipt/analyze`, { method: "POST", body })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.detail ?? text(lang, "영수증 분석에 실패했습니다", "Receipt analysis failed", "領収書の分析に失敗しました"))
      }
      const data = await response.json() as ReceiptAnalysisResult
      setReceiptAnalysis(data)
      const draft = data.draft ?? {}
      const analysis = data.analysis ?? {}
      const hints = analysis.corporate_card_hints ?? {}
      setForm((current) => {
        const nextCurrency = draft.currency || analysis.document?.currency || current.currency
        const defaults = taxDefaults(nextCurrency)
        return {
          ...current,
          vendor: draft.vendor || analysis.merchant?.name || current.vendor,
          amount: draft.amount != null ? String(draft.amount) : current.amount,
          currency: nextCurrency,
          tax_amount: draft.tax_amount != null ? String(draft.tax_amount) : analysis.amounts?.tax != null ? String(analysis.amounts.tax) : current.tax_amount,
          tax_type: draft.tax_type || current.tax_type || defaults.tax_type,
          tax_rate_percent: draft.tax_rate_percent != null ? String(draft.tax_rate_percent) : current.tax_rate_percent || defaults.tax_rate_percent,
          tax_included: draft.tax_included ?? current.tax_included,
          supplier_gstin: draft.supplier_gstin || analysis.merchant?.tax_id || current.supplier_gstin,
          supplier_business_registration_number: draft.supplier_business_registration_number || analysis.merchant?.business_number || current.supplier_business_registration_number,
          supplier_legal_name: draft.supplier_legal_name || analysis.merchant?.name || current.supplier_legal_name,
          invoice_number: draft.invoice_number || analysis.document?.invoice_number || analysis.document?.receipt_number || current.invoice_number,
          invoice_date: draft.invoice_date || analysis.document?.transaction_date || current.invoice_date,
          payment_method: draft.payment_method || analysis.document?.payment_method || current.payment_method,
          cash_receipt_reference: draft.cash_receipt_reference || analysis.document?.receipt_number || current.cash_receipt_reference,
          fx_evidence_url: draft.fx_evidence_url || current.fx_evidence_url,
          fx_evidence_description: draft.fx_evidence_description || current.fx_evidence_description,
          category: normalizeCategory(draft.category || hints.suggested_account_name || hints.suggested_account_code || current.category),
          business_purpose: current.business_purpose || buildPurposeFromAnalysis(data, lang),
          transaction_date: draft.transaction_date || analysis.document?.transaction_date || current.transaction_date,
          card_last4: draft.card_last4 || analysis.document?.card_last4 || current.card_last4,
          receipt_status: "attached",
        }
      })
      const warnings = analysis.extraction_warnings ?? []
      if (warnings.length) setWarning(warnings.join(" "))
      showToast(text(lang, "영수증 분석이 완료되었습니다", "Receipt analysis completed", "領収書の分析が完了しました"), "success")
    } catch (error) {
      const message = error instanceof Error ? error.message : text(lang, "영수증 분석에 실패했습니다", "Receipt analysis failed", "領収書の分析に失敗しました")
      showToast(message, "error")
      setWarning(message)
    } finally {
      setReceiptAnalyzing(false)
    }
  }

  async function decide(claimId: number, action: "approved" | "rejected", memo?: string) {
    setSaving(true)
    try {
      const response = await appFetch(`${API}/claims/${claimId}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          memo: memo?.trim() || (action === "approved" ? "Approved in Palette OS" : ""),
        }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        if (response.status === 404) {
          setExpandedClaimId(null)
          await load()
        }
        throw new Error(data.detail ?? text(lang, "결재 상태를 업데이트할 수 없습니다", "Could not update approval", "決裁ステータスを更新できません"))
      }
      showToast(action === "approved" ? text(lang, "정산이 승인되었습니다", "Settlement approved", "精算を承認しました") : text(lang, "정산이 반려되었습니다", "Settlement rejected", "精算を差し戻しました"), action === "approved" ? "success" : "info")
      setExpandedClaimId(null)
      await load()
    } catch (error) {
      const message = error instanceof Error ? error.message : text(lang, "결재 상태를 업데이트할 수 없습니다", "Could not update approval", "決裁ステータスを更新できません")
      showToast(message, "error")
    } finally {
      setSaving(false)
    }
  }

  async function resubmitClaim(
    claimId: number,
    businessPurpose: string,
    comment: string,
    missingReceiptReason = "",
    invoiceEvidence: Partial<Record<InvoiceEvidenceKey, string | null | undefined>> = {},
  ): Promise<boolean> {
    setSaving(true)
    try {
      const response = await appFetch(`${API}/claims/${claimId}/resubmit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_purpose: businessPurpose.trim(),
	          comment: comment.trim(),
	          receipt_status: missingReceiptReason.trim() ? "missing_declared" : undefined,
	          missing_receipt_reason: missingReceiptReason.trim() || undefined,
	          ...invoiceEvidencePayload(invoiceEvidence),
	        }),
	      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        if (response.status === 404) {
          setExpandedClaimId(null)
          await load()
        }
        throw new Error(apiErrorMessage(data, text(lang, "정산을 재상신할 수 없습니다", "Could not resubmit settlement", "精算を再申請できません")))
      }
      showToast(text(lang, "정산이 다시 상신되었습니다", "Settlement resubmitted for approval", "精算を再申請しました"), "success")
      setExpandedClaimId(null)
      await load()
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : text(lang, "정산을 재상신할 수 없습니다", "Could not resubmit settlement", "精算を再申請できません")
      showToast(message, "error")
      return false
    } finally {
      setSaving(false)
    }
  }

  async function submitQuickResubmission() {
    if (!quickResubmitDraft || !quickResubmitDraft.businessPurpose.trim() || !quickResubmitDraft.comment.trim()) return
    const ok = await resubmitClaim(quickResubmitDraft.claim.id, quickResubmitDraft.businessPurpose, quickResubmitDraft.comment, quickResubmitDraft.missingReceiptReason, quickResubmitDraft)
    if (ok) setQuickResubmitDraft(null)
  }

  async function readStatementFile(file: File | null) {
    if (!file) return
    setStatementFileName(file.name)
    setStatementCsv(await file.text())
  }

  async function importStatement() {
    if (!statementCsv.trim()) {
      showToast(text(lang, "CSV 텍스트를 붙여넣거나 파일을 선택하세요", "Paste CSV text or choose a statement file", "CSV テキストを貼り付けるか、ファイルを選択してください"), "error")
      return
    }
    setStatementImporting(true)
    try {
      const response = await appFetch(`${API}/statements/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: statementFileName || "statement.csv",
          csv_text: statementCsv,
        }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.detail ?? text(lang, "카드 사용내역을 가져올 수 없습니다", "Could not import statement", "カード利用明細を取り込めません"))
      }
      const data = await response.json()
      const importedRows: StatementRow[] = Array.isArray(data.rows) ? data.rows : []
      const duplicateCount = importedRows.filter((row) => row.match_status === "duplicate").length
      showToast(
        text(
          lang,
          `카드 사용내역 대사 완료: 매칭 ${data.upload?.matched_count ?? 0}건 · 조치필요 ${data.upload?.missing_count ?? 0}건 · 중복 ${duplicateCount}건`,
          `Statement reconciled: ${data.upload?.matched_count ?? 0} matched · ${data.upload?.missing_count ?? 0} action needed · ${duplicateCount} duplicates`, `カード利用明細の照合完了: 一致 ${data.upload?.matched_count ?? 0}件 · 要対応 ${data.upload?.missing_count ?? 0}件 · 重複 ${duplicateCount}件`,
        ),
        "success",
      )
      await load()
    } catch (error) {
      const message = error instanceof Error ? error.message : text(lang, "카드 사용내역을 가져올 수 없습니다", "Could not import statement", "カード利用明細を取り込めません")
      showToast(message, "error")
    } finally {
      setStatementImporting(false)
    }
  }

  async function createClaimFromStatement(rowId: number) {
    setSaving(true)
    try {
      const response = await appFetch(`${API}/statements/${rowId}/create-claim`, { method: "POST" })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.detail ?? text(lang, "정산 신청을 생성할 수 없습니다", "Could not create claim", "精算申請を作成できません"))
      }
      showToast(text(lang, "누락 정산 신청이 생성되었습니다", "Missing-claim request created", "未精算分の精算申請を作成しました"), "success")
      await load()
      setTab("history")
    } catch (error) {
      const message = error instanceof Error ? error.message : text(lang, "정산 신청을 생성할 수 없습니다", "Could not create claim", "精算申請を作成できません")
      showToast(message, "error")
    } finally {
      setSaving(false)
    }
  }

  function downloadCsv(filename: string, csvText: string) {
    const blob = new Blob([csvText], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  async function exportErp() {
    setSaving(true)
    try {
      const response = await appFetch(`${API}/erp/export`, { method: "POST" })
      if (!response.ok) throw new Error(text(lang, "ERP 출력을 생성할 수 없습니다", "Could not generate ERP export", "ERP 出力を作成できません"))
      const data = await response.json()
      setErpResult(data)
      if (data.csv && data.filename) downloadCsv(data.filename, data.csv)
      showToast(text(lang, `ERP 출력이 생성되었습니다: ${data.row_count}행`, `ERP export generated: ${data.row_count} rows`, `ERP 出力を作成しました: ${data.row_count}行`), "success")
      await load()
    } catch (error) {
      const message = error instanceof Error ? error.message : text(lang, "ERP 출력을 생성할 수 없습니다", "Could not generate ERP export", "ERP 出力を作成できません")
      showToast(message, "error")
    } finally {
      setSaving(false)
    }
  }

  async function createPreSpendRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const requestType = preSpendForm.request_type
    const budgetItems = requestType === "business_trip" ? tripBudgetItemsFromForm(preSpendForm) : []
    const splitTotal = budgetTotal(budgetItems)
    let amount = parseAmountInput(preSpendForm.amount)
    if ((!Number.isFinite(amount) || amount <= 0) && requestType === "business_trip" && splitTotal > 0) {
      amount = splitTotal
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast(text(lang, "올바른 금액을 입력하세요", "Enter a valid amount", "正しい金額を入力してください"), "error")
      return
    }
    if (requestType === "business_trip" && !preSpendForm.trip_area.trim()) {
      showToast(text(lang, "출장 지역을 입력하세요", "Enter the trip area", "出張先を入力してください"), "error")
      return
    }
    if (requestType === "business_trip" && splitTotal > 0 && Math.abs(splitTotal - amount) > tripBudgetTolerance(amount)) {
      showToast(text(lang, "세부 예산 합계가 예상 금액과 크게 다릅니다", "Budget split-up differs too much from expected spend", "予算内訳の合計が見込み金額と大きく異なります"), "error")
      return
    }
    setSaving(true)
    try {
      const response = await appFetch(`${API}/pre-spend-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
	          request_type: requestType,
	          vendor: preSpendForm.vendor || null,
	          amount: Math.round(amount),
	          currency: preSpendForm.currency,
	          ...invoiceEvidencePayload(preSpendForm),
	          category: requestType === "business_trip" ? "travel" : preSpendForm.category,
          business_purpose: preSpendForm.business_purpose,
          requester_name: activeMemberName,
          expected_purchase_date: requestType === "business_trip" ? (preSpendForm.trip_start_date || null) : (preSpendForm.expected_purchase_date || null),
          trip_area: requestType === "business_trip" ? preSpendForm.trip_area || null : null,
          trip_start_date: requestType === "business_trip" ? preSpendForm.trip_start_date || null : null,
          trip_end_date: requestType === "business_trip" ? preSpendForm.trip_end_date || null : null,
          budget_items: budgetItems,
          cost_center: preSpendForm.cost_center || null,
          project_code: preSpendForm.project_code || null,
          attendees: preSpendForm.attendees.split(",").map((item) => item.trim()).filter(Boolean),
        }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(apiErrorMessage(data, text(lang, "사전 승인을 생성할 수 없습니다", "Could not create pre-spend request", "事前承認を作成できません")))
      }
      setPreSpendForm(localizedPreSpendForm(activeLocality))
      showToast(text(lang, "사전 사용 승인이 생성되었습니다", "Pre-spend request created", "事前利用承認を作成しました"), "success")
      await load()
    } catch (error) {
      const message = error instanceof Error ? error.message : text(lang, "사전 승인을 생성할 수 없습니다", "Could not create pre-spend request", "事前承認を作成できません")
      showToast(message, "error")
    } finally {
      setSaving(false)
    }
  }

  async function decidePreSpendRequest(requestId: number, action: "approved" | "rejected") {
    const memo = action === "approved"
      ? "Approved pre-spend request"
      : window.prompt(text(lang, "반려 사유를 입력하세요.", "Enter a rejection reason.", "差し戻し理由を入力してください。"), "")?.trim()
    if (action === "rejected" && !memo) return
    setSaving(true)
    try {
      const response = await appFetch(`${API}/pre-spend-requests/${requestId}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, memo }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(apiErrorMessage(data, text(lang, "사전 승인 상태를 변경할 수 없습니다", "Could not update pre-spend request", "事前承認のステータスを変更できません")))
      }
      showToast(action === "approved" ? text(lang, "사전 승인이 승인되었습니다", "Pre-spend approved", "事前承認を承認しました") : text(lang, "사전 승인이 반려되었습니다", "Pre-spend rejected", "事前承認を差し戻しました"), action === "approved" ? "success" : "info")
      await load()
    } catch (error) {
      const message = error instanceof Error ? error.message : text(lang, "사전 승인 상태를 변경할 수 없습니다", "Could not update pre-spend request", "事前承認のステータスを変更できません")
      showToast(message, "error")
    } finally {
      setSaving(false)
    }
  }

  async function askAssistant(question: string) {
    const trimmed = question.trim()
    if (!trimmed || assistantLoading) return
    /* The history sent is the thread BEFORE this turn; the new question goes in
       its own field so the backend never has to guess which turn is live. */
    const history = assistantThread.map(({ role, content }) => ({ role, content }))
    setAssistantThread((thread) => [...thread, { role: "user", content: trimmed }])
    setAssistantInput("")
    setAssistantError(null)
    setAssistantLoading(true)
    try {
      const response = await appFetch(`${API}/assistant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed, lang, history }),
      })
      if (!response.ok) throw new Error(text(lang, "어시스턴트가 응답하지 못했습니다", "The assistant could not answer", "アシスタントが応答できませんでした"))
      const data = await response.json()
      setAssistantThread((thread) => [...thread, { role: "assistant", content: String(data.answer || ""), source: data.source }])
    } catch (error) {
      /* The question stays in the thread and the text returns to the box, so a
         failed round trip costs a retry, not the typing. */
      setAssistantInput(trimmed)
      setAssistantThread((thread) => thread.slice(0, -1))
      setAssistantError(error instanceof Error ? error.message : text(lang, "어시스턴트가 응답하지 못했습니다", "The assistant could not answer", "アシスタントが応答できませんでした"))
    } finally {
      setAssistantLoading(false)
    }
  }

  function openAssistant() {
    setAssistantOpen(true)
  }

  function closeAssistant() {
    setAssistantOpen(false)
    /* Focus goes back to the control that opened the panel, or the user lands
       at the top of the document with no idea where they were. */
    assistantTriggerRef.current?.focus()
  }

  /* Escape closes the panel from anywhere inside it. It is docked, not modal,
     so the rest of the app stays operable and focus is not trapped. */
  useEffect(() => {
    if (!assistantOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      closeAssistant()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [assistantOpen])

  useEffect(() => {
    if (assistantOpen) assistantInputRef.current?.focus()
  }, [assistantOpen])

  /* Pin the newest turn into view, including while an answer is pending. */
  useEffect(() => {
    const node = assistantThreadRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [assistantThread, assistantLoading])

  async function askPolicyQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!qaQuestion.trim()) return
    setQaLoading(true)
    try {
      const response = await appFetch(`${API}/policy-question`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: qaQuestion,
          lang,
          category: "corporate_card",
          domain: "corporate_card",
          country: "KR",
        }),
      })
      if (!response.ok) throw new Error(text(lang, "정책 질문에 답변할 수 없습니다", "Could not answer policy question", "ポリシーに関する質問に回答できません"))
      const data = await response.json()
      showToast(data.source === "local_policy" ? text(lang, "로컬 정책 기준으로 답변했습니다", "Answered from local policy fallback", "ローカルのポリシー基準で回答しました") : text(lang, "정책 서비스가 답변했습니다", "Answered by policy service", "ポリシーサービスが回答しました"), "success")
      setQaQuestion("")
      await load()
    } catch (error) {
      const message = error instanceof Error ? error.message : text(lang, "정책 질문에 답변할 수 없습니다", "Could not answer policy question", "ポリシーに関する質問に回答できません")
      showToast(message, "error")
    } finally {
      setQaLoading(false)
    }
  }

  function renderDashboard() {
    const profile = roleProfiles[role]
    const heroCopy =
      isPersonalScope
        ? {
            eyebrow: text(lang, "빠른 실행", "Quick action", "クイックアクション"),
            title: text(lang, "영수증 한 장이면 정산 신청서가 자동 완성됩니다", "A receipt can become a routed settlement request in one pass", "領収書1枚で精算申請書が自動作成されます"),
            sub: text(lang, "문서를 업로드하고 추출 필드를 확인하면 조직도 서비스가 결재선을 계산합니다.", "Upload the document, confirm the extracted fields, and let the hierarchy service resolve the approval line.", "書類をアップロードし抽出項目を確認すると、組織図サービスが決裁ルートを算出します。"),
            cta: text(lang, "정산 신청 시작", "Start a settlement", "精算申請を開始"),
            target: "submit" as Tab,
          }
        : isOversightScope
          ? {
              eyebrow: text(lang, "검토 대기", "Awaiting review", "審査待ち"),
              title: text(lang, "본부 정산 결재를 검토하세요", "Team settlement approvals are ready for decision", "部門の精算決裁を確認してください"),
              sub: text(lang, "상신된 정산, 결재 경로, 규정 예외를 한 화면에서 확인합니다.", "Review submitted claims, inspect the approval path, and keep policy exceptions moving.", "申請済みの精算、決裁ルート、規程の例外を1画面で確認できます。"),
              cta: text(lang, "결재함 열기", "Open approvals", "決裁ボックスを開く"),
              target: "approvals" as Tab,
            }
          : isOversightScope
            ? {
                eyebrow: text(lang, "경영 모니터링", "Executive monitoring", "経営モニタリング"),
                title: text(lang, "전사 법인카드 사용과 리스크를 예측하세요", "Monitor corporate-card spend, controls, and forecasts", "全社の法人カード利用とリスクを予測します"),
                sub: text(lang, "월별·연간 추이, 직원별 사용, 예외, 누락 증빙, ERP 대기 금액을 한 화면에서 확인합니다.", "Review monthly and yearly trends, employee exposure, exceptions, missing evidence, and ERP-ready value.", "月次・年次の推移、従業員別の利用、例外、証憑の不足、ERP 出力待ちの金額を1画面で確認できます。"),
                cta: text(lang, "모니터링 열기", "Open monitoring", "モニタリングを開く"),
                target: "monitoring" as Tab,
              }
          : {
              eyebrow: text(lang, "회계 마감", "Accounting cycle", "経理締め"),
              title: text(lang, "승인된 정산을 ERP로 내보내세요", "Approved settlements are ready for accounting export", "承認済みの精算を ERP に出力してください"),
              sub: text(lang, "전사 사용, 정산 누락, ERP 인계를 관리합니다.", "Track company-wide spend, check missing claim exposure, and prepare ERP handoff.", "全社の利用状況、精算漏れ、ERP への引き継ぎを管理します。"),
              cta: text(lang, "ERP 출력 열기", "Open ERP export", "ERP 出力を開く"),
              target: "erp" as Tab,
            }

    return (
      <>
        <PageHead
          eyebrow={text(lang, `${profile.labelKo} 대시보드`, `${profile.label} dashboard`, `${profile.labelJa} ダッシュボード`)}
          title={isPersonalScope
            ? text(lang, "내가 해야 하는 일", "What needs your attention today", "対応が必要なタスク")
            : isOversightScope
              ? text(lang, "본부 결재와 검토", "Approvals and reviews for your team", "部門の決裁と審査")
              : isOversightScope
                ? text(lang, "전사 비용 통제와 예측", "Company-wide controls and forecasting", "全社の経費統制と予測")
                : text(lang, "전사 사용과 회계 현황", "Company-wide spend and accounting status", "全社の利用状況と経理状況")}
          desc={text(lang, "법인카드 정산, 결재, 사용 현황을 Palette OS 데이터로 처리합니다.", "A Palette OS-native corporate-card workspace backed by live settlement and approval data.", "法人カードの精算、決裁、利用状況を Palette OS のデータで管理します。")}
        />
        <RoleStrip role={role} lang={lang} />
        <div className="hero">
          <div>
            <div className="hero-eyebrow">{heroCopy.eyebrow}</div>
            <h2 className="hero-title">{heroCopy.title}</h2>
            <p className="hero-sub">{heroCopy.sub}</p>
          </div>
          <button className="hero-cta" type="button" onClick={() => setTab(heroCopy.target)}>
            {heroCopy.cta}
          </button>
        </div>
        <section className="grid" style={{ marginBottom: 18 }}>
          <Metric label={text(lang, "총 사용액", "Total spend", "総利用額")} value={money(totalSpend)} sub={text(lang, `${summary.counts.claims}건 정산`, `${summary.counts.claims} settlement requests`, `精算 ${summary.counts.claims}件`)} />
          <Metric label={text(lang, "대기", "Pending", "承認待ち")} value={summary.counts.pending.toString()} sub={money(pendingSpend)} tone="warn" />
          <Metric label={text(lang, "승인", "Approved", "承認済み")} value={summary.counts.approved.toString()} sub={money(approvedSpend)} tone="ok" />
          <Metric label={text(lang, "내 결재", "For me", "自分の決裁")} value={summary.pending_for_me.length.toString()} sub={text(lang, "열린 결재 단계", "Open approval steps", "未完了の決裁ステップ")} tone="info" />
        </section>
        <section className="quick-grid" style={{ marginBottom: 18 }}>
          {isOversightScope ? (
            <>
              <Quick label={text(lang, "모니터링", "Monitoring", "モニタリング")} sub={text(lang, "통제·예측 대시보드", "Controls and forecast dashboard", "統制・予測ダッシュボード")} icon="pulse" onClick={() => setTab("monitoring")} />
              <Quick label={text(lang, "통계", "Statistics", "統計")} sub={text(lang, "계정·상태별 분석", "Category and lifecycle analysis", "勘定科目・ステータス別分析")} icon="bars" onClick={() => setTab("analytics")} />
              <Quick label={text(lang, "정산 이력", "Settlement history", "精算履歴")} sub={text(lang, "전사 정산 검토", "Company-wide claim review", "全社の精算審査")} icon="history" onClick={() => setTab("history")} />
              <Quick label={text(lang, "ERP 상태", "ERP status", "ERP ステータス")} sub={text(lang, "미출력 승인 금액", "Unexported approved value", "未出力の承認済み金額")} icon="export" onClick={() => setTab("erp")} />
            </>
          ) : (
            <>
              <Quick label={text(lang, "정산 신청", "File settlement", "精算申請")} sub={text(lang, "영수증에서 결재 신청", "Receipt to approval request", "領収書から決裁申請")} icon="receipt" onClick={() => setTab("submit")} />
              <Quick label={text(lang, "사전 승인", "Pre-spend", "事前承認")} sub={text(lang, "계획·제한 항목", "Planned or restricted spend", "計画・制限対象の支出")} icon="check" onClick={() => setTab("pre_spend")} />
              <Quick label={text(lang, "결재함", "Approval queue", "決裁ボックス")} sub={text(lang, "대기 중인 결정", "Pending decisions", "保留中の判断")} icon="stamp" onClick={() => setTab("approvals")} />
              <Quick label={text(lang, "사용 현황", "Usage overview", "利用状況")} sub={text(lang, "월별·계정별 추이", "Monthly and category trend", "月次・勘定科目別の推移")} icon="chart" onClick={() => setTab("usage")} />
            </>
          )}
        </section>
        <section className="grid">
          <div className="col-6">
            <div className="dash-card">
              <div className="card-head">
                <div>
                  <div className="card-title">{isPersonalScope ? text(lang, "진행 중인 내 정산", "My settlements in flight", "進行中の自分の精算") : text(lang, "대기 중인 결재", "Pending approvals", "承認待ちの決裁")}</div>
                  <div className="card-sub">{text(lang, "실시간 워크스페이스의 최근 정산과 결재 상태입니다.", "Recent claims and decisions from the live workspace.", "ライブワークスペースの最新の精算と決裁状況です。")}</div>
                </div>
                <button className="card-link" type="button" onClick={() => setTab(isPersonalScope ? "history" : "approvals")}>
                  {text(lang, "전체 보기", "View all", "すべて表示")}
                </button>
              </div>
              <ClaimList lang={lang} claims={(isPersonalScope ? filteredClaims : approvalClaims).slice(0, 4)} loading={loading} onOpen={(id) => {
                setExpandedClaimId(id)
                setTab(isPersonalScope ? "history" : "approvals")
              }} />
            </div>
          </div>
          <div className="col-6">
            <div className="dash-card">
              <div className="card-head">
                <div>
                  <div className="card-title">{text(lang, "계정별 사용 금액", "Spend by category", "勘定科目別の利用金額")}</div>
                  <div className="card-sub">{text(lang, "정산 신청 데이터 기준 실시간 분포입니다.", "Live distribution from settlement claims.", "精算申請データに基づくリアルタイムの分布です。")}</div>
                </div>
                <button className="card-link" type="button" onClick={() => setTab("analytics")}>
                  {text(lang, "자세히", "Details", "詳細")}
                </button>
              </div>
              <CategoryBars lang={lang} categories={categories} total={totalSpend} />
            </div>
          </div>
        </section>
      </>
    )
  }

  function renderInbox() {
    return (
      <>
        <PageHead eyebrow={text(lang, "Inbox", "Inbox", "Inbox")} title={text(lang, "처리할 일", "Action inbox", "対応事項")} desc={text(lang, "선택한 에이전트가 응답해야 하는 정산과 결재 요청입니다.", "Requests and approvals that need a response from the selected agent.", "選択したエージェントの対応が必要な精算・決裁リクエストです。")} />
        <RoleStrip role={role} lang={lang} />
        <section className="grid">
          <Metric label={text(lang, "열림", "Open", "未対応")} value={inboxClaims.length.toString()} sub={text(lang, "응답 필요", "Needs response", "要対応")} tone="warn" />
          <Metric label={text(lang, "정산", "Claims", "精算")} value={summary.counts.claims.toString()} sub={text(lang, "전체 정산", "All settlements", "すべての精算")} />
          <Metric label={text(lang, "반려", "Rejected", "差し戻し")} value={summary.counts.rejected.toString()} sub={text(lang, "신청자 보완", "Return to requester", "申請者による補足")} tone="danger" />
          <Metric label={text(lang, "승인", "Approved", "承認済み")} value={summary.counts.approved.toString()} sub={text(lang, "ERP 출력 가능", "Ready for export", "ERP 出力可能")} tone="ok" />
          <div className="col-12">
            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-title">{isPersonalScope ? text(lang, "내 응답 대기", "My response queue", "自分の対応待ち") : text(lang, "결재 요청", "Approval requests", "決裁リクエスト")}</div>
                  <div className="card-sub">{text(lang, "업무 Inbox에서 바로 처리할 항목입니다.", "Operational inbox rows ready for action.", "業務 Inbox からすぐに対応できる項目です。")}</div>
                </div>
              </div>
              <ClaimList lang={lang} claims={inboxClaims} loading={loading} onOpen={(id) => {
                setExpandedClaimId(id)
                setTab(isPersonalScope ? "history" : "approvals")
              }} />
            </div>
          </div>
        </section>
      </>
    )
  }

  function renderSubmit() {
    const previewAmount = Number.parseFloat(form.amount.replace(/,/g, ""))
    const previewAmountValue = Number.isFinite(previewAmount) ? Math.round(previewAmount) : 0
    const currentTaxProfile = taxProfile(form.currency)
    const currentTaxRate = parseAmountInput(form.tax_rate_percent)
    const suggestedTaxAmount = expectedTaxAmount(previewAmountValue, currentTaxRate, form.tax_included)
    const displayAmount = previewAmountValue > 0 ? money(previewAmountValue, form.currency) : money(132000, activeLocalCurrency)
    const claimInvoiceFields = invoiceFieldsFor(activeLocality, form.currency)
    const formRequiresFx = Boolean(activeLocality && form.currency !== activeLocalCurrency)
    const needsFinanceReview = formRequiresFx || ["equipment", "software", "travel", "entertainment"].includes(form.category)
    /* Mirrors _has_fx_evidence() in the backend: either field satisfies it.
       Evaluated here so a claim the policy engine will certainly reject is
       caught in the form, rather than coming back as a 400 after submission. */
    const fxEvidenceMissing = formRequiresFx && !form.fx_evidence_url.trim() && !form.fx_evidence_description.trim()
    const analysis = receiptAnalysis?.analysis
    const cardbotReady = hasReceiptAnalysisSignal(receiptAnalysis)
    const receiptVendor = form.vendor || analysis?.merchant?.name || (receiptAnalyzing ? text(lang, "분석 중", "Analyzing", "分析中") : text(lang, "거래처 미인식", "Vendor not detected", "取引先を認識できません"))
    const receiptDate = analysis?.document?.transaction_date || "..."
    const receiptCardLast4 = analysis?.document?.card_last4 || "----"
    const receiptSubtotal = analysis?.amounts?.subtotal
    const receiptTax = analysis?.amounts?.tax
    const receiptTotal = analysis?.amounts?.total ?? analysis?.amounts?.paid
    const receiptItems = analysis?.line_items?.length
      ? analysis.line_items.slice(0, 8).map((item) => [
          item.description || text(lang, "항목", "Item", "項目"),
          item.line_total != null ? Number(item.line_total).toLocaleString(langLocale(lang)) : "-",
        ])
      : [[receiptAnalyzing ? text(lang, "LLM이 항목을 추출하는 중입니다", "LLM is extracting line items", "LLM が項目を抽出しています") : text(lang, "분석된 항목 없음", "No extracted line items", "抽出された項目はありません"), "..."]]
    const chatAmount = receiptTotal ?? (previewAmountValue > 0 ? previewAmountValue : null)
    const suggestedAccount = analysis?.corporate_card_hints?.suggested_account_name || analysis?.corporate_card_hints?.suggested_account_code
    const chatSummary = uniqueText([
      form.vendor || analysis?.merchant?.name ? text(lang, `거래처 ${form.vendor || analysis?.merchant?.name}`, `Vendor ${form.vendor || analysis?.merchant?.name}`, `取引先 ${form.vendor || analysis?.merchant?.name}`) : undefined,
      chatAmount != null ? text(lang, `금액 ${Number(chatAmount).toLocaleString(langLocale(lang))} ${form.currency}`, `${Number(chatAmount).toLocaleString(langLocale(lang))} ${form.currency}`, `金額 ${Number(chatAmount).toLocaleString(langLocale(lang))} ${form.currency}`) : undefined,
      analysis?.document?.transaction_date ? text(lang, `일자 ${analysis.document.transaction_date}`, `Date ${analysis.document.transaction_date}`, `日付 ${analysis.document.transaction_date}`) : undefined,
      analysis?.document?.card_last4 ? text(lang, `카드 끝자리 ${analysis.document.card_last4}`, `Card ending ${analysis.document.card_last4}`, `カード下4桁 ${analysis.document.card_last4}`) : undefined,
      suggestedAccount ? text(lang, `추천 계정 ${suggestedAccount}`, `Suggested account ${suggestedAccount}`, `推奨勘定科目 ${suggestedAccount}`) : undefined,
    ])
    const chatMissing = uniqueText([
      form.vendor ? undefined : text(lang, "거래처", "vendor", "取引先"),
      previewAmountValue > 0 ? undefined : text(lang, "금액", "amount", "金額"),
      analysis?.document?.transaction_date ? undefined : text(lang, "거래일", "transaction date", "取引日"),
      analysis?.document?.card_last4 ? undefined : text(lang, "카드 끝자리", "card ending", "カード下4桁"),
    ])
    const chatQuestion = !form.vendor
      ? text(lang, "거래처가 확실하지 않습니다. 정산 신청서에서 거래처를 확인해 주세요.", "I could not identify the vendor. Please confirm it in the request form.", "取引先を特定できませんでした。精算申請書で取引先をご確認ください。")
      : previewAmountValue <= 0
        ? text(lang, "금액이 확실하지 않습니다. 결제 금액을 확인해 주세요.", "I could not identify the amount. Please confirm the paid amount.", "金額を特定できませんでした。支払金額をご確認ください。")
        : !form.business_purpose
          ? text(lang, "이 지출의 업무 목적을 선택하거나 직접 입력해 주세요.", "Choose or enter the business purpose for this spend.", "この支出の業務目的を選択または入力してください。")
          : text(lang, "필수 정보가 채워졌습니다. 자동 생성된 신청서를 검토해 주세요.", "The required details are ready. Review the generated request.", "必須情報が入力されました。自動作成された申請書をご確認ください。")
    const chatSuggestions = receiptAnalysis && cardbotReady ? purposeSuggestionsFromAnalysis(receiptAnalysis, lang) : []
    const extractionWarnings = analysis?.extraction_warnings ?? []
    const availablePreApprovals = summary.pre_spend_requests.filter((item) => {
      if (item.requester_member_id !== activeMemberId) return false
      if (item.request_type === "business_trip") {
        if (!["approved", "used"].includes(item.state)) return false
        if (previewAmountValue <= 0) return true
        return remainingTripPreSpend(summary.claims, item) >= previewAmountValue
      }
      const approvedAmount = amountOf(item)
      return item.state === "approved" && (!form.amount || Math.abs(approvedAmount - previewAmountValue) <= Math.max(1000, Math.round(approvedAmount * 0.15)))
    })
    const currentStep = submitStage === "scan" ? 1 : submitStage === "review" ? 2 : 3
    /* Drop the current receipt and its extracted values, keeping what the
       person wrote, then reopen the picker. Reachable from the scan, review and
       form stages -- the receipt stays swappable right up until the claim is
       actually submitted. */
    const hasDraftInProgress = Boolean(
      form.business_purpose.trim() ||
        form.vendor.trim() ||
        form.amount.trim() ||
        form.cost_center.trim() ||
        form.project_code.trim() ||
        form.attendees.trim(),
    )
    const replaceReceipt = () => {
      setReceiptFile(null)
      setReceiptAnalysis(null)
      setWarning("")
      setForm((current) => {
        const next = { ...current }
        for (const field of RECEIPT_DERIVED_FIELDS) next[field] = blankSettlementForm[field]
        return next
      })
      setSubmitStage("scan")
      /* Remounts the input so choosing the SAME filename again still fires a
         change event -- otherwise re-picking the file you just removed does
         nothing at all. */
      setFileInputKey((key) => key + 1)
    }
    const resetSubmit = () => {
      clearSettlementDraft(activeMemberId)
      restoredDraftFor.current = activeMemberId
      setReceiptFile(null)
      setReceiptAnalysis(null)
      setSubmitStage("scan")
      setFileInputKey((key) => key + 1)
      setForm(localizedSettlementForm(activeLocality))
    }
    return (
      <>
        <PageHead
          eyebrow={text(lang, "법인카드 정산", "Corporate Card Settlement", "法人カード精算")}
          title={text(lang, "정산 신청서 자동 생성", "Auto-generate a settlement request", "精算申請書の自動作成")}
          desc={text(lang, "영수증을 스캔하면 AI가 내용을 추출하고 챗봇이 직원과 대화해 결재 신청서를 자동 완성합니다.", "Scan a receipt and AI extracts the contents; the bot then chats with the employee to auto-fill the approval form.", "領収書をスキャンすると AI が内容を抽出し、チャットボットが従業員と対話しながら決裁申請書を自動作成します。")}
        />
        <div className="stepper v9">
          <div className={`step-card ${currentStep > 1 ? "done" : currentStep === 1 ? "active" : "idle"}`}>
            <span className="step-num">{currentStep > 1 ? "✓" : "1"}</span>
            <div>
              <div className="step-title">{text(lang, "영수증 스캔", "Scan receipt", "領収書スキャン")}</div>
              <div className="step-sub">{text(lang, "종이 영수증 업로드", "Upload paper receipt", "紙の領収書をアップロード")}</div>
            </div>
          </div>
          <div className={`step-card ${currentStep > 2 ? "done" : currentStep === 2 ? "active" : "idle"}`}>
            <span className="step-num">{currentStep > 2 ? "✓" : "2"}</span>
            <div>
              <div className="step-title">{text(lang, "AI 챗봇 확인", "AI bot review", "AI チャットボット確認")}</div>
              <div className="step-sub">{text(lang, "필요 정보 자동 추출", "Auto-extract required info", "必要情報の自動抽出")}</div>
            </div>
          </div>
          <div className={`step-card ${currentStep === 3 ? "active" : "idle"}`}>
            <span className="step-num">3</span>
            <div>
              <div className="step-title">{text(lang, "결재 신청서 생성", "Generate request", "決裁申請書の作成")}</div>
              <div className="step-sub">{text(lang, "자동 작성된 폼 확인", "Review auto-filled form", "自動作成されたフォームを確認")}</div>
            </div>
          </div>
        </div>
        <form onSubmit={submitClaim}>
          {submitStage === "scan" && (
            <div className="card">
              <div className="receipt-stage">
                <label className="upload-zone" style={{ margin: 0, minHeight: 360, cursor: "pointer" }}>
                  <input
                    key={fileInputKey}
                    className="hidden-file"
                    type="file"
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null
                      void analyzeReceiptUpload(file)
                    }}
                  />
                  <span>
                    <span className="upload-icon">+</span>
                    <span className="file-name">{text(lang, "영수증 또는 인보이스 업로드", "Upload receipt or invoice", "領収書またはインボイスのアップロード")}</span>
                    <span className="line-2" style={{ display: "block", marginTop: 6 }}>
                      {text(lang, "PDF, 이미지, 사진 촬영 파일", "PDF, image, or photo capture", "PDF・画像・撮影写真")}
                    </span>
                  </span>
                </label>
                {hasDraftInProgress && (
                  <div className="upload-draft-note">
                    <span>
                      {text(
                        lang,
                        "작성 중인 내용은 그대로 있습니다. 새 영수증을 올리면 영수증에서 읽어온 항목만 새로 채워집니다.",
                        "Your draft is kept. Uploading a new receipt refills only the fields read from the receipt.", "作成中の内容はそのまま保持されます。新しい領収書をアップロードすると、領収書から読み取った項目のみが再入力されます。",
                      )}
                    </span>
                    <button className="button-secondary" type="button" onClick={() => setSubmitStage("form")}>
                      {text(lang, "작성 중인 신청서로 돌아가기", "Back to the draft", "作成中の申請書に戻る")}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {submitStage === "review" && (
            <section className="submit-split">
              <div className="card">
                <div className="card-head">
                  <div>
                    <div className="card-title">{text(lang, "스캔된 영수증", "Scanned receipt", "スキャンした領収書")}</div>
                    <div className="card-sub">{receiptFile ? text(lang, `${receiptFile.name} ${receiptAnalyzing ? "분석 중" : "분석됨"}`, `${receiptAnalyzing ? "Analyzing" : "Analyzed"} ${receiptFile.name}`, `${receiptFile.name} ${receiptAnalyzing ? "分析中" : "分析済み"}`) : text(lang, "영수증 분석 결과", "Receipt analysis result", "領収書の分析結果")}</div>
                  </div>
                  <div className="receipt-head-actions">
                    <span className={`pill ${receiptAnalyzing ? "info" : "ok"}`}>{receiptAnalyzing ? text(lang, "분석 중", "Analyzing", "分析中") : text(lang, "인식됨", "Recognized", "認識済み")}</span>
                    <button
                      className="button-secondary"
                      type="button"
                      disabled={receiptAnalyzing || saving}
                      onClick={replaceReceipt}
                    >
                      {text(lang, "영수증 교체", "Replace receipt", "領収書を差し替え")}
                    </button>
                  </div>
                </div>
                <div className="receipt-paper-wrap">
                  <div className="receipt-paper">
                    <div style={{ textAlign: "center", fontWeight: 900, fontSize: 14, letterSpacing: ".05em" }}>{receiptVendor}</div>
                    <div className="receipt-note" style={{ textAlign: "center", fontSize: 10, marginTop: 4 }}>{analysis?.merchant?.address || ""}</div>
                    <div className="receipt-note" style={{ textAlign: "center", fontSize: 10 }}>{analysis?.merchant?.business_number ? text(lang, `사업자 ${analysis.merchant.business_number}`, `Biz No. ${analysis.merchant.business_number}`, `事業者番号 ${analysis.merchant.business_number}`) : ""}</div>
                    <hr />
                    <div className="receipt-line"><span>{text(lang, "일시", "Date", "日時")}</span><span>{receiptDate}</span></div>
                    <div className="receipt-line"><span>POS / {text(lang, "영수증", "receipt", "領収書")}</span><span>{analysis?.document?.receipt_number || "..."}</span></div>
                    <hr />
                    {receiptItems.map(([name, amount]) => <div className="receipt-line" key={name}><span>{name}</span><span>{amount}</span></div>)}
                    <hr />
                    <div className="receipt-line"><span>{text(lang, "공급가액", "Subtotal", "小計")}</span><span>{receiptSubtotal != null ? Number(receiptSubtotal).toLocaleString(langLocale(lang)) : "-"}</span></div>
                    <div className="receipt-line"><span>{text(lang, "부가세", "VAT", "税額")}</span><span>{receiptTax != null ? Number(receiptTax).toLocaleString(langLocale(lang)) : "-"}</span></div>
                    <div className="receipt-line" style={{ fontWeight: 900, fontSize: 14, marginTop: 6 }}><span>{text(lang, "합계", "Total", "合計")}</span><span>{receiptTotal != null ? Number(receiptTotal).toLocaleString(langLocale(lang)) : "-"}</span></div>
                    <hr />
                    <div className="receipt-note" style={{ textAlign: "center", fontSize: 10 }}>{text(lang, `카드 ****-${receiptCardLast4}`, `Card ****-${receiptCardLast4}`, `カード ****-${receiptCardLast4}`)}</div>
                  </div>
                </div>
                {warning && <div className="warning" style={{ marginTop: 12 }}>{warning}</div>}
              </div>
              <div className="card chat-card">
                <div className="card-head">
                  <div>
                    <div className="card-title">{text(lang, "카드봇 (정산 어시스턴트)", "Card-bot (settlement assistant)", "カードボット(精算アシスタント)")}</div>
                    <div className="card-sub">{cardbotReady ? text(lang, "분석 결과를 바탕으로 정산 신청서를 함께 작성합니다.", "Drafting the settlement from extracted receipt details.", "分析結果をもとに精算申請書を一緒に作成します。") : text(lang, "분석된 필드가 준비되면 대화를 시작합니다.", "The chat starts after extracted fields are available.", "分析済みの項目が揃うと会話を開始します。")}</div>
                  </div>
                </div>
                <div className="chat-area">
                  {!cardbotReady ? (
                    <div className="placeholder-panel" style={{ minHeight: 260 }}>
                      <EmptyState>
                        {receiptAnalyzing
                          ? text(lang, "영수증 필드를 추출하는 중입니다. 카드봇 대화는 분석 결과가 준비되면 시작됩니다.", "Extracting receipt fields. Card-bot chat will start when analysis data is available.", "領収書の項目を抽出しています。カードボットとの会話は分析結果が揃うと開始されます。")
                          : text(lang, "분석 가능한 영수증 정보가 없습니다. 직접 입력하거나 다른 파일로 다시 시도해 주세요.", "No analyzable receipt details are available. Enter the details yourself, or try another file.", "分析できる領収書情報がありません。直接入力するか、別のファイルで再度お試しください。")}
                      </EmptyState>
                      {!receiptAnalyzing && (
                        <div className="actions" style={{ justifyContent: "center" }}>
                          <button className="button-secondary" type="button" onClick={saveSettlementDraft}>
                            {text(lang, "임시저장", "Save draft", "一時保存")}
                          </button>
                          <button className="button" type="button" onClick={() => setSubmitStage("form")}>
                            {text(lang, "직접 입력하기", "Enter details manually", "手動で入力")}
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="bubble-bot">
                        <div className="bubble-meta">CARD-BOT</div>
                        <strong>{receiptAnalyzing ? text(lang, "일부 필드를 먼저 확인했습니다.", "I found some fields so far.", "一部の項目を先に確認しました。") : text(lang, "영수증 분석 결과를 확인했습니다.", "I reviewed the receipt analysis.", "領収書の分析結果を確認しました。")}</strong>
                        <div>{chatSummary.length ? chatSummary.join(" · ") : text(lang, "추출된 필드를 정산 신청서에 반영했습니다.", "I applied the extracted fields to the request.", "抽出した項目を精算申請書に反映しました。")}</div>
                      </div>
                      {(chatMissing.length > 0 || extractionWarnings.length > 0) && (
                        <div className="bubble-bot">
                          <div className="bubble-meta">CARD-BOT</div>
                          {chatMissing.length > 0 && <div>{text(lang, `확인이 필요한 항목: ${chatMissing.join(", ")}`, `Needs confirmation: ${chatMissing.join(", ")}`, `確認が必要な項目: ${chatMissing.join(", ")}`)}</div>}
                          {extractionWarnings.length > 0 && <div>{extractionWarnings.join(" ")}</div>}
                        </div>
                      )}
                      <div className="bubble-bot">
                        <div className="bubble-meta">CARD-BOT</div>
                        <strong>{chatQuestion}</strong>
                      </div>
                      {form.business_purpose && <div className="bubble-user">{form.business_purpose}</div>}
                      {chatSuggestions.length > 0 && (
                        <div className="chip-row wrap">
                          {chatSuggestions.map((item) => (
                            <button className="chip suggest" type="button" key={item} onClick={() => setForm((current) => ({ ...current, business_purpose: item }))}>{item}</button>
                          ))}
                        </div>
                      )}
                      <div style={{ display: "flex", gap: 8, marginTop: "auto" }}>
                        <input className="input" value={form.business_purpose} onChange={(event) => setForm((current) => ({ ...current, business_purpose: event.target.value }))} placeholder={text(lang, "업무 목적을 입력하세요", "Enter business purpose", "業務目的を入力してください")} />
                        <button className="button-secondary" type="button" disabled={receiptAnalyzing} onClick={saveSettlementDraft}>{text(lang, "임시저장", "Save draft", "一時保存")}</button>
                        <button className="button" type="button" disabled={receiptAnalyzing} onClick={() => setSubmitStage("form")}>{receiptAnalyzing ? text(lang, "분석 중", "Analyzing", "分析中") : text(lang, "전송", "Send", "送信")}</button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </section>
          )}

          {submitStage === "form" && (
          <section className="submit-form-panel">
            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-title">{text(lang, "자동 생성된 결재 신청서", "Auto-generated approval request", "自動生成された決裁申請書")}</div>
                  <div className="card-sub">{text(lang, "인식된 영수증과 대화 내용을 바탕으로 자동 완성됩니다.", "Auto-filled from receipt recognition and chat context.", "認識した領収書と会話内容をもとに自動入力されます。")}</div>
                </div>
                <span className="pill ok">AI</span>
              </div>
              <div style={{ padding: 18 }}>
                <div className="paid-total">
                  <div className="metric-label">{text(lang, "결제 총액", "Paid total", "支払総額")}</div>
                  <div className="amount">{displayAmount}</div>
                  <div className="line-2">{receiptVendor} · {receiptDate} · Card ({receiptCardLast4})</div>
                </div>
                <div className="form-grid">
                  <label className="field">
                    {text(lang, "거래처", "Vendor", "取引先")}
                    <input className="input" value={form.vendor} onChange={(event) => setForm((current) => ({ ...current, vendor: event.target.value }))} required />
                  </label>
                  <label className="field">
	                    {text(lang, `금액 (${form.currency})`, `Amount (${form.currency})`, `金額 (${form.currency})`)}
	                    <input className="input" inputMode="decimal" value={form.amount} onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))} required />
	                  </label>
                  <label className="field">
                    {text(lang, "통화", "Currency", "通貨")}
                    <select
                      className="select"
                      value={form.currency}
                      onChange={(event) => {
                        const nextCurrency = event.target.value
                        const previousDefaults = taxDefaults(form.currency)
                        const defaults = taxDefaults(nextCurrency)
                        setForm((current) => ({
                          ...current,
                          currency: nextCurrency,
                          tax_type: !current.tax_type || current.tax_type === previousDefaults.tax_type ? defaults.tax_type : current.tax_type,
                          tax_rate_percent: !current.tax_rate_percent || current.tax_rate_percent === previousDefaults.tax_rate_percent ? defaults.tax_rate_percent : current.tax_rate_percent,
                        }))
                      }}
                    >
                      <option value="KRW">KRW</option>
                      <option value="INR">INR</option>
                      <option value="USD">USD</option>
	                      <option value="EUR">EUR</option>
	                    </select>
	                    <span className="field-note">
	                      {activeLocality ? text(lang, `직원 지역 ${activeLocality} · 기준 통화 ${activeLocalCurrency}`, `Employee locality ${activeLocality} · local currency ${activeLocalCurrency}`, `従業員の地域 ${activeLocality} · 基準通貨 ${activeLocalCurrency}`) : text(lang, "직원 지역 필요", "Employee locality required", "従業員の地域が必要です")}
	                    </span>
	                  </label>
                  <label className="field">
                    {text(lang, "세금 유형", "Tax type", "税区分")}
                    <input className="input" value={form.tax_type} onChange={(event) => setForm((current) => ({ ...current, tax_type: event.target.value }))} placeholder={currentTaxProfile?.type || "VAT/GST"} />
                  </label>
                  <label className="field">
                    {text(lang, "세율", "Tax rate", "税率")}
                    {currentTaxProfile ? (
                      <select className="select" value={form.tax_rate_percent} onChange={(event) => setForm((current) => ({ ...current, tax_rate_percent: event.target.value }))}>
                        {currentTaxProfile.rates.map((rate) => (
                          <option value={rate} key={rate}>{rate}%</option>
                        ))}
                      </select>
                    ) : (
                      <input className="input" inputMode="decimal" value={form.tax_rate_percent} onChange={(event) => setForm((current) => ({ ...current, tax_rate_percent: event.target.value }))} placeholder="0" />
                    )}
                  </label>
                  <label className="field">
                    {text(lang, "세액", "Tax amount", "税額")}
                    <input className="input" inputMode="decimal" value={form.tax_amount} onChange={(event) => setForm((current) => ({ ...current, tax_amount: event.target.value }))} placeholder={suggestedTaxAmount > 0 ? String(suggestedTaxAmount) : "0"} />
                    {suggestedTaxAmount > 0 ? <span className="field-note">{text(lang, `예상 ${money(suggestedTaxAmount, form.currency)}`, `Expected ${money(suggestedTaxAmount, form.currency)}`, `見込み ${money(suggestedTaxAmount, form.currency)}`)}</span> : null}
                  </label>
                  <label className="field">
                    {text(lang, "과세 방식", "Tax basis", "課税方式")}
                    <select className="select" value={form.tax_included ? "included" : "excluded"} onChange={(event) => setForm((current) => ({ ...current, tax_included: event.target.value === "included" }))}>
                      <option value="included">{text(lang, "세금 포함", "Tax included", "税込")}</option>
                      <option value="excluded">{text(lang, "세금 별도", "Tax extra", "税抜")}</option>
	                    </select>
	                  </label>
	                  <div className="field wide">
	                    <span>{text(lang, activeLocality === "IN" ? "인도 인보이스 증빙" : activeLocality === "KR" ? "한국 증빙" : "지역별 증빙", activeLocality === "IN" ? "India invoice evidence" : activeLocality === "KR" ? "Korea receipt evidence" : "Locality evidence", activeLocality === "IN" ? "インドのインボイス証憑" : activeLocality === "KR" ? "韓国の証憑" : "地域別の証憑")}</span>
	                    <span className="field-note">
	                      {formRequiresFx ? text(lang, "외화 사용은 환율 증빙이 필요합니다.", "Foreign-currency spend requires FX evidence.", "外貨での利用には為替レートの証憑が必要です。") : text(lang, `정수 단위 ${form.currency} 금액으로 입력`, `Enter whole-unit ${form.currency} amounts.`, `${form.currency} の金額を整数単位で入力してください`)}
	                    </span>
	                  </div>
	                  {!activeLocality ? (
	                    <div className="warning wide">{text(lang, "조직 멤버의 지역 정보가 없으면 제출이 차단됩니다.", "Submission is blocked until the org member has a supported locality.", "組織メンバーの地域情報がない場合、申請はブロックされます。")}</div>
	                  ) : null}
	                  {claimInvoiceFields.map((field) => {
	                    const isFxField = field.key === "fx_evidence_url" || field.key === "fx_evidence_description"
	                    return (
	                      <label className="field" key={field.key}>
	                        {text(lang, field.ko, field.en, field.ja)}
	                        {isFxField && fxEvidenceMissing ? <span className="field-required">{text(lang, "필수", "required", "必須")}</span> : null}
	                        <input
	                          className="input"
	                          type={field.type || "text"}
	                          value={form[field.key] || ""}
	                          onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))}
	                        />
	                      </label>
	                    )
	                  })}
	                  <label className="field">
	                    {text(lang, "계정 카테고리", "Account category", "勘定カテゴリ")}
                    <select className="select" value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}>
                      <option value="meals">{text(lang, "복리후생비", "Meals", "福利厚生費")}</option>
                      <option value="travel">{text(lang, "여비교통비", "Travel", "旅費交通費")}</option>
                      <option value="software">{text(lang, "지급수수료", "Software", "支払手数料")}</option>
                      <option value="equipment">{text(lang, "비품", "Equipment", "備品")}</option>
                      <option value="general">{text(lang, "소모품비", "General", "消耗品費")}</option>
                    </select>
                  </label>
                  <label className="field">
                    {text(lang, "거래일", "Transaction date", "取引日")}
                    <input className="input" type="date" value={form.transaction_date} onChange={(event) => setForm((current) => ({ ...current, transaction_date: event.target.value }))} />
                  </label>
                  <label className="field">
                    {text(lang, "카드 끝자리", "Card last4", "カード下4桁")}
                    <input className="input" maxLength={4} value={form.card_last4} onChange={(event) => setForm((current) => ({ ...current, card_last4: event.target.value.replace(/\D/g, "").slice(0, 4) }))} />
                  </label>
                  <label className="field">
                    {text(lang, "코스트센터", "Cost center", "コストセンター")}
                    <input className="input" value={form.cost_center} onChange={(event) => setForm((current) => ({ ...current, cost_center: event.target.value }))} />
                  </label>
                  <label className="field">
                    {text(lang, "프로젝트", "Project", "プロジェクト")}
                    <input className="input" value={form.project_code} onChange={(event) => setForm((current) => ({ ...current, project_code: event.target.value }))} />
                  </label>
                  <label className="field">
                    {text(lang, "참석자/맥락", "Attendees/context", "参加者/背景")}
                    <input className="input" value={form.attendees} onChange={(event) => setForm((current) => ({ ...current, attendees: event.target.value }))} placeholder={text(lang, "쉼표로 구분", "Comma separated", "カンマ区切り")} />
                  </label>
                  <label className="field">
                    {text(lang, "사전 승인", "Pre-spend approval", "事前承認")}
                    <select className="select" value={form.pre_approval_id} onChange={(event) => setForm((current) => ({ ...current, pre_approval_id: event.target.value }))}>
                      <option value="">{text(lang, "연결 안 함", "No linked approval", "連携しない")}</option>
                      {availablePreApprovals.map((item) => (
                        <option value={item.id} key={item.id}>{preSpendOptionLabel(item, summary.claims)}</option>
                      ))}
                    </select>
                  </label>
                  {!receiptFile ? (
                    <>
                      <label className="field">
                        {text(lang, "증빙 상태", "Receipt status", "証憑ステータス")}
                        <select className="select" value={form.receipt_status} onChange={(event) => setForm((current) => ({ ...current, receipt_status: event.target.value }))}>
                          <option value="attached">{text(lang, "첨부", "Attached", "添付済み")}</option>
                          <option value="missing_declared">{text(lang, "영수증 없음 신고", "Missing receipt declared", "領収書なしを申告")}</option>
                        </select>
                      </label>
                      <label className="field">
                        {text(lang, "영수증 없음 사유", "Missing receipt reason", "領収書がない理由")}
                        <input className="input" value={form.missing_receipt_reason} onChange={(event) => setForm((current) => ({ ...current, missing_receipt_reason: event.target.value }))} />
                      </label>
                    </>
                  ) : null}
                  <label className="field wide">
                    {text(lang, "사용 목적", "Business purpose", "利用目的")}
                    <textarea className="textarea" value={form.business_purpose} onChange={(event) => setForm((current) => ({ ...current, business_purpose: event.target.value }))} required />
                  </label>
                </div>
                <div className="ai-suggestion">
                  <div className="bubble-meta">{text(lang, "법카봇 자동 추천", "Card-bot suggestion", "カードボットの自動提案")}</div>
                  <div><strong>{analysis?.corporate_card_hints?.suggested_account_name || analysis?.corporate_card_hints?.suggested_account_code || text(lang, "계정과목 검토 필요", "Account review needed", "勘定科目の確認が必要")}</strong></div>
                  <div className="line-2">{analysis?.corporate_card_hints?.allocation_reason || text(lang, "LLM 분석 결과를 기준으로 계정과목과 정책 플래그를 추천합니다.", "Account and policy flags are suggested from the LLM analysis.", "LLM の分析結果をもとに勘定科目とポリシーフラグを提案します。")}</div>
                </div>
                {fxEvidenceMissing && (
                  <div className="warning" style={{ marginTop: 14 }}>
                    {text(
                      lang,
                      `${activeLocality} 소속은 ${activeLocalCurrency}로 정산합니다. ${form.currency} 지출은 환율 증빙(URL 또는 설명)이 있어야 상신됩니다.`,
                      `${activeLocality} employees settle in ${activeLocalCurrency}. A ${form.currency} expense needs FX evidence — fill in the FX evidence URL or note above before submitting.`, `${activeLocality} 所属の従業員は ${activeLocalCurrency} で精算します。${form.currency} での支出は、為替証憑(URL または説明)を入力しないと申請できません。`,
                    )}
                  </div>
                )}
                <div className="actions" style={{ marginTop: 18, justifyContent: "flex-end" }}>
                  <button className="button-secondary" type="button" disabled={saving} onClick={replaceReceipt}>
                    {text(lang, "영수증 교체", "Replace receipt", "領収書を差し替え")}
                  </button>
                  <button className="button-secondary" type="button" disabled={saving} onClick={resetSubmit}>
                    {text(lang, "전체 초기화", "Reset all", "すべてリセット")}
                  </button>
                  <button className="button-secondary" type="button" onClick={saveSettlementDraft}>{text(lang, "임시저장", "Save draft", "一時保存")}</button>
                  <button className="button" disabled={saving} type="submit">
                    {saving ? text(lang, "상신 중", "Submitting", "申請中") : text(lang, "결재 상신", "Submit for approval", "決裁申請")}
                  </button>
                </div>
              </div>
            </div>
            <div>
              <div className="card">
                <div className="card-head">
                  <div>
                    <div className="card-title">{text(lang, "결재선", "Approval line", "決裁ルート")}</div>
                    <div className="card-sub">{text(lang, "상신 시 조직도 서비스에서 계산됩니다.", "Resolved from the hierarchy service at submission time.", "申請時に組織図サービスで算出されます。")}</div>
                  </div>
	                  <span className={`pill ${activeLocality ? "info" : "warn"}`}>{activeLocality ? text(lang, "조직도 결재", "Hierarchy route", "組織図に基づく決裁") : text(lang, "지역 필요", "Locality required", "地域が必要です")}</span>
                </div>
                <div className="approval-line">
                  <div className="approval-step">
                    <span className="approval-index">1</span>
                    <div>
                      <div className="line-1">{text(lang, "직속 관리자", "Direct manager", "直属の上長")}</div>
                      <div className="line-2">{text(lang, "1차 결재", "First approval", "一次決裁")}</div>
                    </div>
                    <span className="pill pending">{text(lang, "대기", "Pending", "承認待ち")}</span>
                  </div>
	                  <div className="approval-step">
	                    <span className="approval-index">2</span>
	                    <div>
	                      <div className="line-1">{text(lang, "다음 보고 책임자", "Next reporting head", "次の報告責任者")}</div>
	                      <div className="line-2">{text(lang, "존재하고 중복이 아닐 때 포함", "Included when present and distinct", "存在し、重複しない場合に含む")}</div>
	                    </div>
	                    <span className="pill pending">{text(lang, "조건부", "Conditional", "条件付き")}</span>
	                  </div>
	                  {needsFinanceReview && (
	                    <div className="approval-step">
	                      <span className="approval-index">3</span>
	                      <div>
	                        <div className="line-1">{text(lang, "회계 책임자", "Finance head", "経理責任者")}</div>
	                        <div className="line-2">{text(lang, "정책 플래그 또는 세무 검토", "Policy flags or tax review", "ポリシーフラグまたは税務確認")}</div>
	                      </div>
	                      <span className="pill pending">{text(lang, "대기", "Pending", "承認待ち")}</span>
	                    </div>
                  )}
                </div>
              </div>
              <div className="card" style={{ marginTop: 16 }}>
                <div className="card-head"><div className="card-title">{text(lang, "처리 흐름", "Processing flow", "処理フロー")}</div></div>
                <div style={{ padding: 16, display: "grid", gap: 9 }}>
                  {[text(lang, "영수증 자동 인식 · 완료", "Receipt recognized · done", "領収書の自動認識 · 完了"), text(lang, "법인카드 매칭 · 하나(2352)", "Card matched · Hana (2352)", "法人カード照合 · ハナ(2352)"), text(lang, "계정과목 추천 · 93.6% 신뢰도", "Account suggested · 93.6% confidence", "勘定科目の提案 · 信頼度 93.6%"), text(lang, "규정 검토 · 정상", "Rules review · normal", "規程チェック · 正常")].map((item) => (
                    <div className="line-2" key={item}><strong style={{ color: "var(--ok)" }}>✓</strong> {item}</div>
                  ))}
                </div>
              </div>
            </div>
          </section>
          )}
        </form>
      </>
    )
  }

  function renderPreSpend() {
    const pending = visiblePreSpendRequests.filter((item) => item.state === "pending").length
    const approved = visiblePreSpendRequests.filter((item) => item.state === "approved" || item.state === "used").length
    const isTripRequest = preSpendForm.request_type === "business_trip"
    const formBudgetItems = tripBudgetItemsFromForm(preSpendForm)
    const formBudgetTotal = budgetTotal(formBudgetItems)
    const preSpendLocalCurrency = currencyForLocality(activeLocality) || preSpendForm.currency
    const preSpendRequiresFx = Boolean(activeLocality && preSpendForm.currency !== preSpendLocalCurrency)
    const preSpendInvoiceFields = invoiceFieldsFor(activeLocality, preSpendForm.currency)
    return (
      <>
        <PageHead
          eyebrow={text(lang, "사전 승인", "Pre-spend", "事前承認")}
          title={text(lang, "계획·제한 항목 사전 사용 승인", "Pre-approve planned or restricted spend", "計画・制限項目の事前利用承認")}
          desc={text(lang, "결제 전 정책 검토와 조직도 기반 결재선을 저장합니다.", "Store policy review and hierarchy-based routing before purchase.", "支払い前にポリシー確認と組織図に基づく決裁ルートを保存します。")}
        />
        <section className="grid">
          <Metric label={text(lang, "대기", "Pending", "承認待ち")} value={pending.toString()} sub={text(lang, "검토 필요", "Needs review", "確認が必要")} tone={pending ? "warn" : "ok"} />
          <Metric label={text(lang, "승인", "Approved", "承認済み")} value={approved.toString()} sub={text(lang, "정산 연결 가능", "Can link to claim", "精算と連携可能")} tone="ok" />
          <Metric label={text(lang, "전체", "Total", "合計")} value={visiblePreSpendRequests.length.toString()} sub={text(lang, "사전 승인 요청", "Pre-spend requests", "事前承認申請")} />
          <div className="col-5">
            <form className="card" onSubmit={createPreSpendRequest}>
              <div className="card-head">
                <div>
                  <div className="card-title">{text(lang, "사전 승인 요청", "Request pre-spend approval", "事前承認を申請")}</div>
                  <div className="card-sub">{text(lang, "예상 거래 정보를 입력하면 정책 검토와 결재선이 저장됩니다.", "Enter expected spend details to store policy review and routing.", "予定している取引情報を入力すると、ポリシー確認と決裁ルートが保存されます。")}</div>
                </div>
              </div>
              <div className="form-grid">
                <label className="field wide">
                  {text(lang, "요청 유형", "Request type", "申請種別")}
                  <select
                    className="select"
                    value={preSpendForm.request_type}
                    onChange={(event) => {
                      const nextType = event.target.value
                      setPreSpendForm((current) => ({
                        ...current,
                        request_type: nextType,
                        category: nextType === "business_trip" ? "travel" : current.category,
                        vendor: nextType === "business_trip" ? "" : current.vendor,
                      }))
                    }}
                  >
                    <option value="purchase">{text(lang, "거래/구매", "Purchase", "取引/購入")}</option>
                    <option value="business_trip">{text(lang, "출장", "Business trip", "出張")}</option>
                  </select>
                </label>
                <label className="field">
                  {isTripRequest ? text(lang, "출장 지역", "Trip area", "出張先") : text(lang, "거래처", "Vendor", "取引先")}
                  <input
                    className="input"
                    value={isTripRequest ? preSpendForm.trip_area : preSpendForm.vendor}
                    onChange={(event) => {
                      const value = event.target.value
                      setPreSpendForm((current) => isTripRequest ? { ...current, trip_area: value } : { ...current, vendor: value })
                    }}
                    required
                  />
                </label>
                <label className="field">
                  {text(lang, `예상 금액 (${preSpendForm.currency})`, `Expected amount (${preSpendForm.currency})`, `予定金額 (${preSpendForm.currency})`)}
                  <input className="input" inputMode="decimal" value={preSpendForm.amount} onChange={(event) => setPreSpendForm((current) => ({ ...current, amount: event.target.value }))} required={!isTripRequest} />
                </label>
                <label className="field">
                  {text(lang, "통화", "Currency", "通貨")}
                  <select className="select" value={preSpendForm.currency} onChange={(event) => setPreSpendForm((current) => ({ ...current, currency: event.target.value }))}>
                    <option value="KRW">KRW</option>
                    <option value="INR">INR</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                  </select>
                  <span className="field-note">
                    {activeLocality ? text(lang, `직원 지역 ${activeLocality} · 기준 통화 ${preSpendLocalCurrency}`, `Employee locality ${activeLocality} · local currency ${preSpendLocalCurrency}`, `従業員の地域 ${activeLocality} · 基準通貨 ${preSpendLocalCurrency}`) : text(lang, "직원 지역 필요", "Employee locality required", "従業員の地域が必要です")}
                  </span>
                </label>
                <div className="field wide">
                  <span>{text(lang, activeLocality === "IN" ? "인도 인보이스 증빙" : activeLocality === "KR" ? "한국 증빙" : "지역별 증빙", activeLocality === "IN" ? "India invoice evidence" : activeLocality === "KR" ? "Korea receipt evidence" : "Locality evidence", activeLocality === "IN" ? "インドのインボイス証憑" : activeLocality === "KR" ? "韓国の証憑" : "地域別の証憑")}</span>
                  <span className="field-note">
                    {preSpendRequiresFx ? text(lang, "외화 사용은 환율 증빙이 필요합니다.", "Foreign-currency spend requires FX evidence.", "外貨での利用には為替レートの証憑が必要です。") : text(lang, `정수 단위 ${preSpendForm.currency} 금액으로 입력`, `Enter whole-unit ${preSpendForm.currency} amounts.`, `${preSpendForm.currency} の金額を整数単位で入力してください`)}
                  </span>
                </div>
                {!activeLocality ? (
                  <div className="warning wide">{text(lang, "조직 멤버의 지역 정보가 없으면 제출이 차단됩니다.", "Submission is blocked until the org member has a supported locality.", "組織メンバーの地域情報がない場合、申請はブロックされます。")}</div>
                ) : null}
                {preSpendInvoiceFields.map((field) => (
                  <label className="field" key={field.key}>
                    {text(lang, field.ko, field.en, field.ja)}
                    <input
                      className="input"
                      type={field.type || "text"}
                      value={preSpendForm[field.key] || ""}
                      onChange={(event) => setPreSpendForm((current) => ({ ...current, [field.key]: event.target.value }))}
                    />
                  </label>
                ))}
                <label className="field">
                  {text(lang, "카테고리", "Category", "カテゴリ")}
                  <select className="select" value={isTripRequest ? "travel" : preSpendForm.category} onChange={(event) => setPreSpendForm((current) => ({ ...current, category: event.target.value }))} disabled={isTripRequest}>
                    <option value="equipment">{text(lang, "비품", "Equipment", "備品")}</option>
                    <option value="software">{text(lang, "지급수수료", "Software", "支払手数料")}</option>
                    <option value="travel">{text(lang, "여비교통비", "Travel", "旅費交通費")}</option>
                    <option value="entertainment">{text(lang, "접대비", "Entertainment", "交際費")}</option>
                    <option value="general">{text(lang, "일반", "General", "一般")}</option>
                  </select>
                </label>
                {isTripRequest ? (
                  <>
                    <label className="field">
                      {text(lang, "출장 시작", "Trip start", "出張開始")}
                      <input className="input" type="date" value={preSpendForm.trip_start_date} onChange={(event) => setPreSpendForm((current) => ({ ...current, trip_start_date: event.target.value }))} />
                    </label>
                    <label className="field">
                      {text(lang, "출장 종료", "Trip end", "出張終了")}
                      <input className="input" type="date" value={preSpendForm.trip_end_date} onChange={(event) => setPreSpendForm((current) => ({ ...current, trip_end_date: event.target.value }))} />
                    </label>
                    <label className="field wide">
                      {text(lang, "세부 예산", "Budget split-up", "予算内訳")}
                      <div className="budget-grid">
                        {tripBudgetFields.map((field) => (
                          <label className="budget-field" key={field.key}>
                            <span>{text(lang, field.ko, field.en, field.ja)}</span>
                            <input className="input" inputMode="decimal" value={preSpendForm[field.key]} onChange={(event) => setPreSpendForm((current) => ({ ...current, [field.key]: event.target.value }))} />
                          </label>
                        ))}
                      </div>
                      {formBudgetTotal > 0 ? <span className="field-note">{text(lang, `합계 ${money(formBudgetTotal, preSpendForm.currency)}`, `Total ${money(formBudgetTotal, preSpendForm.currency)}`, `合計 ${money(formBudgetTotal, preSpendForm.currency)}`)}</span> : null}
                    </label>
                  </>
                ) : (
                  <label className="field">
                    {text(lang, "예상 일자", "Expected date", "予定日")}
                    <input className="input" type="date" value={preSpendForm.expected_purchase_date} onChange={(event) => setPreSpendForm((current) => ({ ...current, expected_purchase_date: event.target.value }))} />
                  </label>
                )}
                <label className="field">
                  {text(lang, "코스트센터", "Cost center", "コストセンター")}
                  <input className="input" value={preSpendForm.cost_center} onChange={(event) => setPreSpendForm((current) => ({ ...current, cost_center: event.target.value }))} />
                </label>
                <label className="field">
                  {text(lang, "프로젝트", "Project", "プロジェクト")}
                  <input className="input" value={preSpendForm.project_code} onChange={(event) => setPreSpendForm((current) => ({ ...current, project_code: event.target.value }))} />
                </label>
                <label className="field">
                  {text(lang, "참석자", "Attendees", "参加者")}
                  <input className="input" value={preSpendForm.attendees} onChange={(event) => setPreSpendForm((current) => ({ ...current, attendees: event.target.value }))} placeholder={text(lang, "쉼표로 구분", "Comma separated", "カンマ区切り")} />
                </label>
                <label className="field wide">
                  {text(lang, "업무 목적", "Business purpose", "業務目的")}
                  <textarea className="textarea" value={preSpendForm.business_purpose} onChange={(event) => setPreSpendForm((current) => ({ ...current, business_purpose: event.target.value }))} required />
                </label>
              </div>
              <div className="actions" style={{ marginTop: 14 }}>
                <button className="button" type="submit" disabled={saving}>{text(lang, "사전 승인 요청", "Submit pre-spend request", "事前承認を申請")}</button>
	                <button className="button-secondary" type="button" onClick={() => setPreSpendForm(localizedPreSpendForm(activeLocality))}>{text(lang, "초기화", "Reset", "リセット")}</button>
              </div>
            </form>
          </div>
          <div className="col-7">
            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-title">{text(lang, "사전 승인 목록", "Pre-spend requests", "事前承認一覧")}</div>
                  <div className="card-sub">{text(lang, "승인된 요청은 정산 생성 시 예외 근거로 연결됩니다.", "Approved requests can be linked as exception evidence on settlement.", "承認された申請は、精算作成時に例外の根拠として連携されます。")}</div>
                </div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{text(lang, "요청자", "Requester", "申請者")}</th>
                      <th>{text(lang, "거래/출장", "Spend", "取引/出張")}</th>
                      <th>{text(lang, "유형", "Type", "種別")}</th>
                      <th style={{ textAlign: "right" }}>{text(lang, "금액", "Amount", "金額")}</th>
                      <th>{text(lang, "정책", "Policy", "ポリシー")}</th>
                      <th>{text(lang, "상태", "Status", "ステータス")}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {visiblePreSpendRequests.length === 0 ? (
                      <tr><td colSpan={7}><EmptyState>{text(lang, "사전 승인 요청이 없습니다.", "No pre-spend requests.", "事前承認申請はありません。")}</EmptyState></td></tr>
                    ) : visiblePreSpendRequests.map((item) => {
                      const findings = policyFindings(item.policy_evaluation)
                      const canDecide = isOversightScope && item.state === "pending" && item.requester_member_id !== activeMemberId
                      const linkedClaims = linkedClaimsForPreSpend(summary.claims, item)
                      const linkedAmount = linkedAmountForPreSpend(summary.claims, item)
                      const budgetLabel = preSpendBudgetLabel(item)
                      return (
                        <tr key={item.id}>
                          <td><strong>{item.requester_name}</strong><div className="line-2">{compactDate(item.created_at)}</div></td>
                          <td>
                            <strong>{preSpendDisplayName(item)}</strong>
                            <div className="line-2">{item.request_type === "business_trip" ? [tripDateRange(item), item.business_purpose].filter(Boolean).join(" · ") : item.business_purpose}</div>
                            {budgetLabel ? <div className="line-2">{budgetLabel}</div> : null}
                          </td>
                          <td>
                            <span className={`pill ${item.request_type === "business_trip" ? "info" : ""}`}>{item.request_type === "business_trip" ? text(lang, "출장", "Trip", "出張") : titleCase(item.category)}</span>
                          </td>
                          <td style={{ textAlign: "right", fontWeight: 850 }}>{money(amountOf(item), item.currency)}</td>
                          <td>
                            <span className={`pill ${policyTone(item.policy_evaluation.status)}`}>{policyLabel(item.policy_evaluation.status)}</span>
                            {findings[0] ? <div className="line-2">{findingMessage(findings[0])}</div> : null}
                          </td>
                          <td><StatusPill state={item.state} /></td>
                          <td style={{ textAlign: "right" }}>
                            {canDecide ? (
                              <div className="actions" style={{ justifyContent: "flex-end" }}>
                                <button className="button" type="button" disabled={saving} onClick={() => void decidePreSpendRequest(item.id, "approved")}>{text(lang, "승인", "Approve", "承認")}</button>
                                <button className="button-danger" type="button" disabled={saving} onClick={() => void decidePreSpendRequest(item.id, "rejected")}>{text(lang, "반려", "Reject", "差し戻し")}</button>
                              </div>
                            ) : linkedClaims.length ? (
                              <span className="line-2">{text(lang, `정산 ${linkedClaims.length}건 · ${money(linkedAmount, item.currency)}`, `${linkedClaims.length} claims · ${money(linkedAmount, item.currency)}`, `精算 ${linkedClaims.length}件 · ${money(linkedAmount, item.currency)}`)}</span>
                            ) : item.linked_claim_id ? (
                              <span className="line-2">{text(lang, `정산 #${item.linked_claim_id}`, `Claim #${item.linked_claim_id}`, `精算 #${item.linked_claim_id}`)}</span>
                            ) : null}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>
      </>
    )
  }

  function renderUsage() {
    const cardLimit = monthlyLimitOf(activeCard)
    const usedPct = cardLimit ? Math.min(100, Math.round((totalSpend / cardLimit) * 100)) : 0
    const scopeOptions = isPersonalScope
      ? [text(lang, "본인", "Self", "本人")]
      : isOversightScope
        ? [text(lang, "본부", "Team", "本部"), text(lang, "본인", "Self", "本人")]
        : isOversightScope
          ? [text(lang, "전사", "Company", "全社"), text(lang, "직원", "Employee", "従業員"), text(lang, "예측", "Forecasts", "予測")]
          : [text(lang, "전사", "Company", "全社"), text(lang, "본부", "Team", "本部"), text(lang, "본인", "Self", "本人")]
    const monthlyRows = recentMonthlySpend(filteredClaims, lang)
    const hasMonthlySpend = monthlyRows.some((month) => month.amount > 0)
    const maxMonthlySpend = Math.max(...monthlyRows.map((month) => month.amount), 1)
    const categoryRows = categories.filter(([, amount]) => amount > 0)
    const hasCategorySpend = categoryRows.length > 0 && totalSpend > 0
    const maxCategory = Math.max(...categoryRows.map(([, amount]) => amount), 1)
    const categoryDonut = hasCategorySpend ? donutGradient(categoryRows.slice(0, 5), totalSpend) : ""
    const usageTitle = isPersonalScope ? text(lang, "나의 카드 사용 현황", "My card usage", "マイカード利用状況") : isOversightScope ? text(lang, "본부 사용 현황", "Team usage", "本部の利用状況") : isOversightScope ? text(lang, "전사 법인카드 사용 현황", "Company-wide card usage", "全社の法人カード利用状況") : text(lang, "법인카드 사용 현황", "Corporate card usage", "法人カード利用状況")
    return (
      <>
        <PageHead eyebrow={text(lang, "사용 현황", "Usage", "利用状況")} title={usageTitle} desc={text(lang, "권한 범위에 따라 본인·본부·전사 사용액과 카테고리 구성을 확인합니다.", "Review card spend and category composition by the scope allowed for your role.", "権限の範囲に応じて、本人・本部・全社の利用額とカテゴリ構成を確認します。")} />
        <div className="view-scope">
          <span className="view-scope-label">{text(lang, "보기 범위", "Scope", "表示範囲")}</span>
          <div className="chip-row" style={{ margin: 0 }}>
            {scopeOptions.map((item, index) => <button className={`chip ${index === 0 ? "active" : ""}`} type="button" key={item}>{item}</button>)}
          </div>
        </div>
        <div className="scope-banner">
          <span style={{ color: "var(--sb-green)", fontWeight: 900 }}>●</span>
          <div>{isPersonalScope
            ? text(lang, "본인 사용 내역만 조회할 수 있습니다. 부서 전체 데이터는 본부장 이상에게 표시됩니다.", "Showing only your own transactions. Team data is available to team leaders and above.", "ご本人の利用明細のみ表示できます。部署全体のデータは本部長以上に表示されます。")
            : isOversightScope
              ? text(lang, "본부 소속 직원의 사용 현황만 표시됩니다. 타 본부 데이터는 차단됩니다.", "Showing only your team members. Other teams are blocked.", "本部所属の従業員の利用状況のみ表示されます。他本部のデータは表示されません。")
              : isOversightScope
                ? text(lang, "전사 법인카드 사용 현황과 재무 모니터링 예측을 함께 표시합니다.", "Showing company-wide usage with finance monitoring forecasts available.", "全社の法人カード利用状況と財務モニタリングの予測を表示します。")
                : text(lang, "전사 법인카드 사용 현황과 회계 처리 상태를 표시합니다.", "Showing company-wide corporate card usage and accounting status.", "全社の法人カード利用状況と会計処理ステータスを表示します。")}</div>
        </div>
        <section className="grid" style={{ marginBottom: 16 }}>
          <Metric label={text(lang, "월 한도", "Monthly limit", "月間利用限度額")} value={activeCard ? money(monthlyLimitOf(activeCard)) : "-"} sub={activeCard ? `${activeCard.label} ${text(lang, "끝자리", "ending", "下4桁")} ${activeCard.last4}` : text(lang, "활성 카드 없음", "No active card", "有効なカードがありません")} />
          <Metric label={text(lang, "사용률", "Used", "利用率")} value={`${usedPct}%`} sub={money(totalSpend)} tone={usedPct > 80 ? "warn" : "ok"} />
          <Metric label={text(lang, "응답 필요", "Needs response", "要対応")} value={inboxClaims.length.toString()} sub={text(lang, "이상거래 답변 · 정산 누락", "Anomaly response · missing claim", "異常取引への回答 · 精算漏れ")} tone={inboxClaims.length ? "warn" : "ok"} />
          <Metric label={text(lang, "평균 정산", "Avg claim", "平均精算額")} value={summary.counts.claims ? money(Math.round(totalSpend / summary.counts.claims)) : "-"} sub={text(lang, "VAT 포함", "VAT included", "VAT込み")} />
        </section>
        <section className="usage-main-grid">
            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-title">{text(lang, "월별 사용 추이", "Monthly spend trend", "月別利用推移")}</div>
                  <div className="card-sub">{text(lang, "최근 6개월 사용액", "Recent 6-month spend", "直近6か月の利用額")}</div>
                </div>
                <button className="card-link" type="button">{text(lang, "자세히 →", "Details →", "詳細 →")}</button>
              </div>
              {hasMonthlySpend ? (
                <div className="line-chart">
                  {monthlyRows.map((month) => {
                    const height = Math.max(18, Math.round((month.amount / maxMonthlySpend) * 210))
                    return (
                      <div className="line-chart-col" key={month.key}>
                        <div className="line-chart-bar" style={{ height: `${height}px` }} title={`${month.label}: ${money(month.amount)}`} />
                        <div className="line-chart-label">{month.label}</div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="placeholder-panel" style={{ minHeight: 250 }}>
                  <EmptyState>{text(lang, "아직 월별 사용 데이터가 없습니다.", "No monthly spend data yet.", "月別の利用データはまだありません。")}</EmptyState>
                </div>
              )}
            </div>
            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-title">{isPersonalScope ? text(lang, "나의 카테고리 분포", "My category mix", "マイカテゴリ分布") : text(lang, "카테고리별 비중", "Category share", "カテゴリ別の割合")}</div>
                  <div className="card-sub">{text(lang, "계정과목 사용 비중", "Account category distribution", "勘定科目別の利用割合")}</div>
                </div>
                <button className="card-link" type="button">{text(lang, "자세히 →", "Details →", "詳細 →")}</button>
              </div>
              {hasCategorySpend ? (
                <div className="donut-wrap" style={{ padding: 20 }}>
                  <div className="donut" style={{ background: categoryDonut }}><div className="donut-center"><div><div style={{ fontSize: 10, color: "var(--text-3)" }}>TOP</div><div>{titleCase(categoryRows[0][0])}</div></div></div></div>
                  <div className="legend-list">
                    {categoryRows.slice(0, 5).map(([category, amount], index) => (
                      <div className="legend-row" key={category}>
                        <span className="legend-dot" style={{ background: CHART_COLORS[index % CHART_COLORS.length] }} />
                        <span style={{ flex: 1 }}>{titleCase(category)}</span>
                        <strong>{Math.round((amount / totalSpend) * 100)}%</strong>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="placeholder-panel" style={{ minHeight: 250 }}>
                  <EmptyState>{text(lang, "아직 카테고리 데이터가 없습니다.", "No category data yet.", "カテゴリデータはまだありません。")}</EmptyState>
                </div>
              )}
            </div>
        </section>
        <section className="usage-main-grid" style={{ marginTop: 16 }}>
          <div className="card">
            <div className="card-head">
              <div>
                <div className="card-title">{isPersonalScope ? text(lang, "나의 카테고리별 사용", "My usage by category", "マイカテゴリ別利用") : text(lang, "부서별 사용 현황", "Usage by team", "部署別の利用状況")}</div>
                <div className="card-sub">{text(lang, "금액 기준 상위 항목", "Top rows by amount", "金額上位の項目")}</div>
              </div>
            </div>
            {hasCategorySpend ? (
              <div className="bars" style={{ padding: 18 }}>
                {categoryRows.slice(0, 5).map(([category, amount]) => (
                  <div className="bar-row" key={category}>
                    <div className="line-1">{titleCase(category)}</div>
                    <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.max(8, Math.round((amount / maxCategory) * 100))}%` }} /></div>
                    <div className="row-meta">{money(amount)}</div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState>{text(lang, "아직 카테고리 데이터가 없습니다.", "No category data yet.", "カテゴリデータはまだありません。")}</EmptyState>
            )}
          </div>
          <div className="card">
            <div className="card-head">
              <div>
                <div className="card-title">{isPersonalScope ? text(lang, "내 과업별 사용 내역", "My project usage", "マイプロジェクト別利用明細") : text(lang, "과업별 사용 내역", "Project usage", "プロジェクト別利用明細")}</div>
                <div className="card-sub">{text(lang, "활성 과업 기준 사용액", "Spend by active project", "有効なプロジェクト別の利用額")}</div>
              </div>
              <span className="pill info">{text(lang, "0개 과업", "0 projects", "0件のプロジェクト")}</span>
            </div>
            <EmptyState>{text(lang, "아직 과업 사용 데이터가 없습니다.", "No project spend data yet.", "プロジェクト別の利用データはまだありません。")}</EmptyState>
          </div>
        </section>
      </>
    )
  }

  function renderCards() {
    const rows = cardStatusFilter === "all"
      ? cardMetrics.rows
      : cardMetrics.rows.filter((row) => (cardStatusFilter === "active" ? row.card.status === "active" : row.card.status !== "active"))
    /* Deliberately computed over the FULL register, not the filtered rows: a KPI
       that moves when you flip a table filter stops being a KPI. */
    const activeCount = cardMetrics.rows.filter((row) => row.card.status === "active").length
    const totalLimit = cardMetrics.rows.reduce((sum, row) => sum + row.limit, 0)
    const attributed = cardMetrics.rows.reduce((sum, row) => sum + (row.spend ?? 0), 0)
    const residue = cardMetrics.unattributed.count + cardMetrics.orphan.count
    const limitShare = totalLimit > 0 ? Math.round((attributed / totalLimit) * 100) : 0

    /* The reason a figure is missing, said plainly in the row rather than
       hidden behind a tooltip — this is a spend-control screen. */
    function blockerNote(row: CardMetrics) {
      if (row.blocker === "duplicate_last4") {
        return text(lang, "같은 끝자리 카드가 중복 등록됨", "Another card shares this last 4", "下4桁が同じカードが重複登録されています")
      }
      if (row.blocker === "no_local_spend") {
        return text(lang, "원화 외 거래만 있음", "Only non-KRW transactions", "KRW以外の取引のみ")
      }
      return null
    }

    function caveatNote(row: CardMetrics) {
      const notes: string[] = []
      if (row.caveats.includes("foreign_currency")) {
        notes.push(text(lang, `원화 외 ${row.foreignTxCount}건 제외`, `excludes ${row.foreignTxCount} non-KRW`, `KRW以外の${row.foreignTxCount}件を除外`))
      }
      if (row.caveats.includes("member_unattributed")) {
        notes.push(text(lang, `카드 미지정 ${row.unattributedCount}건 제외`, `excludes ${row.unattributedCount} unassigned`, `カード未指定の${row.unattributedCount}件を除外`))
      }
      if (row.caveats.includes("sole_card_inferred")) {
        notes.push(text(lang, "카드 미지정 거래 포함(유일 카드)", "includes unassigned (sole card)", "カード未指定の取引を含む(唯一のカード)"))
      }
      return notes.join(" · ")
    }

    return (
      <>
        <PageHead
          eyebrow={text(lang, "법인카드", "Corporate cards", "法人カード")}
          title={isPersonalScope ? text(lang, "내 법인카드", "My corporate cards", "マイ法人カード") : text(lang, "법인카드 현황", "Corporate card register", "法人カード一覧")}
          desc={text(
            lang,
            "등록된 카드와 이번 달 사용 현황입니다. 카드에 연결할 수 없는 거래는 숫자를 표시하지 않고 아래에 따로 집계합니다.",
            "Registered cards and this month's usage. Transactions that cannot be tied to a card are never folded into a card's number — they are counted separately below.", "登録済みカードと今月の利用状況です。カードに紐付けられない取引はカードの金額に含めず、下に別途集計します。",
          )}
        />

        <section className="grid" style={{ marginBottom: 18 }}>
          <Metric
            label={text(lang, "카드", "Cards", "カード")}
            /* The register total, not the filtered count: the block above says
               these tiles are computed over the FULL register so they do not
               move when the table filter does, and this one was reading the
               filtered rows -- visibly so once it sat beside its own
               "N active" pill, which always counted the whole register. */
            value={cardMetrics.rows.length.toString()}
            sub={text(lang, "등록된 카드", "registered", "登録済み")}
            icon="card"
            pill={{ label: text(lang, `${activeCount}장 사용 중`, `${activeCount} active`, `${activeCount}枚利用中`), tone: activeCount > 0 ? "ok" : "mute" }}
          />
          <Metric
            label={text(lang, "월 한도 합계", "Total monthly limit", "月間利用限度額の合計")}
            value={money(totalLimit)}
            sub={text(lang, "등록된 카드 기준", "across registered cards", "登録済みカード全体")}
            icon="chart"
          />
          <Metric
            label={text(lang, "이번 달 카드 사용", "On-card spend this month", "今月のカード利用額")}
            value={money(attributed)}
            sub={periodLabel(cardPeriodKey)}
            icon="pulse"
            tone={totalLimit > 0 && attributed > totalLimit ? "warn" : undefined}
            pill={
              totalLimit > 0
                ? {
                    label: text(lang, `한도의 ${limitShare}%`, `${limitShare}% of limit`, `利用限度額の${limitShare}%`),
                    tone: limitShare >= 100 ? "danger" : limitShare >= 80 ? "warn" : "ok",
                  }
                : undefined
            }
          />
          <Metric
            label={text(lang, "카드 미지정", "Not tied to a card", "カード未指定")}
            value={residue.toString()}
            sub={text(lang, "합계", "in total", "合計")}
            icon="alert"
            tone={residue > 0 ? "warn" : undefined}
            pill={{
              label: money(cardMetrics.unattributed.amount + cardMetrics.orphan.amount),
              tone: residue > 0 ? "warn" : "ok",
            }}
          />
        </section>

        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">{text(lang, "카드 목록", "Card register", "カード一覧")}</div>
              <div className="card-sub">
                {text(
                  lang,
                  "사용률은 이번 달 청구 기준이며 승인·대기·반려를 모두 포함합니다.",
                  "Usage is this month's claims against the card's monthly limit, counting pending, approved and rejected alike.", "利用率は今月の申請額を月間利用限度額と比較したもので、承認待ち・承認済み・差し戻しをすべて含みます。",
                )}
              </div>
            </div>
          </div>

          <div className="toolbar">
            <div className="chip-row" role="group" aria-label={text(lang, "카드 상태 필터", "Filter cards by status", "ステータスでカードを絞り込み")}>
              {([
                ["all", text(lang, "전체", "All", "すべて"), cardMetrics.rows.length],
                ["active", text(lang, "사용 중", "Active", "利用中"), activeCount],
                ["inactive", text(lang, "해지", "Inactive", "解約済み"), cardMetrics.rows.length - activeCount],
              ] as const).map(([value, label, count]) => (
                <button
                  key={value}
                  type="button"
                  className={`chip ${cardStatusFilter === value ? "active" : ""}`}
                  aria-pressed={cardStatusFilter === value}
                  onClick={() => setCardStatusFilter(value)}
                >
                  {label} <span className="chip-count">{count}</span>
                </button>
              ))}
            </div>
            {isOversightScope && (
              <button className="btn-primary toolbar-action" type="button" onClick={() => setTab("members")}>
                <span aria-hidden="true">+</span>
                {text(lang, "카드 등록", "Add card", "カード登録")}
              </button>
            )}
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{text(lang, "카드 소유자", "Cardholder", "カード名義人")}</th>
                  <th>{text(lang, "카드", "Card", "カード")}</th>
                  <th style={{ minWidth: 260 }}>{text(lang, "사용률", "Limit usage", "利用率")}</th>
                  <th className="num">{text(lang, "거래", "Transactions", "取引")}</th>
                  <th>{text(lang, "상태", "Status", "ステータス")}</th>
                  <th>{text(lang, "등록일", "Added", "登録日")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      <EmptyState>
                        {cardMetrics.rows.length > 0
                          ? text(lang, "이 조건에 해당하는 카드가 없습니다.", "No cards match this filter.", "この条件に該当するカードはありません。")
                          : isPersonalScope
                            ? text(lang, "발급된 법인카드가 없습니다.", "No corporate card is assigned to you yet.", "発行済みの法人カードはありません。")
                            : text(lang, "등록된 법인카드가 없습니다.", "No corporate cards are registered yet.", "登録済みの法人カードはありません。")}
                      </EmptyState>
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => {
                    const note = blockerNote(row)
                    const caveat = note ? "" : caveatNote(row)
                    return (
                      <tr key={row.card.id}>
                        <td>
                          <div className="cell-person">
                            <span className="avatar">{initials(row.card.member_name)}</span>
                            <span className="cell-person-text">
                              <span className="line-1">{row.card.member_name}</span>
                              <span className="line-2">{row.card.member_id}</span>
                            </span>
                          </div>
                        </td>
                        <td>
                          <div className="line-1">{row.card.label}</div>
                          <div className="line-2 card-digits">•••• {row.card.last4}</div>
                        </td>
                        <td className="usage-cell">
                          {row.usedPct === null ? (
                            <>
                              <div className="line-1">{row.limit > 0 ? money(row.limit) : "—"}</div>
                              <div className="line-2">
                                {note ?? text(lang, "한도가 설정되지 않았습니다", "No limit set", "利用限度額が設定されていません")}
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="usage-head">
                                <span className="usage-amount">
                                  {money(row.spend ?? 0)}
                                  <span className="usage-limit"> /{money(row.limit)}</span>
                                </span>
                                <span className={`usage-pct ${row.usedPct >= 100 ? "over" : row.usedPct >= 80 ? "warn" : ""}`}>
                                  {caveat ? "≥ " : ""}{row.usedPct}%
                                </span>
                              </div>
                              <div
                                className="bar-track"
                                role="progressbar"
                                aria-valuenow={row.usedPct}
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-label={text(
                                  lang,
                                  `${row.card.member_name} 카드 한도 사용률`,
                                  `${row.card.member_name} card limit usage`, `${row.card.member_name} のカード利用限度額の利用率`,
                                )}
                              >
                                <div
                                  className={`bar-fill ${row.usedPct >= 100 ? "over" : row.usedPct >= 80 ? "warn" : ""}`}
                                  style={{ width: `${Math.min(100, Math.max(0, row.usedPct))}%` }}
                                />
                              </div>
                              {caveat && <div className="line-2">{caveat}</div>}
                            </>
                          )}
                        </td>
                        <td className="num">{row.txCount === null ? "—" : row.txCount}</td>
                        <td><StatusPill state={row.card.status} /></td>
                        <td className="line-2">{row.card.created_at ? compactDate(row.card.created_at) : "—"}</td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Residue. Shown so the per-card rows visibly do not have to sum to
              the period total — and so an admin can act on the gap. */}
          {residue > 0 && (
            <div className="warning" style={{ marginTop: 14 }}>
              {cardMetrics.unattributed.count > 0 && (
                <div>
                  {text(
                    lang,
                    `카드가 지정되지 않은 거래 ${cardMetrics.unattributed.count}건(${money(cardMetrics.unattributed.amount)})은 어느 카드에도 합산하지 않았습니다.`,
                    `${cardMetrics.unattributed.count} transaction(s) worth ${money(cardMetrics.unattributed.amount)} name no card and are counted against none.`, `カードが指定されていない取引 ${cardMetrics.unattributed.count}件(${money(cardMetrics.unattributed.amount)})は、どのカードにも合算していません。`,
                  )}
                </div>
              )}
              {cardMetrics.orphan.count > 0 && (
                <div>
                  {text(
                    lang,
                    `등록되지 않은 카드(${cardMetrics.orphan.last4s.join(", ")}) 거래 ${cardMetrics.orphan.count}건(${money(cardMetrics.orphan.amount)})이 있습니다.`,
                    `${cardMetrics.orphan.count} transaction(s) worth ${money(cardMetrics.orphan.amount)} reference unregistered cards ending ${cardMetrics.orphan.last4s.join(", ")}.`, `未登録カード(${cardMetrics.orphan.last4s.join(", ")})の取引が ${cardMetrics.orphan.count}件(${money(cardMetrics.orphan.amount)})あります。`,
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </>
    )
  }

  function renderMonitoring() {
    const overview = monitoring.overview
    const predictions = monitoring.predictions
    const riskTotal = monitoringRiskTotal(overview)
    const monthlyRows = monitoring.monthly
    const yearlyRows = monitoring.yearly
    const employeeRows = monitoring.employees.slice(0, 8)
    const categoryRows = monitoring.categories.filter((item) => spendOf(item) > 0).slice(0, 6)
    const findingRows = monitoring.findings.slice(0, 8)
    const hasMonthlySpend = monthlyRows.some((row) => spendOf(row) > 0)
    const hasYearlySpend = yearlyRows.some((row) => spendOf(row) > 0)
    const maxMonthly = Math.max(...monthlyRows.map((row) => spendOf(row)), 1)
    const maxYearly = Math.max(...yearlyRows.map((row) => spendOf(row)), 1)
    const maxCategory = Math.max(...categoryRows.map((row) => spendOf(row)), 1)
    const topProjection = predictions.top_employee_projection
    const overviewSpend = Number(overview.total_spend ?? overview.total_spend_cents ?? 0)
    const projectedMonthEnd = predictionOf(predictions, "projected_month_end", "projected_month_end_cents")
    const monthToDate = predictionOf(predictions, "month_to_date", "month_to_date_cents")
    const yearToDate = predictionOf(predictions, "year_to_date", "year_to_date_cents")
    const projectedYearEnd = predictionOf(predictions, "projected_year_end", "projected_year_end_cents")
    const averageMonthlySpend = predictionOf(predictions, "average_monthly_spend", "average_monthly_spend_cents")
    const policyCleanRate = percent(overview.total_claims - overview.blocked_claims - overview.needs_info_claims, overview.total_claims)
    const exportableValue = filteredClaims
      .filter((claim) => claim.state === "approved" && ["compliant", "exception_approved"].includes(claim.policy_status) && !claim.erp_export_id)
      .reduce((sum, claim) => sum + amountOf(claim), 0)

    return (
      <>
        <PageHead
          eyebrow={text(lang, "모니터링", "Monitoring", "モニタリング")}
          title={isOversightScope ? text(lang, "재무 비용 통제 대시보드", "Finance spend control dashboard", "財務支出管理ダッシュボード") : text(lang, "법인카드 통제 모니터링", "Corporate card control monitoring", "法人カード統制モニタリング")}
          desc={text(lang, "정산, 증빙, 사전승인, 카드사 대사, ERP 출력 상태를 하나의 통제 화면에서 확인합니다.", "Monitor settlements, evidence, pre-spend, issuer reconciliation, and ERP handoff from one control view.", "精算、証憑、事前承認、カード会社との照合、ERP出力の状況を一つの統制画面で確認します。")}
        />
        <RoleStrip role={role} lang={lang} />
        <section className="grid" style={{ marginBottom: 16 }}>
          <Metric label={text(lang, "전사 사용액", "Company spend", "全社利用額")} value={money(overviewSpend)} sub={text(lang, `${overview.total_claims}건 정산`, `${overview.total_claims} settlement claims`, `精算 ${overview.total_claims}件`)} />
          <Metric label={text(lang, "통제 이슈", "Control issues", "統制上の問題")} value={riskTotal.toString()} sub={text(lang, "차단·보완·누락", "Blocked, needs-info, missing", "ブロック・要補足・欠落")} tone={riskTotal ? "warn" : "ok"} />
          <Metric label={text(lang, "증빙 누락", "Missing receipts", "証憑欠落")} value={overview.missing_receipt_claims.toString()} sub={text(lang, `${overview.statement_missing_claims}건 대사 누락`, `${overview.statement_missing_claims} statement gaps`, `照合漏れ ${overview.statement_missing_claims}件`)} tone={overview.missing_receipt_claims || overview.statement_missing_claims ? "warn" : "ok"} />
          <Metric label={text(lang, "ERP 대기", "ERP ready", "ERP出力待ち")} value={overview.unexported_approved_claims.toString()} sub={money(exportableValue)} tone={overview.unexported_approved_claims ? "info" : "ok"} />
        </section>
        <section className="bi-grid">
          <div className="col-8">
            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-title">{text(lang, "BI 사용액 예측", "BI spend forecast", "BI利用額予測")}</div>
                  <div className="card-sub">{text(lang, "월별 실적과 현재 월 런레이트 기반 예측입니다.", "Monthly actuals with current-month run-rate forecast.", "月次実績と当月のランレートに基づく予測です。")}</div>
                </div>
                <span className="pill info">{text(lang, `월말 ${money(projectedMonthEnd)}`, `Month-end ${money(projectedMonthEnd)}`, `月末 ${money(projectedMonthEnd)}`)}</span>
              </div>
              <BITrendChart lang={lang} rows={monthlyRows} projected={projectedMonthEnd} />
            </div>
          </div>
          <div className="col-4">
            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-title">{text(lang, "통제 리스크 히트맵", "Control risk heatmap", "統制リスクヒートマップ")}</div>
                  <div className="card-sub">{text(lang, "정산 통제 항목별 현재 밀도입니다.", "Current density by settlement control area.", "精算統制項目別の現在の密度です。")}</div>
                </div>
              </div>
              <BIRiskHeatmap lang={lang} overview={overview} />
            </div>
          </div>
          <div className="col-5">
            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-title">{text(lang, "계정과목 믹스", "Category mix", "勘定科目の構成")}</div>
                  <div className="card-sub">{text(lang, "상위 카테고리 지출 구성입니다.", "Top category contribution to spend.", "上位カテゴリの支出構成です。")}</div>
                </div>
              </div>
              <BICategoryDonut lang={lang} categories={categoryRows} />
            </div>
          </div>
          <div className="col-7">
            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-title">{text(lang, "직원 노출 버블", "Employee exposure bubbles", "従業員別エクスポージャー")}</div>
                  <div className="card-sub">{text(lang, "원 크기는 사용액, 위치는 리스크 발생량을 나타냅니다.", "Bubble size indicates spend; vertical position indicates risk volume.", "円の大きさは利用額、位置はリスク発生量を示します。")}</div>
                </div>
                <span className="pill info">{text(lang, "상위 8명", "Top 8", "上位8名")}</span>
              </div>
              <BIEmployeeBubbleChart lang={lang} employees={monitoring.employees} />
            </div>
          </div>
        </section>
        <section className="grid">
          <div className="col-7">
            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-title">{text(lang, "월별 사용 및 예외 추이", "Monthly spend and exception trend", "月別利用額と例外の推移")}</div>
                  <div className="card-sub">{text(lang, "최근 12개월 기준 정산 금액과 통제 예외입니다.", "Recent 12-month claim value and control exception posture.", "直近12か月の精算金額と統制例外です。")}</div>
                </div>
                <span className="pill info">{monitoring.generated_at ? compactDate(monitoring.generated_at) : text(lang, "대기", "Pending", "待機中")}</span>
              </div>
              {hasMonthlySpend ? (
                <div className="line-chart">
                  {monthlyRows.map((row) => {
                    const rowSpend = spendOf(row)
                    const height = Math.max(18, Math.round((rowSpend / maxMonthly) * 210))
                    return (
                      <div className="line-chart-col" key={row.period}>
                        <div className="line-chart-bar" style={{ height: `${height}px` }} title={`${periodLabel(row.period)}: ${money(rowSpend)}`} />
                        <div className="line-chart-label">{periodLabel(row.period)}</div>
                        <div className="line-chart-label">{row.exceptions ? `${row.exceptions} ex` : ""}</div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="placeholder-panel" style={{ minHeight: 250 }}>
                  <EmptyState>{loading ? text(lang, "모니터링 데이터를 불러오는 중입니다...", "Loading monitoring data...", "モニタリングデータを読み込んでいます...") : text(lang, "아직 월별 사용 데이터가 없습니다.", "No monthly spend data yet.", "月別の利用データはまだありません。")}</EmptyState>
                </div>
              )}
            </div>
          </div>
          <div className="col-5">
            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-title">{text(lang, "통제 큐", "Control queue", "統制キュー")}</div>
                  <div className="card-sub">{text(lang, "정책 평가에서 저장된 주요 발견 항목입니다.", "Top persisted policy findings from backend evaluation.", "ポリシー評価で保存された主な検出項目です。")}</div>
                </div>
                <span className={`pill ${riskTotal ? "warn" : "ok"}`}>{riskTotal ? text(lang, "검토 필요", "Review", "要確認") : text(lang, "정상", "Clean", "正常")}</span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{text(lang, "항목", "Finding", "項目")}</th>
                      <th>{text(lang, "건수", "Count", "件数")}</th>
                      <th style={{ textAlign: "right" }}>{text(lang, "금액", "Value", "金額")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {findingRows.length === 0 ? (
                      <tr><td colSpan={3}><EmptyState>{text(lang, "정책 발견 항목이 없습니다.", "No policy findings.", "ポリシー検出項目はありません。")}</EmptyState></td></tr>
                    ) : findingRows.map((item) => (
                      <tr key={item.code}>
                        <td>
                          <span className={`pill ${findingTone(item.severity)}`}>{titleCase(item.code)}</span>
                          <div className="line-2">{item.sample_message}</div>
                        </td>
                        <td>{item.count}</td>
                        <td style={{ textAlign: "right", fontWeight: 850 }}>{money(spendOf(item))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <div className="col-5">
            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-title">{text(lang, "카테고리 노출", "Category exposure", "カテゴリ別エクスポージャー")}</div>
                  <div className="card-sub">{text(lang, "금액 기준 상위 계정과목입니다.", "Top account categories by value.", "金額上位の勘定科目です。")}</div>
                </div>
              </div>
              {categoryRows.length ? (
                <div className="bars" style={{ padding: 18 }}>
	                  {categoryRows.map((row) => {
	                    const rowSpend = spendOf(row)
	                    return (
	                      <div className="bar-row" key={row.category}>
	                        <div className="line-1">{titleCase(row.category)}</div>
	                        <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.max(8, Math.round((rowSpend / maxCategory) * 100))}%` }} /></div>
	                        <div className="row-meta">{money(rowSpend)}</div>
	                      </div>
	                    )
	                  })}
                </div>
              ) : (
                <EmptyState>{text(lang, "카테고리 사용 데이터가 없습니다.", "No category spend data.", "カテゴリ別の利用データはありません。")}</EmptyState>
              )}
            </div>
          </div>
          <div className="col-7">
            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-title">{text(lang, "직원별 모니터링", "Employee monitoring", "従業員別モニタリング")}</div>
                  <div className="card-sub">{text(lang, "사용액, 예외, 증빙 누락을 직원 단위로 확인합니다.", "Review spend, exceptions, and missing evidence by employee.", "利用額、例外、証憑欠落を従業員単位で確認します。")}</div>
                </div>
                <span className={`pill ${policyCleanRate >= 90 ? "ok" : "warn"}`}>{policyCleanRate}% clean</span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{text(lang, "직원", "Employee", "従業員")}</th>
                      <th style={{ textAlign: "right" }}>{text(lang, "사용액", "Spend", "利用額")}</th>
                      <th>{text(lang, "정산", "Claims", "精算")}</th>
                      <th>{text(lang, "예외", "Exceptions", "例外")}</th>
                      <th>{text(lang, "증빙", "Evidence", "証憑")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employeeRows.length === 0 ? (
                      <tr><td colSpan={5}><EmptyState>{text(lang, "직원별 사용 데이터가 없습니다.", "No employee spend data.", "従業員別の利用データはありません。")}</EmptyState></td></tr>
                    ) : employeeRows.map((item) => (
                      <tr key={item.member_id}>
                        <td>
                          <strong>{item.name}</strong>
                          <div className="line-2">{item.member_id}</div>
                        </td>
                        <td style={{ textAlign: "right", fontWeight: 850 }}>{money(spendOf(item))}</td>
                        <td>{item.claims}</td>
                        <td><span className={`pill ${item.blocked || item.exceptions ? "warn" : "ok"}`}>{item.blocked + item.exceptions + item.warnings}</span></td>
                        <td><span className={`pill ${item.missing_receipts ? "warn" : "ok"}`}>{item.missing_receipts ? text(lang, `${item.missing_receipts}건 누락`, `${item.missing_receipts} missing`, `${item.missing_receipts}件欠落`) : text(lang, "완료", "Complete", "完了")}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>
        {isOversightScope ? (
          <section className="grid" style={{ marginTop: 16 }}>
            <Metric label={text(lang, "월 누계", "Month to date", "当月累計")} value={money(monthToDate)} sub={text(lang, `월말 예상 ${money(projectedMonthEnd)}`, `Month-end forecast ${money(projectedMonthEnd)}`, `月末予測 ${money(projectedMonthEnd)}`)} tone="info" />
            <Metric label={text(lang, "연 누계", "Year to date", "年初来累計")} value={money(yearToDate)} sub={text(lang, `연말 예상 ${money(projectedYearEnd)}`, `Year-end forecast ${money(projectedYearEnd)}`, `年末予測 ${money(projectedYearEnd)}`)} />
            <Metric label={text(lang, "월 평균", "Monthly average", "月平均")} value={money(averageMonthlySpend)} sub={text(lang, "사용 데이터 기준", "Based on active spend months", "利用実績のある月に基づく")} />
            <Metric label={text(lang, "30일 리스크 예측", "30-day risk forecast", "30日間のリスク予測")} value={predictions.risk_claims_next_30_days.toString()} sub={text(lang, "현재 월 런레이트", "Current month run rate", "当月ランレート")} tone={predictions.risk_claims_next_30_days ? "warn" : "ok"} />
            <div className="col-6">
              <div className="card">
                <div className="card-head">
                  <div>
                    <div className="card-title">{text(lang, "연도별 사용 추이", "Yearly spend trend", "年別利用額の推移")}</div>
                    <div className="card-sub">{text(lang, "연 누계와 장기 증감 방향입니다.", "Year-level spend trajectory.", "年間累計と長期的な増減傾向です。")}</div>
                  </div>
                </div>
                {hasYearlySpend ? (
                  <div className="bars" style={{ padding: 18 }}>
	                    {yearlyRows.map((row) => {
	                      const rowSpend = spendOf(row)
	                      return (
	                        <div className="bar-row" key={row.period}>
	                          <div className="line-1">{row.period}</div>
	                          <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.max(8, Math.round((rowSpend / maxYearly) * 100))}%` }} /></div>
	                          <div className="row-meta">{money(rowSpend)}</div>
	                        </div>
	                      )
	                    })}
                  </div>
                ) : (
                  <EmptyState>{text(lang, "연도별 사용 데이터가 없습니다.", "No yearly spend data.", "年別の利用データはありません。")}</EmptyState>
                )}
              </div>
            </div>
            <div className="col-6">
              <div className="card">
                <div className="card-head">
                  <div>
                    <div className="card-title">{text(lang, "직원별 월말 예측", "Per-employee month-end forecast", "従業員別の月末予測")}</div>
                    <div className="card-sub">{text(lang, "현재 월 사용 런레이트 기준입니다.", "Based on the current month run rate.", "当月の利用ランレートに基づきます。")}</div>
                  </div>
	                  <span className="pill info">{topProjection ? `${topProjection.name}: ${money(projectedMonthSpendOf(topProjection))}` : text(lang, "예측 없음", "No forecast", "予測なし")}</span>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{text(lang, "직원", "Employee", "従業員")}</th>
                        <th style={{ textAlign: "right" }}>{text(lang, "월말 예상", "Forecast", "月末予測")}</th>
                        <th style={{ textAlign: "right" }}>{text(lang, "총 사용", "Total", "総利用額")}</th>
                        <th>{text(lang, "리스크", "Risk", "リスク")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monitoring.employees.length === 0 ? (
                        <tr><td colSpan={4}><EmptyState>{text(lang, "예측할 직원 데이터가 없습니다.", "No employee data to forecast.", "予測対象の従業員データはありません。")}</EmptyState></td></tr>
                      ) : monitoring.employees.slice(0, 10).map((item) => {
                        const employeeRisk = item.blocked + item.warnings + item.exceptions + item.missing_receipts + item.late_claims
                        return (
                          <tr key={`forecast-${item.member_id}`}>
                            <td>
                              <strong>{item.name}</strong>
                              <div className="line-2">{item.member_id}</div>
                            </td>
	                            <td style={{ textAlign: "right", fontWeight: 850 }}>{money(projectedMonthSpendOf(item))}</td>
	                            <td style={{ textAlign: "right" }}>{money(spendOf(item))}</td>
                            <td><span className={`pill ${employeeRisk ? "warn" : "ok"}`}>{employeeRisk}</span></td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </section>
        ) : null}
      </>
    )
  }

  function renderAnomalies() {
    const missingRows = ownMissingClaims.slice(0, 4)
    const claimRows = ownClaims.filter((claim) => claim.state === "rejected" || claim.state === "needs_info" || claimPolicyFindings(claim).length > 0).slice(0, 8)
    const anomalyRows = [
      ...missingRows.map((row) => ({
        id: `missing-${row.id}`,
        date: row.transaction_date || compactDate(row.created_at),
        vendor: row.vendor,
        category: row.category,
        amount: amountOf(row),
        verdict: "warn" as const,
        labelKo: "정산 미상신",
        labelEn: "Missing claim",
        ruleKo: "카드사 청구 내역에는 있으나 정산 신청이 없습니다.",
        ruleEn: "Card statement row has no matching settlement claim.",
        stateKo: "정산 신청 필요",
        stateEn: "Needs settlement",
        labelJa: "精算未申請",
        ruleJa: "カード会社の請求明細にはありますが、精算申請がありません。",
        stateJa: "精算申請が必要",
        claim: null as Claim | null,
      })),
      ...claimRows.map((claim) => {
        const isRejected = claim.state === "rejected"
        const isNeedsInfo = claim.state === "needs_info"
        const rejectionMemo = latestRejectionMemo(claim)
        const findings = claimPolicyFindings(claim)
        const firstFinding = findings[0]
        const isDanger = isRejected || claim.policy_status === "blocked"
        return {
          id: `claim-${claim.id}`,
          date: claim.transaction_date || compactDate(claim.created_at),
          vendor: claim.vendor,
          category: claim.category,
          amount: amountOf(claim),
          verdict: isDanger ? "danger" as const : "warn" as const,
          labelKo: isRejected ? "반려 정산" : isNeedsInfo ? "정보 보완" : "정책 확인",
          labelEn: isRejected ? "Rejected claim" : isNeedsInfo ? "Needs info" : "Policy finding",
          ruleKo: isRejected
            ? (rejectionMemo ? `반려 사유: ${rejectionMemo}` : "반려된 정산은 보완 후 재상신해야 합니다.")
            : findingMessage(firstFinding) || policyLabel(claim.policy_status),
          ruleEn: isRejected
            ? (rejectionMemo ? `Rejection reason: ${rejectionMemo}` : "Rejected settlement needs correction and resubmission.")
            : findingMessage(firstFinding) || policyLabel(claim.policy_status),
          stateKo: isRejected || isNeedsInfo ? "재상신 필요" : claim.state === "approved" ? "검토 완료" : "검토 필요",
          stateEn: isRejected || isNeedsInfo ? "Resubmit" : claim.state === "approved" ? "Reviewed" : "Needs review",
          labelJa: isRejected ? "差し戻し精算" : isNeedsInfo ? "要補足" : "ポリシー確認",
          ruleJa: isRejected
            ? (rejectionMemo ? `差し戻し理由: ${rejectionMemo}` : "差し戻された精算は、補足のうえ再申請してください。")
            : findingMessage(firstFinding) || policyLabel(claim.policy_status),
          stateJa: isRejected || isNeedsInfo ? "再申請が必要" : claim.state === "approved" ? "確認済み" : "確認が必要",
          claim,
        }
      }),
    ]
    const visible = anomalyRows.filter((row) =>
      searchMatches(searchQuery, [row.vendor, row.category, row.date, row.labelEn, row.labelKo, row.labelJa, row.amount]),
    )
    const dangerCnt = visible.filter((row) => row.verdict === "danger").length
    const warnCnt = visible.filter((row) => row.verdict === "warn").length
    return (
      <>
        <PageHead
          eyebrow={text(lang, "내 이상거래", "My anomalies", "自分の異常取引")}
          title={text(lang, "내 이상거래 · 소명 필요 항목", "My flagged transactions", "自分の異常取引・説明が必要な項目")}
          desc={text(lang, "AI가 규정 외·확인 필요로 판정한 내역과 정산 미상신 안내를 확인합니다.", "Review transactions flagged by AI as out-of-policy or requiring explanation, plus missing-claim notices.", "AIがポリシー外・要確認と判定した取引と、精算未申請のお知らせを確認します。")}
        />
        <div className="scope-banner warn">
          <span style={{ color: "var(--warn)", fontWeight: 900 }}>!</span>
          <div>{text(lang, "본인의 거래만 표시됩니다. 직원 결재 요청은 Inbox 또는 결재 승인에서 처리합니다.", "Showing only your own transactions. Employee approval requests are handled in Inbox or Approvals.", "ご自身の取引のみ表示されます。従業員からの承認依頼はInboxまたは決裁承認で処理します。")}</div>
        </div>
        <section className="grid" style={{ marginBottom: 16 }}>
          <Metric label={text(lang, "규정 외", "Out-of-policy", "ポリシー外")} value={`${dangerCnt}`} sub={dangerCnt ? text(lang, "소명 필요", "Needs explanation", "説明が必要") : text(lang, "정상 상태", "Normal", "正常")} tone={dangerCnt ? "danger" : "ok"} />
          <Metric label={text(lang, "확인필요", "Needs review", "要確認")} value={`${warnCnt}`} sub={text(lang, "증빙 보완", "Evidence review", "証憑の補足")} tone="warn" />
          <Metric label={text(lang, "답변 작성 필요", "Need answer", "回答の作成が必要")} value={`${visible.length}`} sub={text(lang, "내가 처리해야 함", "Action required", "対応が必要")} />
          <Metric label={text(lang, "정산 미상신", "Missing claims", "精算未申請")} value={`${ownMissingClaims.length}`} sub={text(lang, "카드사 대사 기준", "From statement reconciliation", "カード会社との照合に基づく")} tone={ownMissingClaims.length ? "warn" : "ok"} />
        </section>
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">{text(lang, "나의 이상 거래", "My anomaly transactions", "自分の異常取引")}</div>
              <div className="card-sub">{text(lang, "행을 클릭해 답변 작성 또는 제출된 답변을 확인합니다.", "Click a row to respond or review submitted explanations.", "行をクリックして回答を作成するか、提出済みの回答を確認します。")}</div>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{text(lang, "일자", "Date", "日付")}</th>
                  <th>{text(lang, "거래처", "Vendor", "取引先")}</th>
                  <th>{text(lang, "계정과목", "Account", "勘定科目")}</th>
                  <th style={{ textAlign: "right" }}>{text(lang, "금액", "Amount", "金額")}</th>
                  <th>{text(lang, "판정", "Verdict", "判定")}</th>
                  <th>{text(lang, "근거", "Rule", "根拠")}</th>
                  <th>{text(lang, "상태", "Status", "ステータス")}</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr><td colSpan={7}><EmptyState>{text(lang, "표시할 이상거래가 없습니다.", "No anomalies to show.", "表示する異常取引はありません。")}</EmptyState></td></tr>
                ) : visible.map((item) => {
                  const isExpanded = expandedAnomalyId === item.id
                  const canExpand = Boolean(item.claim && hasRejectionHistory(item.claim))
                  return (
                    <Fragment key={item.id}>
                      <tr
                        className={`${item.verdict === "danger" ? "row-danger" : "row-warn"} ${canExpand ? "clickable" : ""}`}
                        onClick={() => canExpand && setExpandedAnomalyId(isExpanded ? null : item.id)}
                      >
                        <td>{item.date}</td>
                        <td><strong>{item.vendor}</strong></td>
                        <td>{titleCase(item.category)}</td>
                        <td style={{ textAlign: "right", fontWeight: 850 }}>{money(item.amount)}</td>
                        <td><span className={`pill ${item.verdict === "danger" ? "danger" : "warn"}`}>{text(lang, item.labelKo, item.labelEn, item.labelJa)}</span></td>
                        <td style={{ fontSize: 12 }}>{text(lang, item.ruleKo, item.ruleEn, item.ruleJa)}</td>
                        <td>
                          <button
                            className="button-secondary"
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation()
                              if (!item.claim) {
                                setTab("submit")
                                return
                              }
                              if ((item.claim.state === "rejected" || item.claim.state === "needs_info") && item.claim.requester_member_id === activeMemberId) {
                                setQuickResubmitDraft(resubmitDraftFromClaim(item.claim))
                                return
                              }
                              setExpandedClaimId(item.claim.id)
                              setTab("history")
                            }}
                          >
                            {text(lang, item.stateKo, item.stateEn, item.stateJa)}
                          </button>
                        </td>
                      </tr>
                      {isExpanded && item.claim ? (
                        <tr className="detail-row">
                          <td colSpan={7}>
                            <div className="anomaly-detail">
                              <RejectionHistoryPanel lang={lang} claim={item.claim} defaultOpen />
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </>
    )
  }

  function renderHistory() {
    return (
      <>
        <PageHead eyebrow={text(lang, "정산 내역", "My settlements", "精算履歴")} title={isPersonalScope ? text(lang, "내 정산 내역", "My settlement history", "自分の精算履歴") : text(lang, "정산 결재와 이력", "Settlement approval and history", "精算の決裁と履歴")} desc={text(lang, "정산 신청은 Palette OS에 결재 스냅샷과 함께 저장됩니다.", "Claims are stored in Palette OS with immutable approval snapshots.", "精算申請は決裁スナップショットとともにPalette OSに保存されます。")} />
        <ClaimsTable lang={lang} claims={filteredClaims} loading={loading} expandedClaimId={expandedClaimId} setExpandedClaimId={setExpandedClaimId} decide={decide} resubmit={resubmitClaim} saving={saving} canDelegate={isOversightScope} activeMemberId={activeMemberId} memberLabel={memberLabel} />
      </>
    )
  }

  function renderApprovals() {
    return (
      <>
        <PageHead eyebrow={text(lang, "결재 승인", "Approvals", "決裁承認")} title={isOversightScope ? text(lang, "정산 승인과 전체 이력 검토", "Approve settlements and review all history", "精算の承認と全履歴の確認") : isOversightScope ? text(lang, "정산 결재 현황 검토", "Review settlement approval status", "精算の決裁状況の確認") : text(lang, "팀 결재 대기열", "Team approval queue", "チームの承認待ちキュー")} desc={text(lang, "정산을 펼쳐 결재선, 증빙 상태, 사용 목적을 확인합니다.", "Expand each settlement to inspect the approval line, receipt state, and business purpose.", "各精算を展開して、決裁ルート、証憑の状態、利用目的を確認します。")} />
        <RoleStrip role={role} lang={lang} />
        <div className="chip-row">
          {(["pending", "approved", "rejected", "all"] as const).map((item) => (
            <button className={`chip ${segment === item ? "active" : ""}`} type="button" key={item} onClick={() => setSegment(item)}>
              {text(lang, item === "pending" ? "대기" : item === "approved" ? "승인" : item === "rejected" ? "반려" : "전체", titleCase(item), item === "pending" ? "承認待ち" : item === "approved" ? "承認済み" : item === "rejected" ? "差し戻し" : "すべて")} ({item === "all" ? approvalClaims.length : approvalClaims.filter((claim) => claim.state === item).length})
            </button>
          ))}
        </div>
        <ClaimsTable lang={lang} claims={visibleApprovals} loading={loading} expandedClaimId={expandedClaimId} setExpandedClaimId={setExpandedClaimId} decide={decide} resubmit={resubmitClaim} saving={saving} canDelegate={isOversightScope} activeMemberId={activeMemberId} memberLabel={memberLabel} />
      </>
    )
  }

  function renderAnalytics() {
    return (
      <>
        <PageHead eyebrow={text(lang, "통계", "Statistics", "統計")} title={text(lang, "카드 사용 분석", "Card spend analytics", "カード利用分析")} desc={text(lang, "실시간 정산 합계로 구성한 사용 통계입니다.", "Spend analytics based on live settlement totals.", "リアルタイムの精算合計に基づく利用統計です。")} />
        <section className="grid">
          <Metric label={text(lang, "총액", "Total", "総額")} value={money(totalSpend)} sub={text(lang, "전체 상신 정산", "All submitted claims", "申請済みの全精算")} />
          <Metric label={text(lang, "승인", "Approved", "承認済み")} value={money(approvedSpend)} sub={text(lang, `${summary.counts.approved}건`, `${summary.counts.approved} items`, `${summary.counts.approved}件`)} tone="ok" />
          <Metric label={text(lang, "대기", "Pending", "承認待ち")} value={money(pendingSpend)} sub={text(lang, `${summary.counts.pending}건`, `${summary.counts.pending} items`, `${summary.counts.pending}件`)} tone="warn" />
          <Metric label={text(lang, "반려", "Rejected", "差し戻し")} value={summary.counts.rejected.toString()} sub={text(lang, "보완 필요", "Needs correction", "要補足")} tone="danger" />
          <div className="col-6">
            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-title">{text(lang, "상위 계정", "Top categories", "上位勘定科目")}</div>
                  <div className="card-sub">{text(lang, "계정 카테고리별 금액 분포입니다.", "Amount distribution by account category.", "勘定科目カテゴリ別の金額分布です。")}</div>
                </div>
              </div>
              <CategoryBars lang={lang} categories={categories} total={totalSpend} />
            </div>
          </div>
          <div className="col-6">
            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-title">{text(lang, "정산 상태", "Claim lifecycle", "精算ステータス")}</div>
                  <div className="card-sub">{text(lang, "현재 워크플로우 상태별 잔액입니다.", "Current workflow state balance.", "現在のワークフロー状態別の残高です。")}</div>
                </div>
              </div>
              <CategoryBars lang={lang} categories={[["pending", pendingSpend], ["approved", approvedSpend], ["rejected", filteredClaims.filter((claim) => claim.state === "rejected").reduce((sum, claim) => sum + amountOf(claim), 0)]]} total={totalSpend} />
            </div>
          </div>
        </section>
      </>
    )
  }

  function renderStatementUpload() {
    const csvTemplate = "transaction_date,card_last4,cardholder_member_id,cardholder_name,vendor,amount,currency,category\n"
    const matchedRows = summary.statement_rows.filter((row) => row.match_status === "matched" || row.match_status === "claim_created").length
    const preApprovedRows = summary.statement_rows.filter((row) => row.match_status === "pre_approval_matched").length
    return (
      <>
        <PageHead eyebrow={text(lang, "관리자", "Administration", "管理")} title={text(lang, "카드 사용내역 업로드", "Card statement upload", "カード利用明細のアップロード")} desc={text(lang, "카드사 CSV를 업로드하고 정산 신청과 대사한 뒤 누락 정산을 생성합니다.", "Upload issuer CSVs, reconcile them against settlement claims, and create missing-claim requests.", "カード会社のCSVをアップロードし、精算申請と照合したうえで未申請の精算を作成します。")} />
        <section className="grid">
          <Metric label={text(lang, "가져온 행", "Rows imported", "取り込んだ行")} value={summary.counts.statement_rows.toString()} sub={text(lang, "최근 카드 사용내역", "Recent statement rows", "最近のカード利用明細")} />
          <Metric label={text(lang, "누락 정산", "Missing claims", "未申請の精算")} value={summary.counts.missing_claims.toString()} sub={text(lang, "매칭되지 않은 카드 사용", "Unmatched card charges", "照合されていないカード利用")} tone={summary.counts.missing_claims ? "warn" : "ok"} />
          <Metric label={text(lang, "사전승인", "Pre-approved", "事前承認済み")} value={preApprovedRows.toString()} sub={text(lang, "정산 생성 필요", "Claim still required", "精算の作成が必要")} tone={preApprovedRows ? "warn" : "ok"} />
          <Metric label={text(lang, "매칭", "Matched", "照合済み")} value={matchedRows.toString()} sub={text(lang, "정산 연결 완료", "Statement to claim", "精算との紐付け完了")} tone="ok" />
          <div className="col-5">
            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-title">{text(lang, "카드사 CSV 가져오기", "Import card issuer CSV", "カード会社CSVの取り込み")}</div>
                  <div className="card-sub">{text(lang, "필수 헤더: date, vendor, amount, currency, category, cardholder, last4.", "Accepted headers: date, vendor, amount, currency, category, cardholder, last4.", "必須ヘッダー: date, vendor, amount, currency, category, cardholder, last4")}</div>
                </div>
              </div>
              <label className="upload-zone">
                <input key={statementFileKey} className="hidden-file" type="file" accept=".csv,text/csv" onChange={(event) => void readStatementFile(event.target.files?.[0] ?? null)} />
                <span>
                  <span className="upload-icon">+</span>
                  <span className="file-name">{statementFileName || text(lang, "카드 사용내역 CSV 선택", "Choose statement CSV", "カード利用明細CSVを選択")}</span>
                  <span className="line-2" style={{ display: "block", marginTop: 6 }}>{text(lang, "아래에 CSV를 붙여넣어도 됩니다", "Or paste CSV below", "下にCSVを貼り付けることもできます")}</span>
                </span>
              </label>
              <label className="field" style={{ marginTop: 12 }}>
                {text(lang, "CSV 데이터", "CSV data", "CSVデータ")}
                <textarea
                  className="textarea"
                  style={{ minHeight: 180, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12 }}
                  value={statementCsv}
                  placeholder={csvTemplate}
                  onChange={(event) => setStatementCsv(event.target.value)}
                />
              </label>
              <div className="actions" style={{ marginTop: 12 }}>
                <button className="button" type="button" disabled={statementImporting} onClick={() => void importStatement()}>
                  {statementImporting ? text(lang, "대사 중", "Reconciling", "照合中") : text(lang, "가져오기 및 대사", "Import and reconcile", "取り込みと照合")}
                </button>
                <button className="button-secondary" type="button" onClick={() => setStatementCsv(csvTemplate)}>
                  {text(lang, "CSV 형식 채우기", "Fill CSV format", "CSV形式を入力")}
                </button>
                {(statementCsv.trim() || statementFileName) && (
                  <button
                    className="button-secondary"
                    type="button"
                    disabled={statementImporting}
                    onClick={() => {
                      setStatementCsv("")
                      setStatementFileName("")
                      setStatementFileKey((key) => key + 1)
                    }}
                  >
                    {text(lang, "선택 해제", "Clear file", "選択を解除")}
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="col-7">
            <StatementRowsTable lang={lang} rows={visibleStatementRows} loading={loading} saving={saving} createClaimFromStatement={createClaimFromStatement} />
          </div>
        </section>
      </>
    )
  }

  function renderErpExport() {
    const approvedClaims = filteredClaims.filter((claim) => claim.state === "approved")
    const exportableClaims = approvedClaims.filter((claim) => ["compliant", "exception_approved"].includes(claim.policy_status) && !claim.erp_export_id)
    const exportableSpend = exportableClaims.reduce((sum, claim) => sum + amountOf(claim), 0)
    return (
      <>
        <PageHead eyebrow={text(lang, "회계", "Accounting", "会計")} title={text(lang, "ERP 출력", "ERP export", "ERP出力")} desc={text(lang, "승인된 정산을 CSV로 생성하고 출력 이력을 관리합니다.", "Generate a CSV from approved settlements and keep an export log.", "承認済みの精算からCSVを作成し、出力履歴を管理します。")} />
        <section className="grid">
          <Metric label={text(lang, "출력 가능", "Exportable", "出力可能")} value={exportableClaims.length.toString()} sub={text(lang, "정책 승인 완료", "Policy-cleared rows", "ポリシー承認済み")} tone="ok" />
          <Metric label={text(lang, "출력 금액", "Exportable value", "出力金額")} value={money(exportableSpend)} sub={text(lang, "미출력 총액", "Unexported total", "未出力の総額")} />
          <Metric label={text(lang, "출력 이력", "Exports", "出力履歴")} value={summary.erp_exports.length.toString()} sub={text(lang, "생성된 배치", "Generated batches", "作成済みバッチ")} />
          <Metric label={text(lang, "대기", "Pending", "承認待ち")} value={summary.counts.pending.toString()} sub={text(lang, "출력 불가", "Not exportable", "出力不可")} tone="warn" />
          <div className="col-5">
            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-title">{text(lang, "ERP CSV 생성", "Generate ERP CSV", "ERP CSVの作成")}</div>
                  <div className="card-sub">{text(lang, "승인된 정산만 포함되며 생성 즉시 다운로드됩니다.", "Approved settlements only. The generated file downloads immediately.", "承認済みの精算のみが含まれ、作成後すぐにダウンロードされます。")}</div>
                </div>
              </div>
              <div className="placeholder-panel" style={{ minHeight: 160 }}>
                <div>
                  <div className="upload-icon">E</div>
                  <div className="card-title">{text(lang, `${exportableClaims.length}개 출력 가능 행`, `${exportableClaims.length} exportable rows`, `出力可能な行 ${exportableClaims.length}件`)}</div>
                  <p className="page-desc" style={{ marginLeft: "auto", marginRight: "auto" }}>{text(lang, `출력 가능 총액 ${money(exportableSpend)}`, `${money(exportableSpend)} exportable value.`, `出力可能な総額 ${money(exportableSpend)}`)}</p>
                  <button className="button" type="button" disabled={saving} onClick={() => void exportErp()}>
                    {text(lang, "CSV 생성 및 다운로드", "Generate and download CSV", "CSVを作成してダウンロード")}
                  </button>
                </div>
              </div>
              {erpResult && (
                <div className="warning" style={{ marginTop: 12 }}>
                  {text(lang, `${erpResult.filename} 파일을 ${erpResult.row_count}행으로 생성했습니다.`, `Generated ${erpResult.filename} with ${erpResult.row_count} rows.`, `${erpResult.filename} を ${erpResult.row_count}行で作成しました。`)}
                </div>
              )}
            </div>
          </div>
          <div className="col-7">
            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-title">{text(lang, "출력 이력", "Export history", "出力履歴")}</div>
                  <div className="card-sub">{text(lang, "최근 생성된 회계 파일입니다.", "Latest generated accounting files.", "最近作成された会計ファイルです。")}</div>
                </div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>{text(lang, "파일", "File", "ファイル")}</th><th>{text(lang, "행", "Rows", "行数")}</th><th style={{ textAlign: "right" }}>{text(lang, "총액", "Total", "総額")}</th><th>{text(lang, "생성일", "Created", "作成日")}</th></tr>
                  </thead>
                  <tbody>
                    {summary.erp_exports.length === 0 ? (
                      <tr><td colSpan={4}><EmptyState>{text(lang, "아직 출력 이력이 없습니다.", "No exports yet.", "出力履歴はまだありません。")}</EmptyState></td></tr>
                    ) : summary.erp_exports.map((item) => (
                      <tr key={item.id}>
                        <td><strong>{item.filename}</strong><div className="line-2">{item.generated_by_member_id}</div></td>
                        <td>{item.row_count}</td>
                        <td style={{ textAlign: "right", fontWeight: 850 }}>{money(item.total_amount ?? item.total_amount_cents)}</td>
                        <td>{compactDate(item.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>
      </>
    )
  }

  function renderQa() {
    return (
      <>
        <PageHead eyebrow={text(lang, "도움말", "Help", "ヘルプ")} title="Q&A" desc={text(lang, "법인카드 규정 질문을 남기면 설정된 LLM 라우터 또는 로컬 정책 기준으로 답변합니다.", "Ask corporate-card policy questions. The backend uses the configured LLM router and falls back to local policy guidance if unavailable.", "法人カードの規程に関する質問を入力すると、設定済みのLLMルーター、または利用できない場合はローカルの規程ガイドに基づいて回答します。")} />
        <section className="grid">
          <div className="col-5">
            <form className="card" onSubmit={askPolicyQuestion}>
              <div className="card-head">
                <div>
                  <div className="card-title">{text(lang, "정책 질문하기", "Ask a policy question", "規程について質問")}</div>
                  <div className="card-sub">{text(lang, "답변은 조직 Q&A 이력에 저장됩니다.", "Answers are logged for the organization.", "回答は組織のQ&A履歴に保存されます。")}</div>
                </div>
              </div>
              <label className="field">
                {text(lang, "질문", "Question", "質問")}
                <textarea className="textarea" value={qaQuestion} onChange={(event) => setQaQuestion(event.target.value)} placeholder={text(lang, "팀 회식에 법인카드를 사용할 수 있나요?", "Can I use the card for a team dinner?", "チームの会食に法人カードを使用できますか？")} required />
              </label>
              <div className="actions" style={{ marginTop: 12 }}>
                <button className="button" type="submit" disabled={qaLoading}>{qaLoading ? text(lang, "질문 중", "Asking", "質問中") : text(lang, "질문하기", "Ask", "質問する")}</button>
                <button className="button-secondary" type="button" onClick={() => setQaQuestion(text(lang, "출장비 사용 시 어떤 증빙이 필요한가요?", "What evidence is required for travel spend?", "出張費の利用時にはどのような証憑が必要ですか？"))}>{text(lang, "예시 질문", "Example", "質問例")}</button>
              </div>
            </form>
          </div>
          <div className="col-7">
            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-title">{text(lang, "최근 답변", "Recent answers", "最近の回答")}</div>
                  <div className="card-sub">{text(lang, "출처에서 LLM 라우터 또는 로컬 정책 응답 여부를 확인할 수 있습니다.", "Source shows whether the LLM router or local fallback answered.", "出典欄で、LLMルーターとローカル規程のどちらが回答したかを確認できます。")}</div>
                </div>
              </div>
              <div className="list">
                {summary.policy_questions.length === 0 ? (
                  <EmptyState>{text(lang, "아직 정책 질문이 없습니다.", "No policy questions yet.", "規程に関する質問はまだありません。")}</EmptyState>
                ) : summary.policy_questions.map((item) => (
                  <div className="list-row" key={item.id} style={{ alignItems: "flex-start" }}>
                    <div className="list-main">
                      <div className="line-1">{item.question}</div>
                      <p className="page-desc" style={{ marginTop: 6 }}>{item.answer}</p>
                    </div>
                    <span className={`pill ${item.source === "llm_router" ? "ok" : "info"}`}>{item.source}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </>
    )
  }

  function renderMembers() {
    const visibleMembers = members.filter((member) =>
      searchMatches(searchQuery, [member.name, member.email, member.title, member.role, member.app_role, member.id]),
    )
    const managerMemberCount = members.filter((member) => member.app_role && isRoleManager(member.app_role)).length
    const assignedCount = members.filter((member) => member.app_role_source === "assigned").length
    return (
      <>
        <PageHead
          eyebrow={text(lang, "권한 관리", "Access control", "権限管理")}
          title={text(lang, "조직 멤버 역할과 권한", "Organization member roles and permissions", "組織メンバーのロールと権限")}
          desc={text(lang, "역할은 Palette OS 조직 역할(뷰어·멤버·관리자·소유자)을 따릅니다. 관리자와 소유자만 역할을 변경할 수 있습니다.", "Roles follow the Palette OS organization roles — viewer, member, admin, owner. Only admins and owners can change them.", "ロールはPalette OSの組織ロール（閲覧者・メンバー・管理者・オーナー）に準拠します。ロールを変更できるのは管理者とオーナーのみです。")}
        />
        <section className="grid">
          <Metric label={text(lang, "멤버", "Members", "メンバー")} value={members.length.toString()} sub={text(lang, "현재 조직", "Active organization", "現在の組織")} tone="info" />
          <Metric
            label={text(lang, "관리자·소유자", "Admins and owners", "管理者・オーナー")}
            value={managerMemberCount.toString()}
            sub={text(lang, "결재와 역할 관리", "Approvals and role management", "決裁とロール管理")}
            tone="ok"
          />
          <Metric
            label={text(lang, "직접 지정", "Assigned", "個別指定")}
            value={assignedCount.toString()}
            sub={text(lang, "기본값 오버라이드", "Default overrides", "デフォルトの上書き")}
            tone={assignedCount ? "info" : "ok"}
          />
          <Metric label={text(lang, "관리 권한", "Manage roles", "ロール管理")} value={canManageRoles ? text(lang, "가능", "Enabled", "可能") : text(lang, "읽기", "Read only", "閲覧のみ")} sub={canManageRoles ? text(lang, "관리자·소유자", "Admin or owner", "管理者・オーナー") : text(lang, "관리자·소유자만 변경 가능", "Admins and owners only", "管理者・オーナーのみ変更可能")} tone={canManageRoles ? "ok" : "warn"} />
          <div className="col-12">
            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-title">{text(lang, "법인카드 지정", "Corporate cards", "法人カードの割り当て")}</div>
                  <div className="card-sub">{text(lang, "멤버에게 카드 끝자리와 월 한도를 연결합니다.", "Assign card endings and monthly limits to members.", "メンバーにカード番号下4桁と月間利用限度額を割り当てます。")}</div>
                </div>
                <span className="pill info">{text(lang, `${summary.cards.filter((card) => card.status === "active").length}개 활성`, `${summary.cards.filter((card) => card.status === "active").length} active`, `${summary.cards.filter((card) => card.status === "active").length}件 有効`)}</span>
              </div>
              {canManageRoles ? (
                <form className="form-grid" onSubmit={createMemberCard} style={{ marginBottom: 16 }}>
                  <label className="field">
                    {text(lang, "멤버", "Member", "メンバー")}
                    <select className="select" value={cardForm.member_id} onChange={(event) => setCardForm((current) => ({ ...current, member_id: event.target.value }))} required>
                      <option value="">{text(lang, "멤버 선택", "Choose member", "メンバーを選択")}</option>
                      {members.map((member) => (
                        <option value={member.id} key={member.id}>{member.name || member.email || member.id}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    {text(lang, "카드 표시명", "Card display label", "カード表示名")}
                    <input
                      className="input"
                      value={cardForm.label}
                      onChange={(event) => {
                        const value = event.target.value
                        const last4 = cardLast4FromInput(value)
                        setCardForm((current) => ({ ...current, label: value, last4: current.last4 || last4 }))
                      }}
                      placeholder="Corporate Visa ****1234"
                      required
                    />
                  </label>
                  <label className="field">
                    {text(lang, "끝자리", "Last 4", "下4桁")}
                    <input className="input" inputMode="numeric" maxLength={4} value={cardForm.last4} onChange={(event) => setCardForm((current) => ({ ...current, last4: event.target.value.replace(/\D/g, "").slice(0, 4) }))} placeholder="1234" required />
                  </label>
                  <label className="field">
                    {text(lang, "월 한도", "Monthly limit", "月間利用限度額")}
                    <input className="input" inputMode="decimal" value={cardForm.monthly_limit} onChange={(event) => setCardForm((current) => ({ ...current, monthly_limit: event.target.value }))} placeholder="1000000" required />
                  </label>
                  <div className="field" style={{ justifyContent: "flex-end" }}>
                    <button className="button" type="submit" disabled={saving}>{text(lang, "카드 등록", "Add card", "カード登録")}</button>
                  </div>
                </form>
              ) : (
                <div className="warning" style={{ marginBottom: 12 }}>{text(lang, "카드 등록과 비활성화는 관리자만 할 수 있습니다.", "Only admins can add or deactivate cards.", "カードの登録と無効化は管理者のみ行えます。")}</div>
              )}
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{text(lang, "멤버", "Member", "メンバー")}</th>
                      <th>{text(lang, "카드", "Card", "カード")}</th>
                      <th>{text(lang, "끝자리", "Last 4", "下4桁")}</th>
                      <th>{text(lang, "월 한도", "Monthly limit", "月間利用限度額")}</th>
                      <th>{text(lang, "상태", "Status", "ステータス")}</th>
                      <th>{text(lang, "생성일", "Created", "作成日")}</th>
                      <th>{text(lang, "작업", "Actions", "操作")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.cards.length === 0 ? (
                      <tr><td colSpan={7}><EmptyState>{text(lang, "등록된 법인카드가 없습니다.", "No corporate cards registered.", "登録済みの法人カードはありません。")}</EmptyState></td></tr>
                    ) : summary.cards.map((card) => (
                      <tr key={card.id}>
                        <td>
                          <strong>{card.member_name}</strong>
                          <div className="line-2">{card.member_id}</div>
                        </td>
                        <td>{card.label}</td>
                        <td><code>{card.last4}</code></td>
                        <td>{money(monthlyLimitOf(card))}</td>
                        <td><StatusPill state={card.status} /></td>
                        <td>{card.created_at ? compactDate(card.created_at) : "-"}</td>
                        <td>
                          {canManageRoles && card.status === "active" ? (
                            <button className="button-danger" type="button" disabled={saving} onClick={() => void deactivateMemberCard(card.id)}>
                              {text(lang, "비활성화", "Deactivate", "無効化")}
                            </button>
                          ) : (
                            <span className="line-2">-</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <div className="col-12">
            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-title">{text(lang, "앱 역할 매핑", "App role mapping", "アプリロールの割り当て")}</div>
                  <div className="card-sub">{text(lang, "플랫폼 멤버에 법인카드 앱 역할과 권한 세트를 연결합니다.", "Map platform members to corporate-card app roles and permission sets.", "プラットフォームのメンバーに法人カードアプリのロールと権限セットを割り当てます。")}</div>
                </div>
                <button className="button-secondary" type="button" disabled={membersLoading} onClick={() => void loadMembers()}>
                  {membersLoading ? text(lang, "불러오는 중", "Loading", "読み込み中") : text(lang, "새로고침", "Refresh", "更新")}
                </button>
              </div>
              {membersError ? <div className="warning" style={{ marginBottom: 12 }}>{membersError}</div> : null}
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{text(lang, "이름", "Name", "氏名")}</th>
                      <th>{text(lang, "이메일", "Email", "メールアドレス")}</th>
                      <th>{text(lang, "플랫폼 역할", "Platform role", "プラットフォームロール")}</th>
                      <th>{text(lang, "앱 역할", "App role", "アプリロール")}</th>
                      <th style={{ minWidth: 190 }}>{text(lang, "근무 지역", "Work locality", "勤務地域")}</th>
                      <th>{text(lang, "권한", "Permissions", "権限")}</th>
                      <th>{text(lang, "상태", "Status", "ステータス")}</th>
                      <th>{text(lang, "ID", "ID", "ID")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {membersLoading ? (
                      <tr><td colSpan={8}><EmptyState>{text(lang, "조직 멤버를 불러오는 중입니다...", "Loading organization members...", "組織メンバーを読み込んでいます...")}</EmptyState></td></tr>
                    ) : visibleMembers.length === 0 ? (
                      <tr><td colSpan={8}><EmptyState>{searchQuery
                        ? text(lang, "검색과 일치하는 멤버가 없습니다.", "No members match your search.", "検索条件に一致するメンバーはいません。")
                        : text(lang, "표시할 조직 멤버가 없습니다.", "No organization members to show.", "表示できる組織メンバーはいません。")}</EmptyState></td></tr>
                    ) : visibleMembers.map((member) => (
                      <tr key={member.id}>
                        <td>
                          <strong>{member.name || text(lang, "이름 없음", "Unnamed", "名前未設定")}</strong>
                          <div className="line-2">{member.title || compactDate(member.joined_at)}</div>
                        </td>
                        <td>{member.email}</td>
                        <td>{titleCase(member.role)}</td>
                        <td>
                          {canManageRoles ? (
                            <select
                              className="select"
                              value={member.app_role ?? "member"}
                              disabled={saving}
                              onChange={(event) => void assignMemberRole(member.id, event.target.value as Role)}
                            >
                              {roleOptions.map((option) => (
                                <option value={option} key={option}>{roleLabel(option)}</option>
                              ))}
                            </select>
                          ) : (
                            <span className={`pill ${isRoleManager(member.app_role ?? "member") ? "ok" : member.app_role === "viewer" ? "" : "info"}`}>{roleLabel(member.app_role ?? "member")}</span>
                          )}
                          <div className="line-2">{member.app_role_source === "assigned" ? text(lang, "관리자 지정", "Assigned by admin", "管理者が指定") : text(lang, "기본 역할", "Default role", "デフォルトロール")}</div>
                        </td>
                        <td>
                          <MemberLocalityCell
                            lang={lang}
                            member={member}
                            canEdit={canManageRoles}
                            saving={saving}
                            onSave={(value) => void setMemberLocality(member.id, value)}
                          />
                        </td>
                        <td>
                          <div className="chip-row wrap" style={{ margin: 0 }}>
                            {(member.app_permissions?.length ? member.app_permissions : rolePermissionMap[member.app_role ?? "member"]).slice(0, 5).map((permission) => (
                              <span className="pill info" key={`${member.id}-${permission}`}>{titleCase(permission)}</span>
                            ))}
                            {(member.app_permissions?.length ?? 0) > 5 ? <span className="pill">+{(member.app_permissions?.length ?? 0) - 5}</span> : null}
                          </div>
                        </td>
                        <td><StatusPill state={member.is_active ? "active" : "inactive"} /></td>
                        <td><code>{member.id}</code></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>
      </>
    )
  }

  let page
  if (tab === "dashboard") page = renderDashboard()
  else if (tab === "inbox") page = renderInbox()
  else if (tab === "cards") page = renderCards()
  else if (tab === "submit") page = renderSubmit()
  else if (tab === "pre_spend") page = renderPreSpend()
  else if (tab === "usage") page = renderUsage()
  else if (tab === "monitoring") page = renderMonitoring()
  else if (tab === "anomalies") page = renderAnomalies()
  else if (tab === "history") page = renderHistory()
  else if (tab === "approvals") page = renderApprovals()
  else if (tab === "analytics") page = renderAnalytics()
  else if (tab === "upload") page = renderStatementUpload()
  else if (tab === "erp") page = renderErpExport()
  else if (tab === "members") page = renderMembers()
  else page = renderQa()

  return (
    <div className={`cc-app ${colorMode}`} data-color-mode={colorMode}>
      <style>{styles}</style>
      <div className={`app-shell ${assistantOpen ? "assistant-open" : ""}`}>
        <aside className={`sidebar ${navCollapsed ? "collapsed" : ""}`}>
          <div className="sb-brand">
            <span className="sb-brand-mark" aria-hidden="true">
              <Icon name="card" />
            </span>
            <span className="sb-brand-name">{text(lang, "법인카드", "Corporate card", "法人カード")}</span>
            <button
              className="sb-collapse"
              type="button"
              onClick={() => setNavCollapsed((value) => !value)}
              aria-expanded={!navCollapsed}
              title={navCollapsed ? text(lang, "사이드바 펼치기", "Expand sidebar", "サイドバーを展開") : text(lang, "사이드바 접기", "Collapse sidebar", "サイドバーを折りたたむ")}
              aria-label={navCollapsed ? text(lang, "사이드바 펼치기", "Expand sidebar", "サイドバーを展開") : text(lang, "사이드바 접기", "Collapse sidebar", "サイドバーを折りたたむ")}
            >
              <Icon name="panel" />
            </button>
          </div>
          <nav className="sb-nav" aria-label="Corporate card navigation">
            {navItems
              .filter((item) => item.roles.includes(role))
              .map((item, index, visible) => {
                const count = navCount(item.count)
                const label = text(lang, item.labelKo, item.label, item.labelJa)
                /* A section label only earns its place if the group actually has
                   items for this role — role filtering can empty a group, and a
                   heading over nothing is noise. Suppressed when collapsed,
                   where the rail has no room for text. */
                const showSection =
                  !navCollapsed && item.section && index > 0 && Boolean(item.sectionKo ?? item.sectionEn)
                return (
                  <Fragment key={item.tab}>
                    {showSection && (
                      <div className="sb-section-label" aria-hidden="true">
                        {text(lang, item.sectionKo ?? "", item.sectionEn ?? "", item.sectionJa ?? "")}
                      </div>
                    )}
                    <button
                      className={`sb-item ${tab === item.tab ? "active" : ""}`}
                      type="button"
                      onClick={() => setTab(item.tab)}
                      aria-current={tab === item.tab ? "page" : undefined}
                      /* Collapsed, the icon is the only label, so the accessible
                         name has to come from the attribute. */
                      aria-label={navCollapsed ? label : undefined}
                      title={navCollapsed ? label : undefined}
                    >
                      <Icon name={item.icon} />
                      <span className="sb-label">{label}</span>
                      {item.count && count > 0 && <span className={`sb-count ${item.count !== "claims" ? "urgent" : ""}`}>{count}</span>}
                    </button>
                  </Fragment>
                )
              })}
          </nav>
          <div className="sb-footer">
            <div className="sb-user-row">
              <span className="avatar">{initials(activeMemberName)}</span>
              <div className="sb-user-info">
                <div className="sb-user-name">{activeMemberName}</div>
                <div className="sb-user-mail">{roleLabel(role)}{platform.user.email ? ` · ${platform.user.email}` : ""}</div>
              </div>
            </div>
          </div>
        </aside>
        <main className="main">
          <header className="topbar">
            <div className="topbar-heading">
              {(() => {
                const current = navItems.find((item) => item.tab === tab)
                return (
                  <>
                    <span className="topbar-page-icon" aria-hidden="true">
                      <Icon name={current?.icon ?? "dashboard"} />
                    </span>
                    <span className="topbar-heading-text">
                      <span className="topbar-eyebrow">{text(lang, "법인카드 관리", "Corporate card", "法人カード管理")}</span>
                      <span className="topbar-page">{text(lang, current?.labelKo ?? "", current?.label ?? "", current?.labelJa ?? "")}</span>
                    </span>
                  </>
                )
              })()}
            </div>
            <div className="topbar-actions">
              <div className="topbar-search">
                <svg className="icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                  <circle cx="7" cy="7" r="4.4" />
                  <line x1="10.3" y1="10.3" x2="14" y2="14" />
                </svg>
                <input
                  ref={searchInputRef}
                  type="search"
                  aria-label="Search transactions"
                  placeholder={text(lang, "거래·직원·계정과목", "Transactions, staff, accounts", "取引・従業員・勘定科目")}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                <kbd className="kbd-hint" aria-hidden="true">/</kbd>
              </div>
              <button className="btn-primary" type="button" onClick={() => setTab(isPersonalScope ? "submit" : isOversightScope ? "approvals" : isOversightScope ? "monitoring" : "erp")}>
                {isPersonalScope
                  ? text(lang, "정산 신청", "File settlement", "精算申請")
                  : isOversightScope
                    ? text(lang, "결재함 열기", "Open approvals", "決裁ボックスを開く")
                    : isOversightScope
                      ? text(lang, "모니터링", "Monitoring", "モニタリング")
                      : text(lang, "ERP 출력", "Export to ERP", "ERP出力")}
              </button>
              <button className="btn-secondary topbar-clear" type="button" disabled={saving} onClick={() => setClearConfirmOpen(true)}>
                {text(lang, "초기화", "Clear", "クリア")}
              </button>
              <button
                ref={assistantTriggerRef}
                className={`btn-secondary topbar-ai ${assistantOpen ? "on" : ""}`}
                type="button"
                onClick={() => (assistantOpen ? closeAssistant() : openAssistant())}
                aria-expanded={assistantOpen}
                aria-controls="assistant-panel"
              >
                <Icon name="sparkle" />
                {text(lang, "AI 도우미", "AI Assistant", "AIアシスタント")}
              </button>
              <button className="topbar-bell" type="button" aria-label="Open inbox" onClick={() => setTab("inbox")}>
                <svg className="icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                  <path d="M8 2.1a3.4 3.4 0 0 0-3.4 3.4v2.2L3.4 10.3h9.2l-1.2-2.6V5.5A3.4 3.4 0 0 0 8 2.1Z" />
                  <path d="M6.5 12.1a1.6 1.6 0 0 0 3 0" />
                </svg>
                {inboxClaims.length > 0 && <span className="topbar-bell-count">{inboxClaims.length}</span>}
              </button>
            </div>
          </header>
          <div className="content">{page}</div>
        </main>
        <aside
          id="assistant-panel"
          className="assistant"
          /* Docked, not modal: the app behind it stays usable, so this is a
             labelled complementary region rather than a dialog that would
             falsely promise a focus trap. Hidden from AT while collapsed. */
          role="complementary"
          aria-label={text(lang, "AI 도우미", "AI Assistant", "AIアシスタント")}
          aria-hidden={!assistantOpen}
          {...(assistantOpen ? {} : { inert: "" as unknown as boolean })}
        >
          <div className="assistant-head">
            <span className="assistant-mark" aria-hidden="true"><Icon name="sparkle" /></span>
            <div className="assistant-head-text">
              <div className="assistant-title">{text(lang, "AI 도우미", "AI Assistant", "AIアシスタント")}</div>
              <div className="assistant-sub">{text(lang, "이 워크스페이스의 카드·정산·결재를 안내합니다", "Cards, settlements and approvals in this workspace", "このワークスペースのカード・精算・決裁をご案内します")}</div>
            </div>
            <button
              className="assistant-close"
              type="button"
              onClick={closeAssistant}
              aria-label={text(lang, "도우미 닫기", "Close assistant", "アシスタントを閉じる")}
            >
              <svg viewBox="0 0 16 16" className="icon" aria-hidden="true" focusable="false">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>

          <div className="assistant-thread" ref={assistantThreadRef} aria-live="polite" aria-busy={assistantLoading}>
            {assistantThread.length === 0 && !assistantLoading ? (
              <div className="assistant-intro">
                <p className="assistant-intro-lead">
                  {text(
                    lang,
                    "이 앱의 기능과 현재 워크스페이스 데이터를 기준으로 답변합니다.",
                    "I answer from this app's features and your workspace's live data.", "このアプリの機能と現在のワークスペースのデータに基づいて回答します。",
                  )}
                </p>
                <div className="assistant-suggests">
                  {assistantSuggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      className="assistant-suggest"
                      type="button"
                      onClick={() => void askAssistant(suggestion)}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              assistantThread.map((turn, index) => (
                <div className={`assistant-turn ${turn.role === "assistant" ? "is-bot" : "is-user"}`} key={`${turn.role}-${index}`}>
                  {turn.role === "assistant" && (
                    <div className="bubble-meta">
                      {turn.source === "local_app_context"
                        ? text(lang, "앱 데이터 기준", "From app data", "アプリデータに基づく")
                        : text(lang, "AI 도우미", "AI Assistant", "AIアシスタント")}
                    </div>
                  )}
                  <div className={turn.role === "assistant" ? "bubble-bot" : "bubble-user"}>
                    {turn.content.split("\n").map((line, lineIndex) => (
                      <p className="assistant-line" key={lineIndex}>
                        <AssistantText line={line} />
                      </p>
                    ))}
                  </div>
                </div>
              ))
            )}
            {assistantLoading && (
              <div className="assistant-turn is-bot">
                <div className="bubble-meta">{text(lang, "AI 도우미", "AI Assistant", "AIアシスタント")}</div>
                <div className="bubble-bot assistant-thinking">
                  <span className="assistant-dot" /><span className="assistant-dot" /><span className="assistant-dot" />
                  <span className="sr-only">{text(lang, "답변 작성 중", "Thinking", "回答を作成中")}</span>
                </div>
              </div>
            )}
            {assistantError && (
              <div className="assistant-error" role="alert">
                {assistantError}
                <button className="assistant-retry" type="button" onClick={() => void askAssistant(assistantInput)}>
                  {text(lang, "다시 시도", "Retry", "再試行")}
                </button>
              </div>
            )}
          </div>

          <form
            className="assistant-compose"
            onSubmit={(event) => {
              event.preventDefault()
              void askAssistant(assistantInput)
            }}
          >
            <label className="sr-only" htmlFor="assistant-input">{text(lang, "질문", "Question", "質問")}</label>
            <textarea
              id="assistant-input"
              ref={assistantInputRef}
              className="assistant-input"
              rows={1}
              value={assistantInput}
              placeholder={text(lang, "무엇이든 물어보세요", "Ask about cards, claims or approvals", "カード・精算・決裁について質問してください")}
              onChange={(event) => setAssistantInput(event.target.value)}
              /* Enter sends, Shift+Enter breaks the line: the convention every
                 chat input in this category already uses. */
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.shiftKey) return
                event.preventDefault()
                void askAssistant(assistantInput)
              }}
            />
            <button
              className="assistant-send"
              type="submit"
              disabled={assistantLoading || !assistantInput.trim()}
              aria-label={text(lang, "보내기", "Send", "送信")}
            >
              <svg viewBox="0 0 16 16" className="icon" aria-hidden="true" focusable="false">
                <path d="M2.5 8h10M8.4 3.6 12.8 8l-4.4 4.4" />
              </svg>
            </button>
          </form>
        </aside>
      </div>
      {clearConfirmOpen && (
        <div className="modal-backdrop" role="presentation" onClick={() => { if (!saving) setClearConfirmOpen(false) }}>
          <div
            className="modal-panel confirm-panel"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="clear-confirm-title"
            aria-describedby="clear-confirm-desc"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="confirm-title" id="clear-confirm-title">{text(lang, "법인카드 데이터 삭제", "Clear corporate-card data", "法人カードデータの削除")}</div>
            <div className="confirm-desc" id="clear-confirm-desc">
              {text(
                lang,
                "현재 조직의 정산·사전 신청·승인 기록이 영구적으로 삭제됩니다. 이 작업은 되돌릴 수 없습니다.",
                "This will permanently delete every settlement, pre-spend request, and approval record for this organization. This action cannot be undone.", "この組織の精算・事前申請・承認の記録がすべて完全に削除されます。この操作は元に戻せません。",
              )}
            </div>
            <div className="confirm-footer">
              <button className="button-secondary" type="button" disabled={saving} onClick={() => setClearConfirmOpen(false)}>
                {text(lang, "취소", "Cancel", "キャンセル")}
              </button>
              <button className="button-destructive" type="button" disabled={saving} onClick={() => void clearWorkspace()}>
                {saving ? text(lang, "삭제 중…", "Clearing…", "削除中…") : text(lang, "삭제", "Clear", "削除")}
              </button>
            </div>
          </div>
        </div>
      )}
      {quickResubmitDraft && (
        <ResubmitModal
          lang={lang}
          draft={quickResubmitDraft}
          setDraft={setQuickResubmitDraft}
          saving={saving}
          onSubmit={submitQuickResubmission}
        />
      )}
    </div>
  )
}

function Metric({
  label,
  value,
  sub,
  tone,
  icon,
  pill,
}: {
  label: string
  value: string
  sub: string
  tone?: "ok" | "warn" | "danger" | "info"
  /* Optional so every existing call site keeps working untouched. */
  icon?: IconName
  /* A second figure that qualifies the first — a share, a count, a rate.
     Optional, and only ever passed something the page actually computes: a
     tile that invents a trend it cannot measure is worse than one without. */
  pill?: { label: string; tone?: "ok" | "warn" | "danger" | "info" | "mute" }
}) {
  return (
    <div className="metric col-3">
      <div className="metric-head">
        <div className="metric-label">{label}</div>
        {icon && (
          <span className="metric-icon" aria-hidden="true">
            <Icon name={icon} />
          </span>
        )}
      </div>
      <div className="metric-body">
        <div className={`metric-value ${tone ?? ""}`}>{value}</div>
        <div className="metric-foot">
          {pill && <span className={`metric-pill ${pill.tone ?? "mute"}`}>{pill.label}</span>}
          <span className="metric-sub">{sub}</span>
        </div>
      </div>
    </div>
  )
}

function Quick({ label, sub, icon, onClick }: { label: string; sub: string; icon: IconName; onClick: () => void }) {
  return (
    <button className="quick" type="button" onClick={onClick}>
      <span className="quick-icon" aria-hidden="true">
        <Icon name={icon} />
      </span>
      <span className="quick-title">{label}</span>
      <span className="quick-sub">{sub}</span>
    </button>
  )
}

function ClaimList({ lang, claims, loading, onOpen }: { lang: Lang; claims: Claim[]; loading: boolean; onOpen: (id: number) => void }) {
  if (loading) return <EmptyState>{text(lang, "정산을 불러오는 중입니다...", "Loading claims...", "精算を読み込んでいます...")}</EmptyState>
  if (claims.length === 0) return <EmptyState>{text(lang, "대기 중인 항목이 없습니다.", "Nothing pending.", "承認待ちの項目はありません。")}</EmptyState>
  return (
    <div className="list">
      {claims.map((claim) => (
        <div className="list-row clickable" key={claim.id} onClick={() => onOpen(claim.id)}>
          <div className="list-main">
            <div className="line-1">{claim.vendor} - {claim.category}</div>
            <div className="line-2">{compactDate(claim.created_at)} - {claim.requester_name} - {claim.business_purpose}</div>
          </div>
          <div className="row-meta">
            {money(amountOf(claim), claim.currency)}
            <div style={{ marginTop: 3 }}><StatusPill state={claim.state} /></div>
          </div>
        </div>
      ))}
    </div>
  )
}

function CategoryBars({ lang, categories, total }: { lang: Lang; categories: Array<[string, number]>; total: number }) {
  if (categories.length === 0 || total <= 0) return <EmptyState>{text(lang, "아직 사용 데이터가 없습니다.", "No spend data yet.", "利用データはまだありません。")}</EmptyState>
  return (
    <div className="bars">
      {categories.map(([category, amount]) => {
        const pct = Math.max(5, Math.round((amount / total) * 100))
        return (
          <div className="bar-row" key={category}>
            <div className="line-1">{titleCase(category)}</div>
            <div className="bar-track"><div className="bar-fill" style={{ width: `${pct}%` }} /></div>
            <div className="row-meta">{money(amount)}</div>
          </div>
        )
      })}
    </div>
  )
}

function BITrendChart({ lang, rows, projected }: { lang: Lang; rows: MonitoringPeriod[]; projected: number }) {
  const actualRows = rows.filter((row) => spendOf(row) > 0)
  if (actualRows.length === 0) return <EmptyState>{text(lang, "표시할 추이 데이터가 없습니다.", "No trend data to show.", "表示できる推移データはありません。")}</EmptyState>
  const width = 720
  const height = 280
  const pad = 42
  const hasForecast = projected > 0
  const values = [...actualRows.map((row) => spendOf(row)), ...(hasForecast ? [projected] : [])]
  const maxValue = Math.max(...values, 1)
  const pointCount = values.length
  const point = (value: number, index: number) => {
    const x = pad + (pointCount <= 1 ? 0 : (index / (pointCount - 1)) * (width - pad * 2))
    const y = height - pad - (value / maxValue) * (height - pad * 2)
    return { x, y }
  }
  const actualPoints = actualRows.map((row, index) => point(spendOf(row), index))
  const forecastPoint = hasForecast ? point(projected, values.length - 1) : null
  const actualPolyline = actualPoints.map((item) => `${item.x},${item.y}`).join(" ")
  const areaPath = [
    `M ${actualPoints[0]?.x ?? pad} ${height - pad}`,
    ...actualPoints.map((item, index) => `${index === 0 ? "L" : "L"} ${item.x} ${item.y}`),
    `L ${actualPoints.at(-1)?.x ?? pad} ${height - pad}`,
    "Z",
  ].join(" ")
  return (
    <svg className="bi-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={text(lang, "월별 사용액 예측 그래프", "Monthly spend forecast chart", "月別利用額の予測グラフ")}>
      {[0.25, 0.5, 0.75, 1].map((ratio) => {
        const y = height - pad - ratio * (height - pad * 2)
        return <line className="bi-gridline" x1={pad} x2={width - pad} y1={y} y2={y} key={ratio} />
      })}
      <line className="bi-axis" x1={pad} x2={width - pad} y1={height - pad} y2={height - pad} />
      <line className="bi-axis" x1={pad} x2={pad} y1={pad} y2={height - pad} />
      <path className="bi-area" d={areaPath} />
      <polyline className="bi-line" points={actualPolyline} />
      {forecastPoint && actualPoints.length ? (
        <line className="bi-line forecast" x1={actualPoints.at(-1)!.x} y1={actualPoints.at(-1)!.y} x2={forecastPoint.x} y2={forecastPoint.y} />
      ) : null}
      {actualPoints.map((item, index) => (
        <g key={actualRows[index].period}>
          <circle className="bi-point" cx={item.x} cy={item.y} r="6" />
          <text className="bi-label" x={item.x} y={height - 13} textAnchor="middle">{periodLabel(actualRows[index].period)}</text>
        </g>
      ))}
      {forecastPoint ? (
        <g>
          <circle className="bi-point forecast" cx={forecastPoint.x} cy={forecastPoint.y} r="7" />
          <text className="bi-label" x={forecastPoint.x} y={height - 13} textAnchor="middle">{text(lang, "예측", "Forecast", "予測")}</text>
          <text className="bi-value" x={forecastPoint.x} y={Math.max(24, forecastPoint.y - 12)} textAnchor="middle">{money(projected)}</text>
        </g>
      ) : null}
      <text className="bi-label" x={pad} y="24">{money(maxValue)}</text>
      <text className="bi-label" x={width - pad} y="24" textAnchor="end">{text(lang, "실적 + 런레이트", "Actual + run rate", "実績＋ランレート")}</text>
    </svg>
  )
}

function BIRiskHeatmap({ lang, overview }: { lang: Lang; overview: MonitoringOverview }) {
  const cells = [
    { labelKo: "차단", labelEn: "Blocked", value: overview.blocked_claims, subKo: "하드 블록", subEn: "Hard blocks", labelJa: "ブロック", subJa: "ハードブロック" },
    { labelKo: "보완", labelEn: "Needs info", value: overview.needs_info_claims, subKo: "신청자 조치", subEn: "Requester action", labelJa: "要補足", subJa: "申請者の対応" },
    { labelKo: "증빙 누락", labelEn: "Missing receipts", value: overview.missing_receipt_claims, subKo: "영수증/선언", subEn: "Receipt/declaration", labelJa: "証憑不足", subJa: "領収書/申告" },
    { labelKo: "대사 누락", labelEn: "Statement gaps", value: overview.statement_missing_claims, subKo: "카드사 행", subEn: "Issuer rows", labelJa: "照合漏れ", subJa: "カード会社の明細行" },
    { labelKo: "7일 초과", labelEn: "Aged pending", value: overview.pending_over_7_days + overview.needs_info_over_7_days, subKo: "지연 항목", subEn: "Delayed items", labelJa: "7日超過", subJa: "遅延項目" },
    { labelKo: "사전승인", labelEn: "Pre-spend", value: overview.pre_spend_pending, subKo: "승인 대기", subEn: "Pending approval", labelJa: "事前承認", subJa: "承認待ち" },
  ]
  return (
    <div className="bi-heatmap">
      {cells.map((cell) => {
        const tone = cell.value >= 5 ? "high" : cell.value > 0 ? "medium" : ""
        return (
          <div className={`bi-risk-cell ${tone}`} key={cell.labelEn}>
            <div className="bi-risk-value">{cell.value}</div>
            <div>
              <div className="bi-risk-label">{text(lang, cell.labelKo, cell.labelEn, cell.labelJa)}</div>
              <div className="bi-risk-sub">{text(lang, cell.subKo, cell.subEn, cell.subJa)}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function BICategoryDonut({ lang, categories }: { lang: Lang; categories: MonitoringCategory[] }) {
  const rows = categories.filter((item) => spendOf(item) > 0).slice(0, 5)
  const total = rows.reduce((sum, item) => sum + spendOf(item), 0)
  if (!rows.length || total <= 0) return <EmptyState>{text(lang, "카테고리 그래프 데이터가 없습니다.", "No category graph data.", "カテゴリ別グラフのデータがありません。")}</EmptyState>
  const top = rows[0]
  const gradientRows = rows.map((item) => [item.category, spendOf(item)] as [string, number])
  return (
    <div className="bi-split">
      <div className="bi-donut" style={{ background: donutGradient(gradientRows, total) }}>
        <div className="bi-donut-center">
          <div>
            <div style={{ color: "var(--text-3)", fontSize: 10 }}>TOP</div>
            <div>{percent(spendOf(top), total)}%</div>
            <div style={{ color: "var(--text-3)", fontSize: 11 }}>{titleCase(top.category)}</div>
          </div>
        </div>
      </div>
      <div className="bi-insight-list">
        {rows.map((item, index) => (
          <div className="bi-insight-row" key={item.category}>
            <span className="bi-dot" style={{ background: CHART_COLORS[index % CHART_COLORS.length] }} />
            <span className="line-1">{titleCase(item.category)}</span>
            <span className="row-meta">{money(spendOf(item))}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function BIEmployeeBubbleChart({ lang, employees }: { lang: Lang; employees: MonitoringEmployee[] }) {
  const rows = employees.slice(0, 8)
  if (!rows.length) return <EmptyState>{text(lang, "직원 노출 그래프 데이터가 없습니다.", "No employee exposure graph data.", "従業員別エクスポージャーのグラフデータがありません。")}</EmptyState>
  const width = 680
  const height = 280
  const pad = 44
  const maxSpend = Math.max(...rows.map((item) => spendOf(item)), 1)
  const risks = rows.map((item) => item.blocked + item.warnings + item.exceptions + item.missing_receipts + item.late_claims)
  const maxRisk = Math.max(...risks, 1)
  return (
    <svg className="bi-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={text(lang, "직원별 사용액과 리스크 버블 차트", "Employee spend and risk bubble chart", "従業員別の利用額とリスクのバブルチャート")}>
      <line className="bi-axis" x1={pad} x2={width - pad} y1={height - pad} y2={height - pad} />
      <line className="bi-axis" x1={pad} x2={pad} y1={pad} y2={height - pad} />
      {[0.25, 0.5, 0.75, 1].map((ratio) => (
        <line className="bi-gridline" x1={pad} x2={width - pad} y1={height - pad - ratio * (height - pad * 2)} y2={height - pad - ratio * (height - pad * 2)} key={ratio} />
      ))}
      {rows.map((item, index) => {
        const risk = risks[index]
        const rowSpend = spendOf(item)
        const x = pad + (rowSpend / maxSpend) * (width - pad * 2)
        const y = height - pad - (risk / maxRisk) * (height - pad * 2)
        const radius = 9 + Math.sqrt(rowSpend / maxSpend) * 19
        const color = risk > 0 ? "var(--warn)" : "var(--sb-green)"
        return (
          <g key={item.member_id}>
            <circle cx={x} cy={y} r={radius} fill={risk > 0 ? "rgba(178, 94, 9, 0.17)" : "rgba(0, 98, 65, 0.15)"} stroke={color} strokeWidth="2">
              <title>{`${item.name}: ${money(rowSpend)} · risk ${risk}`}</title>
            </circle>
            <text className="bi-value" x={x} y={y + 4} textAnchor="middle">{risk}</text>
            <text className="bi-label" x={x} y={Math.min(height - 12, y + radius + 16)} textAnchor="middle">{item.name.split(" ")[0]}</text>
          </g>
        )
      })}
      <text className="bi-label" x={width - pad} y={height - 12} textAnchor="end">{text(lang, "사용액", "Spend", "利用額")}</text>
      <text className="bi-label" x={pad} y="24">{text(lang, "리스크", "Risk", "リスク")}</text>
    </svg>
  )
}

function StatementRowsTable({
  lang,
  rows,
  loading,
  saving,
  createClaimFromStatement,
}: {
  lang: Lang
  rows: StatementRow[]
  loading: boolean
  saving: boolean
  createClaimFromStatement: (rowId: number) => Promise<void>
}) {
  if (loading) return <div className="card"><EmptyState>{text(lang, "카드 사용내역을 불러오는 중입니다...", "Loading statement rows...", "カード利用明細を読み込んでいます...")}</EmptyState></div>
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">{text(lang, "대사 결과", "Reconciliation results", "照合結果")}</div>
          <div className="card-sub">{text(lang, "매칭되지 않은 행은 정산 신청으로 생성할 수 있습니다.", "Unmatched rows can create settlement requests.", "照合されなかった行から精算申請を作成できます。")}</div>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{text(lang, "일자", "Date", "日付")}</th>
              <th>{text(lang, "사용자", "Cardholder", "利用者")}</th>
              <th>{text(lang, "거래처", "Vendor", "取引先")}</th>
              <th>{text(lang, "카테고리", "Category", "カテゴリ")}</th>
              <th style={{ textAlign: "right" }}>{text(lang, "금액", "Amount", "金額")}</th>
              <th>{text(lang, "상태", "Status", "ステータス")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={7}><EmptyState>{text(lang, "가져온 카드 사용내역이 없습니다.", "No statement rows imported.", "取り込まれたカード利用明細はありません。")}</EmptyState></td></tr>
            ) : rows.map((row) => {
              const canCreateClaim = row.match_status === "missing" || row.match_status === "pre_approval_matched"
              const reason = row.reconciliation?.reason ? titleCase(row.reconciliation.reason) : ""
              return (
                <tr key={row.id}>
                  <td>{row.transaction_date || compactDate(row.created_at)}</td>
                  <td>
                    <strong>{row.cardholder_name || text(lang, "알 수 없음", "Unknown", "不明")}</strong>
                    <div className="line-2">{row.cardholder_member_id || text(lang, "직원 매핑 없음", "No member mapping", "従業員の紐付けなし")}{row.card_last4 ? ` - ${row.card_last4}` : ""}</div>
                  </td>
                  <td><strong>{row.vendor}</strong></td>
                  <td>{titleCase(row.category)}</td>
                  <td style={{ textAlign: "right", fontWeight: 850 }}>{money(amountOf(row), row.currency)}</td>
                  <td>
                    <StatusPill state={row.match_status} />
                    {row.match_pre_approval_id ? <div className="line-2">{text(lang, `사전승인 #${row.match_pre_approval_id}`, `Pre-spend #${row.match_pre_approval_id}`, `事前承認 #${row.match_pre_approval_id}`)}</div> : null}
                    {reason ? <div className="line-2">{reason}</div> : null}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {canCreateClaim ? (
                      <button className="button" type="button" disabled={saving} onClick={() => void createClaimFromStatement(row.id)}>
                        {text(lang, "정산 생성", "Create claim", "精算を作成")}
                      </button>
                    ) : row.match_claim_id ? (
                      <span className="line-2">{text(lang, `정산 #${row.match_claim_id}`, `Claim #${row.match_claim_id}`, `精算 #${row.match_claim_id}`)}</span>
                    ) : row.match_status === "duplicate" && row.reconciliation?.duplicate_of_statement_row_id ? (
                      <span className="line-2">{text(lang, `중복 행 #${row.reconciliation.duplicate_of_statement_row_id}`, `Duplicate row #${row.reconciliation.duplicate_of_statement_row_id}`, `重複行 #${row.reconciliation.duplicate_of_statement_row_id}`)}</span>
                    ) : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ClaimsTable({
  lang,
  claims,
  loading,
  expandedClaimId,
  setExpandedClaimId,
  decide,
  resubmit,
  saving,
  canDelegate,
  activeMemberId,
  memberLabel,
}: {
  lang: Lang
  claims: Claim[]
  loading: boolean
  expandedClaimId: number | null
  setExpandedClaimId: (id: number | null) => void
  decide: (claimId: number, action: "approved" | "rejected", memo?: string) => Promise<void>
  resubmit: (claimId: number, businessPurpose: string, comment: string, missingReceiptReason?: string, invoiceEvidence?: Partial<Record<InvoiceEvidenceKey, string | null | undefined>>) => Promise<boolean>
  saving: boolean
  /* Whether this member may decide a claim they are NOT the named approver on
     -- the backend's `admin_delegate_override` path, which owners and admins
     have. It is a capability of the person, not of the page they are looking
     at, which is exactly what the old `showActions` flag got wrong. */
  canDelegate: boolean
  activeMemberId: string
  memberLabel: (memberId?: string | null) => string
}) {
  const [receiptPreview, setReceiptPreview] = useState<{ url: string; name: string } | null>(null)
  const [rejectDraft, setRejectDraft] = useState<{ claim: Claim; reason: string; note: string } | null>(null)
  /* Only set when the backend will demand a memo -- an admin deciding a claim
     someone else is named on. The assigned approver approves in one click. */
  const [approveDraft, setApproveDraft] = useState<{ claim: Claim; memo: string } | null>(null)
  const [resubmitDraft, setResubmitDraft] = useState<ResubmitDraft | null>(null)
  /* Mirrors backend decide_claim(): the named pending approver may decide, and
     so may an owner/admin as a delegate. Everything else the backend refuses --
     a settled claim, a policy block, or approving your own spend. */
  function decisionRoleFor(claim: Claim): "approver" | "delegate" | null {
    if (claim.state !== "pending") return null
    if (claim.policy_status === "blocked") return null
    if (String(claim.requester_member_id) === String(activeMemberId)) return null
    const pendingSteps = claim.steps.filter((step) => step.state === "pending")
    if (pendingSteps.length === 0) return null
    if (pendingSteps.some((step) => String(step.approver_member_id ?? "") === String(activeMemberId))) return "approver"
    return canDelegate ? "delegate" : null
  }

  const previewKind = receiptPreview ? receiptPreviewKind(receiptPreview.url) : "download"
  const selectedRejectReason = rejectDraft ? rejectionReasons.find((item) => item.value === rejectDraft.reason) : null
  const rejectMemo = rejectDraft
    ? rejectDraft.reason === "custom"
      ? rejectDraft.note.trim()
      : [selectedRejectReason ? text(lang, selectedRejectReason.ko, selectedRejectReason.en, selectedRejectReason.ja) : "", rejectDraft.note.trim()].filter(Boolean).join("\n")
    : ""
  async function submitRejection() {
    if (!rejectDraft || !rejectMemo.trim()) return
    await decide(rejectDraft.claim.id, "rejected", rejectMemo)
    setRejectDraft(null)
  }
  async function submitDelegatedApproval() {
    if (!approveDraft || !approveDraft.memo.trim()) return
    await decide(approveDraft.claim.id, "approved", approveDraft.memo.trim())
    setApproveDraft(null)
  }
  async function submitResubmission() {
    if (!resubmitDraft || !resubmitDraft.businessPurpose.trim() || !resubmitDraft.comment.trim()) return
    const ok = await resubmit(resubmitDraft.claim.id, resubmitDraft.businessPurpose, resubmitDraft.comment, resubmitDraft.missingReceiptReason, resubmitDraft)
    if (ok) setResubmitDraft(null)
  }
  if (loading) return <div className="card"><EmptyState>{text(lang, "정산을 불러오는 중입니다...", "Loading claims...", "精算を読み込んでいます...")}</EmptyState></div>
  if (claims.length === 0) return <div className="card"><EmptyState>{text(lang, "정산 내역이 없습니다.", "No settlement claims found.", "精算履歴はありません。")}</EmptyState></div>
  return (
    <>
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{text(lang, "일자", "Date", "日付")}</th>
                <th>{text(lang, "신청자", "Requester", "申請者")}</th>
                <th>{text(lang, "거래처", "Vendor", "取引先")}</th>
                <th>{text(lang, "카테고리", "Category", "カテゴリ")}</th>
                <th style={{ textAlign: "right" }}>{text(lang, "금액", "Amount", "金額")}</th>
                <th>{text(lang, "상태", "Status", "ステータス")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {claims.map((claim) => {
                const isOpen = expandedClaimId === claim.id
                const receiptUrl = browserSafeReceiptUrl(claim.receipt_file_url)
                const canResubmit = (claim.state === "rejected" || claim.state === "needs_info") && claim.requester_member_id === activeMemberId
                const decisionRole = decisionRoleFor(claim)
                return (
                  <Fragment key={claim.id}>
                    <tr className="clickable" onClick={() => setExpandedClaimId(isOpen ? null : claim.id)}>
                      <td>{compactDate(claim.created_at)}</td>
                      <td>
                        <strong>{claim.requester_name}</strong>
                        <div className="line-2">{claim.requester_member_id}</div>
                      </td>
                      <td>
                        <strong>{claim.vendor}</strong>
                        <div className="line-2">{claim.receipt_file_url ? text(lang, "증빙 첨부", "Receipt attached", "証憑添付済み") : text(lang, "증빙 없음", "No receipt", "証憑なし")}</div>
                      </td>
                      <td>{titleCase(claim.category)}</td>
                      <td style={{ textAlign: "right", fontWeight: 850 }}>{money(amountOf(claim), claim.currency)}</td>
                      <td>
                        <StatusPill state={claim.state} />
                        <div style={{ marginTop: 4 }}><span className={`pill ${policyTone(claim.policy_status)}`}>{policyLabel(claim.policy_status)}</span></div>
                      </td>
                      <td style={{ textAlign: "right" }}>{isOpen ? text(lang, "열림", "Open", "表示中") : text(lang, "보기", "View", "表示")}</td>
                    </tr>
                    {isOpen && (
                      <tr className="detail-row">
                        <td colSpan={7}>
                          <div className="approval-detail">
                            <div className="detail-box">
                              <div className="card-title">{text(lang, "정산 상세", "Settlement detail", "精算の詳細")}</div>
                              <p className="page-desc" style={{ marginTop: 8 }}>{claim.business_purpose}</p>
                              {claim.approval_snapshot.warnings?.length ? (
                                <div className="warning" style={{ marginTop: 12 }}>{claim.approval_snapshot.warnings.join(" ")}</div>
                              ) : null}
                              <PolicyPanel lang={lang} claim={claim} />
                              <RejectionHistoryPanel lang={lang} claim={claim} />
                              <div className="actions" style={{ marginTop: 14 }}>
                                {decisionRole && (
                                  <>
                                    <button
                                      className="button"
                                      type="button"
                                      disabled={saving}
                                      onClick={() =>
                                        decisionRole === "delegate"
                                          ? setApproveDraft({ claim, memo: "" })
                                          : void decide(claim.id, "approved")
                                      }
                                    >
                                      {text(lang, "승인", "Approve", "承認")}
                                    </button>
                                    <button className="button-danger" type="button" disabled={saving} onClick={() => setRejectDraft({ claim, reason: rejectionReasons[0]?.value ?? "custom", note: "" })}>
                                      {text(lang, "반려", "Reject", "差し戻し")}
                                    </button>
                                    {decisionRole === "delegate" && (
                                      <span className="line-2">{text(lang, "지정 결재자 대신 승인합니다", "Deciding on behalf of the named approver", "指定の決裁者に代わって承認します")}</span>
                                    )}
                                  </>
                                )}
                                {canResubmit ? (
	                                  <button className="button" type="button" disabled={saving} onClick={() => setResubmitDraft(resubmitDraftFromClaim(claim))}>
                                    {text(lang, "수정 후 재상신", "Edit and resubmit", "修正して再申請")}
                                  </button>
                                ) : null}
                                {receiptUrl ? (
                                  <button className="button-secondary" type="button" onClick={() => setReceiptPreview({ url: receiptUrl, name: receiptFileName(receiptUrl) })}>
                                    {text(lang, "증빙 보기", "View receipt", "証憑を表示")}
                                  </button>
                                ) : claim.receipt_file_url ? (
                                  <span className="button-secondary">{text(lang, "로컬 증빙 URL 사용 불가", "Local receipt URL unavailable", "ローカルの証憑URLは利用できません")}</span>
                                ) : null}
                              </div>
                            </div>
                            <div className="detail-box">
                              <div className="card-title">{text(lang, "결재선", "Approval line", "決裁ルート")}</div>
                              <div className="approval-line" style={{ marginTop: 12 }}>
                                {claim.steps.length === 0 ? (
                                  <EmptyState>{text(lang, "저장된 결재 단계가 없습니다.", "No approval steps stored.", "保存された決裁ステップはありません。")}</EmptyState>
                                ) : (
                                  claim.steps.map((step) => (
                                    <div className="approval-step" key={step.id}>
                                      <span className="approval-index">{step.step_order}</span>
                                      <div>
                                        <div className="line-1">{step.approver_name}</div>
                                        <div className="line-2">{step.approver_title || titleCase(step.reason)}</div>
                                        {step.resolver_source ? <div className="line-2">{step.resolver_source}</div> : null}
                                        {/* Who actually decided, which is not always who was named: an
                                            owner/admin can decide in the named approver's place, and a
                                            line that showed only the name would credit the wrong person. */}
                                        {step.decided_by_member_id ? (() => {
                                          const onBehalf =
                                            !!step.approver_member_id &&
                                            String(step.decided_by_member_id) !== String(step.approver_member_id)
                                          /* When the named approver signed it themselves the step already
                                             carries their display name, which beats resolving the id against
                                             a roster that may not list them. */
                                          const decider = onBehalf
                                            ? memberLabel(step.decided_by_member_id)
                                            : step.approver_name || memberLabel(step.decided_by_member_id)
                                          const verb = step.state === "rejected"
                                            ? text(lang, "반려", "Rejected", "差し戻し")
                                            : text(lang, "승인", "Approved", "承認済み")
                                          return (
                                            <div className="approval-decider">
                                              <span className="approval-decider-who">
                                                {text(lang, `${verb} · ${decider}`, `${verb} by ${decider}`, `${verb} · ${decider}`)}
                                              </span>
                                              {step.decided_at ? (
                                                <span className="approval-decider-when"> · {compactDate(step.decided_at)}</span>
                                              ) : null}
                                              {onBehalf ? (
                                                <span className="approval-delegated">
                                                  {text(lang, `${step.approver_name} 대리`, `on behalf of ${step.approver_name}`, `${step.approver_name} の代理`)}
                                                </span>
                                              ) : null}
                                            </div>
                                          )
                                        })() : null}
                                        {step.decision_memo ? <div className="approval-memo">{step.decision_memo}</div> : null}
                                      </div>
                                      <StatusPill state={step.state} />
                                    </div>
                                  ))
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
      {receiptPreview && (
        <div className="modal-backdrop" role="presentation" onClick={() => setReceiptPreview(null)}>
          <div className="modal-panel" role="dialog" aria-modal="true" aria-label={text(lang, "증빙 미리보기", "Receipt preview", "証憑のプレビュー")} onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div className="modal-title">{receiptPreview.name}</div>
              <div className="modal-actions">
                <a className="button-secondary" href={`${receiptPreview.url}?download=1`}>
                  {text(lang, "다운로드", "Download", "ダウンロード")}
                </a>
                <a className="button-secondary" href={receiptPreview.url} target="_blank" rel="noreferrer">
                  {text(lang, "새 탭", "New tab", "新しいタブ")}
                </a>
                <button className="button-secondary" type="button" onClick={() => setReceiptPreview(null)}>
                  {text(lang, "닫기", "Close", "閉じる")}
                </button>
              </div>
            </div>
            <div className="receipt-preview">
              {previewKind === "image" ? (
                <img src={receiptPreview.url} alt={receiptPreview.name} />
              ) : previewKind === "pdf" ? (
                <iframe src={receiptPreview.url} title={receiptPreview.name} />
              ) : (
                <EmptyState>{text(lang, "이 파일 형식은 미리보기를 지원하지 않습니다. 다운로드해서 확인하세요.", "This file type cannot be previewed. Download it to view.", "このファイル形式はプレビューに対応していません。ダウンロードしてご確認ください。")}</EmptyState>
              )}
            </div>
          </div>
        </div>
      )}
      {approveDraft && (
        <div className="modal-backdrop" role="presentation" onClick={() => setApproveDraft(null)}>
          <div className="modal-panel" role="dialog" aria-modal="true" aria-label={text(lang, "대리 승인 사유", "Approve on behalf", "代理承認の理由")} onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div>
                <div className="modal-title">{text(lang, "대리 승인", "Approve on behalf", "代理承認")}</div>
                <div className="modal-note">{approveDraft.claim.vendor} · {money(amountOf(approveDraft.claim), approveDraft.claim.currency)}</div>
              </div>
              <button className="button-secondary" type="button" onClick={() => setApproveDraft(null)}>
                {text(lang, "닫기", "Close", "閉じる")}
              </button>
            </div>
            <div className="modal-form">
              <label className="field">
                {text(lang, "승인 사유", "Reason for approving", "承認理由")}
                <textarea
                  className="textarea"
                  value={approveDraft.memo}
                  onChange={(event) => setApproveDraft((current) => current ? { ...current, memo: event.target.value } : current)}
                  placeholder={text(lang, "지정 결재자를 대신해 승인하는 이유를 남기세요.", "Say why you are deciding instead of the named approver.", "指定の決裁者に代わって承認する理由を入力してください。")}
                />
              </label>
              <div className="modal-note">
                {text(
                  lang,
                  "대리 승인은 결재 기록에 승인자와 사유가 함께 남습니다.",
                  "A delegated approval is recorded against you, with this reason, on the approval line.", "代理承認では、承認者と理由が決裁記録に残ります。",
                )}
              </div>
              <div className="modal-actions">
                <button className="button-secondary" type="button" onClick={() => setApproveDraft(null)}>
                  {text(lang, "취소", "Cancel", "キャンセル")}
                </button>
                <button
                  className="button"
                  type="button"
                  /* The backend rejects a delegated approval with no memo, so
                     the button stays disabled until there is one. */
                  disabled={saving || !approveDraft.memo.trim()}
                  onClick={() => void submitDelegatedApproval()}
                >
                  {text(lang, "승인 확정", "Approve", "承認を確定")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {rejectDraft && (
        <div className="modal-backdrop" role="presentation" onClick={() => setRejectDraft(null)}>
          <div className="modal-panel" role="dialog" aria-modal="true" aria-label={text(lang, "반려 사유 입력", "Reject settlement", "差し戻し理由の入力")} onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div>
                <div className="modal-title">{text(lang, "정산 반려", "Reject settlement", "精算の差し戻し")}</div>
                <div className="modal-note">{rejectDraft.claim.vendor} · {money(amountOf(rejectDraft.claim), rejectDraft.claim.currency)}</div>
              </div>
              <button className="button-secondary" type="button" onClick={() => setRejectDraft(null)}>
                {text(lang, "닫기", "Close", "閉じる")}
              </button>
            </div>
            <div className="modal-form">
              <label className="field">
                {text(lang, "반려 사유", "Rejection reason", "差し戻し理由")}
                <select className="select" value={rejectDraft.reason} onChange={(event) => setRejectDraft((current) => current ? { ...current, reason: event.target.value } : current)}>
                  {rejectionReasons.map((item) => (
                    <option value={item.value} key={item.value}>{text(lang, item.ko, item.en, item.ja)}</option>
                  ))}
                  <option value="custom">{text(lang, "직접 입력", "Custom response", "直接入力")}</option>
                </select>
              </label>
              <label className="field">
                {rejectDraft.reason === "custom" ? text(lang, "반려 메시지", "Rejection message", "差し戻しメッセージ") : text(lang, "추가 의견", "Additional note", "追加コメント")}
                <textarea
                  className="textarea"
                  value={rejectDraft.note}
                  onChange={(event) => setRejectDraft((current) => current ? { ...current, note: event.target.value } : current)}
                  placeholder={text(lang, "수정해야 할 내용을 구체적으로 작성하세요.", "Add specific correction details.", "修正が必要な内容を具体的に入力してください。")}
                />
              </label>
              <div className="modal-actions">
                <button className="button-secondary" type="button" onClick={() => setRejectDraft(null)}>
                  {text(lang, "취소", "Cancel", "キャンセル")}
                </button>
                <button className="button-danger" type="button" disabled={saving || !rejectMemo.trim()} onClick={() => void submitRejection()}>
                  {text(lang, "반려 확정", "Reject", "差し戻しを確定")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {resubmitDraft && (
        <ResubmitModal
          lang={lang}
          draft={resubmitDraft}
          setDraft={setResubmitDraft}
          saving={saving}
          onSubmit={submitResubmission}
        />
      )}
    </>
  )
}

function ResubmitModal({
  lang,
  draft,
  setDraft,
  saving,
  onSubmit,
}: {
  lang: Lang
  draft: ResubmitDraft
  setDraft: (value: ResubmitDraft | null | ((current: ResubmitDraft | null) => ResubmitDraft | null)) => void
  saving: boolean
  onSubmit: () => Promise<void>
}) {
  const locality = normalizeEmployeeLocality(draft.claim.employee_locality)
  const localCurrency = currencyForLocality(locality) || draft.claim.currency
  const requiresFx = Boolean(locality && draft.claim.currency !== localCurrency)
  const evidenceFields = invoiceFieldsFor(locality, draft.claim.currency)
  return (
    <div className="modal-backdrop" role="presentation" onClick={() => setDraft(null)}>
      <div className="modal-panel" role="dialog" aria-modal="true" aria-label={text(lang, "정산 재상신", "Resubmit settlement", "精算の再申請")} onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="modal-title">{text(lang, "수정 후 재상신", "Edit and resubmit", "修正して再申請")}</div>
            <div className="modal-note">{draft.claim.vendor} · {money(amountOf(draft.claim), draft.claim.currency)}</div>
          </div>
          <button className="button-secondary" type="button" onClick={() => setDraft(null)}>
            {text(lang, "닫기", "Close", "閉じる")}
          </button>
        </div>
        <div className="modal-form">
          <RejectionHistoryPanel lang={lang} claim={draft.claim} compact />
          <label className="field">
            {text(lang, "업무 목적 및 소명", "Business purpose and explanation", "業務目的と説明")}
            <textarea
              className="textarea"
              value={draft.businessPurpose}
              onChange={(event) => setDraft((current) => current ? { ...current, businessPurpose: event.target.value } : current)}
              placeholder={text(lang, "업무 목적, 참석자, 프로젝트, 고액 사용 사유를 보완하세요.", "Add purpose, attendees, project, and high-value justification.", "業務目的、参加者、プロジェクト、高額利用の理由を補足してください。")}
            />
          </label>
          <label className="field">
            {text(lang, "재상신 코멘트", "Resubmission comment", "再申請コメント")}
            <textarea
              className="textarea"
              value={draft.comment}
              onChange={(event) => setDraft((current) => current ? { ...current, comment: event.target.value } : current)}
              placeholder={text(lang, "수정한 내용을 결재자가 바로 이해할 수 있게 남기세요.", "Summarize what changed for the approver.", "修正内容を決裁者がすぐに理解できるよう記入してください。")}
            />
          </label>
          {!draft.claim.receipt_file_url ? (
            <label className="field">
              {text(lang, "영수증 없음 사유", "Missing receipt declaration", "領収書がない理由")}
              <textarea
                className="textarea"
                value={draft.missingReceiptReason}
                onChange={(event) => setDraft((current) => current ? { ...current, missingReceiptReason: event.target.value } : current)}
                placeholder={text(lang, "영수증을 첨부할 수 없는 사유를 남기세요.", "Explain why a receipt cannot be attached.", "領収書を添付できない理由を入力してください。")}
              />
            </label>
          ) : null}
          <div className="field wide">
            <span>{text(lang, locality === "IN" ? "인도 인보이스 증빙" : locality === "KR" ? "한국 증빙" : "지역별 증빙", locality === "IN" ? "India invoice evidence" : locality === "KR" ? "Korea receipt evidence" : "Locality evidence", locality === "IN" ? "インドのインボイス証憑" : locality === "KR" ? "韓国の証憑" : "地域別の証憑")}</span>
            <span className="field-note">
              {requiresFx ? text(lang, "외화 사용은 환율 증빙이 필요합니다.", "Foreign-currency spend requires FX evidence.", "外貨での利用には為替レートの証憑が必要です。") : text(lang, `정수 단위 ${draft.claim.currency} 금액`, `Whole-unit ${draft.claim.currency} amount.`, `整数単位の${draft.claim.currency}金額`)}
            </span>
          </div>
          {!locality ? (
            <div className="warning">{text(lang, "조직 멤버의 지역 정보가 없으면 재상신이 차단됩니다.", "Resubmission is blocked until the org member has a supported locality.", "組織メンバーの地域情報がない場合、再申請はできません。")}</div>
          ) : null}
          {evidenceFields.map((field) => (
            <label className="field" key={field.key}>
              {text(lang, field.ko, field.en, field.ja)}
              <input
                className="input"
                type={field.type || "text"}
                value={draft[field.key] || ""}
                onChange={(event) => setDraft((current) => current ? { ...current, [field.key]: event.target.value } : current)}
              />
            </label>
          ))}
          <div className="modal-actions">
            <button className="button-secondary" type="button" onClick={() => setDraft(null)}>
              {text(lang, "취소", "Cancel", "キャンセル")}
            </button>
            <button className="button" type="button" disabled={saving || !draft.businessPurpose.trim() || !draft.comment.trim() || (!draft.claim.receipt_file_url && !draft.missingReceiptReason.trim())} onClick={() => void onSubmit()}>
              {text(lang, "재상신", "Resubmit", "再申請")}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function RejectionHistoryPanel({
  lang,
  claim,
  compact = false,
  defaultOpen = false,
}: {
  lang: Lang
  claim: Claim
  compact?: boolean
  defaultOpen?: boolean
}) {
  const currentRejection = latestRejectionMemo(claim)
  const history = claimHistory(claim)
  const [open, setOpen] = useState(defaultOpen)
  const [page, setPage] = useState(0)
  if (!currentRejection && history.length === 0) return null

  const pageSize = 4
  const totalPages = Math.max(1, Math.ceil(history.length / pageSize))
  const safePage = Math.min(page, totalPages - 1)
  const pagedHistory = history.slice(safePage * pageSize, safePage * pageSize + pageSize)
  const historyLabel = history.length === 1 ? text(lang, "이력 1건", "1 history item", "履歴 1件") : text(lang, `이력 ${history.length}건`, `${history.length} history items`, `履歴 ${history.length}件`)

  return (
    <div className={`rejection-panel ${compact ? "compact" : ""}`}>
      <button className="rejection-toggle" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span>
          <span className="rejection-title">{text(lang, "반려 및 재상신 이력", "Rejection and resubmission history", "差し戻し・再申請の履歴")}</span>
          <span className="rejection-text">{currentRejection || historyLabel}</span>
        </span>
        <span className="pill danger">{open ? text(lang, "접기", "Collapse", "折りたたむ") : text(lang, "보기", "View", "表示")}</span>
      </button>
      {open ? (
        <div className="rejection-body">
          {currentRejection ? (
            <div>
              <div className="rejection-title">{text(lang, "현재 반려 사유", "Current rejection reason", "現在の差し戻し理由")}</div>
              <div className="rejection-text">{currentRejection}</div>
            </div>
          ) : null}
          {history.length ? (
            <div>
              <div className="rejection-title">{text(lang, "이전 처리 이력", "Previous history", "過去の処理履歴")}</div>
              {pagedHistory.map((item, index) => {
                const priorRejections = rejectedSteps(item.previous_steps)
                return (
                  <div className="history-entry" key={`${item.at ?? "history"}-${safePage}-${index}`}>
                    <div className="line-1">
                      {text(lang, "재상신", "Resubmitted", "再申請")}
                      {item.at ? ` · ${compactDate(item.at)}` : ""}
                    </div>
                    {item.comment ? <div className="rejection-text">{item.comment}</div> : null}
                    {item.previous_business_purpose ? (
                      <div className="approval-memo">{text(lang, "이전 소명: ", "Previous explanation: ", "過去の説明: ")}{item.previous_business_purpose}</div>
                    ) : null}
                    {priorRejections.map((step) => (
                      <div className="approval-memo" key={step.id}>
                        {text(lang, "이전 반려 사유: ", "Previous rejection: ", "過去の差し戻し理由: ")}{step.decision_memo}
                      </div>
                    ))}
                  </div>
                )
              })}
              {history.length > pageSize ? (
                <div className="pager-row">
                  <button className="button-secondary" type="button" disabled={safePage === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>
                    {text(lang, "이전", "Prev", "前へ")}
                  </button>
                  <span className="pager-label">{safePage + 1} / {totalPages}</span>
                  <button className="button-secondary" type="button" disabled={safePage >= totalPages - 1} onClick={() => setPage((value) => Math.min(totalPages - 1, value + 1))}>
                    {text(lang, "다음", "Next", "次へ")}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
