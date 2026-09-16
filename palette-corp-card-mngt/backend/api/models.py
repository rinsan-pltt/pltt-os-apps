from sqlalchemy import Boolean, DateTime, Float, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from palette_sdk.db import OrgScopedTable


class CorporateCard(OrgScopedTable):
    __tablename__ = "corporate_card_system__cards"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    member_id: Mapped[str] = mapped_column(String(128), index=True, nullable=False)
    member_name: Mapped[str] = mapped_column(String(200), nullable=False)
    label: Mapped[str] = mapped_column(String(160), nullable=False)
    last4: Mapped[str] = mapped_column(String(4), nullable=False)
    monthly_limit_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    status: Mapped[str] = mapped_column(String(40), default="active", index=True, nullable=False)
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[str] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class SettlementClaim(OrgScopedTable):
    __tablename__ = "corporate_card_system__settlement_claims"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    requester_member_id: Mapped[str] = mapped_column(String(128), index=True, nullable=False)
    requester_name: Mapped[str] = mapped_column(String(200), nullable=False)
    vendor: Mapped[str] = mapped_column(String(240), nullable=False)
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str] = mapped_column(String(12), default="KRW", nullable=False)
    employee_locality: Mapped[str | None] = mapped_column(String(12), nullable=True)
    tax_amount_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    tax_type: Mapped[str | None] = mapped_column(String(40), nullable=True)
    tax_rate_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    tax_included: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    supplier_gstin: Mapped[str | None] = mapped_column(String(32), nullable=True)
    supplier_business_registration_number: Mapped[str | None] = mapped_column(String(40), nullable=True)
    supplier_legal_name: Mapped[str | None] = mapped_column(String(240), nullable=True)
    invoice_number: Mapped[str | None] = mapped_column(String(80), nullable=True)
    invoice_date: Mapped[str | None] = mapped_column(String(40), nullable=True)
    place_of_supply: Mapped[str | None] = mapped_column(String(120), nullable=True)
    payment_method: Mapped[str | None] = mapped_column(String(80), nullable=True)
    fx_evidence_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    fx_evidence_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    cash_receipt_reference: Mapped[str | None] = mapped_column(String(120), nullable=True)
    category: Mapped[str] = mapped_column(String(80), default="general", nullable=False)
    business_purpose: Mapped[str] = mapped_column(Text, nullable=False)
    transaction_date: Mapped[str | None] = mapped_column(String(40), nullable=True)
    card_last4: Mapped[str | None] = mapped_column(String(4), nullable=True)
    cost_center: Mapped[str | None] = mapped_column(String(80), nullable=True)
    project_code: Mapped[str | None] = mapped_column(String(80), nullable=True)
    attendees_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    receipt_file_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    receipt_status: Mapped[str] = mapped_column(String(40), default="missing", nullable=False)
    missing_receipt_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    pre_approval_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    policy_status: Mapped[str] = mapped_column(String(40), default="warning", index=True, nullable=False)
    policy_evaluation_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    erp_export_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    state: Mapped[str] = mapped_column(String(40), default="pending", index=True, nullable=False)
    approval_snapshot_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[str] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class ApprovalStep(OrgScopedTable):
    __tablename__ = "corporate_card_system__approval_steps"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    claim_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    step_order: Mapped[int] = mapped_column(Integer, nullable=False)
    approver_member_id: Mapped[str | None] = mapped_column(String(128), index=True, nullable=True)
    approver_name: Mapped[str] = mapped_column(String(200), nullable=False)
    approver_title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    reason: Mapped[str] = mapped_column(String(120), nullable=False)
    source: Mapped[str] = mapped_column(String(80), default="local_json_hierarchy", nullable=False)
    resolver_source: Mapped[str] = mapped_column(String(120), default="local_json_hierarchy", nullable=False)
    state: Mapped[str] = mapped_column(String(40), default="pending", index=True, nullable=False)
    decision_memo: Mapped[str | None] = mapped_column(Text, nullable=True)
    decision_source: Mapped[str] = mapped_column(String(80), default="assigned_approver", nullable=False)
    decided_by_member_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    decided_at: Mapped[str | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PreSpendRequest(OrgScopedTable):
    __tablename__ = "corporate_card_system__pre_spend_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    requester_member_id: Mapped[str] = mapped_column(String(128), index=True, nullable=False)
    requester_name: Mapped[str] = mapped_column(String(200), nullable=False)
    request_type: Mapped[str] = mapped_column(String(40), default="purchase", index=True, nullable=False)
    vendor: Mapped[str] = mapped_column(String(240), nullable=False)
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str] = mapped_column(String(12), default="KRW", nullable=False)
    employee_locality: Mapped[str | None] = mapped_column(String(12), nullable=True)
    supplier_gstin: Mapped[str | None] = mapped_column(String(32), nullable=True)
    supplier_business_registration_number: Mapped[str | None] = mapped_column(String(40), nullable=True)
    supplier_legal_name: Mapped[str | None] = mapped_column(String(240), nullable=True)
    invoice_number: Mapped[str | None] = mapped_column(String(80), nullable=True)
    invoice_date: Mapped[str | None] = mapped_column(String(40), nullable=True)
    place_of_supply: Mapped[str | None] = mapped_column(String(120), nullable=True)
    payment_method: Mapped[str | None] = mapped_column(String(80), nullable=True)
    fx_evidence_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    fx_evidence_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    cash_receipt_reference: Mapped[str | None] = mapped_column(String(120), nullable=True)
    category: Mapped[str] = mapped_column(String(80), default="general", nullable=False)
    business_purpose: Mapped[str] = mapped_column(Text, nullable=False)
    expected_purchase_date: Mapped[str | None] = mapped_column(String(40), nullable=True)
    trip_area: Mapped[str | None] = mapped_column(String(240), nullable=True)
    trip_start_date: Mapped[str | None] = mapped_column(String(40), nullable=True)
    trip_end_date: Mapped[str | None] = mapped_column(String(40), nullable=True)
    budget_items_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    cost_center: Mapped[str | None] = mapped_column(String(80), nullable=True)
    project_code: Mapped[str | None] = mapped_column(String(80), nullable=True)
    attendees_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    state: Mapped[str] = mapped_column(String(40), default="pending", index=True, nullable=False)
    approval_snapshot_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    policy_evaluation_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    linked_claim_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    decided_by_member_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    decision_memo: Mapped[str | None] = mapped_column(Text, nullable=True)
    decided_at: Mapped[str | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[str] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class PolicyRule(OrgScopedTable):
    __tablename__ = "corporate_card_system__policy_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    category: Mapped[str] = mapped_column(String(80), default="general", nullable=False)
    threshold_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    action: Mapped[str] = mapped_column(String(80), default="require_approval", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True, nullable=False)
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CardStatementUpload(OrgScopedTable):
    __tablename__ = "corporate_card_system__statement_uploads"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    filename: Mapped[str] = mapped_column(String(240), nullable=False)
    row_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    matched_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    missing_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    uploaded_by_member_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CardStatementRow(OrgScopedTable):
    __tablename__ = "corporate_card_system__statement_rows"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    upload_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    transaction_date: Mapped[str | None] = mapped_column(String(40), nullable=True)
    card_last4: Mapped[str | None] = mapped_column(String(4), nullable=True)
    cardholder_member_id: Mapped[str | None] = mapped_column(String(128), index=True, nullable=True)
    cardholder_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    vendor: Mapped[str] = mapped_column(String(240), nullable=False)
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str] = mapped_column(String(12), default="KRW", nullable=False)
    category: Mapped[str] = mapped_column(String(80), default="general", nullable=False)
    match_status: Mapped[str] = mapped_column(String(40), default="missing", index=True, nullable=False)
    match_claim_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    match_pre_approval_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reconciliation_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    raw_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ErpExport(OrgScopedTable):
    __tablename__ = "corporate_card_system__erp_exports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    filename: Mapped[str] = mapped_column(String(240), nullable=False)
    row_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_amount_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    generated_by_member_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PolicyQuestion(OrgScopedTable):
    __tablename__ = "corporate_card_system__policy_questions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    asked_by_member_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    answer: Mapped[str] = mapped_column(Text, nullable=False)
    source: Mapped[str] = mapped_column(String(80), default="local_policy", nullable=False)
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now())


class RoleAssignment(OrgScopedTable):
    __tablename__ = "corporate_card_system__role_assignments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    member_id: Mapped[str] = mapped_column(String(128), index=True, nullable=False)
    app_role: Mapped[str] = mapped_column(String(40), default="STAFF", index=True, nullable=False)
    permissions_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    assigned_by_member_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    assigned_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now())
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[str] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )
