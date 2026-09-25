"""Corporate card management backend for Palette OS."""

import csv
import base64
import calendar
import io
import json
import mimetypes
import os
import re
import asyncio
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from fastapi import Depends, File, Form, HTTPException, Query, Request as FastAPIRequest, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, select, text

from palette_sdk import PluginContext, PluginRouter, get_plugin_context, require_permission
from palette_sdk.services import services
from models import (
    ApprovalStep,
    CardStatementRow,
    CardStatementUpload,
    CorporateCard,
    ErpExport,
    MemberLocality,
    PolicyQuestion,
    PolicyRule,
    PreSpendRequest,
    RoleAssignment,
    SettlementClaim,
)
from services.hierarchy_approval_service import (
    SOURCE as HIERARCHY_APPROVAL_SOURCE,
)
from services.hierarchy_route_service import (
    CorporateCardHierarchyRouteService,
    ORGX_ROUTE_PREVIEW_TARGET as HIERARCHY_ROUTE_PREVIEW_TARGET,
    ORGX_ROUTE_RESOLVE_TARGET as HIERARCHY_ROUTE_RESOLVE_TARGET,
)
from services.approval_workflow_service import (
    APPROVAL_APPROVED,
    APPROVAL_REJECTED,
    APPROVAL_RESUBMITTED,
    ApprovalWorkflowService,
)
from services.storage_paths import RECEIPTS, input_folder
from services.talk_service import TalkNotifier
from services.receipt_storage_service import (
    PlatformReceiptStorage,
    local_receipt_storage,
    should_use_platform_storage,
)

router = PluginRouter(tags=["corporate-card-system"])

READ = [require_permission("resources:read")]
WRITE = [require_permission("resources:write")]
MEMBERS_READ = [require_permission("members:read")]
CHAT_WRITE = [require_permission("chat:write")]
POLICY_ASK_TARGET = "policy/v1#ask"
POLICY_SEARCH_TARGET = "policy/v1#search"
POLICY_DOMAIN = "corporate_card"
DEFAULT_COUNTRY = "KR"
TIMELY_SUBMISSION_DAYS = 60
STATEMENT_MATCH_DATE_WINDOW_DAYS = 3
PRE_SPEND_MATCH_DATE_WINDOW_DAYS = 45
STATEMENT_NEEDS_CLAIM_STATUSES = {"missing", "pre_approval_matched"}
TAX_RATE_TOLERANCE_CENTS = 10
TAX_RATE_TOLERANCE_RATIO = 0.02
MAX_APPROVAL_STEPS = 3
POLICY_PROFILES = {
    "IN": {"currency": "INR", "tax_type": "GST", "version": "corporate-card-IN-v1"},
    "KR": {"currency": "KRW", "tax_type": "VAT", "version": "corporate-card-KR-v1"},
}
LOCALITY_ALIASES = {
    "IN": "IN",
    "IND": "IN",
    "INDIA": "IN",
    "BHARAT": "IN",
    "KR": "KR",
    "KO": "KR",
    "KOR": "KR",
    "KOREA": "KR",
    "SOUTH KOREA": "KR",
    "REPUBLIC OF KOREA": "KR",
}
# Cities and the place-name half of an IANA timezone ("Asia/Seoul"), consulted
# ONLY after every country name and code has failed to match. Two reasons this
# is a separate table rather than more rows in the one above:
#
#   1. It is a guess. "Seoul" means the person is almost certainly in Korea;
#      "KR" means they are. Keeping them apart lets an explicit country
#      anywhere in a string beat a city inferred from the same string, so
#      "India House, Seoul" resolves to IN rather than to whichever token the
#      matcher happened to reach first.
#   2. The resolved locality is shown on the claim ("Employee locality KR"), so
#      a wrong guess is visible to the person filing rather than silent -- but
#      it is still a guess, and worth reading as one.
#
# Names are matched as whole words after punctuation is stripped, which is what
# makes the `timezone` field usable at last: "Asia/Kolkata" normalises to
# "ASIA KOLKATA", and KOLKATA is below. Before this it matched nothing.
LOCALITY_CITY_ALIASES = {
    # KR
    "SEOUL": "KR", "BUSAN": "KR", "PUSAN": "KR", "INCHEON": "KR", "DAEGU": "KR",
    "DAEJEON": "KR", "GWANGJU": "KR", "ULSAN": "KR", "SEJONG": "KR", "SUWON": "KR",
    "SEONGNAM": "KR", "BUNDANG": "KR", "PANGYO": "KR", "GANGNAM": "KR",
    "YONGIN": "KR", "GOYANG": "KR", "ANYANG": "KR", "BUCHEON": "KR",
    "CHEONGJU": "KR", "JEONJU": "KR", "POHANG": "KR", "CHANGWON": "KR", "JEJU": "KR",
    # IN
    "MUMBAI": "IN", "BOMBAY": "IN", "DELHI": "IN", "GURGAON": "IN", "GURUGRAM": "IN",
    "NOIDA": "IN", "BENGALURU": "IN", "BANGALORE": "IN", "HYDERABAD": "IN",
    "CHENNAI": "IN", "MADRAS": "IN", "KOLKATA": "IN", "CALCUTTA": "IN",
    "PUNE": "IN", "AHMEDABAD": "IN", "JAIPUR": "IN", "KOCHI": "IN", "COCHIN": "IN",
    "ERNAKULAM": "IN", "THIRUVANANTHAPURAM": "IN", "TRIVANDRUM": "IN",
    "CHANDIGARH": "IN", "INDORE": "IN", "NAGPUR": "IN", "SURAT": "IN",
    "LUCKNOW": "IN", "COIMBATORE": "IN", "VISAKHAPATNAM": "IN",
    "BHUBANESWAR": "IN", "MYSURU": "IN", "MYSORE": "IN", "VADODARA": "IN",
    "BARODA": "IN", "NASHIK": "IN", "GANDHINAGAR": "IN",
}
TAX_PROFILES = {
    "KRW": {"type": "VAT", "default_rate": 10.0, "allowed_rates": {0.0, 10.0}},
    "INR": {"type": "GST", "default_rate": 18.0, "allowed_rates": {0.0, 5.0, 12.0, 18.0, 28.0, 40.0}},
}
PROHIBITED_CATEGORIES = {"personal", "cash_advance", "cash_equivalent", "gift_card", "weapons"}
RESTRICTED_CATEGORIES = {"equipment", "software", "travel", "entertainment"}
CONTEXT_REQUIRED_CATEGORIES = {"meals", "meeting_expense", "entertainment", "travel"}
PRE_SPEND_REQUEST_TYPES = {"purchase", "business_trip"}
BUSINESS_TRIP_BUDGET_TOLERANCE_RATIO = 0.15
BUSINESS_TRIP_BUDGET_TOLERANCE_MIN_CENTS = 1_000
# App roles are the organisation roles Palette OS already assigns — viewer,
# member, admin, owner — so a person's standing in the org is the single source
# of truth and there is no second role vocabulary to keep in sync. An admin or
# owner can still override the app role for one member; the default is whatever
# the platform says.
APP_ROLES = {"viewer", "member", "admin", "owner"}
DEFAULT_APP_ROLE = "member"
ROLE_MANAGER_ROLES = {"admin", "owner"}
_MEMBER_PERMISSIONS = [
    "submit_claim",
    "request_pre_spend",
    "view_own_claims",
    "view_history",
    "view_members",
    "ask_policy",
]
APP_ROLE_PERMISSIONS = {
    # Read-only standing: own settlements, own row in the member list, policy Q&A.
    "viewer": ["view_own_claims", "view_members", "ask_policy"],
    # Everyday cardholder.
    "member": list(_MEMBER_PERMISSIONS),
    # Approves, monitors, reconciles, exports, and assigns app roles.
    "admin": [
        *_MEMBER_PERMISSIONS,
        "approve_claims",
        "monitor_team",
        "monitor_spend",
        "view_bi",
        "manage_statements",
        "export_erp",
        "manage_roles",
    ],
}
# Owner is admin plus org ownership, which the app itself does not act on.
APP_ROLE_PERMISSIONS["owner"] = list(APP_ROLE_PERMISSIONS["admin"])
APP_PERMISSION_SET = {permission for permissions in APP_ROLE_PERMISSIONS.values() for permission in permissions}
CLAIM_TAX_SCHEMA_CHECKED = False


class ClaimIn(BaseModel):
    vendor: str = Field(min_length=1, max_length=240)
    amount: int | None = Field(default=None, gt=0)
    amount_cents: int | None = Field(default=None, gt=0)
    currency: str = Field(default="KRW", max_length=12)
    tax_amount: int | None = Field(default=None, ge=0)
    tax_amount_cents: int | None = Field(default=None, ge=0)
    tax_type: str | None = Field(default=None, max_length=40)
    tax_rate_percent: float | None = Field(default=None, ge=0, le=100)
    tax_included: bool = True
    supplier_gstin: str | None = Field(default=None, max_length=32)
    supplier_business_registration_number: str | None = Field(default=None, max_length=40)
    supplier_legal_name: str | None = Field(default=None, max_length=240)
    invoice_number: str | None = Field(default=None, max_length=80)
    invoice_date: str | None = Field(default=None, max_length=40)
    place_of_supply: str | None = Field(default=None, max_length=120)
    payment_method: str | None = Field(default=None, max_length=80)
    fx_evidence_url: str | None = None
    fx_evidence_description: str | None = None
    cash_receipt_reference: str | None = Field(default=None, max_length=120)
    category: str = Field(default="general", max_length=80)
    business_purpose: str = Field(min_length=1)
    requester_name: str = Field(min_length=1, max_length=200)
    transaction_date: str | None = Field(default=None, max_length=40)
    card_last4: str | None = Field(default=None, max_length=4)
    cost_center: str | None = Field(default=None, max_length=80)
    project_code: str | None = Field(default=None, max_length=80)
    attendees: list[str] = Field(default_factory=list)
    receipt_file_url: str | None = None
    receipt_status: str | None = Field(default=None, max_length=40)
    missing_receipt_reason: str | None = None
    pre_approval_id: int | None = None
    policy_status: str | None = None
    policy_evaluation: dict[str, Any] = Field(default_factory=dict)
    receipt_analysis: dict[str, Any] = Field(default_factory=dict)
    approval_snapshot: dict[str, Any] = Field(default_factory=dict)


class DecisionIn(BaseModel):
    action: str = Field(pattern="^(approved|rejected)$")
    memo: str | None = None


class ResubmitClaimIn(BaseModel):
    business_purpose: str = Field(min_length=1)
    comment: str = Field(min_length=1, max_length=3000)
    receipt_file_url: str | None = None
    receipt_status: str | None = Field(default=None, max_length=40)
    missing_receipt_reason: str | None = None
    cost_center: str | None = Field(default=None, max_length=80)
    project_code: str | None = Field(default=None, max_length=80)
    attendees: list[str] = Field(default_factory=list)
    pre_approval_id: int | None = None
    supplier_gstin: str | None = Field(default=None, max_length=32)
    supplier_business_registration_number: str | None = Field(default=None, max_length=40)
    supplier_legal_name: str | None = Field(default=None, max_length=240)
    invoice_number: str | None = Field(default=None, max_length=80)
    invoice_date: str | None = Field(default=None, max_length=40)
    place_of_supply: str | None = Field(default=None, max_length=120)
    payment_method: str | None = Field(default=None, max_length=80)
    fx_evidence_url: str | None = None
    fx_evidence_description: str | None = None
    cash_receipt_reference: str | None = Field(default=None, max_length=120)


class CardIn(BaseModel):
    member_id: str = Field(min_length=1, max_length=128)
    member_name: str = Field(min_length=1, max_length=200)
    label: str = Field(min_length=1, max_length=160)
    last4: str = Field(pattern=r"^\d{4}$")
    monthly_limit: int | None = Field(default=None, ge=0)
    monthly_limit_cents: int | None = Field(default=None, ge=0)


class StatementRowIn(BaseModel):
    transaction_date: str | None = Field(default=None, max_length=40)
    card_last4: str | None = Field(default=None, max_length=4)
    cardholder_member_id: str | None = Field(default=None, max_length=128)
    cardholder_name: str | None = Field(default=None, max_length=200)
    vendor: str = Field(min_length=1, max_length=240)
    amount_cents: int | None = None
    amount: str | int | float | None = None
    currency: str = Field(default="KRW", max_length=12)
    category: str = Field(default="general", max_length=80)


class StatementUploadIn(BaseModel):
    filename: str = Field(default="statement.csv", max_length=240)
    csv_text: str | None = None
    rows: list[StatementRowIn] = Field(default_factory=list)


class PolicyQuestionIn(BaseModel):
    question: str = Field(min_length=2, max_length=2000)
    lang: str = Field(default="en", max_length=12)
    category: str | None = Field(default=None, max_length=80)
    domain: str = Field(default=POLICY_DOMAIN, max_length=80)
    country: str = Field(default=DEFAULT_COUNTRY, max_length=12)


class MemberLocalityIn(BaseModel):
    # Free text on purpose: "KR", "Korea", "Seoul", "Asia/Kolkata" all resolve
    # through the same alias table the profile fields use. Empty clears it.
    locality: str = Field(default="", max_length=160)


class AssistantTurn(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(min_length=1, max_length=4000)


class AssistantIn(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    lang: str = Field(default="en", max_length=12)
    # The last few turns, so follow-ups ("what about the second one?") resolve.
    history: list[AssistantTurn] = Field(default_factory=list)


class ApprovalPathRequest(BaseModel):
    requester_member_id: str | None = Field(default=None, max_length=128)
    amount: int | None = Field(default=None, ge=0)
    amount_cents: int | None = Field(default=None, ge=0)
    currency: str = Field(default="KRW", max_length=12)
    tax_amount: int | None = Field(default=None, ge=0)
    tax_amount_cents: int | None = Field(default=None, ge=0)
    tax_type: str | None = Field(default=None, max_length=40)
    tax_rate_percent: float | None = Field(default=None, ge=0, le=100)
    tax_included: bool = True
    supplier_gstin: str | None = Field(default=None, max_length=32)
    supplier_business_registration_number: str | None = Field(default=None, max_length=40)
    supplier_legal_name: str | None = Field(default=None, max_length=240)
    invoice_number: str | None = Field(default=None, max_length=80)
    invoice_date: str | None = Field(default=None, max_length=40)
    place_of_supply: str | None = Field(default=None, max_length=120)
    payment_method: str | None = Field(default=None, max_length=80)
    fx_evidence_url: str | None = None
    fx_evidence_description: str | None = None
    cash_receipt_reference: str | None = Field(default=None, max_length=120)
    category: str | None = Field(default=None, max_length=80)
    workflow_type: str = Field(default="corporate_card_settlement", max_length=120)
    vendor: str | None = Field(default=None, max_length=240)
    business_purpose: str | None = None
    transaction_date: str | None = Field(default=None, max_length=40)
    card_last4: str | None = Field(default=None, max_length=4)
    cost_center: str | None = Field(default=None, max_length=80)
    project_code: str | None = Field(default=None, max_length=80)
    attendees: list[str] = Field(default_factory=list)
    receipt_file_url: str | None = None
    receipt_status: str | None = Field(default=None, max_length=40)
    missing_receipt_reason: str | None = None
    pre_approval_id: int | None = None
    policy_evaluation: dict[str, Any] = Field(default_factory=dict)


class PreSpendBudgetItemIn(BaseModel):
    category: str = Field(min_length=1, max_length=80)
    label: str | None = Field(default=None, max_length=120)
    amount: int | None = Field(default=None, ge=0)
    amount_cents: int | None = Field(default=None, ge=0)


class PreSpendRequestIn(BaseModel):
    vendor: str | None = Field(default=None, max_length=240)
    request_type: str = Field(default="purchase", pattern="^(purchase|business_trip)$")
    amount: int | None = Field(default=None, gt=0)
    amount_cents: int | None = Field(default=None, gt=0)
    currency: str = Field(default="KRW", max_length=12)
    supplier_gstin: str | None = Field(default=None, max_length=32)
    supplier_business_registration_number: str | None = Field(default=None, max_length=40)
    supplier_legal_name: str | None = Field(default=None, max_length=240)
    invoice_number: str | None = Field(default=None, max_length=80)
    invoice_date: str | None = Field(default=None, max_length=40)
    place_of_supply: str | None = Field(default=None, max_length=120)
    payment_method: str | None = Field(default=None, max_length=80)
    fx_evidence_url: str | None = None
    fx_evidence_description: str | None = None
    cash_receipt_reference: str | None = Field(default=None, max_length=120)
    category: str = Field(default="general", max_length=80)
    business_purpose: str = Field(min_length=1)
    requester_name: str = Field(min_length=1, max_length=200)
    expected_purchase_date: str | None = Field(default=None, max_length=40)
    trip_area: str | None = Field(default=None, max_length=240)
    trip_start_date: str | None = Field(default=None, max_length=40)
    trip_end_date: str | None = Field(default=None, max_length=40)
    budget_items: list[PreSpendBudgetItemIn] = Field(default_factory=list)
    cost_center: str | None = Field(default=None, max_length=80)
    project_code: str | None = Field(default=None, max_length=80)
    attendees: list[str] = Field(default_factory=list)


class LinkPreSpendIn(BaseModel):
    claim_id: int


class RoleAssignmentIn(BaseModel):
    app_role: str = Field(pattern="^(viewer|member|admin|owner)$")
    permissions: list[str] | None = None


GEMINI_FLASH_LITE_MODEL = "gemini-3.5-flash-lite"
SUPPORTED_RECEIPT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
    "application/pdf",
}
MAX_RECEIPT_UPLOAD_BYTES = 12 * 1024 * 1024
SAFE_FILENAME_RE = re.compile(r"[^A-Za-z0-9._-]+")

RECEIPT_ANALYSIS_SCHEMA: dict[str, Any] = {
    "document_type": "receipt | invoice | tax_invoice | card_slip | unknown",
    "language": "detected document language",
    "confidence": 0.0,
    "merchant": {"name": None, "business_number": None, "address": None, "phone": None, "tax_id": None},
    "document": {
        "invoice_number": None,
        "receipt_number": None,
        "transaction_date": None,
        "currency": None,
        "payment_method": None,
        "card_last4": None,
    },
    "amounts": {
        "subtotal": None,
        "discount": None,
        "tax": None,
        "tip": None,
        "shipping": None,
        "service_charge": None,
        "total": None,
        "paid": None,
        "balance_due": None,
    },
    "line_items": [
        {
            "row_number": 1,
            "description": None,
            "category": None,
            "tags": [],
            "quantity": None,
            "unit": None,
            "unit_price": None,
            "tax_amount": None,
            "line_total": None,
            "confidence": 0.0,
        }
    ],
    "category_summary": [{"category": None, "amount": None, "tags": []}],
    "corporate_card_hints": {
        "suggested_account_code": None,
        "suggested_account_name": None,
        "allocation_required": False,
        "allocation_reason": None,
        "policy_flags": [],
    },
    "extraction_warnings": [],
    "raw_text": "important OCR text only, not a full verbose dump",
}


def _json_loads(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return value if isinstance(value, dict) else {}


def _json_list(raw: str | None) -> list[Any]:
    if not raw:
        return []
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        return []
    return value if isinstance(value, list) else []


def _json_dumps(value: dict[str, Any] | None) -> str:
    return json.dumps(value or {}, ensure_ascii=False, separators=(",", ":"))


def _json_dumps_list(value: list[Any] | None) -> str:
    return json.dumps(value or [], ensure_ascii=False, separators=(",", ":"))


def _clean_optional_text(value: str | None) -> str | None:
    cleaned = str(value or "").strip()
    return cleaned or None


def _coalesce_amount(*values: Any, field_name: str = "amount", allow_zero: bool = False) -> int:
    for value in values:
        if value is None:
            continue
        amount = _amount_to_units(value)
        if amount > 0 or (allow_zero and amount == 0):
            return amount
    minimum = "non-negative" if allow_zero else "positive"
    raise HTTPException(status_code=400, detail=f"{field_name} must be a {minimum} whole-unit amount")


def _amount_to_units(value: str | int | float | None) -> int:
    if value is None:
        return 0
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return round(value)
    cleaned = value.strip()
    if not cleaned:
        return 0
    negative = cleaned.startswith("(") and cleaned.endswith(")")
    cleaned = cleaned.replace(",", "")
    cleaned = re.sub(r"[^0-9.\-]", "", cleaned)
    if cleaned in {"", "-", "."}:
        return 0
    amount = round(float(cleaned))
    return abs(amount) if negative else amount


def _payload_amount(payload: Any, *, allow_zero: bool = False) -> int:
    return _coalesce_amount(
        getattr(payload, "amount", None),
        getattr(payload, "amount_cents", None),
        field_name="amount",
        allow_zero=allow_zero,
    )


def _payload_tax_amount(payload: Any) -> int:
    value = getattr(payload, "tax_amount", None)
    legacy_value = getattr(payload, "tax_amount_cents", None)
    if value is None and legacy_value is None:
        return 0
    return _coalesce_amount(value, legacy_value, field_name="tax_amount", allow_zero=True)


def _payload_monthly_limit(payload: Any) -> int:
    value = getattr(payload, "monthly_limit", None)
    legacy_value = getattr(payload, "monthly_limit_cents", None)
    if value is None and legacy_value is None:
        return 0
    return _coalesce_amount(value, legacy_value, field_name="monthly_limit", allow_zero=True)


INVOICE_EVIDENCE_FIELDS = (
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
)


def _invoice_evidence_from_payload(payload: Any) -> dict[str, str | None]:
    return {field: _clean_optional_text(getattr(payload, field, None)) for field in INVOICE_EVIDENCE_FIELDS}


def _invoice_evidence_from_model(item: Any) -> dict[str, str | None]:
    return {field: _clean_optional_text(getattr(item, field, None)) for field in INVOICE_EVIDENCE_FIELDS}


def _assign_invoice_evidence(item: Any, evidence: dict[str, str | None]) -> None:
    for field in INVOICE_EVIDENCE_FIELDS:
        setattr(item, field, evidence.get(field))


def _has_fx_evidence(evidence: dict[str, str | None]) -> bool:
    return bool(evidence.get("fx_evidence_url") or evidence.get("fx_evidence_description"))


def _invoice_evidence_dict(item: Any) -> dict[str, str | None]:
    return _invoice_evidence_from_model(item)


def _card_dict(card: CorporateCard) -> dict[str, Any]:
    return {
        "id": card.id,
        "member_id": card.member_id,
        "member_name": card.member_name,
        "label": card.label,
        "last4": card.last4,
        "monthly_limit": card.monthly_limit_cents,
        "monthly_limit_cents": card.monthly_limit_cents,
        "status": card.status,
        "created_at": card.created_at.isoformat() if hasattr(card.created_at, "isoformat") else str(card.created_at),
    }


def _claim_dict(claim: SettlementClaim, steps: list[ApprovalStep] | None = None) -> dict[str, Any]:
    return {
        "id": claim.id,
        "requester_member_id": claim.requester_member_id,
        "requester_name": claim.requester_name,
        "vendor": claim.vendor,
        "amount": claim.amount_cents,
        "amount_cents": claim.amount_cents,
        "currency": claim.currency,
        "employee_locality": claim.employee_locality,
        "tax_amount": claim.tax_amount_cents,
        "tax_amount_cents": claim.tax_amount_cents,
        "tax_type": claim.tax_type,
        "tax_rate_percent": claim.tax_rate_percent,
        "tax_included": claim.tax_included,
        "invoice_evidence": _invoice_evidence_dict(claim),
        **_invoice_evidence_dict(claim),
        "category": claim.category,
        "business_purpose": claim.business_purpose,
        "transaction_date": claim.transaction_date,
        "card_last4": claim.card_last4,
        "cost_center": claim.cost_center,
        "project_code": claim.project_code,
        "attendees": _json_list(claim.attendees_json),
        "receipt_file_url": claim.receipt_file_url,
        "receipt_status": claim.receipt_status,
        "missing_receipt_reason": claim.missing_receipt_reason,
        "pre_approval_id": claim.pre_approval_id,
        "policy_status": claim.policy_status,
        "policy_evaluation": _json_loads(claim.policy_evaluation_json),
        "erp_export_id": claim.erp_export_id,
        "state": claim.state,
        "approval_snapshot": _json_loads(claim.approval_snapshot_json),
        "created_at": claim.created_at.isoformat() if hasattr(claim.created_at, "isoformat") else str(claim.created_at),
        "steps": [_step_dict(step) for step in steps] if steps is not None else [],
    }


def _step_dict(step: ApprovalStep) -> dict[str, Any]:
    return {
        "id": step.id,
        "claim_id": step.claim_id,
        "step_order": step.step_order,
        "approver_member_id": step.approver_member_id,
        "approver_name": step.approver_name,
        "approver_title": step.approver_title,
        "reason": step.reason,
        "source": step.source,
        "resolver_source": step.resolver_source,
        "state": step.state,
        "decision_memo": step.decision_memo,
        "decision_source": step.decision_source,
        "decided_by_member_id": step.decided_by_member_id,
        "decided_at": step.decided_at.isoformat() if step.decided_at else None,
    }


def _pre_spend_dict(item: PreSpendRequest) -> dict[str, Any]:
    return {
        "id": item.id,
        "requester_member_id": item.requester_member_id,
        "requester_name": item.requester_name,
        "request_type": item.request_type,
        "vendor": item.vendor,
        "amount": item.amount_cents,
        "amount_cents": item.amount_cents,
        "currency": item.currency,
        "employee_locality": item.employee_locality,
        "invoice_evidence": _invoice_evidence_dict(item),
        **_invoice_evidence_dict(item),
        "category": item.category,
        "business_purpose": item.business_purpose,
        "expected_purchase_date": item.expected_purchase_date,
        "trip_area": item.trip_area,
        "trip_start_date": item.trip_start_date,
        "trip_end_date": item.trip_end_date,
        "budget_items": _json_list(item.budget_items_json),
        "cost_center": item.cost_center,
        "project_code": item.project_code,
        "attendees": _json_list(item.attendees_json),
        "state": item.state,
        "approval_snapshot": _json_loads(item.approval_snapshot_json),
        "policy_evaluation": _json_loads(item.policy_evaluation_json),
        "linked_claim_id": item.linked_claim_id,
        "decided_by_member_id": item.decided_by_member_id,
        "decision_memo": item.decision_memo,
        "decided_at": item.decided_at.isoformat() if item.decided_at else None,
        "created_at": item.created_at.isoformat() if hasattr(item.created_at, "isoformat") else str(item.created_at),
    }


def _statement_upload_dict(upload: CardStatementUpload) -> dict[str, Any]:
    return {
        "id": upload.id,
        "filename": upload.filename,
        "row_count": upload.row_count,
        "matched_count": upload.matched_count,
        "missing_count": upload.missing_count,
        "uploaded_by_member_id": upload.uploaded_by_member_id,
        "created_at": upload.created_at.isoformat() if hasattr(upload.created_at, "isoformat") else str(upload.created_at),
    }


def _statement_row_dict(row: CardStatementRow) -> dict[str, Any]:
    return {
        "id": row.id,
        "upload_id": row.upload_id,
        "transaction_date": row.transaction_date,
        "card_last4": row.card_last4,
        "cardholder_member_id": row.cardholder_member_id,
        "cardholder_name": row.cardholder_name,
        "vendor": row.vendor,
        "amount": row.amount_cents,
        "amount_cents": row.amount_cents,
        "currency": row.currency,
        "category": row.category,
        "match_status": row.match_status,
        "match_claim_id": row.match_claim_id,
        "match_pre_approval_id": row.match_pre_approval_id,
        "reconciliation": _json_loads(row.reconciliation_json),
        "raw": _json_loads(row.raw_json),
        "created_at": row.created_at.isoformat() if hasattr(row.created_at, "isoformat") else str(row.created_at),
    }


def _erp_export_dict(export: ErpExport) -> dict[str, Any]:
    return {
        "id": export.id,
        "filename": export.filename,
        "row_count": export.row_count,
        "total_amount": export.total_amount_cents,
        "total_amount_cents": export.total_amount_cents,
        "generated_by_member_id": export.generated_by_member_id,
        "created_at": export.created_at.isoformat() if hasattr(export.created_at, "isoformat") else str(export.created_at),
    }


def _policy_question_dict(item: PolicyQuestion) -> dict[str, Any]:
    return {
        "id": item.id,
        "asked_by_member_id": item.asked_by_member_id,
        "question": item.question,
        "answer": item.answer,
        "source": item.source,
        "created_at": item.created_at.isoformat() if hasattr(item.created_at, "isoformat") else str(item.created_at),
    }


def _role_permissions(app_role: str, requested: list[str] | None = None) -> list[str]:
    default_permissions = APP_ROLE_PERMISSIONS.get(app_role, APP_ROLE_PERMISSIONS[DEFAULT_APP_ROLE])
    raw_permissions = requested if requested is not None else default_permissions
    cleaned = []
    for permission in raw_permissions:
        normalized = str(permission or "").strip()
        if normalized in APP_PERMISSION_SET and normalized not in cleaned:
            cleaned.append(normalized)
    return cleaned or list(default_permissions)


def _normalized_app_role(value: Any) -> str:
    """An organisation role string as one of the app's four roles."""
    role = str(value or "").strip().lower()
    return role if role in APP_ROLES else DEFAULT_APP_ROLE


def _default_app_role_for_member(member: dict[str, Any]) -> str:
    """The member's organisation role, which is the app role until overridden."""
    return _normalized_app_role(member.get("role"))


def _role_assignment_dict(item: RoleAssignment) -> dict[str, Any]:
    return {
        "id": item.id,
        "member_id": item.member_id,
        "app_role": item.app_role,
        "permissions": _json_list(item.permissions_json),
        "assigned_by_member_id": item.assigned_by_member_id,
        "assigned_at": item.assigned_at.isoformat() if hasattr(item.assigned_at, "isoformat") else str(item.assigned_at),
        "created_at": item.created_at.isoformat() if hasattr(item.created_at, "isoformat") else str(item.created_at),
        "updated_at": item.updated_at.isoformat() if hasattr(item.updated_at, "isoformat") else str(item.updated_at),
    }


async def _role_assignments(ctx: PluginContext) -> list[RoleAssignment]:
    stmt = (
        select(RoleAssignment)
        .where(RoleAssignment.organization_id == ctx.organization_id)
        .order_by(RoleAssignment.member_id)
    )
    return list((await ctx.db.execute(stmt)).scalars().all())


async def _role_assignment_for_member(ctx: PluginContext, member_id: str) -> RoleAssignment | None:
    stmt = select(RoleAssignment).where(
        RoleAssignment.organization_id == ctx.organization_id,
        RoleAssignment.member_id == member_id,
    )
    return (await ctx.db.execute(stmt)).scalar_one_or_none()


def _enrich_members_with_app_roles(members: list[dict[str, Any]], assignments: list[RoleAssignment]) -> list[dict[str, Any]]:
    by_member = {assignment.member_id: assignment for assignment in assignments}
    enriched = []
    for member in members:
        row = dict(member)
        assignment = by_member.get(str(row.get("id") or ""))
        app_role = assignment.app_role if assignment else _default_app_role_for_member(row)
        row["app_role"] = app_role
        row["app_permissions"] = _role_permissions(app_role, _json_list(assignment.permissions_json) if assignment else None)
        row["app_role_source"] = "assigned" if assignment else "default"
        row["assigned_by_member_id"] = assignment.assigned_by_member_id if assignment else None
        row["assigned_at"] = assignment.assigned_at.isoformat() if assignment and hasattr(assignment.assigned_at, "isoformat") else (str(assignment.assigned_at) if assignment else None)
        enriched.append(row)
    return enriched


async def _organization_members(ctx: PluginContext) -> list[dict[str, Any]]:
    try:
        return await ctx.members.list()
    except RuntimeError:
        # No platform member service (the local simulator). The signed-in user
        # is the only member this runtime can honestly report.
        return _current_user_as_member(ctx)


def _member_by_id(members: list[dict[str, Any]], member_id: str) -> dict[str, Any] | None:
    return next((member for member in members if str(member.get("id") or "") == member_id), None)


def _normalize_employee_locality(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, dict):
        for key in ("country_code", "country", "code", "name", "locality", "location"):
            normalized = _normalize_employee_locality(value.get(key))
            if normalized:
                return normalized
        return None
    cleaned = re.sub(r"[^A-Za-z ]+", " ", str(value or "")).strip().upper()
    if not cleaned:
        return None
    compact = re.sub(r"\s+", " ", cleaned)
    if compact in LOCALITY_ALIASES:
        return LOCALITY_ALIASES[compact]
    # An ordered list, not a set: with a set, a string carrying two matchable
    # words resolved to whichever one iteration happened to reach first, which
    # is arbitrary. Reading left to right makes the answer reproducible.
    words = [word for word in compact.split(" ") if word]
    for word in words:
        if word in LOCALITY_ALIASES:
            return LOCALITY_ALIASES[word]
    if "SOUTH KOREA" in compact or "REPUBLIC OF KOREA" in compact:
        return "KR"
    if "INDIA" in compact:
        return "IN"
    # Last resort. Every country name and code above has already failed, so a
    # city is the only signal left.
    if compact in LOCALITY_CITY_ALIASES:
        return LOCALITY_CITY_ALIASES[compact]
    for word in words:
        if word in LOCALITY_CITY_ALIASES:
            return LOCALITY_CITY_ALIASES[word]
    return None


def _member_locality(member: dict[str, Any] | None) -> str | None:
    if not member:
        return None
    for key in (
        "country_code",
        "country",
        "locality",
        "location",
        "office_country",
        "office_location",
        "work_location",
        "region",
        "timezone",
    ):
        normalized = _normalize_employee_locality(member.get(key))
        if normalized:
            return normalized
    profile = member.get("profile")
    if isinstance(profile, dict):
        normalized = _member_locality(profile)
        if normalized:
            return normalized
    return None


async def _member_locality_overrides(ctx: PluginContext) -> dict[str, MemberLocality]:
    rows = await ctx.repo(MemberLocality).list(limit=500)
    # Newest row wins if a member somehow has more than one.
    latest: dict[str, MemberLocality] = {}
    for row in sorted(rows, key=lambda r: r.id):
        latest[str(row.member_id)] = row
    return latest


async def _employee_locality(ctx: PluginContext, member_id: str) -> tuple[str | None, dict[str, Any] | None]:
    members = await _organization_members(ctx)
    member = _member_by_id(members, member_id)
    platform_locality = _member_locality(member)
    if platform_locality:
        return platform_locality, member
    # The platform profile said nothing usable, so fall back to what an admin
    # recorded in this app. Deliberately second: when the SDK starts carrying a
    # country, it wins automatically and these rows stop mattering.
    override = (await _member_locality_overrides(ctx)).get(str(member_id))
    return (override.locality if override else None), member


def _policy_profile_for_locality(locality: str | None) -> dict[str, str] | None:
    if not locality:
        return None
    return POLICY_PROFILES.get(locality)


def _can_manage_role_assignments(ctx: PluginContext, acting_member_id: str) -> bool:
    """Admins and owners manage app roles; an app-role override counts too."""
    return _normalized_app_role(ctx.org_role) in ROLE_MANAGER_ROLES


def _coerce_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    cleaned = str(value).strip()
    if not cleaned:
        return None
    if cleaned.endswith("Z"):
        cleaned = f"{cleaned[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(cleaned)
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
    except ValueError:
        return None


def _claim_monitoring_date(claim: SettlementClaim) -> datetime:
    parsed = _parse_transaction_date(claim.transaction_date)
    if parsed:
        return parsed
    created_at = _coerce_datetime(claim.created_at)
    return created_at or datetime.now(UTC)


def _period_row(period: str) -> dict[str, Any]:
    return {
        "period": period,
        "claims": 0,
        "spend_cents": 0,
        "approved_cents": 0,
        "pending_cents": 0,
        "blocked": 0,
        "exceptions": 0,
        "missing_receipts": 0,
    }


def _add_spend_aliases(row: dict[str, Any]) -> dict[str, Any]:
    aliases = {
        "spend_cents": "spend",
        "approved_cents": "approved",
        "pending_cents": "pending",
        "current_month_cents": "current_month",
        "projected_month_spend_cents": "projected_month_spend",
    }
    for legacy_key, next_key in aliases.items():
        if legacy_key in row and next_key not in row:
            row[next_key] = row[legacy_key]
    return row


def _policy_finding_items(claim: SettlementClaim) -> list[dict[str, Any]]:
    evaluation = _json_loads(claim.policy_evaluation_json)
    items: list[dict[str, Any]] = []
    seen_codes: set[str] = set()
    sources = (
        ("hard_blocks", "blocked"),
        ("required_actions", "action"),
        ("warnings", "warning"),
    )
    for key, default_severity in sources:
        raw_items = evaluation.get(key)
        if not isinstance(raw_items, list):
            continue
        for raw in raw_items:
            if isinstance(raw, dict):
                code = str(raw.get("code") or raw.get("message") or key).strip() or key
                if code in seen_codes:
                    continue
                seen_codes.add(code)
                items.append(
                    {
                        "code": code,
                        "severity": str(raw.get("severity") or default_severity),
                        "message": str(raw.get("message") or code),
                    }
                )
            elif isinstance(raw, str) and raw.strip() and raw not in seen_codes:
                seen_codes.add(raw)
                items.append({"code": raw, "severity": default_severity, "message": raw})
    if claim.receipt_status != "attached" and "missing_receipt" not in seen_codes:
        items.append(
            {
                "code": "missing_receipt",
                "severity": "blocked" if claim.policy_status == "blocked" else "warning",
                "message": "Receipt is missing or has only a declaration.",
            }
        )
    if claim.state == "needs_info" and "needs_info" not in seen_codes:
        items.append(
            {
                "code": "needs_info",
                "severity": "action",
                "message": "Requester must add missing business context or evidence.",
            }
        )
    return items


def _claim_has_risk(claim: SettlementClaim) -> bool:
    return (
        claim.state in {"needs_info", "rejected"}
        or claim.policy_status in {"blocked", "warning", "exception_required"}
        or claim.receipt_status != "attached"
        or bool(_policy_finding_items(claim))
    )


def _monitoring_payload(
    *,
    claims: list[SettlementClaim],
    statement_rows: list[CardStatementRow],
    pre_spend_requests: list[PreSpendRequest],
) -> dict[str, Any]:
    now = datetime.now(UTC)
    today = now.date()
    days_in_month = calendar.monthrange(now.year, now.month)[1]
    day_of_month = max(today.day, 1)
    days_in_year = 366 if calendar.isleap(now.year) else 365
    day_of_year = max(now.timetuple().tm_yday, 1)
    current_month = f"{now.year}-{now.month:02d}"
    current_year = str(now.year)
    month_rows: dict[str, dict[str, Any]] = {}
    year_rows: dict[str, dict[str, Any]] = {}
    employees: dict[str, dict[str, Any]] = {}
    categories: dict[str, dict[str, Any]] = {}
    findings: dict[str, dict[str, Any]] = {}
    current_month_spend = 0
    current_year_spend = 0
    current_month_risk_claims = 0
    seven_days_ago = now - timedelta(days=7)
    exception_statuses = {"warning", "exception_required", "exception_approved"}

    for claim in claims:
        amount = int(claim.amount_cents or 0)
        claim_dt = _claim_monitoring_date(claim)
        month = f"{claim_dt.year}-{claim_dt.month:02d}"
        year = str(claim_dt.year)
        is_missing_receipt = claim.receipt_status != "attached"
        is_exception = claim.policy_status in exception_statuses
        month_row = month_rows.setdefault(month, _period_row(month))
        year_row = year_rows.setdefault(year, _period_row(year))
        for row in (month_row, year_row):
            row["claims"] += 1
            row["spend_cents"] += amount
            if claim.state == "approved":
                row["approved_cents"] += amount
            if claim.state == "pending":
                row["pending_cents"] += amount
            if claim.policy_status == "blocked":
                row["blocked"] += 1
            if is_exception:
                row["exceptions"] += 1
            if is_missing_receipt:
                row["missing_receipts"] += 1

        if month == current_month:
            current_month_spend += amount
            if _claim_has_risk(claim):
                current_month_risk_claims += 1
        if year == current_year:
            current_year_spend += amount

        employee_id = claim.requester_member_id or claim.requester_name or "unknown"
        employee = employees.setdefault(
            employee_id,
            {
                "member_id": employee_id,
                "name": claim.requester_name or employee_id,
                "claims": 0,
                "spend_cents": 0,
                "approved_cents": 0,
                "pending_cents": 0,
                "blocked": 0,
                "warnings": 0,
                "exceptions": 0,
                "missing_receipts": 0,
                "late_claims": 0,
                "current_month_cents": 0,
                "projected_month_spend_cents": 0,
            },
        )
        employee["claims"] += 1
        employee["spend_cents"] += amount
        if claim.state == "approved":
            employee["approved_cents"] += amount
        if claim.state == "pending":
            employee["pending_cents"] += amount
        if claim.policy_status == "blocked":
            employee["blocked"] += 1
        if claim.policy_status == "warning":
            employee["warnings"] += 1
        if is_exception:
            employee["exceptions"] += 1
        if is_missing_receipt:
            employee["missing_receipts"] += 1
        if month == current_month:
            employee["current_month_cents"] += amount

        category_name = claim.category or "general"
        category = categories.setdefault(
            category_name,
            {
                "category": category_name,
                "claims": 0,
                "spend_cents": 0,
                "blocked": 0,
                "warnings": 0,
            },
        )
        category["claims"] += 1
        category["spend_cents"] += amount
        if claim.policy_status == "blocked":
            category["blocked"] += 1
        if is_exception:
            category["warnings"] += 1

        for item in _policy_finding_items(claim):
            code = str(item.get("code") or "policy_finding")
            bucket = findings.setdefault(
                code,
                {
                    "code": code,
                    "severity": item.get("severity") or "warning",
                    "count": 0,
                    "spend_cents": 0,
                    "sample_message": item.get("message") or code,
                },
            )
            bucket["count"] += 1
            bucket["spend_cents"] += amount
            if not bucket.get("sample_message"):
                bucket["sample_message"] = item.get("message") or code
            if code == "late_submission":
                employee["late_claims"] += 1

    for employee in employees.values():
        employee["projected_month_spend_cents"] = round(employee["current_month_cents"] / day_of_month * days_in_month)
        _add_spend_aliases(employee)
        del employee["current_month_cents"]

    monthly = sorted(month_rows.values(), key=lambda row: row["period"])[-12:]
    yearly = sorted(year_rows.values(), key=lambda row: row["period"])
    for row in [*monthly, *yearly, *employees.values(), *categories.values(), *findings.values()]:
        _add_spend_aliases(row)
    employee_rows = sorted(employees.values(), key=lambda row: (row["spend_cents"], row["claims"]), reverse=True)
    category_rows = sorted(categories.values(), key=lambda row: row["spend_cents"], reverse=True)
    finding_rows = sorted(findings.values(), key=lambda row: (row["count"], row["spend_cents"]), reverse=True)
    nonzero_months = [row for row in monthly if row["spend_cents"] > 0]
    average_monthly = round(sum(row["spend_cents"] for row in nonzero_months) / len(nonzero_months)) if nonzero_months else 0
    statement_missing = [row for row in statement_rows if row.match_status in STATEMENT_NEEDS_CLAIM_STATUSES]
    exportable_approved = [
        claim
        for claim in claims
        if claim.state == "approved"
        and claim.policy_status in {"compliant", "exception_approved"}
        and claim.erp_export_id is None
    ]
    projected_month_end = round(current_month_spend / day_of_month * days_in_month)
    projected_year_end = round(current_year_spend / day_of_year * days_in_year)
    projected_risk_next_30 = round(current_month_risk_claims / day_of_month * min(30, days_in_month))
    total_spend = sum(int(claim.amount_cents or 0) for claim in claims)
    approved_spend = sum(int(claim.amount_cents or 0) for claim in claims if claim.state == "approved")
    pending_spend = sum(int(claim.amount_cents or 0) for claim in claims if claim.state == "pending")

    return {
        "generated_at": now.isoformat(),
        "scope": "company",
        "overview": {
            "total_claims": len(claims),
            "total_spend": total_spend,
            "total_spend_cents": total_spend,
            "approved_spend": approved_spend,
            "approved_spend_cents": approved_spend,
            "pending_spend": pending_spend,
            "pending_spend_cents": pending_spend,
            "blocked_claims": sum(1 for claim in claims if claim.policy_status == "blocked"),
            "needs_info_claims": sum(1 for claim in claims if claim.state == "needs_info"),
            "missing_receipt_claims": sum(1 for claim in claims if claim.receipt_status != "attached"),
            "exception_claims": sum(1 for claim in claims if claim.policy_status in exception_statuses),
            "statement_missing_claims": len(statement_missing),
            "unexported_approved_claims": len(exportable_approved),
            "pending_over_7_days": sum(1 for claim in claims if claim.state == "pending" and _claim_monitoring_date(claim) < seven_days_ago),
            "needs_info_over_7_days": sum(1 for claim in claims if claim.state == "needs_info" and _claim_monitoring_date(claim) < seven_days_ago),
            "pre_spend_pending": sum(1 for item in pre_spend_requests if item.state == "pending"),
        },
        "monthly": monthly,
        "yearly": yearly,
        "employees": employee_rows[:100],
        "categories": category_rows[:20],
        "findings": finding_rows[:50],
        "predictions": {
            "month_to_date": current_month_spend,
            "month_to_date_cents": current_month_spend,
            "projected_month_end": projected_month_end,
            "projected_month_end_cents": projected_month_end,
            "year_to_date": current_year_spend,
            "year_to_date_cents": current_year_spend,
            "projected_year_end": projected_year_end,
            "projected_year_end_cents": projected_year_end,
            "average_monthly_spend": average_monthly,
            "average_monthly_spend_cents": average_monthly,
            "risk_claims_next_30_days": projected_risk_next_30,
            "top_employee_projection": employee_rows[0] if employee_rows else None,
        },
    }


async def _claims(ctx: PluginContext) -> list[SettlementClaim]:
    await _ensure_claim_tax_schema(ctx)
    stmt = (
        select(SettlementClaim)
        .where(SettlementClaim.organization_id == ctx.organization_id)
        .order_by(SettlementClaim.id.desc())
    )
    return list((await ctx.db.execute(stmt)).scalars().all())


async def _steps_for_claims(ctx: PluginContext, claim_ids: list[int]) -> dict[int, list[ApprovalStep]]:
    if not claim_ids:
        return {}
    stmt = (
        select(ApprovalStep)
        .where(
            ApprovalStep.organization_id == ctx.organization_id,
            ApprovalStep.claim_id.in_(claim_ids),
        )
        .order_by(ApprovalStep.claim_id, ApprovalStep.step_order)
    )
    grouped: dict[int, list[ApprovalStep]] = {}
    for step in (await ctx.db.execute(stmt)).scalars().all():
        grouped.setdefault(step.claim_id, []).append(step)
    return grouped


async def _statement_uploads(ctx: PluginContext) -> list[CardStatementUpload]:
    stmt = (
        select(CardStatementUpload)
        .where(CardStatementUpload.organization_id == ctx.organization_id)
        .order_by(CardStatementUpload.id.desc())
        .limit(50)
    )
    return list((await ctx.db.execute(stmt)).scalars().all())


async def _statement_rows(ctx: PluginContext, *, status_filter: str | None = None) -> list[CardStatementRow]:
    stmt = select(CardStatementRow).where(CardStatementRow.organization_id == ctx.organization_id)
    if status_filter:
        stmt = stmt.where(CardStatementRow.match_status == status_filter)
    stmt = stmt.order_by(CardStatementRow.id.desc()).limit(500)
    return list((await ctx.db.execute(stmt)).scalars().all())


async def _erp_exports(ctx: PluginContext) -> list[ErpExport]:
    stmt = (
        select(ErpExport)
        .where(ErpExport.organization_id == ctx.organization_id)
        .order_by(ErpExport.id.desc())
        .limit(20)
    )
    return list((await ctx.db.execute(stmt)).scalars().all())


async def _pre_spend_requests(ctx: PluginContext) -> list[PreSpendRequest]:
    await _ensure_claim_tax_schema(ctx)
    stmt = (
        select(PreSpendRequest)
        .where(PreSpendRequest.organization_id == ctx.organization_id)
        .order_by(PreSpendRequest.id.desc())
        .limit(100)
    )
    return list((await ctx.db.execute(stmt)).scalars().all())


async def _policy_questions(ctx: PluginContext) -> list[PolicyQuestion]:
    stmt = (
        select(PolicyQuestion)
        .where(PolicyQuestion.organization_id == ctx.organization_id)
        .order_by(PolicyQuestion.id.desc())
        .limit(20)
    )
    return list((await ctx.db.execute(stmt)).scalars().all())


async def _ensure_claim_tax_schema(ctx: PluginContext) -> None:
    global CLAIM_TAX_SCHEMA_CHECKED
    if CLAIM_TAX_SCHEMA_CHECKED:
        return
    try:
        bind = ctx.db.get_bind()
    except Exception:
        CLAIM_TAX_SCHEMA_CHECKED = True
        return
    if getattr(getattr(bind, "dialect", None), "name", "") != "sqlite":
        CLAIM_TAX_SCHEMA_CHECKED = True
        return

    claim_additions = [
        ("tax_amount_cents", "ALTER TABLE corporate_card_system__settlement_claims ADD COLUMN tax_amount_cents INTEGER NOT NULL DEFAULT 0"),
        ("tax_type", "ALTER TABLE corporate_card_system__settlement_claims ADD COLUMN tax_type VARCHAR(40)"),
        ("tax_rate_percent", "ALTER TABLE corporate_card_system__settlement_claims ADD COLUMN tax_rate_percent FLOAT"),
        ("tax_included", "ALTER TABLE corporate_card_system__settlement_claims ADD COLUMN tax_included BOOLEAN NOT NULL DEFAULT 1"),
        ("employee_locality", "ALTER TABLE corporate_card_system__settlement_claims ADD COLUMN employee_locality VARCHAR(12)"),
        ("supplier_gstin", "ALTER TABLE corporate_card_system__settlement_claims ADD COLUMN supplier_gstin VARCHAR(32)"),
        ("supplier_business_registration_number", "ALTER TABLE corporate_card_system__settlement_claims ADD COLUMN supplier_business_registration_number VARCHAR(40)"),
        ("supplier_legal_name", "ALTER TABLE corporate_card_system__settlement_claims ADD COLUMN supplier_legal_name VARCHAR(240)"),
        ("invoice_number", "ALTER TABLE corporate_card_system__settlement_claims ADD COLUMN invoice_number VARCHAR(80)"),
        ("invoice_date", "ALTER TABLE corporate_card_system__settlement_claims ADD COLUMN invoice_date VARCHAR(40)"),
        ("place_of_supply", "ALTER TABLE corporate_card_system__settlement_claims ADD COLUMN place_of_supply VARCHAR(120)"),
        ("payment_method", "ALTER TABLE corporate_card_system__settlement_claims ADD COLUMN payment_method VARCHAR(80)"),
        ("fx_evidence_url", "ALTER TABLE corporate_card_system__settlement_claims ADD COLUMN fx_evidence_url TEXT"),
        ("fx_evidence_description", "ALTER TABLE corporate_card_system__settlement_claims ADD COLUMN fx_evidence_description TEXT"),
        ("cash_receipt_reference", "ALTER TABLE corporate_card_system__settlement_claims ADD COLUMN cash_receipt_reference VARCHAR(120)"),
    ]
    pre_spend_additions = [
        ("employee_locality", "ALTER TABLE corporate_card_system__pre_spend_requests ADD COLUMN employee_locality VARCHAR(12)"),
        ("supplier_gstin", "ALTER TABLE corporate_card_system__pre_spend_requests ADD COLUMN supplier_gstin VARCHAR(32)"),
        ("supplier_business_registration_number", "ALTER TABLE corporate_card_system__pre_spend_requests ADD COLUMN supplier_business_registration_number VARCHAR(40)"),
        ("supplier_legal_name", "ALTER TABLE corporate_card_system__pre_spend_requests ADD COLUMN supplier_legal_name VARCHAR(240)"),
        ("invoice_number", "ALTER TABLE corporate_card_system__pre_spend_requests ADD COLUMN invoice_number VARCHAR(80)"),
        ("invoice_date", "ALTER TABLE corporate_card_system__pre_spend_requests ADD COLUMN invoice_date VARCHAR(40)"),
        ("place_of_supply", "ALTER TABLE corporate_card_system__pre_spend_requests ADD COLUMN place_of_supply VARCHAR(120)"),
        ("payment_method", "ALTER TABLE corporate_card_system__pre_spend_requests ADD COLUMN payment_method VARCHAR(80)"),
        ("fx_evidence_url", "ALTER TABLE corporate_card_system__pre_spend_requests ADD COLUMN fx_evidence_url TEXT"),
        ("fx_evidence_description", "ALTER TABLE corporate_card_system__pre_spend_requests ADD COLUMN fx_evidence_description TEXT"),
        ("cash_receipt_reference", "ALTER TABLE corporate_card_system__pre_spend_requests ADD COLUMN cash_receipt_reference VARCHAR(120)"),
    ]
    added = False
    for table_name, additions in (
        ("corporate_card_system__settlement_claims", claim_additions),
        ("corporate_card_system__pre_spend_requests", pre_spend_additions),
    ):
        rows = (await ctx.db.execute(text(f"PRAGMA table_info({table_name})"))).all()
        columns = {str(row[1]) for row in rows}
        for column, statement in additions:
            if column not in columns:
                await ctx.db.execute(text(statement))
                added = True
    if added:
        await ctx.db.commit()
    CLAIM_TAX_SCHEMA_CHECKED = True


async def _require_claim(ctx: PluginContext, claim_id: int) -> SettlementClaim:
    await _ensure_claim_tax_schema(ctx)
    stmt = select(SettlementClaim).where(
        SettlementClaim.id == claim_id,
        SettlementClaim.organization_id == ctx.organization_id,
    )
    claim = (await ctx.db.execute(stmt)).scalar_one_or_none()
    if claim is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Claim not found")
    return claim


async def _require_pre_spend(ctx: PluginContext, request_id: int) -> PreSpendRequest:
    await _ensure_claim_tax_schema(ctx)
    stmt = select(PreSpendRequest).where(
        PreSpendRequest.id == request_id,
        PreSpendRequest.organization_id == ctx.organization_id,
    )
    item = (await ctx.db.execute(stmt)).scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pre-spend request not found")
    return item





def _talk_notifier(ctx: PluginContext) -> TalkNotifier:
    """Talk notifier for this install.

    The channel comes from install config (`talk_channel`) or a
    CORPORATE_CARD_TALK_CHANNEL env/secret; with neither set the notifier falls
    back to the first channel the app's agent was invited to.
    """
    configured = ctx.config_value("talk_channel") if hasattr(ctx, "config_value") else None
    channel = str(configured or "").strip() or _config_value(ctx, "CORPORATE_CARD_TALK_CHANNEL")
    return TalkNotifier(ctx, channel=channel)


def _talk_amount(amount_cents: int, currency: str) -> str:
    return f"{amount_cents:,} {currency}"


def _acting_member_id(ctx: PluginContext, request: FastAPIRequest) -> str:
    """The signed-in Palette OS user. Kept as a helper so routes read the same."""
    return ctx.user_id


def _current_user_as_member(ctx: PluginContext) -> list[dict[str, Any]]:
    """Single-member roster for runtimes with no organisation member service.

    Only reached when the platform injected no member service at all -- the
    `pltt dev` simulator. It cannot be reached from a real deployment: a missing
    `members:read` permission raises PermissionError, which the caller does not
    catch, and a live Palette OS always provides the service. That is what makes
    it safe to invent a locality here.

    Every other field on this row is already invented ("Palette user", no
    email), and without a locality the policy gate blocks EVERY settlement, so
    the submit flow cannot be exercised locally at all. Defaults to KR, matching
    DEFAULT_COUNTRY and the KRW tax profile; set CORPORATE_CARD_DEV_LOCALITY=IN
    to develop against the India rules instead, or to an unsupported value to
    deliberately test the blocked path.
    """
    configured = os.environ.get("CORPORATE_CARD_DEV_LOCALITY")
    locality = _normalize_employee_locality(DEFAULT_COUNTRY if configured is None else configured)
    member = {
        "id": ctx.user_id,
        "name": "Palette user",
        "email": "",
        "role": _normalized_app_role(ctx.org_role) if ctx.org_role else "owner",
        "is_active": True,
        "joined_at": datetime.now(UTC).isoformat(),
    }
    if locality:
        member["country_code"] = locality
    return [member]


def _safe_path_segment(value: Any) -> str:
    cleaned = SAFE_FILENAME_RE.sub("-", str(value or "default")).strip(".-")
    return cleaned or "default"


def _receipt_storage_root() -> Path:
    configured = os.environ.get("CORPORATE_CARD_RECEIPT_STORAGE_DIR")
    if configured:
        root = Path(configured).expanduser()
        return root if root.is_absolute() else root.resolve()
    else:
        # Same inputs/outputs tree as platform storage, so a receipt sits at the
        # same relative path in dev as it does in the org bucket.
        return (
            Path(__file__).resolve().parents[2]
            / ".palette"
            / "dev-storage"
            / "uploads"
            / "corporate-card-system"
            / Path(input_folder(RECEIPTS))
        )


async def _delete_org_rows(ctx: PluginContext, model: Any) -> int:
    result = await ctx.db.execute(delete(model).where(model.organization_id == ctx.organization_id))
    return int(result.rowcount or 0)


def _delete_receipt_files(organization_id: Any) -> int:
    return local_receipt_storage(_receipt_storage_root()).delete_org(organization_id)


def _snapshot_approvers(snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    raw_approvers = snapshot.get("approvers") or snapshot.get("steps") or snapshot.get("approval_steps")
    approvers = raw_approvers if isinstance(raw_approvers, list) else []
    resolver_source = str(snapshot.get("resolver_source") or snapshot.get("source") or HIERARCHY_APPROVAL_SOURCE)
    cleaned = []
    for index, item in enumerate(approvers, start=1):
        if not isinstance(item, dict):
            continue
        cleaned.append(
            {
                "step": int(item.get("step") or item.get("step_order") or index),
                "member_id": item.get("member_id") or item.get("approver_member_id") or item.get("user_id") or item.get("id"),
                "name": item.get("name") or item.get("approver_name") or item.get("display_name") or "Approver",
                "title": item.get("title") or item.get("approver_title"),
                "reason": item.get("reason") or "approval_path",
                "source": item.get("source") or resolver_source,
                "resolver_source": item.get("resolver_source") or resolver_source,
            }
        )
    return cleaned


def _hierarchy_route_payload(
    *,
    requester_member_id: str,
    amount: int,
    currency: str,
    category: str,
    transaction: dict[str, Any] | None = None,
    selectors: dict[str, Any] | None = None,
    policy_evaluation: dict[str, Any] | None = None,
    workflow_type: str = "corporate_card_settlement",
) -> dict[str, Any]:
    return {
        "requester_member_id": requester_member_id,
        "amount": amount,
        "currency": currency,
        "category": category,
        "transaction": transaction or {},
        "selectors": selectors or {},
        "policy_evaluation": policy_evaluation or {},
        "workflow_type": workflow_type,
    }


async def _resolve_hierarchy_route(
    ctx: PluginContext,
    *,
    target: str,
    requester_member_id: str,
    amount: int,
    currency: str,
    category: str,
    transaction: dict[str, Any] | None = None,
    selectors: dict[str, Any] | None = None,
    policy_evaluation: dict[str, Any] | None = None,
    workflow_type: str = "corporate_card_settlement",
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    service = CorporateCardHierarchyRouteService(ctx, members=await _organization_members(ctx))
    route_kwargs = {
        "requester_member_id": requester_member_id,
        "amount": amount,
        "currency": currency,
        "category": category,
        "transaction": transaction,
        "selectors": selectors,
        "policy_evaluation": policy_evaluation,
        "workflow_type": workflow_type,
    }
    result = (
        await service.preview_route(**route_kwargs)
        if target == HIERARCHY_ROUTE_PREVIEW_TARGET
        else await service.resolve_route(**route_kwargs)
    )
    return result.snapshot, result.approvers


async def _create_approval_steps(
    ctx: PluginContext,
    *,
    claim_id: int,
    requester_member_id: str,
    approvers: list[dict[str, Any]],
    default_reason: str = "approval_path",
) -> list[dict[str, Any]]:
    return await ApprovalWorkflowService(ctx).create_claim_steps(
        claim_id=claim_id,
        requester_member_id=requester_member_id,
        approvers=approvers,
        default_reason=default_reason,
    )


def _row_amount(row: StatementRowIn) -> int:
    if row.amount is not None:
        return _amount_to_units(row.amount)
    if row.amount_cents is not None:
        return row.amount_cents
    return 0


def _normalized_vendor(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def _date_distance_days(left: str | None, right: str | None) -> int | None:
    left_date = _parse_transaction_date(left)
    right_date = _parse_transaction_date(right)
    if left_date is None or right_date is None:
        return None
    return abs((left_date - right_date).days)


def _statement_row_equivalent(row: StatementRowIn, existing: CardStatementRow) -> bool:
    return (
        _row_amount(row) == existing.amount_cents
        and row.currency.upper() == existing.currency.upper()
        and _normalized_vendor(row.vendor) == _normalized_vendor(existing.vendor)
        and (row.transaction_date or "") == (existing.transaction_date or "")
        and (row.card_last4 or "") == (existing.card_last4 or "")
        and (row.cardholder_member_id or "") == (existing.cardholder_member_id or "")
    )


def _claim_match_reconciliation(row: StatementRowIn, claim: SettlementClaim) -> dict[str, Any] | None:
    row_amount = _row_amount(row)
    row_vendor = _normalized_vendor(row.vendor)
    claim_vendor = _normalized_vendor(claim.vendor)
    same_vendor = bool(row_vendor and claim_vendor and (row_vendor in claim_vendor or claim_vendor in row_vendor))
    same_amount = abs(claim.amount_cents - row_amount) <= 1
    same_currency = claim.currency.upper() == row.currency.upper()
    same_member = not row.cardholder_member_id or claim.requester_member_id == row.cardholder_member_id
    same_card = not row.card_last4 or not claim.card_last4 or claim.card_last4 == row.card_last4[-4:]
    date_distance = _date_distance_days(row.transaction_date, claim.transaction_date)
    date_match = date_distance is None or date_distance <= STATEMENT_MATCH_DATE_WINDOW_DAYS
    if not (same_amount and same_currency and same_member and same_card and same_vendor and date_match):
        return None
    score = 70
    score += 10 if same_vendor else 0
    score += 10 if date_distance is not None else 0
    score += 5 if row.card_last4 and claim.card_last4 else 0
    score += 5 if row.cardholder_member_id else 0
    return {
        "status": "matched",
        "reason": "matched_submitted_settlement_claim",
        "confidence": min(score, 100),
        "claim_id": claim.id,
        "claim_state": claim.state,
        "matched_on": ["amount", "currency", "vendor", "cardholder", "card_last4", "date_window"],
        "date_distance_days": date_distance,
        "required_actions": [],
    }


def _claim_matches_statement(row: StatementRowIn, claims: list[SettlementClaim]) -> tuple[SettlementClaim | None, dict[str, Any]]:
    candidates: list[tuple[int, SettlementClaim, dict[str, Any]]] = []
    for claim in claims:
        if claim.state == "rejected":
            continue
        reconciliation = _claim_match_reconciliation(row, claim)
        if reconciliation:
            candidates.append((int(reconciliation["confidence"]), claim, reconciliation))
    if not candidates:
        return None, {
            "status": "missing",
            "reason": "no_submitted_claim_match",
            "confidence": 0,
            "required_actions": ["create_or_complete_settlement_claim", "attach_receipt_or_missing_receipt_declaration", "provide_business_purpose"],
        }
    candidates.sort(key=lambda item: item[0], reverse=True)
    _, claim, reconciliation = candidates[0]
    return claim, reconciliation


def _pre_spend_date_matches(row: StatementRowIn, item: PreSpendRequest) -> bool:
    if _pre_spend_is_business_trip(item):
        row_date = _parse_transaction_date(row.transaction_date)
        start = _parse_transaction_date(item.trip_start_date or item.expected_purchase_date)
        end = _parse_transaction_date(item.trip_end_date or item.expected_purchase_date)
        if row_date is None or start is None:
            return True
        if end is None:
            return abs((row_date - start).days) <= PRE_SPEND_MATCH_DATE_WINDOW_DAYS
        return start - timedelta(days=3) <= row_date <= end + timedelta(days=3)
    distance = _date_distance_days(row.transaction_date, item.expected_purchase_date)
    return distance is None or distance <= PRE_SPEND_MATCH_DATE_WINDOW_DAYS


async def _pre_spend_matches_statement(
    ctx: PluginContext,
    row: StatementRowIn,
    requests: list[PreSpendRequest],
) -> tuple[PreSpendRequest | None, dict[str, Any]]:
    row_amount = _row_amount(row)
    row_vendor = _normalized_vendor(row.vendor)
    candidates: list[tuple[int, PreSpendRequest, dict[str, Any]]] = []
    for item in requests:
        if item.state not in {"approved", "used"}:
            continue
        if item.requester_member_id != row.cardholder_member_id and row.cardholder_member_id:
            continue
        if item.currency.upper() != row.currency.upper():
            continue
        date_match = _pre_spend_date_matches(row, item)
        if not date_match:
            continue
        if _pre_spend_is_business_trip(item):
            remaining = item.amount_cents + _budget_tolerance(item.amount_cents) - await _linked_pre_spend_amount(ctx, item.id)
            if row_amount > remaining:
                continue
            score = 70
            if _normalized_category(row.category) in {"travel", "lodging", "meals", "transport", "travel_transport"}:
                score += 10
            if item.trip_area:
                score += 5
            reconciliation = {
                "status": "pre_approval_matched",
                "reason": "matched_approved_business_trip_pre_spend",
                "confidence": min(score, 90),
                "pre_approval_id": item.id,
                "pre_spend_request_type": item.request_type,
                "remaining_pre_approval_cents": remaining,
                "required_actions": ["create_settlement_claim", "attach_receipt_or_missing_receipt_declaration", "provide_business_purpose"],
            }
            candidates.append((int(reconciliation["confidence"]), item, reconciliation))
            continue

        item_vendor = _normalized_vendor(item.vendor)
        same_vendor = bool(row_vendor and item_vendor and (row_vendor in item_vendor or item_vendor in row_vendor))
        amount_close = abs(item.amount_cents - row_amount) <= _budget_tolerance(item.amount_cents)
        if not (same_vendor and amount_close):
            continue
        reconciliation = {
            "status": "pre_approval_matched",
            "reason": "matched_approved_pre_spend",
            "confidence": 85,
            "pre_approval_id": item.id,
            "pre_spend_request_type": item.request_type,
            "required_actions": ["create_settlement_claim", "attach_receipt_or_missing_receipt_declaration", "provide_business_purpose"],
        }
        candidates.append((85, item, reconciliation))
    if not candidates:
        return None, {
            "status": "missing",
            "reason": "no_claim_or_pre_approval_match",
            "confidence": 0,
            "required_actions": ["create_or_complete_settlement_claim", "attach_receipt_or_missing_receipt_declaration", "provide_business_purpose"],
        }
    candidates.sort(key=lambda item: item[0], reverse=True)
    _, item, reconciliation = candidates[0]
    return item, reconciliation


def _csv_value(raw: dict[str, str], *names: str) -> str | None:
    lowered = {key.strip().lower().replace(" ", "_"): value for key, value in raw.items() if key}
    for name in names:
        value = lowered.get(name)
        if value not in (None, ""):
            return value.strip()
    return None


def _parse_statement_csv(csv_text: str) -> list[StatementRowIn]:
    reader = csv.DictReader(io.StringIO(csv_text.strip()))
    rows: list[StatementRowIn] = []
    for raw in reader:
        vendor = _csv_value(raw, "vendor", "merchant", "description", "payee")
        amount = _csv_value(raw, "amount", "amount_krw", "total", "transaction_amount")
        if not vendor or not amount:
            continue
        rows.append(
            StatementRowIn(
                transaction_date=_csv_value(raw, "transaction_date", "date", "tx_date", "posted_date"),
                card_last4=_csv_value(raw, "card_last4", "last4", "card"),
                cardholder_member_id=_csv_value(raw, "cardholder_member_id", "member_id", "employee_id", "user_id"),
                cardholder_name=_csv_value(raw, "cardholder_name", "employee", "employee_name", "name"),
                vendor=vendor,
                amount=amount,
                currency=_csv_value(raw, "currency") or "KRW",
                category=_csv_value(raw, "category", "account", "account_code") or "general",
            )
        )
    return rows


def _finding(code: str, message: str, *, severity: str = "warning", action: str | None = None) -> dict[str, str]:
    item = {"code": code, "severity": severity, "message": message}
    if action:
        item["action"] = action
    return item


def _normalized_currency(value: str | None) -> str:
    return str(value or "KRW").strip().upper()


def _tax_profile(currency: str | None) -> dict[str, Any] | None:
    return TAX_PROFILES.get(_normalized_currency(currency))


def _normalized_tax_type(value: str | None, currency: str | None) -> str | None:
    cleaned = _clean_optional_text(value)
    if cleaned:
        return cleaned.upper()
    profile = _tax_profile(currency)
    return str(profile["type"]) if profile else None


def _default_tax_rate(currency: str | None) -> float | None:
    profile = _tax_profile(currency)
    return float(profile["default_rate"]) if profile else None


def _expected_tax_amount(amount: int, rate_percent: float | None, tax_included: bool) -> int | None:
    if rate_percent is None or rate_percent <= 0:
        return 0
    if tax_included:
        return round(amount * rate_percent / (100 + rate_percent))
    return round(amount * rate_percent / 100)


def _tax_tolerance_amount(amount: int) -> int:
    return max(TAX_RATE_TOLERANCE_CENTS, round(amount * TAX_RATE_TOLERANCE_RATIO))


def _normalized_category(value: str | None) -> str:
    return re.sub(r"[^a-z0-9_]+", "_", str(value or "general").strip().lower()).strip("_") or "general"


def _normalized_pre_spend_request_type(value: str | None) -> str:
    normalized = str(value or "purchase").strip().lower()
    if normalized not in PRE_SPEND_REQUEST_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported pre-spend request type")
    return normalized


def _pre_spend_budget_items(raw_items: list[PreSpendBudgetItemIn]) -> list[dict[str, Any]]:
    cleaned: list[dict[str, Any]] = []
    for item in raw_items:
        amount = _payload_amount(item, allow_zero=True)
        if amount <= 0:
            continue
        category = _normalized_category(item.category)
        label = _clean_optional_text(item.label) or category.replace("_", " ").title()
        cleaned.append({"category": category, "label": label[:120], "amount": amount, "amount_cents": amount})
    return cleaned


def _budget_total(items: list[dict[str, Any]] | None) -> int:
    total = 0
    for item in items or []:
        amount = item.get("amount") if isinstance(item, dict) else None
        if amount is None and isinstance(item, dict):
            amount = item.get("amount_cents")
        if isinstance(amount, int):
            total += amount
    return total


def _budget_tolerance(amount: int) -> int:
    return max(BUSINESS_TRIP_BUDGET_TOLERANCE_MIN_CENTS, round(amount * BUSINESS_TRIP_BUDGET_TOLERANCE_RATIO))


def _pre_spend_is_business_trip(item: PreSpendRequest) -> bool:
    return str(getattr(item, "request_type", "purchase") or "purchase").lower() == "business_trip"


def _pre_spend_vendor(payload: PreSpendRequestIn, request_type: str) -> str:
    vendor = _clean_optional_text(payload.vendor)
    if vendor:
        return vendor
    if request_type == "business_trip":
        area = _clean_optional_text(payload.trip_area)
        return f"Business trip - {area}" if area else "Business trip estimate"
    raise HTTPException(status_code=400, detail="Vendor is required for purchase pre-spend requests")


def _parse_transaction_date(value: str | None) -> datetime | None:
    if not value:
        return None
    cleaned = value.strip()
    if not cleaned:
        return None
    for candidate in (cleaned, cleaned.replace(".", "-").replace("/", "-")):
        try:
            parsed = datetime.fromisoformat(candidate)
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
        except ValueError:
            pass
    for fmt in ("%Y-%m-%d", "%Y%m%d", "%d-%m-%Y", "%m-%d-%Y"):
        try:
            return datetime.strptime(cleaned, fmt).replace(tzinfo=UTC)
        except ValueError:
            continue
    return None


def _ensure_trip_dates_are_ordered(start_date: str | None, end_date: str | None) -> None:
    start = _parse_transaction_date(start_date)
    end = _parse_transaction_date(end_date)
    if start and end and end < start:
        raise HTTPException(status_code=400, detail="Trip end date cannot be before the start date")


def _receipt_status(receipt_file_url: str | None, requested_status: str | None, missing_reason: str | None) -> str:
    if receipt_file_url:
        return "attached"
    normalized = str(requested_status or "").strip().lower()
    if normalized in {"missing_declared", "missing", "not_required"}:
        return normalized
    if missing_reason and missing_reason.strip():
        return "missing_declared"
    return "missing"


async def _active_card_for_member(ctx: PluginContext, member_id: str, last4: str | None = None) -> CorporateCard | None:
    stmt = select(CorporateCard).where(
        CorporateCard.organization_id == ctx.organization_id,
        CorporateCard.member_id == member_id,
        CorporateCard.status == "active",
    )
    if last4:
        stmt = stmt.where(CorporateCard.last4 == last4[-4:])
    stmt = stmt.order_by(CorporateCard.id.desc()).limit(1)
    return (await ctx.db.execute(stmt)).scalar_one_or_none()


async def _linked_pre_spend_amount(
    ctx: PluginContext,
    pre_approval_id: int,
    *,
    exclude_claim_id: int | None = None,
) -> int:
    await _ensure_claim_tax_schema(ctx)
    stmt = select(SettlementClaim).where(
        SettlementClaim.organization_id == ctx.organization_id,
        SettlementClaim.pre_approval_id == pre_approval_id,
        SettlementClaim.state != "rejected",
    )
    if exclude_claim_id is not None:
        stmt = stmt.where(SettlementClaim.id != exclude_claim_id)
    return sum(claim.amount_cents for claim in (await ctx.db.execute(stmt)).scalars().all())


async def _approved_pre_spend(
    ctx: PluginContext,
    pre_approval_id: int | None,
    requester_member_id: str,
    *,
    amount: int | None = None,
    exclude_claim_id: int | None = None,
) -> PreSpendRequest | None:
    if pre_approval_id is None:
        return None
    item = await _require_pre_spend(ctx, pre_approval_id)
    if item.requester_member_id != requester_member_id:
        raise HTTPException(status_code=400, detail="Pre-spend approval belongs to another requester")
    if item.state not in {"approved", "used"}:
        raise HTTPException(status_code=400, detail="Pre-spend request is not approved")
    if amount is not None:
        linked_amount = await _linked_pre_spend_amount(ctx, item.id, exclude_claim_id=exclude_claim_id)
        if _pre_spend_is_business_trip(item):
            allowance = item.amount_cents + _budget_tolerance(item.amount_cents)
            if linked_amount + amount > allowance:
                raise HTTPException(status_code=400, detail="Linked trip spend exceeds the approved pre-spend budget")
        elif item.state == "used" and linked_amount > 0:
            raise HTTPException(status_code=400, detail="Pre-spend request is already linked to a settlement claim")
    return item


async def _mark_pre_spend_linked(ctx: PluginContext, item: PreSpendRequest, claim_id: int) -> None:
    item.linked_claim_id = claim_id
    if not _pre_spend_is_business_trip(item):
        item.state = "used"
        return
    linked_amount = await _linked_pre_spend_amount(ctx, item.id)
    item.state = "used" if linked_amount >= item.amount_cents else "approved"


async def _related_claims(
    ctx: PluginContext,
    *,
    requester_member_id: str,
    transaction_date: str | None,
    exclude_claim_id: int | None = None,
) -> list[SettlementClaim]:
    await _ensure_claim_tax_schema(ctx)
    stmt = select(SettlementClaim).where(
        SettlementClaim.organization_id == ctx.organization_id,
        SettlementClaim.requester_member_id == requester_member_id,
        SettlementClaim.state != "rejected",
    )
    if exclude_claim_id:
        stmt = stmt.where(SettlementClaim.id != exclude_claim_id)
    rows = list((await ctx.db.execute(stmt)).scalars().all())
    parsed = _parse_transaction_date(transaction_date)
    if parsed is None:
        return rows
    return [
        claim
        for claim in rows
        if _parse_transaction_date(claim.transaction_date) is None
        or abs((_parse_transaction_date(claim.transaction_date) - parsed).days) <= 3
    ]


async def _current_month_spend(
    ctx: PluginContext,
    *,
    requester_member_id: str,
    transaction_date: str | None,
    exclude_claim_id: int | None = None,
) -> int:
    anchor = _parse_transaction_date(transaction_date) or datetime.now(UTC)
    start = anchor.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if start.month == 12:
        end = start.replace(year=start.year + 1, month=1)
    else:
        end = start.replace(month=start.month + 1)
    total = 0
    for claim in await _related_claims(ctx, requester_member_id=requester_member_id, transaction_date=transaction_date, exclude_claim_id=exclude_claim_id):
        claim_date = _parse_transaction_date(claim.transaction_date)
        if claim_date is None:
            created_at = _coerce_datetime(claim.created_at)
            claim_date = created_at or anchor
        if start <= claim_date < end:
            total += claim.amount_cents
    return total


def _required_invoice_fields(locality: str | None, *, source: str, receipt_state: str) -> list[tuple[str, str]]:
    if source in {"pre_spend", "statement"} or receipt_state != "attached":
        return []
    if locality == "IN":
        return [
            ("supplier_gstin", "Supplier GSTIN is required for India tax invoices."),
            ("supplier_legal_name", "Supplier legal name is required for India tax invoices."),
            ("invoice_number", "Invoice number is required for India tax invoices."),
            ("invoice_date", "Invoice date is required for India tax invoices."),
            ("place_of_supply", "Place of supply is required for India GST treatment."),
            ("payment_method", "Payment method is required for India settlements."),
        ]
    if locality == "KR":
        return [
            ("supplier_business_registration_number", "Supplier business registration number is required for Korea evidence."),
            ("invoice_number", "Invoice or receipt number is required for Korea evidence."),
            ("invoice_date", "Issue date is required for Korea evidence."),
            ("payment_method", "Payment method is required for Korea settlements."),
        ]
    return []


async def _evaluate_policy(
    ctx: PluginContext,
    *,
    requester_member_id: str,
    vendor: str,
    amount: int,
    currency: str,
    category: str,
    business_purpose: str,
    tax_amount: int = 0,
    tax_type: str | None = None,
    tax_rate_percent: float | None = None,
    tax_included: bool = True,
    transaction_date: str | None = None,
    card_last4: str | None = None,
    cost_center: str | None = None,
    project_code: str | None = None,
    attendees: list[str] | None = None,
    receipt_file_url: str | None = None,
    requested_receipt_status: str | None = None,
    missing_receipt_reason: str | None = None,
    invoice_evidence: dict[str, str | None] | None = None,
    pre_approval_id: int | None = None,
    receipt_analysis: dict[str, Any] | None = None,
    request_type: str | None = None,
    trip_area: str | None = None,
    budget_items: list[dict[str, Any]] | None = None,
    source: str = "claim",
    exclude_claim_id: int | None = None,
) -> dict[str, Any]:
    hard_blocks: list[dict[str, str]] = []
    warnings: list[dict[str, str]] = []
    required_actions: list[dict[str, str]] = []
    category_key = _normalized_category(category)
    currency_key = _normalized_currency(currency)
    employee_locality, _ = await _employee_locality(ctx, requester_member_id)
    policy_profile = _policy_profile_for_locality(employee_locality)
    evidence = {field: _clean_optional_text((invoice_evidence or {}).get(field)) for field in INVOICE_EVIDENCE_FIELDS}
    tax_profile = _tax_profile(currency_key)
    normalized_tax_type = _normalized_tax_type(tax_type, currency_key)
    effective_tax_rate = tax_rate_percent if tax_rate_percent is not None else _default_tax_rate(currency_key)
    request_type_key = str(request_type or "").strip().lower()
    is_business_trip = request_type_key == "business_trip"
    trip_area_value = _clean_optional_text(trip_area)
    attendee_values = [item.strip() for item in attendees or [] if str(item).strip()]
    receipt_state = _receipt_status(receipt_file_url, requested_receipt_status, missing_receipt_reason)
    pre_approval = await _approved_pre_spend(
        ctx,
        pre_approval_id,
        requester_member_id,
        amount=amount,
        exclude_claim_id=exclude_claim_id,
    ) if pre_approval_id else None
    if pre_approval and _pre_spend_is_business_trip(pre_approval):
        request_type_key = request_type_key or "business_trip"
        trip_area_value = trip_area_value or _clean_optional_text(pre_approval.trip_area)
    is_business_trip = request_type_key == "business_trip"
    active_card = await _active_card_for_member(ctx, requester_member_id, card_last4)
    routing_hints = {
        "requires_manager_review": True,
        "requires_finance_review": category_key in RESTRICTED_CATEGORIES,
        "requires_tax_review": receipt_state != "attached" or category_key in {"meals", "entertainment", "travel"},
        "requires_pre_approval": category_key in RESTRICTED_CATEGORIES,
        "employee_locality": employee_locality,
        "policy_country": employee_locality,
    }

    if policy_profile is None:
        hard_blocks.append(_finding("employee_locality_required", "Employee locality must be India or Korea on the organization member profile before policy can be evaluated.", severity="blocked", action="Update the org member country/location to IN, India, KR, KO, Korea, or South Korea."))
    else:
        local_currency = policy_profile["currency"]
        if currency_key != local_currency and not _has_fx_evidence(evidence):
            hard_blocks.append(_finding("fx_evidence_required", f"{employee_locality} employees normally settle in {local_currency}; foreign-currency expenses require FX evidence.", severity="blocked", action="Attach or describe FX conversion evidence."))
        elif currency_key != local_currency:
            warnings.append(_finding("foreign_currency_with_fx_evidence", f"Foreign-currency expense captured for {employee_locality} with FX evidence.", action="Finance should verify conversion evidence."))

    if len(business_purpose.strip()) < 8:
        hard_blocks.append(_finding("business_purpose_required", "Business purpose must clearly explain why the expense is business-related.", severity="blocked", action="Add a specific business purpose."))

    if receipt_state == "missing":
        hard_blocks.append(_finding("receipt_required", "Receipt or missing receipt declaration is required before submission.", severity="blocked", action="Attach a receipt or provide a missing receipt declaration."))
    elif receipt_state == "missing_declared" and len((missing_receipt_reason or "").strip()) < 12:
        hard_blocks.append(_finding("missing_receipt_reason_required", "Missing receipt declarations require a clear explanation.", severity="blocked", action="Explain why the receipt is unavailable."))
    elif receipt_state == "missing_declared":
        warnings.append(_finding("missing_receipt_declared", "Receipt is missing but a declaration was provided.", action="Approver should review the declaration."))

    if category_key in PROHIBITED_CATEGORIES:
        hard_blocks.append(_finding("prohibited_category", f"{category_key} is prohibited for corporate-card settlement.", severity="blocked", action="Use a different payment or reimbursement path."))

    if category_key in RESTRICTED_CATEGORIES:
        warnings.append(_finding("restricted_category", f"{category_key} is restricted and requires additional review.", action="Confirm required pre-spend approval or exception basis."))

    for field, message in _required_invoice_fields(employee_locality, source=source, receipt_state=receipt_state):
        if not evidence.get(field):
            hard_blocks.append(_finding(f"{field}_required", message, severity="blocked", action="Capture the required invoice evidence."))

    if employee_locality == "KR" and receipt_state == "attached" and not (evidence.get("cash_receipt_reference") or evidence.get("invoice_number")):
        warnings.append(_finding("korea_receipt_reference_missing", "Korea evidence should include a cash receipt, e-tax invoice, card receipt, or invoice reference where available.", action="Capture the reference if the supplier issued one."))

    if tax_amount > amount:
        hard_blocks.append(_finding("tax_exceeds_total", "Tax amount cannot exceed the submitted total.", severity="blocked", action="Correct the tax amount or total amount."))
    elif tax_profile:
        if normalized_tax_type and normalized_tax_type != tax_profile["type"]:
            warnings.append(_finding("tax_type_unusual", f"{currency_key} expenses usually use {tax_profile['type']} for indirect tax.", action="Confirm the tax type before approval."))
        if effective_tax_rate is not None and float(effective_tax_rate) not in tax_profile["allowed_rates"]:
            warnings.append(_finding("tax_rate_unusual", f"{currency_key} {tax_profile['type']} rate is outside the common configured rates.", action="Confirm the statutory tax slab on the invoice."))
        expected_tax = _expected_tax_amount(amount, effective_tax_rate, tax_included)
        if tax_amount > 0 and expected_tax is not None and abs(tax_amount - expected_tax) > _tax_tolerance_amount(amount):
            warnings.append(_finding("tax_amount_mismatch", "Tax amount does not align with the selected tax rate and total.", action="Check whether the invoice is tax-inclusive, tax-exclusive, or uses a different slab."))
        if receipt_state == "attached" and tax_amount == 0 and effective_tax_rate and effective_tax_rate > 0:
            warnings.append(_finding("tax_not_captured", f"{tax_profile['type']} was not captured for this {currency_key} receipt.", action="Enter tax as shown on the invoice, or set the rate to 0 if exempt/non-taxable."))
    elif tax_amount > 0 and not normalized_tax_type:
        warnings.append(_finding("tax_type_missing", "Tax amount was entered without a tax type.", action="Enter VAT, GST, or the local tax name."))

    budget_total = _budget_total(budget_items)
    if is_business_trip:
        if not trip_area_value:
            hard_blocks.append(_finding("trip_area_required", "Business-trip pre-approval requires an approximate destination or area.", severity="blocked", action="Add the city, region, or travel area."))
        if budget_items and abs(budget_total - amount) > _budget_tolerance(amount):
            warnings.append(_finding("trip_budget_mismatch", "Budget split-up does not closely match the expected trip spend.", action="Align lodging, travel, meals, and other estimates with the requested ceiling."))
        if not budget_items:
            warnings.append(_finding("trip_budget_breakdown_missing", "Business-trip estimates should include lodging, travel, meals, or other budget split-ups.", action="Add a budget breakdown if the estimate is known."))

    rules_stmt = select(PolicyRule).where(
        PolicyRule.organization_id == ctx.organization_id,
        PolicyRule.is_active == True,  # noqa: E712
        PolicyRule.category.in_({category_key, "general"}),
        PolicyRule.threshold_cents <= amount,
    )
    for rule in (await ctx.db.execute(rules_stmt)).scalars().all():
        rule_code = f"policy_rule_{rule.id}"
        if rule.action == "prohibit":
            hard_blocks.append(_finding(rule_code, rule.name, severity="blocked", action="Resolve the policy rule before submitting."))
        elif rule.action == "require_pre_approval" and source != "pre_spend":
            routing_hints["requires_pre_approval"] = True
            required_actions.append(_finding(rule_code, rule.name, severity="exception_required", action="Link an approved pre-spend request."))
        elif rule.action in {"require_finance_review", "require_approval"}:
            routing_hints["requires_finance_review"] = True
            warnings.append(_finding(rule_code, rule.name, action="Route through approval workflow."))

    if routing_hints["requires_pre_approval"] and pre_approval is None and source != "pre_spend":
        required_actions.append(_finding("pre_approval_required", "Restricted or policy-flagged spend should have pre-spend approval.", severity="exception_required", action="Create or link an approved pre-spend request."))
    elif pre_approval is not None:
        warnings.append(_finding("pre_approval_linked", f"Linked pre-spend approval #{pre_approval.id}.", action="Verify actual spend matches the approved request."))

    if active_card is None:
        warnings.append(_finding("card_not_found", "No active corporate card was found for this requester/card ending.", action="Finance should verify card assignment."))
    elif active_card.monthly_limit_cents > 0:
        month_spend = await _current_month_spend(
            ctx,
            requester_member_id=requester_member_id,
            transaction_date=transaction_date,
            exclude_claim_id=exclude_claim_id,
        )
        projected = month_spend + amount
        if amount > active_card.monthly_limit_cents and pre_approval is None:
            routing_hints["requires_pre_approval"] = True
            routing_hints["requires_finance_review"] = True
            hard_blocks.append(_finding("single_transaction_limit_exceeded", "Amount exceeds the card monthly limit and has no approved exception.", severity="blocked", action="Link an approved pre-spend exception or adjust the card limit."))
        if projected > active_card.monthly_limit_cents and pre_approval is None:
            routing_hints["requires_pre_approval"] = True
            routing_hints["requires_finance_review"] = True
            hard_blocks.append(_finding("monthly_limit_exceeded", "Projected monthly spend exceeds the card limit.", severity="blocked", action="Link an approved pre-spend exception or ask finance to adjust the card limit."))

    parsed_date = _parse_transaction_date(transaction_date)
    if parsed_date and datetime.now(UTC) - parsed_date > timedelta(days=TIMELY_SUBMISSION_DAYS):
        warnings.append(_finding("late_submission", f"Transaction is older than {TIMELY_SUBMISSION_DAYS} days.", action="Approver should review tax/accountable-plan treatment."))

    if category_key in CONTEXT_REQUIRED_CATEGORIES and not attendee_values and not project_code and not trip_area_value:
        warnings.append(_finding("context_required", "This category usually requires attendees, trip, or project context.", action="Add attendees or project context."))

    related_claims = await _related_claims(
        ctx,
        requester_member_id=requester_member_id,
        transaction_date=transaction_date,
        exclude_claim_id=exclude_claim_id,
    )
    vendor_key = _normalized_vendor(vendor)
    duplicates = [
        claim
        for claim in related_claims
        if claim.amount_cents == amount
        and claim.currency.upper() == currency.upper()
        and _normalized_vendor(claim.vendor) == vendor_key
    ]
    if duplicates:
        warnings.append(_finding("duplicate_suspicion", "Similar claim already exists for the same requester, vendor, amount, and date window.", action="Check for duplicate reimbursement."))

    same_vendor_rows = [
        claim
        for claim in related_claims
        if _normalized_vendor(claim.vendor) == vendor_key
    ]
    split_total = sum(claim.amount_cents for claim in same_vendor_rows) + amount
    if len(same_vendor_rows) >= 1:
        warnings.append(_finding("split_purchase_suspicion", "Multiple same-vendor transactions were found in the related date window.", action=f"Approver should verify the combined {split_total} {currency_key} spend is not a split purchase."))

    if source == "statement":
        warnings.append(_finding("statement_created", "Claim was created from an unmatched statement row.", action="Requester must add purpose and receipt/declaration before approval."))

    confidence = receipt_analysis.get("confidence") if isinstance(receipt_analysis, dict) else None
    if isinstance(confidence, (int, float)) and confidence < 0.75:
        warnings.append(_finding("low_receipt_confidence", "Receipt extraction confidence is low.", action="Approver should inspect the receipt manually."))

    if hard_blocks:
        status_value = "blocked"
    elif required_actions:
        status_value = "exception_required"
    elif warnings:
        status_value = "warning"
    else:
        status_value = "compliant"

    return {
        "status": status_value,
        "hard_blocks": hard_blocks,
        "warnings": warnings,
        "required_actions": required_actions,
        "routing_hints": routing_hints,
        "receipt_status": receipt_state,
        "pre_approval_id": pre_approval.id if pre_approval else None,
        "tax_summary": {
            "tax_amount": tax_amount,
            "tax_amount_cents": tax_amount,
            "tax_type": normalized_tax_type,
            "tax_rate_percent": effective_tax_rate,
            "tax_included": tax_included,
            "currency": currency_key,
        },
        "pre_spend_request_type": request_type_key or None,
        "trip_area": trip_area_value,
        "invoice_evidence": evidence,
        "employee_locality": employee_locality,
        "policy_country": employee_locality,
        "budget_total": budget_total if budget_items else None,
        "budget_total_cents": budget_total if budget_items else None,
        "evaluated_at": datetime.now(UTC).isoformat(),
        "policy_version": policy_profile["version"] if policy_profile else "corporate-card-locality-required-v1",
    }


def _claim_policy_status(evaluation: dict[str, Any], *, has_pre_approval: bool = False) -> str:
    status_value = str(evaluation.get("status") or "warning")
    if status_value == "blocked":
        return "blocked"
    if has_pre_approval and status_value in {"warning", "exception_required"}:
        return "exception_approved"
    return status_value


def _policy_messages(evaluation: dict[str, Any], key: str) -> list[str]:
    values = evaluation.get(key)
    if not isinstance(values, list):
        return []
    messages = []
    for item in values:
        if isinstance(item, dict) and item.get("message"):
            messages.append(str(item["message"]))
        elif isinstance(item, str):
            messages.append(item)
    return messages


CONFIG_ALIASES = {
    "LLM_ROUTER_API_KEY": ("NUXT_PUBLIC_GATEWAY_KEY", "GATEWAY_KEY"),
    "GOOGLE_AI_API_KEY": ("GEMINI_API_KEY", "GOOGLE_API_KEY"),
    "OPENAI_KEY": ("OPENAI_API_KEY",),
}

# Direct provider endpoints, used when neither the platform LLM service nor the
# LLM router is available. Both speak the OpenAI chat-completions protocol, so
# the same request builder covers them.
GEMINI_OPENAI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai"
OPENAI_BASE_URL = "https://api.openai.com/v1"
OPENAI_DEFAULT_MODEL = "gpt-5.2"


DEV_LLM_STUB_PREFIX = "[pltt dev: no LLM key]"

PLACEHOLDER_CONFIG_VALUES = {
    "change-me",
    "changeme",
    "placeholder",
    "todo",
    "your-key-here",
}


def _clean_config_value(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip().strip('"').strip("'")
    lowered = cleaned.lower()
    if not cleaned or lowered in PLACEHOLDER_CONFIG_VALUES:
        return None
    if lowered.startswith("<") and lowered.endswith(">"):
        return None
    return cleaned


def _env_file_value(keys: tuple[str, ...]) -> str | None:
    for parent in Path(__file__).resolve().parents:
        candidate = parent / ".env"
        if not candidate.exists():
            continue
        values: dict[str, str] = {}
        for line in candidate.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            name, value = stripped.split("=", 1)
            values[name.strip()] = value
        for key in keys:
            cleaned = _clean_config_value(values.get(key))
            if cleaned:
                return cleaned
    return None


def _config_value(ctx: PluginContext, key: str) -> str | None:
    candidates = (key, *CONFIG_ALIASES.get(key, ()))
    for candidate in candidates:
        value = _clean_config_value(ctx.secret(candidate))
        if value:
            return value
    for candidate in candidates:
        value = _clean_config_value(os.environ.get(candidate))
        if value:
            return value
    return _env_file_value(candidates)


def _fallback_policy_answer(question: str) -> str:
    q = question.lower()
    if "meal" in q or "dinner" in q or "식" in q:
        return "Meals should include a business purpose, attendee context, and receipt. High-value meals route through manager and finance review."
    if "receipt" in q or "invoice" in q or "영수" in q:
        return "Attach the receipt or invoice to the settlement claim. If the card statement has no matching claim, use Card statement upload to create a missing-claim request."
    if "travel" in q or "flight" in q or "hotel" in q:
        return "Travel spend requires the trip purpose and receipt. The hierarchy resolver adds finance review for travel categories."
    return "Use the corporate card for business expenses only, file settlements promptly with receipts, and escalate unclear policy cases to Administration."


def _text_from_llm_content(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, dict):
        return json.dumps(content, ensure_ascii=False)
    if isinstance(content, list):
        parts: list[str] = []
        for part in content:
            if not isinstance(part, dict):
                continue
            text = part.get("text") or part.get("content")
            if isinstance(text, str):
                parts.append(text)
            elif isinstance(text, dict):
                parts.append(json.dumps(text, ensure_ascii=False))
        return "".join(parts)
    return ""


def _content_from_choice_payload(data: dict[str, Any]) -> str:
    choices = data.get("choices") or []
    if not choices:
        output_text = data.get("output_text")
        return output_text if isinstance(output_text, str) else ""
    choice = choices[0] if isinstance(choices[0], dict) else {}
    message = choice.get("message") or {}
    delta = choice.get("delta") or {}
    for container in (message, delta):
        content = container.get("content") if isinstance(container, dict) else None
        text = _text_from_llm_content(content)
        if text:
            return text
    return ""


def _json_from_text(text: str) -> dict[str, Any] | None:
    candidates = [text.strip()]
    candidates.extend(match.strip() for match in re.findall(r"```(?:json)?\s*(.*?)```", text, re.IGNORECASE | re.DOTALL))

    for candidate in tuple(candidates):
        obj = _balanced_json_object(candidate)
        if obj and obj != candidate:
            candidates.append(obj)

    for candidate in candidates:
        if not candidate:
            continue
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed
    return None


def _balanced_json_object(text: str) -> str | None:
    start = text.find("{")
    if start < 0:
        return None

    depth = 0
    in_string = False
    escape = False
    for index, char in enumerate(text[start:], start=start):
        if in_string:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == '"':
                in_string = False
            continue

        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[start : index + 1]
    return None


def _read_router_stream(request: Request) -> str:
    with urlopen(request, timeout=90) as response:
        content_type = response.headers.get("content-type", "")
        if "text/event-stream" not in content_type:
            body = response.read().decode("utf-8", errors="replace")
            try:
                return _content_from_choice_payload(json.loads(body))
            except json.JSONDecodeError:
                return body

        parts: list[str] = []
        for raw_line in response:
            line = raw_line.decode("utf-8", errors="replace").strip()
            if not line or line.startswith(":"):
                continue
            if line.startswith("data:"):
                line = line.removeprefix("data:").strip()
            if line == "[DONE]":
                break
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            part = _content_from_choice_payload(event)
            if part:
                parts.append(part)
        return "".join(parts)


def _receipt_analysis_prompt(notes: str | None) -> str:
    return f"""Analyze this uploaded receipt, invoice, tax invoice, or card-slip image/PDF and extract accounting-ready JSON.

Expected JSON shape:
{json.dumps(RECEIPT_ANALYSIS_SCHEMA, ensure_ascii=False, indent=2)}

Rules:
- Return exactly one valid JSON object. Do not wrap it in markdown.
- Parse every visible row item when possible.
- Include categories, tags, total amount, tax, quantity, unit price, line total, merchant, transaction date, and card last4 when visible.
- If quantity or unit price is not shown, use null rather than guessing.
- If the document mixes categories, set corporate_card_hints.allocation_required=true and explain why.
- If it is a Korean tax invoice, capture business numbers and VAT details.
- If it is a restaurant/entertainment receipt, flag alcohol, late-night, weekend, or high-value signals when visible.
- Normalize numeric amounts as numbers without currency symbols or thousands separators.
- Prefer categories such as office_supplies, consumables, meals, meeting_expense, entertainment, travel_transport, fuel, lodging, software_saas, cloud_services, telecom, printing_books, shipping, repair_maintenance, equipment_asset, other.

User/context notes:
{notes or "None"}
"""


def _platform_llm(ctx: PluginContext) -> Any | None:
    """The platform LLM service (`ctx.llm`) when this runtime injected one.

    Enabled by `platform_services: ["llm"]`. Hosted it runs on the platform's
    key under the organization spend cap; under `pltt dev` it uses the
    developer's own key, or a deterministic stub when there is none. Runtimes
    without the service inject `UnavailablePlatformService`, whose attribute
    access raises, so check before trusting `chat`.
    """
    llm = getattr(ctx, "llm", None)
    if llm is None or type(llm).__name__ == "UnavailablePlatformService":
        return None
    # `LocalLLMService.live` is False when `pltt dev` found no OPENAI_API_KEY; its
    # chat() then returns a canned "[pltt dev: no LLM key] ..." string, which is
    # useless for JSON extraction. Prefer the LLM router in that case.
    if getattr(llm, "live", True) is False:
        return None
    return llm if callable(getattr(llm, "chat", None)) else None


def _chat_completions_url(base_url: str) -> str:
    """Chat-completions URL for an OpenAI-compatible base.

    The LLM router is configured as a bare origin (`http://127.0.0.1:4444`) and
    needs `/v1` added; provider bases already carry their version segment
    (`.../v1beta/openai`, `https://api.openai.com/v1`).
    """
    base = base_url.rstrip("/")
    if base.endswith("/chat/completions"):
        return base
    if base.endswith("/openai") or re.fullmatch(r".*/v\d+[a-z]*", base):
        return f"{base}/chat/completions"
    return f"{base}/v1/chat/completions"


def _chat_engines(ctx: PluginContext, *, router_model: str) -> list[tuple[str, str, str | None, str]]:
    """OpenAI-compatible engines to try, in order, as (label, base, key, model).

    The router comes first because a developer running one locally wants it
    used; its key is optional, since a local gateway may not check auth. Direct
    provider keys come next so receipt analysis still works on a machine (or a
    hosted install) with no router.
    """
    engines: list[tuple[str, str, str | None, str]] = []
    router_base = _config_value(ctx, "LLM_ROUTER_BASE_URL")
    if router_base:
        engines.append(("llm_router", router_base, _config_value(ctx, "LLM_ROUTER_API_KEY"), router_model))
    gemini_key = _config_value(ctx, "GOOGLE_AI_API_KEY")
    if gemini_key:
        engines.append((
            "gemini",
            GEMINI_OPENAI_BASE_URL,
            gemini_key,
            _config_value(ctx, "GEMINI_FLASH_LITE_MODEL") or GEMINI_FLASH_LITE_MODEL,
        ))
    openai_key = _config_value(ctx, "OPENAI_KEY")
    if openai_key:
        engines.append((
            "openai",
            OPENAI_BASE_URL,
            openai_key,
            _config_value(ctx, "OPENAI_MODEL") or OPENAI_DEFAULT_MODEL,
        ))
    return engines


def _adapt_messages_for_engine(label: str, messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Rewrite document parts to the shape a given engine accepts.

    Checked against the live Gemini OpenAI-compatible endpoint: a PDF is read
    fine as an `image_url` data URL, while a `file` part is rejected outright
    ("Invalid content part type: file"). OpenAI is the reverse and wants `file`,
    so PDF parts are converted only for that engine.
    """
    if label != "openai":
        return messages
    adapted: list[dict[str, Any]] = []
    for message in messages:
        content = message.get("content")
        if not isinstance(content, list):
            adapted.append(message)
            continue
        parts: list[Any] = []
        for part in content:
            url = part.get("image_url", {}).get("url", "") if isinstance(part, dict) and part.get("type") == "image_url" else ""
            if url.startswith("data:application/pdf"):
                parts.append({"type": "file", "file": {"filename": "document.pdf", "file_data": url}})
            else:
                parts.append(part)
        adapted.append({**message, "content": parts})
    return adapted


async def _llm_chat_text(
    ctx: PluginContext,
    *,
    system: str,
    user_content: Any,
    router_model: str,
    json_object: bool,
    purpose: str,
) -> tuple[str, str, str | None]:
    """Return (text, source, model) from the first engine that answers.

    Order: the platform LLM service (`ctx.llm`), then the LLM router, then any
    direct provider key. The router is a developer-machine service
    (`LLM_ROUTER_BASE_URL`, normally `http://127.0.0.1:4444`), so a hosted app
    that reaches for it gets ECONNREFUSED and moves on. Model ids are not shared
    across engines, so each carries its own and the platform call keeps the
    platform default rather than sending a router name like
    `gemini-2.5-flash-lite`.
    """
    messages = [{"role": "user", "content": user_content}]
    failures: list[str] = []

    llm = _platform_llm(ctx)
    if llm is not None:
        try:
            reply = await llm.chat(messages, system=system)
            if isinstance(reply, dict):
                text = str(reply.get("text") or "")
                model_used = reply.get("model")
            else:
                text = str(reply or "")
                model_used = None
            if text.strip() and not text.lstrip().startswith(DEV_LLM_STUB_PREFIX):
                return text, "platform_llm", model_used
            failures.append("platform_llm: empty response")
        except Exception as exc:  # noqa: BLE001 - any platform failure tries the next engine
            failures.append(f"platform_llm: {exc}")
        ctx.logger.warning("Platform LLM %s unavailable: %s", purpose, failures[-1])

    engines = _chat_engines(ctx, router_model=router_model)
    for label, base_url, api_key, model in engines:
        payload: dict[str, Any] = {
            "model": model,
            "messages": [{"role": "system", "content": system}, *_adapt_messages_for_engine(label, messages)],
            "temperature": 0.1,
            "stream": False,
        }
        if json_object:
            payload["response_format"] = {"type": "json_object"}
        headers = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        # Bind the loop values as defaults so the thread body cannot pick up a
        # later iteration's engine.
        def call_engine(
            url: str = _chat_completions_url(base_url),
            body: bytes = json.dumps(payload).encode("utf-8"),
            request_headers: dict[str, str] = headers,
        ) -> str:
            return _read_router_stream(Request(url, data=body, headers=request_headers, method="POST"))

        try:
            text = await asyncio.to_thread(call_engine)
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:600]
            failures.append(f"{label}: HTTP {exc.code} {detail}")
            ctx.logger.warning("%s rejected the %s request: %s", label, purpose, detail)
            continue
        except (URLError, TimeoutError, OSError) as exc:
            failures.append(f"{label}: {exc}")
            ctx.logger.warning("%s %s request failed: %s", label, purpose, exc)
            continue
        if text.strip():
            return text, label, model
        failures.append(f"{label}: empty response")

    if not engines and not failures:
        raise HTTPException(
            status_code=503,
            detail=(
                f"No LLM is available for {purpose}. Declare platform_services: [\"llm\"] for the hosted "
                "platform service, set LLM_ROUTER_BASE_URL, or provide GOOGLE_AI_API_KEY or OPENAI_KEY."
            ),
        )
    raise HTTPException(
        status_code=502,
        detail=f"Every LLM engine failed for {purpose}: " + "; ".join(failures),
    )


async def _analyze_receipt_upload(
    ctx: PluginContext,
    *,
    filename: str,
    content_type: str,
    content: bytes,
    notes: str | None = None,
) -> dict[str, Any]:
    model = _config_value(ctx, "GEMINI_FLASH_LITE_MODEL") or GEMINI_FLASH_LITE_MODEL
    encoded = base64.b64encode(content).decode("ascii")
    document_part = {"type": "image_url", "image_url": {"url": f"data:{content_type};base64,{encoded}"}}

    async def analyze(part: dict[str, Any], *, system: str, purpose: str) -> tuple[str, str, str | None]:
        return await _llm_chat_text(
            ctx,
            system=system,
            user_content=[
                {"type": "text", "text": _receipt_analysis_prompt(notes)},
                {"type": "text", "text": f"Filename: {filename}; MIME type: {content_type}"},
                part,
            ],
            router_model=model,
            json_object=True,
            purpose=purpose,
        )

    extract_system = (
        "You extract structured accounting data from invoices, receipts, tax invoices, and card slips. "
        "Return only valid JSON. Handle Korean and English documents."
    )
    response_text, source, model_used = await analyze(
        document_part, system=extract_system, purpose="receipt analysis"
    )
    parsed = _json_from_text(response_text)
    if parsed is None:
        # Prose, an apology, or a refusal instead of the object. Ask once more
        # with the instruction narrowed to nothing but JSON before giving up.
        ctx.logger.warning(
            "%s returned non-JSON receipt analysis (model=%s), retrying with a strict JSON instruction",
            source,
            model_used or model,
        )
        response_text, source, model_used = await analyze(
            document_part,
            system=(
                "You extract structured accounting data from invoices, receipts, tax invoices, and card slips. "
                "Reply with a single JSON object and nothing else: no prose, no explanation, no code fences. "
                "If a field cannot be read, use null. Handle Korean and English documents."
            ),
            purpose="receipt analysis retry",
        )
        parsed = _json_from_text(response_text)

    if parsed is None:
        parsed = {
            "document_type": "unknown",
            "confidence": 0,
            "extraction_warnings": [
                f"{source} did not return JSON for {filename} ({content_type}); "
                "the document may be unreadable for the configured model."
            ],
            "raw_response": response_text[:4000],
        }
    parsed.setdefault("source_file", {"filename": filename, "content_type": content_type})
    parsed.setdefault("model", model_used or model)
    return parsed


async def _ask_policy_question(ctx: PluginContext, payload: PolicyQuestionIn) -> tuple[str, str]:
    broker_payload = {
        "question": payload.question,
        "lang": payload.lang,
        "category": payload.category,
        "domain": payload.domain or POLICY_DOMAIN,
        "country": payload.country or DEFAULT_COUNTRY,
    }
    try:
        try:
            search_result = await services(ctx).call(POLICY_SEARCH_TARGET, broker_payload)
            if search_result:
                broker_payload["search_results"] = search_result
        except Exception as exc:
            # Not just BrokerCallError. `policy/v1#search` and `#ask` are declared
            # optional in the manifest, and a host that does not provide them
            # signals that however it likes -- the pltt dev broker raises a bare
            # RuntimeError("No local broker mock configured for ..."), which is
            # not a BrokerCallError and used to escape this whole function and
            # 500 the request. Any failure of an optional service must degrade
            # to the fallback chain below, never take the endpoint down.
            ctx.logger.warning("Policy broker search failed, continuing with ask: %s", exc)
        result = await services(ctx).call(POLICY_ASK_TARGET, broker_payload)
        if isinstance(result, dict):
            answer = result.get("answer") or result.get("text") or result.get("content")
            source = result.get("source") or result.get("resolver_source") or POLICY_ASK_TARGET
            if answer:
                return str(answer), str(source)
        elif result:
            return str(result), POLICY_ASK_TARGET
    except Exception as exc:
        # Same reasoning as the search call above: degrade, do not raise.
        ctx.logger.warning("Policy broker ask failed, falling back: %s", exc)

    try:
        answer, source, _model = await _llm_chat_text(
            ctx,
            system=(
                "Answer corporate-card policy questions concisely. "
                "Mention required settlement evidence and escalate ambiguous cases to Administration."
            ),
            user_content=payload.question,
            router_model=(
                _config_value(ctx, "LLM_ROUTER_FAST_MODEL")
                or _config_value(ctx, "LLM_ROUTER_TEXT_MODEL")
                or "text_fast"
            ),
            json_object=False,
            purpose="policy question",
        )
    except HTTPException as exc:
        ctx.logger.warning("LLM policy question failed, answering from local policy text: %s", exc.detail)
    else:
        if answer.strip():
            return answer.strip(), source

    return _fallback_policy_answer(payload.question), "local_policy"


@router.get("/talk/channels", dependencies=CHAT_WRITE)
async def talk_channels(ctx: PluginContext = Depends(get_plugin_context)) -> dict[str, Any]:
    """Where corporate-card notices can go: the channels this app's agent sits in.

    Empty until a member invites the app's agent to a channel — the only way an
    app gains access to a Talk room.
    """
    notifier = _talk_notifier(ctx)
    channels = await notifier.channels()
    return {
        "available": notifier.available,
        "configured_channel": notifier.channel,
        "resolved_channel": await notifier.resolve_channel(),
        "channels": channels,
    }


@router.get("/dependency", dependencies=READ)
async def dependency() -> dict[str, str]:
    return {
        "hierarchy_source": HIERARCHY_ROUTE_RESOLVE_TARGET,
        "hierarchy_fallback": HIERARCHY_APPROVAL_SOURCE,
        "resolver_path": "/api/v1/plugins/corporate-card-system/approval-path/resolve",
        "contract": "Corporate Card stores normalized approvers and notification events as immutable approval snapshots.",
    }


@router.get("/members", dependencies=MEMBERS_READ)
async def members(ctx: PluginContext = Depends(get_plugin_context)) -> list[dict[str, Any]]:
    """The organisation roster with app roles applied.

    A viewer only ever sees their own row; member and above see everyone in the
    organisation.
    """
    roster = await _organization_members(ctx)
    enriched = _enrich_members_with_app_roles(roster, await _role_assignments(ctx))
    overrides = await _member_locality_overrides(ctx)
    for member in enriched:
        platform_locality = _member_locality(member)
        override = overrides.get(str(member.get("id") or ""))
        member["locality_from_platform"] = platform_locality
        member["locality_override"] = override.locality if override else None
        member["locality_entered_value"] = override.entered_value if override else None
        # What the policy engine will actually use, by the same order as
        # _employee_locality(): profile first, app override second.
        member["effective_locality"] = platform_locality or (override.locality if override else None)
        member["locality_source"] = (
            "platform" if platform_locality else ("app" if override else None)
        )
    acting = _member_by_id(enriched, ctx.user_id)
    if acting is not None and str(acting.get("app_role") or "") == "viewer":
        return [acting]
    return enriched


@router.get("/role-assignments", dependencies=READ)
async def list_role_assignments(ctx: PluginContext = Depends(get_plugin_context)) -> list[dict[str, Any]]:
    return [_role_assignment_dict(item) for item in await _role_assignments(ctx)]


@router.put("/role-assignments/{member_id}", dependencies=WRITE)
async def assign_member_role(
    member_id: str,
    payload: RoleAssignmentIn,
    request: FastAPIRequest,
    ctx: PluginContext = Depends(get_plugin_context),
) -> dict[str, Any]:
    acting_member_id = _acting_member_id(ctx, request)
    if not _can_manage_role_assignments(ctx, acting_member_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only organization admins can assign corporate-card roles")
    members = await _organization_members(ctx)
    if member_id not in {str(member.get("id") or "") for member in members}:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization member not found")
    permissions = _role_permissions(payload.app_role, payload.permissions)
    assignment = await _role_assignment_for_member(ctx, member_id)
    if assignment is None:
        assignment = RoleAssignment(
            organization_id=ctx.organization_id,
            member_id=member_id,
            app_role=payload.app_role,
            permissions_json=_json_dumps_list(permissions),
            assigned_by_member_id=acting_member_id,
            assigned_at=datetime.now(UTC),
        )
        ctx.db.add(assignment)
    else:
        assignment.app_role = payload.app_role
        assignment.permissions_json = _json_dumps_list(permissions)
        assignment.assigned_by_member_id = acting_member_id
        assignment.assigned_at = datetime.now(UTC)
    await ctx.db.commit()
    await ctx.db.refresh(assignment)
    return _role_assignment_dict(assignment)


@router.delete("/dev/clear", dependencies=WRITE)
async def clear_workspace(ctx: PluginContext = Depends(get_plugin_context)) -> dict[str, Any]:
    deleted = {
        "approval_steps": await _delete_org_rows(ctx, ApprovalStep),
        "settlement_claims": await _delete_org_rows(ctx, SettlementClaim),
        "statement_rows": await _delete_org_rows(ctx, CardStatementRow),
        "statement_uploads": await _delete_org_rows(ctx, CardStatementUpload),
        "erp_exports": await _delete_org_rows(ctx, ErpExport),
        "policy_questions": await _delete_org_rows(ctx, PolicyQuestion),
        "policy_rules": await _delete_org_rows(ctx, PolicyRule),
        "pre_spend_requests": await _delete_org_rows(ctx, PreSpendRequest),
        "role_assignments": await _delete_org_rows(ctx, RoleAssignment),
        "cards": await _delete_org_rows(ctx, CorporateCard),
        "receipt_files": _delete_receipt_files(ctx.organization_id),
    }
    await ctx.db.commit()
    return {"status": "cleared", "deleted": deleted}


@router.post("/approval-path/resolve", dependencies=READ)
async def resolve_approval_path(
    payload: ApprovalPathRequest,
    request: FastAPIRequest,
    ctx: PluginContext = Depends(get_plugin_context),
) -> dict[str, Any]:
    requester_member_id = payload.requester_member_id or _acting_member_id(ctx, request)
    amount = _payload_amount(payload, allow_zero=True)
    tax_amount = _payload_tax_amount(payload)
    invoice_evidence = _invoice_evidence_from_payload(payload)
    policy_evaluation = payload.policy_evaluation or await _evaluate_policy(
        ctx,
        requester_member_id=requester_member_id,
        vendor=payload.vendor or "Approval preview",
        amount=amount,
        currency=payload.currency,
        category=payload.category or "general",
        business_purpose=payload.business_purpose or "Approval preview",
        tax_amount=tax_amount,
        tax_type=payload.tax_type,
        tax_rate_percent=payload.tax_rate_percent,
        tax_included=payload.tax_included,
        transaction_date=payload.transaction_date,
        card_last4=payload.card_last4,
        cost_center=payload.cost_center,
        project_code=payload.project_code,
        attendees=payload.attendees,
        receipt_file_url=payload.receipt_file_url,
        requested_receipt_status=payload.receipt_status,
        missing_receipt_reason=payload.missing_receipt_reason,
        invoice_evidence=invoice_evidence,
        pre_approval_id=payload.pre_approval_id,
    )
    snapshot, _ = await _resolve_hierarchy_route(
        ctx,
        target=HIERARCHY_ROUTE_PREVIEW_TARGET,
        requester_member_id=requester_member_id,
        amount=amount,
        currency=payload.currency,
        category=payload.category or "general",
        transaction={
            "vendor": payload.vendor,
            "transaction_date": payload.transaction_date,
            "card_last4": payload.card_last4,
            "cost_center": payload.cost_center,
            "project_code": payload.project_code,
            "employee_locality": policy_evaluation.get("employee_locality"),
            "invoice_evidence": invoice_evidence,
        },
        selectors={"country": policy_evaluation.get("policy_country")},
        policy_evaluation=policy_evaluation,
        workflow_type=payload.workflow_type,
    )
    snapshot["policy_evaluation"] = policy_evaluation
    return snapshot


@router.get("/summary", dependencies=READ)
async def summary(
    request: FastAPIRequest,
    ctx: PluginContext = Depends(get_plugin_context),
) -> dict[str, Any]:
    acting_member_id = _acting_member_id(ctx, request)
    cards = await ctx.repo(CorporateCard).list(order_by="member_name", limit=500)
    claims = await _claims(ctx)
    pre_spend_requests = await _pre_spend_requests(ctx)
    existing_statement_rows = await _statement_rows(ctx)
    steps_by_claim = await _steps_for_claims(ctx, [claim.id for claim in claims])
    serialized_claims = [_claim_dict(claim, steps_by_claim.get(claim.id, [])) for claim in claims]
    statement_rows = await _statement_rows(ctx)
    statement_uploads = await _statement_uploads(ctx)
    erp_exports = await _erp_exports(ctx)
    policy_questions = await _policy_questions(ctx)
    pre_spend_requests = await _pre_spend_requests(ctx)
    pending_for_me = [
        claim
        for claim in serialized_claims
        if any(
            step["state"] == "pending" and step["approver_member_id"] == acting_member_id
            for step in claim["steps"]
        )
    ]
    return {
        "cards": [_card_dict(card) for card in cards],
        "claims": serialized_claims,
        "pending_for_me": pending_for_me,
        "statement_uploads": [_statement_upload_dict(upload) for upload in statement_uploads],
        "statement_rows": [_statement_row_dict(row) for row in statement_rows],
        "missing_claims": [_statement_row_dict(row) for row in statement_rows if row.match_status in STATEMENT_NEEDS_CLAIM_STATUSES],
        "erp_exports": [_erp_export_dict(export) for export in erp_exports],
        "policy_questions": [_policy_question_dict(question) for question in policy_questions],
        "pre_spend_requests": [_pre_spend_dict(item) for item in pre_spend_requests],
        "counts": {
            "cards": len(cards),
            "claims": len(claims),
            "pending": sum(1 for claim in claims if claim.state == "pending"),
            "approved": sum(1 for claim in claims if claim.state == "approved"),
            "rejected": sum(1 for claim in claims if claim.state == "rejected"),
            "needs_info": sum(1 for claim in claims if claim.state == "needs_info"),
            "policy_blocked": sum(1 for claim in claims if claim.policy_status == "blocked"),
            "pre_spend_pending": sum(1 for item in pre_spend_requests if item.state == "pending"),
            "statement_rows": len(statement_rows),
            "missing_claims": sum(1 for row in statement_rows if row.match_status in STATEMENT_NEEDS_CLAIM_STATUSES),
        },
    }


@router.get("/monitoring", dependencies=READ)
async def monitoring(ctx: PluginContext = Depends(get_plugin_context)) -> dict[str, Any]:
    claims = await _claims(ctx)
    statement_rows = await _statement_rows(ctx)
    pre_spend_requests = await _pre_spend_requests(ctx)
    return _monitoring_payload(
        claims=claims,
        statement_rows=statement_rows,
        pre_spend_requests=pre_spend_requests,
    )


@router.put("/member-locality/{member_id}", dependencies=WRITE)
async def set_member_locality(
    member_id: str,
    payload: MemberLocalityIn,
    request: FastAPIRequest,
    ctx: PluginContext = Depends(get_plugin_context),
) -> dict[str, Any]:
    """Record a work locality for a member, until the platform profile has one.

    Admin-only, like role assignment: locality decides which tax and evidence
    rules a person's spending is held to, so it is not a self-service field.
    """
    acting_member_id = _acting_member_id(ctx, request)
    if not _can_manage_role_assignments(ctx, acting_member_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only organization admins can set a member locality")
    members = await _organization_members(ctx)
    if member_id not in {str(member.get("id") or "") for member in members}:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found in this organization")

    entered = (payload.locality or "").strip()
    existing = (await _member_locality_overrides(ctx)).get(member_id)
    if not entered:
        if existing is not None:
            await ctx.repo(MemberLocality).delete(existing.id)
        return {"member_id": member_id, "locality": None, "entered_value": None}

    resolved = _normalize_employee_locality(entered)
    if not resolved:
        supported = ", ".join(sorted(POLICY_PROFILES))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"'{entered}' is not a supported locality. Use a country code or name "
                f"({supported}), or a city such as Seoul or Bengaluru."
            ),
        )
    if existing is None:
        row = await ctx.repo(MemberLocality).create(
            member_id=member_id,
            locality=resolved,
            entered_value=entered,
            set_by_member_id=acting_member_id,
        )
    else:
        existing.locality = resolved
        existing.entered_value = entered
        existing.set_by_member_id = acting_member_id
        await ctx.db.commit()
        await ctx.db.refresh(existing)
        row = existing
    return {
        "member_id": row.member_id,
        "locality": row.locality,
        "entered_value": row.entered_value,
    }


@router.post("/cards", dependencies=WRITE)
async def create_card(
    payload: CardIn,
    request: FastAPIRequest,
    ctx: PluginContext = Depends(get_plugin_context),
) -> dict[str, Any]:
    acting_member_id = _acting_member_id(ctx, request)
    if not _can_manage_role_assignments(ctx, acting_member_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only organization admins can manage corporate cards")
    values = payload.model_dump()
    monthly_limit = _payload_monthly_limit(payload)
    values["label"] = values["label"].strip()
    values["last4"] = values["last4"][-4:]
    values["monthly_limit_cents"] = monthly_limit
    values.pop("monthly_limit", None)
    card = await ctx.repo(CorporateCard).create(**values, status="active")
    return _card_dict(card)


@router.post("/cards/{card_id}/deactivate", dependencies=WRITE)
async def deactivate_card(
    card_id: int,
    request: FastAPIRequest,
    ctx: PluginContext = Depends(get_plugin_context),
) -> dict[str, Any]:
    acting_member_id = _acting_member_id(ctx, request)
    if not _can_manage_role_assignments(ctx, acting_member_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only organization admins can manage corporate cards")
    card = await ctx.repo(CorporateCard).get(card_id)
    if card is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Card not found")
    card.status = "inactive"
    await ctx.db.commit()
    await ctx.db.refresh(card)
    return _card_dict(card)


@router.get("/pre-spend-requests", dependencies=READ)
async def list_pre_spend_requests(ctx: PluginContext = Depends(get_plugin_context)) -> list[dict[str, Any]]:
    return [_pre_spend_dict(item) for item in await _pre_spend_requests(ctx)]


@router.post("/pre-spend-requests", dependencies=WRITE)
async def create_pre_spend_request(
    payload: PreSpendRequestIn,
    request: FastAPIRequest,
    ctx: PluginContext = Depends(get_plugin_context),
) -> dict[str, Any]:
    acting_member_id = _acting_member_id(ctx, request)
    request_type = _normalized_pre_spend_request_type(payload.request_type)
    vendor = _pre_spend_vendor(payload, request_type)
    trip_area = _clean_optional_text(payload.trip_area)
    trip_start_date = _clean_optional_text(payload.trip_start_date)
    trip_end_date = _clean_optional_text(payload.trip_end_date)
    expected_purchase_date = _clean_optional_text(payload.expected_purchase_date)
    budget_items = _pre_spend_budget_items(payload.budget_items)
    category = "travel" if request_type == "business_trip" else payload.category
    amount = _payload_amount(payload)
    invoice_evidence = _invoice_evidence_from_payload(payload)

    if request_type == "business_trip":
        if not trip_area:
            raise HTTPException(status_code=400, detail="Business-trip pre-approval requires an approximate destination or area")
        _ensure_trip_dates_are_ordered(trip_start_date, trip_end_date)
        expected_purchase_date = expected_purchase_date or trip_start_date
        budget_total = _budget_total(budget_items)
        if budget_items and abs(budget_total - amount) > _budget_tolerance(amount):
            raise HTTPException(
                status_code=400,
                detail="Business-trip budget split-up should total close to the expected spend",
            )

    evaluation = await _evaluate_policy(
        ctx,
        requester_member_id=acting_member_id,
        vendor=vendor,
        amount=amount,
        currency=payload.currency,
        category=category,
        business_purpose=payload.business_purpose,
        transaction_date=expected_purchase_date,
        cost_center=payload.cost_center,
        project_code=payload.project_code,
        attendees=payload.attendees,
        requested_receipt_status="not_required",
        request_type=request_type,
        trip_area=trip_area,
        budget_items=budget_items,
        invoice_evidence=invoice_evidence,
        source="pre_spend",
    )
    hard_blocks = [
        item for item in evaluation.get("hard_blocks", [])
        if isinstance(item, dict) and item.get("code") != "receipt_required"
    ]
    if hard_blocks:
        evaluation["hard_blocks"] = hard_blocks
        evaluation["status"] = "blocked"
        raise HTTPException(status_code=400, detail={"message": "Pre-spend request failed policy controls", "policy_evaluation": evaluation})

    snapshot, _ = await _resolve_hierarchy_route(
        ctx,
        target=HIERARCHY_ROUTE_PREVIEW_TARGET,
        requester_member_id=acting_member_id,
        amount=amount,
        currency=payload.currency,
        category=category,
        transaction={
            "vendor": vendor,
            "request_type": request_type,
            "transaction_date": expected_purchase_date,
            "trip_area": trip_area,
            "trip_start_date": trip_start_date,
            "trip_end_date": trip_end_date,
            "budget_items": budget_items,
            "cost_center": payload.cost_center,
            "project_code": payload.project_code,
            "employee_locality": evaluation.get("employee_locality"),
            "invoice_evidence": invoice_evidence,
        },
        selectors={"country": evaluation.get("policy_country")},
        policy_evaluation=evaluation,
        workflow_type="corporate_card_pre_spend",
    )
    snapshot["policy_evaluation"] = evaluation
    item = PreSpendRequest(
        organization_id=ctx.organization_id,
        requester_member_id=acting_member_id,
        requester_name=payload.requester_name,
        request_type=request_type,
        vendor=vendor,
        amount_cents=amount,
        currency=payload.currency,
        employee_locality=evaluation.get("employee_locality"),
        category=category,
        business_purpose=payload.business_purpose.strip(),
        expected_purchase_date=expected_purchase_date,
        trip_area=trip_area,
        trip_start_date=trip_start_date,
        trip_end_date=trip_end_date,
        budget_items_json=_json_dumps_list(budget_items),
        cost_center=payload.cost_center,
        project_code=payload.project_code,
        attendees_json=_json_dumps_list(payload.attendees),
        state="pending",
        approval_snapshot_json=_json_dumps(snapshot),
        policy_evaluation_json=_json_dumps(evaluation),
    )
    _assign_invoice_evidence(item, invoice_evidence)
    ctx.db.add(item)
    await ctx.db.flush()
    notification_events = ApprovalWorkflowService(ctx).submitted_pre_spend_events(
        request_id=item.id,
        requester_member_id=acting_member_id,
        approvers=snapshot.get("approvers") if isinstance(snapshot.get("approvers"), list) else [],
    )
    snapshot["notification_events"] = [*snapshot.get("notification_events", []), *notification_events]
    item.approval_snapshot_json = _json_dumps(snapshot)
    await ctx.db.commit()
    await ctx.db.refresh(item)
    return _pre_spend_dict(item)


@router.post("/pre-spend-requests/{request_id}/decide", dependencies=WRITE)
async def decide_pre_spend_request(
    request_id: int,
    payload: DecisionIn,
    request: FastAPIRequest,
    ctx: PluginContext = Depends(get_plugin_context),
) -> dict[str, Any]:
    acting_member_id = _acting_member_id(ctx, request)
    item = await _require_pre_spend(ctx, request_id)
    memo = (payload.memo or "").strip()
    if item.state != "pending":
        raise HTTPException(status_code=400, detail="Pre-spend request is not pending")
    if acting_member_id == item.requester_member_id:
        raise HTTPException(status_code=403, detail="Requesters cannot approve their own pre-spend request")
    if payload.action == "rejected" and not memo:
        raise HTTPException(status_code=400, detail="A rejection reason is required")
    item.state = "approved" if payload.action == "approved" else "rejected"
    item.decided_by_member_id = acting_member_id
    item.decision_memo = memo or "Approved pre-spend request"
    item.decided_at = datetime.now(UTC)
    snapshot = _json_loads(item.approval_snapshot_json)
    notification_events = snapshot.get("notification_events") if isinstance(snapshot.get("notification_events"), list) else []
    notification_events.append(
        ApprovalWorkflowService(ctx).decision_event(
            APPROVAL_APPROVED if item.state == "approved" else APPROVAL_REJECTED,
            request_id=item.id,
            requester_member_id=item.requester_member_id,
            actor_member_id=acting_member_id,
            state=item.state,
        )
    )
    snapshot["notification_events"] = notification_events
    item.approval_snapshot_json = _json_dumps(snapshot)
    await ctx.db.commit()
    await ctx.db.refresh(item)
    return _pre_spend_dict(item)


@router.post("/pre-spend-requests/{request_id}/link-claim", dependencies=WRITE)
async def link_pre_spend_to_claim(
    request_id: int,
    payload: LinkPreSpendIn,
    request: FastAPIRequest,
    ctx: PluginContext = Depends(get_plugin_context),
) -> dict[str, Any]:
    acting_member_id = _acting_member_id(ctx, request)
    item = await _require_pre_spend(ctx, request_id)
    claim = await _require_claim(ctx, payload.claim_id)
    if item.state not in {"approved", "used"}:
        raise HTTPException(status_code=400, detail="Only approved pre-spend requests can be linked")
    if item.requester_member_id != claim.requester_member_id:
        raise HTTPException(status_code=400, detail="Pre-spend request and claim requester do not match")
    if claim.requester_member_id != acting_member_id and acting_member_id != ctx.user_id:
        raise HTTPException(status_code=403, detail="Only requester or current user can link this claim")
    evaluation = await _evaluate_policy(
        ctx,
        requester_member_id=claim.requester_member_id,
        vendor=claim.vendor,
        amount=claim.amount_cents,
        currency=claim.currency,
        category=claim.category,
        business_purpose=claim.business_purpose,
        tax_amount=claim.tax_amount_cents,
        tax_type=claim.tax_type,
        tax_rate_percent=claim.tax_rate_percent,
        tax_included=claim.tax_included,
        transaction_date=claim.transaction_date,
        card_last4=claim.card_last4,
        cost_center=claim.cost_center,
        project_code=claim.project_code,
        attendees=[str(value) for value in _json_list(claim.attendees_json)],
        receipt_file_url=claim.receipt_file_url,
        requested_receipt_status=claim.receipt_status,
        missing_receipt_reason=claim.missing_receipt_reason,
        invoice_evidence=_invoice_evidence_from_model(claim),
        pre_approval_id=item.id,
        exclude_claim_id=claim.id,
    )
    if evaluation["status"] == "blocked":
        raise HTTPException(status_code=400, detail={"message": "Claim still fails policy controls", "policy_evaluation": evaluation})
    claim.pre_approval_id = item.id
    claim.policy_status = _claim_policy_status(evaluation, has_pre_approval=True)
    claim.policy_evaluation_json = _json_dumps(evaluation)
    await ctx.db.flush()
    await _mark_pre_spend_linked(ctx, item, claim.id)
    await ctx.db.commit()
    steps = (await _steps_for_claims(ctx, [claim.id])).get(claim.id, [])
    return {"pre_spend_request": _pre_spend_dict(item), "claim": _claim_dict(claim, steps)}


@router.post("/claims", dependencies=WRITE)
async def create_claim(
    payload: ClaimIn,
    request: FastAPIRequest,
    ctx: PluginContext = Depends(get_plugin_context),
) -> dict[str, Any]:
    acting_member_id = _acting_member_id(ctx, request)
    amount = _payload_amount(payload)
    tax_amount = _payload_tax_amount(payload)
    invoice_evidence = _invoice_evidence_from_payload(payload)
    policy_evaluation = await _evaluate_policy(
        ctx,
        requester_member_id=acting_member_id,
        vendor=payload.vendor,
        amount=amount,
        currency=payload.currency,
        category=payload.category,
        business_purpose=payload.business_purpose,
        tax_amount=tax_amount,
        tax_type=payload.tax_type,
        tax_rate_percent=payload.tax_rate_percent,
        tax_included=payload.tax_included,
        transaction_date=payload.transaction_date,
        card_last4=payload.card_last4,
        cost_center=payload.cost_center,
        project_code=payload.project_code,
        attendees=payload.attendees,
        receipt_file_url=payload.receipt_file_url,
        requested_receipt_status=payload.receipt_status,
        missing_receipt_reason=payload.missing_receipt_reason,
        invoice_evidence=invoice_evidence,
        pre_approval_id=payload.pre_approval_id,
        receipt_analysis=payload.receipt_analysis,
    )
    if policy_evaluation["status"] == "blocked":
        # Name the failing controls in the log; a bare 400 in the dev console
        # gives no clue which control rejected the claim.
        ctx.logger.warning(
            "Claim blocked by policy controls: %s",
            ", ".join(str(block.get("code") or block) for block in policy_evaluation.get("hard_blocks") or []) or "unspecified",
        )
        raise HTTPException(status_code=400, detail={"message": "Claim failed policy controls", "policy_evaluation": policy_evaluation})

    snapshot, approvers = await _resolve_hierarchy_route(
        ctx,
        target=HIERARCHY_ROUTE_RESOLVE_TARGET,
        requester_member_id=acting_member_id,
        amount=amount,
        currency=payload.currency,
        category=payload.category,
        transaction={
            "vendor": payload.vendor,
            "transaction_date": payload.transaction_date,
            "card_last4": payload.card_last4,
            "cost_center": payload.cost_center,
            "project_code": payload.project_code,
            "pre_approval_id": payload.pre_approval_id,
            "employee_locality": policy_evaluation.get("employee_locality"),
            "invoice_evidence": invoice_evidence,
        },
        selectors={"country": policy_evaluation.get("policy_country")},
        policy_evaluation=policy_evaluation,
    )
    snapshot["policy_evaluation"] = policy_evaluation

    claim = SettlementClaim(
        organization_id=ctx.organization_id,
        requester_member_id=acting_member_id,
        requester_name=payload.requester_name,
        vendor=payload.vendor.strip(),
        amount_cents=amount,
        currency=payload.currency,
        employee_locality=policy_evaluation.get("employee_locality"),
        tax_amount_cents=tax_amount,
        tax_type=_normalized_tax_type(payload.tax_type, payload.currency),
        tax_rate_percent=payload.tax_rate_percent if payload.tax_rate_percent is not None else _default_tax_rate(payload.currency),
        tax_included=payload.tax_included,
        category=payload.category,
        business_purpose=payload.business_purpose.strip(),
        transaction_date=payload.transaction_date,
        card_last4=payload.card_last4[-4:] if payload.card_last4 else None,
        cost_center=payload.cost_center,
        project_code=payload.project_code,
        attendees_json=_json_dumps_list(payload.attendees),
        receipt_file_url=payload.receipt_file_url,
        receipt_status=policy_evaluation["receipt_status"],
        missing_receipt_reason=payload.missing_receipt_reason,
        pre_approval_id=payload.pre_approval_id,
        policy_status=_claim_policy_status(policy_evaluation, has_pre_approval=payload.pre_approval_id is not None),
        policy_evaluation_json=_json_dumps(policy_evaluation),
        state="pending",
        approval_snapshot_json=_json_dumps(snapshot),
    )
    _assign_invoice_evidence(claim, invoice_evidence)
    ctx.db.add(claim)
    await ctx.db.flush()
    if payload.pre_approval_id is not None:
        pre_spend = await _require_pre_spend(ctx, payload.pre_approval_id)
        await _mark_pre_spend_linked(ctx, pre_spend, claim.id)

    notification_events = await _create_approval_steps(
        ctx,
        claim_id=claim.id,
        requester_member_id=acting_member_id,
        approvers=approvers,
    )
    snapshot["notification_events"] = [*snapshot.get("notification_events", []), *notification_events]
    claim.approval_snapshot_json = _json_dumps(snapshot)
    await ctx.db.commit()
    await ctx.db.refresh(claim)
    steps = (await _steps_for_claims(ctx, [claim.id])).get(claim.id, [])
    next_approver = next((step.approver_name or step.approver_member_id for step in steps if step.state == "pending"), None)
    await _talk_notifier(ctx).post(
        f"Settlement submitted · {claim.vendor} · {_talk_amount(claim.amount_cents, claim.currency)}"
        f" · requested by {claim.requester_name}"
        + (f" · waiting on {next_approver}" if next_approver else "")
    )
    return _claim_dict(claim, steps)


@router.post("/receipts/upload", dependencies=WRITE)
async def upload_receipt(
    request: FastAPIRequest,
    file: UploadFile = File(description="Receipt/invoice image or PDF"),
    ctx: PluginContext = Depends(get_plugin_context),
) -> dict[str, Any]:
    content_type = file.content_type or "application/octet-stream"
    if content_type not in SUPPORTED_RECEIPT_TYPES:
        raise HTTPException(status_code=415, detail=f"Unsupported file type: {content_type}")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    if len(content) > MAX_RECEIPT_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File is too large")

    storage_mode = os.environ.get("CORPORATE_CARD_STORAGE_MODE", "auto")
    if should_use_platform_storage(storage_mode, ctx.storage):
        stored = await PlatformReceiptStorage(ctx.storage).upload(
            filename=file.filename or "receipt",
            content_type=content_type,
            content=content,
        )
    else:
        stored = local_receipt_storage(_receipt_storage_root()).upload(
            request=request,
            organization_id=ctx.organization_id,
            filename=file.filename or "receipt",
            content_type=content_type,
            content=content,
        )
    return {
        "status": "uploaded",
        "filename": stored.filename,
        "content_type": stored.content_type,
        "size": stored.size,
        "url": stored.url,
        "object_path": stored.object_path,
        "storage_backend": stored.backend,
    }


@router.get("/receipts/{filename}", dependencies=READ)
async def get_receipt_upload(
    filename: str,
    download: bool = Query(default=False),
    ctx: PluginContext = Depends(get_plugin_context),
) -> FileResponse:
    safe_filename = Path(filename).name
    if safe_filename != filename or not safe_filename or SAFE_FILENAME_RE.search(safe_filename):
        raise HTTPException(status_code=404, detail="Receipt not found")
    path = local_receipt_storage(_receipt_storage_root()).path_for(ctx.organization_id, safe_filename)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Receipt not found")
    media_type = mimetypes.guess_type(safe_filename)[0] or "application/octet-stream"
    return FileResponse(
        path,
        media_type=media_type,
        filename=safe_filename,
        content_disposition_type="attachment" if download else "inline",
    )


@router.post("/receipt/analyze", dependencies=WRITE)
async def analyze_receipt(
    file: UploadFile = File(description="Receipt/invoice image or PDF"),
    notes: str | None = Form(default=None),
    ctx: PluginContext = Depends(get_plugin_context),
) -> dict[str, Any]:
    content_type = file.content_type or "application/octet-stream"
    if content_type not in SUPPORTED_RECEIPT_TYPES:
        raise HTTPException(status_code=415, detail=f"Unsupported file type: {content_type}")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    if len(content) > MAX_RECEIPT_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File is too large")

    analysis = await _analyze_receipt_upload(
        ctx,
        filename=file.filename or "receipt-upload",
        content_type=content_type,
        content=content,
        notes=notes,
    )
    merchant = analysis.get("merchant") if isinstance(analysis.get("merchant"), dict) else {}
    amounts = analysis.get("amounts") if isinstance(analysis.get("amounts"), dict) else {}
    document = analysis.get("document") if isinstance(analysis.get("document"), dict) else {}
    hints = analysis.get("corporate_card_hints") if isinstance(analysis.get("corporate_card_hints"), dict) else {}
    return {
        "status": "analyzed",
        "source_file": file.filename,
        "analysis": analysis,
        "draft": {
            "vendor": merchant.get("name"),
            "amount": amounts.get("total") or amounts.get("paid"),
            "currency": document.get("currency") or "KRW",
            "tax_amount": amounts.get("tax"),
            "tax_type": _normalized_tax_type(None, document.get("currency") or "KRW"),
            "tax_rate_percent": _default_tax_rate(document.get("currency") or "KRW"),
            "tax_included": True,
            "supplier_gstin": merchant.get("tax_id"),
            "supplier_business_registration_number": merchant.get("business_number"),
            "supplier_legal_name": merchant.get("name"),
            "invoice_number": document.get("invoice_number") or document.get("receipt_number"),
            "invoice_date": document.get("transaction_date"),
            "payment_method": document.get("payment_method"),
            "cash_receipt_reference": document.get("receipt_number"),
            "transaction_date": document.get("transaction_date"),
            "card_last4": document.get("card_last4"),
            "category": hints.get("suggested_account_name") or hints.get("suggested_account_code"),
            "allocation_required": hints.get("allocation_required"),
            "allocation_reason": hints.get("allocation_reason"),
            "policy_flags": hints.get("policy_flags") or [],
            "line_items": analysis.get("line_items", []),
        },
    }


@router.post("/claims/{claim_id}/decide", dependencies=WRITE)
async def decide_claim(
    claim_id: int,
    payload: DecisionIn,
    request: FastAPIRequest,
    ctx: PluginContext = Depends(get_plugin_context),
) -> dict[str, Any]:
    acting_member_id = _acting_member_id(ctx, request)
    memo = (payload.memo or "").strip()
    if payload.action == "rejected" and not memo:
        raise HTTPException(status_code=400, detail="A rejection reason is required")

    claim = await _require_claim(ctx, claim_id)
    if claim.policy_status == "blocked":
        raise HTTPException(status_code=400, detail="Blocked claims cannot be approved")
    steps = (await _steps_for_claims(ctx, [claim.id])).get(claim.id, [])
    pending_steps = [step for step in steps if step.state == "pending"]
    if not pending_steps:
        raise HTTPException(status_code=400, detail="No pending approval step")

    step = next((item for item in pending_steps if item.approver_member_id == acting_member_id), None)
    decision_source = "assigned_approver"
    if step is None and acting_member_id == ctx.user_id and ctx.org_role in {"owner", "admin"}:
        if acting_member_id == claim.requester_member_id:
            raise HTTPException(status_code=403, detail="Requesters cannot approve their own claim")
        if not memo:
            raise HTTPException(status_code=400, detail="Delegated admin approval requires a memo")
        step = pending_steps[0]
        decision_source = "admin_delegate_override"
    if step is None:
        raise HTTPException(status_code=403, detail="Current member is not the pending approver")
    if step.approver_member_id == claim.requester_member_id:
        raise HTTPException(status_code=400, detail="Requester cannot be an approver on this claim")

    step.state = payload.action
    step.decision_memo = memo or "Approved in Palette OS"
    step.decision_source = decision_source
    step.decided_by_member_id = acting_member_id
    step.decided_at = datetime.now(UTC)

    if payload.action == "rejected":
        claim.state = "rejected"
    else:
        remaining = [item for item in pending_steps if item.id != step.id]
        claim.state = "approved" if not remaining else "pending"
        if claim.state == "approved" and claim.policy_status in {"warning", "exception_required"}:
            claim.policy_status = "exception_approved"
    snapshot = _json_loads(claim.approval_snapshot_json)
    notification_events = snapshot.get("notification_events") if isinstance(snapshot.get("notification_events"), list) else []
    notification_events.append(
        ApprovalWorkflowService(ctx).decision_event(
            APPROVAL_APPROVED if payload.action == "approved" else APPROVAL_REJECTED,
            claim_id=claim.id,
            requester_member_id=claim.requester_member_id,
            actor_member_id=acting_member_id,
            state=claim.state,
        )
    )
    snapshot["notification_events"] = notification_events
    claim.approval_snapshot_json = _json_dumps(snapshot)

    await ctx.db.commit()
    await ctx.db.refresh(claim)
    steps = (await _steps_for_claims(ctx, [claim.id])).get(claim.id, [])
    decision_word = "rejected" if payload.action == "rejected" else ("approved" if claim.state == "approved" else "approved one step")
    await _talk_notifier(ctx).post(
        f"Settlement {decision_word} · {claim.vendor} · {_talk_amount(claim.amount_cents, claim.currency)}"
        f" · {claim.requester_name}" + (f" · {memo}" if memo else "")
    )
    return _claim_dict(claim, steps)


@router.post("/claims/{claim_id}/resubmit", dependencies=WRITE)
async def resubmit_claim(
    claim_id: int,
    payload: ResubmitClaimIn,
    request: FastAPIRequest,
    ctx: PluginContext = Depends(get_plugin_context),
) -> dict[str, Any]:
    acting_member_id = _acting_member_id(ctx, request)
    claim = await _require_claim(ctx, claim_id)
    if claim.requester_member_id != acting_member_id:
        raise HTTPException(status_code=403, detail="Only the requester can resubmit this claim")
    if claim.state not in {"rejected", "needs_info"}:
        raise HTTPException(status_code=400, detail="Only rejected or needs-info claims can be resubmitted")

    previous_steps = (await _steps_for_claims(ctx, [claim.id])).get(claim.id, [])
    previous_snapshot = _json_loads(claim.approval_snapshot_json)
    next_receipt_url = payload.receipt_file_url if payload.receipt_file_url is not None else claim.receipt_file_url
    next_receipt_status = payload.receipt_status or claim.receipt_status
    next_missing_reason = payload.missing_receipt_reason if payload.missing_receipt_reason is not None else claim.missing_receipt_reason
    next_cost_center = payload.cost_center if payload.cost_center is not None else claim.cost_center
    next_project_code = payload.project_code if payload.project_code is not None else claim.project_code
    next_attendees = payload.attendees or [str(value) for value in _json_list(claim.attendees_json)]
    next_pre_approval_id = payload.pre_approval_id if payload.pre_approval_id is not None else claim.pre_approval_id
    next_invoice_evidence = _invoice_evidence_from_model(claim)
    for field, value in _invoice_evidence_from_payload(payload).items():
        if value is not None:
            next_invoice_evidence[field] = value
    policy_evaluation = await _evaluate_policy(
        ctx,
        requester_member_id=claim.requester_member_id,
        vendor=claim.vendor,
        amount=claim.amount_cents,
        currency=claim.currency,
        category=claim.category,
        business_purpose=payload.business_purpose,
        tax_amount=claim.tax_amount_cents,
        tax_type=claim.tax_type,
        tax_rate_percent=claim.tax_rate_percent,
        tax_included=claim.tax_included,
        transaction_date=claim.transaction_date,
        card_last4=claim.card_last4,
        cost_center=next_cost_center,
        project_code=next_project_code,
        attendees=next_attendees,
        receipt_file_url=next_receipt_url,
        requested_receipt_status=next_receipt_status,
        missing_receipt_reason=next_missing_reason,
        invoice_evidence=next_invoice_evidence,
        pre_approval_id=next_pre_approval_id,
        exclude_claim_id=claim.id,
    )
    if policy_evaluation["status"] == "blocked":
        # Name the failing controls in the log; a bare 400 in the dev console
        # gives no clue which control rejected the claim.
        ctx.logger.warning(
            "Claim blocked by policy controls: %s",
            ", ".join(str(block.get("code") or block) for block in policy_evaluation.get("hard_blocks") or []) or "unspecified",
        )
        raise HTTPException(status_code=400, detail={"message": "Claim failed policy controls", "policy_evaluation": policy_evaluation})
    snapshot, approvers = await _resolve_hierarchy_route(
        ctx,
        target=HIERARCHY_ROUTE_RESOLVE_TARGET,
        requester_member_id=claim.requester_member_id,
        amount=claim.amount_cents,
        currency=claim.currency,
        category=claim.category,
        transaction={
            "vendor": claim.vendor,
            "transaction_date": claim.transaction_date,
            "card_last4": claim.card_last4,
            "cost_center": next_cost_center,
            "project_code": next_project_code,
            "pre_approval_id": next_pre_approval_id,
            "employee_locality": policy_evaluation.get("employee_locality"),
            "invoice_evidence": next_invoice_evidence,
        },
        selectors={"country": policy_evaluation.get("policy_country")},
        policy_evaluation=policy_evaluation,
    )
    history = previous_snapshot.get("history")
    if not isinstance(history, list):
        history = []
    history.append(
        {
            "event": "resubmitted",
            "at": datetime.now(UTC).isoformat(),
            "member_id": acting_member_id,
            "comment": payload.comment.strip(),
            "previous_business_purpose": claim.business_purpose,
            "previous_steps": [_step_dict(step) for step in previous_steps],
        }
    )
    snapshot["history"] = history
    snapshot["policy_evaluation"] = policy_evaluation

    claim.business_purpose = payload.business_purpose.strip()
    claim.receipt_file_url = next_receipt_url
    claim.receipt_status = policy_evaluation["receipt_status"]
    claim.missing_receipt_reason = next_missing_reason
    claim.cost_center = next_cost_center
    claim.project_code = next_project_code
    claim.attendees_json = _json_dumps_list(next_attendees)
    claim.employee_locality = policy_evaluation.get("employee_locality")
    _assign_invoice_evidence(claim, next_invoice_evidence)
    claim.pre_approval_id = next_pre_approval_id
    claim.policy_status = _claim_policy_status(policy_evaluation, has_pre_approval=next_pre_approval_id is not None)
    claim.policy_evaluation_json = _json_dumps(policy_evaluation)
    claim.approval_snapshot_json = _json_dumps(snapshot)
    claim.state = "pending"
    await ctx.db.execute(
        delete(ApprovalStep).where(
            ApprovalStep.organization_id == ctx.organization_id,
            ApprovalStep.claim_id == claim.id,
        )
    )
    notification_events = await _create_approval_steps(
        ctx,
        claim_id=claim.id,
        requester_member_id=claim.requester_member_id,
        approvers=approvers,
    )
    notification_events.append(
        ApprovalWorkflowService(ctx).decision_event(
            APPROVAL_RESUBMITTED,
            claim_id=claim.id,
            requester_member_id=claim.requester_member_id,
            actor_member_id=acting_member_id,
            state="pending",
        )
    )
    snapshot["notification_events"] = [*snapshot.get("notification_events", []), *notification_events]
    claim.approval_snapshot_json = _json_dumps(snapshot)
    if next_pre_approval_id is not None:
        pre_spend = await _require_pre_spend(ctx, next_pre_approval_id)
        await ctx.db.flush()
        await _mark_pre_spend_linked(ctx, pre_spend, claim.id)
    await ctx.db.commit()
    await ctx.db.refresh(claim)
    steps = (await _steps_for_claims(ctx, [claim.id])).get(claim.id, [])
    return _claim_dict(claim, steps)


@router.post("/statements/upload", dependencies=WRITE)
async def upload_statement(
    payload: StatementUploadIn,
    request: FastAPIRequest,
    ctx: PluginContext = Depends(get_plugin_context),
) -> dict[str, Any]:
    acting_member_id = _acting_member_id(ctx, request)
    rows = payload.rows or (_parse_statement_csv(payload.csv_text or "") if payload.csv_text else [])
    if not rows:
        raise HTTPException(status_code=400, detail="No statement rows found")

    claims = await _claims(ctx)
    existing_statement_rows = await _statement_rows(ctx)
    pre_spend_requests = await _pre_spend_requests(ctx)
    upload = CardStatementUpload(
        organization_id=ctx.organization_id,
        filename=payload.filename,
        row_count=len(rows),
        matched_count=0,
        missing_count=0,
        uploaded_by_member_id=acting_member_id,
    )
    ctx.db.add(upload)
    await ctx.db.flush()

    stored_rows: list[CardStatementRow] = []
    matched_count = 0
    missing_count = 0
    for row in rows:
        amount_cents = _row_amount(row)
        if amount_cents <= 0:
            continue

        duplicate = next((existing for existing in existing_statement_rows if _statement_row_equivalent(row, existing)), None)
        if duplicate:
            match = None
            pre_approval = None
            match_status = "duplicate"
            reconciliation = {
                "status": "duplicate",
                "reason": "duplicate_statement_row",
                "confidence": 100,
                "duplicate_of_statement_row_id": duplicate.id,
                "claim_id": duplicate.match_claim_id,
                "pre_approval_id": duplicate.match_pre_approval_id,
                "required_actions": [],
            }
        else:
            match, reconciliation = _claim_matches_statement(row, claims)
            pre_approval = None
            match_status = "matched" if match else "missing"
            if not match:
                pre_approval, reconciliation = await _pre_spend_matches_statement(ctx, row, pre_spend_requests)
                match_status = "pre_approval_matched" if pre_approval else "missing"

        if match_status == "matched":
            matched_count += 1
        elif match_status in STATEMENT_NEEDS_CLAIM_STATUSES:
            missing_count += 1
        stored = CardStatementRow(
            organization_id=ctx.organization_id,
            upload_id=upload.id,
            transaction_date=row.transaction_date,
            card_last4=row.card_last4,
            cardholder_member_id=row.cardholder_member_id,
            cardholder_name=row.cardholder_name,
            vendor=row.vendor.strip(),
            amount_cents=amount_cents,
            currency=row.currency,
            category=row.category,
            match_status=match_status,
            match_claim_id=match.id if match else None,
            match_pre_approval_id=pre_approval.id if pre_approval else None,
            reconciliation_json=_json_dumps(reconciliation),
            raw_json=_json_dumps(row.model_dump()),
        )
        ctx.db.add(stored)
        stored_rows.append(stored)

    upload.row_count = len(stored_rows)
    upload.matched_count = matched_count
    upload.missing_count = missing_count
    await ctx.db.commit()
    await ctx.db.refresh(upload)
    for row in stored_rows:
        await ctx.db.refresh(row)

    return {
        "upload": _statement_upload_dict(upload),
        "rows": [_statement_row_dict(row) for row in stored_rows],
        "missing_claims": [_statement_row_dict(row) for row in stored_rows if row.match_status in STATEMENT_NEEDS_CLAIM_STATUSES],
    }


@router.post("/statements/{row_id}/create-claim", dependencies=WRITE)
async def create_claim_from_statement(
    row_id: int,
    request: FastAPIRequest,
    ctx: PluginContext = Depends(get_plugin_context),
) -> dict[str, Any]:
    row = await ctx.repo(CardStatementRow).get(row_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Statement row not found")
    if row.match_claim_id:
        claim = await _require_claim(ctx, row.match_claim_id)
        steps = (await _steps_for_claims(ctx, [claim.id])).get(claim.id, [])
        return {"row": _statement_row_dict(row), "claim": _claim_dict(claim, steps)}
    if row.match_status == "duplicate":
        reconciliation = _json_loads(row.reconciliation_json)
        raise HTTPException(status_code=400, detail=f"Duplicate statement row already imported as row #{reconciliation.get('duplicate_of_statement_row_id')}")

    requester_member_id = row.cardholder_member_id or _acting_member_id(ctx, request)
    requester_name = row.cardholder_name or "Statement cardholder"
    pre_approval_id = row.match_pre_approval_id
    policy_evaluation = await _evaluate_policy(
        ctx,
        requester_member_id=requester_member_id,
        vendor=row.vendor,
        amount=row.amount_cents,
        currency=row.currency,
        category=row.category,
        business_purpose="",
        transaction_date=row.transaction_date,
        card_last4=row.card_last4,
        requested_receipt_status="missing",
        pre_approval_id=pre_approval_id,
        invoice_evidence={},
        source="statement",
    )
    snapshot = {
        "source": "statement_reconciliation",
        "resolver_source": "needs_info",
        "warnings": [
            "Created from an unmatched card statement row. Requester must add purpose and receipt/declaration before approval."
        ],
        "policy_evaluation": policy_evaluation,
        "approvers": [],
        "steps": [],
    }
    claim = SettlementClaim(
        organization_id=ctx.organization_id,
        requester_member_id=requester_member_id,
        requester_name=requester_name,
        vendor=row.vendor,
        amount_cents=row.amount_cents,
        currency=row.currency,
        employee_locality=policy_evaluation.get("employee_locality"),
        category=row.category,
        business_purpose="",
        transaction_date=row.transaction_date,
        card_last4=row.card_last4,
        tax_amount_cents=0,
        tax_type=_normalized_tax_type(None, row.currency),
        tax_rate_percent=_default_tax_rate(row.currency),
        tax_included=True,
        pre_approval_id=pre_approval_id,
        attendees_json=_json_dumps_list([]),
        receipt_file_url=None,
        receipt_status="missing",
        policy_status="blocked",
        policy_evaluation_json=_json_dumps(policy_evaluation),
        state="needs_info",
        approval_snapshot_json=_json_dumps(snapshot),
    )
    ctx.db.add(claim)
    await ctx.db.flush()
    if pre_approval_id is not None:
        pre_spend = await _require_pre_spend(ctx, pre_approval_id)
        await _mark_pre_spend_linked(ctx, pre_spend, claim.id)
    row.match_status = "claim_created"
    row.match_claim_id = claim.id
    reconciliation = _json_loads(row.reconciliation_json)
    reconciliation.update({"status": "claim_created", "claim_id": claim.id, "required_actions": ["complete_claim_details"]})
    row.reconciliation_json = _json_dumps(reconciliation)
    await ctx.db.commit()
    await ctx.db.refresh(claim)
    await ctx.db.refresh(row)
    return {"row": _statement_row_dict(row), "claim": _claim_dict(claim, [])}


@router.post("/erp/export", dependencies=WRITE)
async def export_erp(
    request: FastAPIRequest,
    ctx: PluginContext = Depends(get_plugin_context),
) -> dict[str, Any]:
    acting_member_id = _acting_member_id(ctx, request)
    claims = [
        claim for claim in await _claims(ctx)
        if claim.state == "approved"
        and claim.policy_status in {"compliant", "exception_approved"}
        and claim.erp_export_id is None
    ]
    steps_by_claim = await _steps_for_claims(ctx, [claim.id for claim in claims])
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "claim_id",
            "requester_member_id",
            "requester_name",
            "transaction_date",
            "card_last4",
            "vendor",
            "amount",
            "currency",
            "employee_locality",
            "tax_amount",
            "tax_type",
            "tax_rate_percent",
            "tax_included",
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
            "category",
            "cost_center",
            "project_code",
            "business_purpose",
            "receipt_status",
            "policy_status",
            "pre_approval_id",
            "approver_chain",
            "approval_decisions",
            "created_at",
        ]
    )
    total = 0
    for claim in claims:
        steps = steps_by_claim.get(claim.id, [])
        approver_chain = " > ".join(step.approver_name for step in steps)
        decisions = "; ".join(
            f"{step.step_order}:{step.state}:{step.decided_by_member_id or ''}:{step.decision_source}"
            for step in steps
        )
        total += claim.amount_cents
        writer.writerow(
            [
                claim.id,
                claim.requester_member_id,
                claim.requester_name,
                claim.transaction_date or "",
                claim.card_last4 or "",
                claim.vendor,
                str(claim.amount_cents),
                claim.currency,
                claim.employee_locality or "",
                str(claim.tax_amount_cents),
                claim.tax_type or "",
                "" if claim.tax_rate_percent is None else str(claim.tax_rate_percent),
                "yes" if claim.tax_included else "no",
                claim.supplier_gstin or "",
                claim.supplier_business_registration_number or "",
                claim.supplier_legal_name or "",
                claim.invoice_number or "",
                claim.invoice_date or "",
                claim.place_of_supply or "",
                claim.payment_method or "",
                claim.fx_evidence_url or "",
                claim.fx_evidence_description or "",
                claim.cash_receipt_reference or "",
                claim.category,
                claim.cost_center or "",
                claim.project_code or "",
                claim.business_purpose,
                claim.receipt_status,
                claim.policy_status,
                claim.pre_approval_id or "",
                approver_chain,
                decisions,
                claim.created_at.isoformat() if hasattr(claim.created_at, "isoformat") else str(claim.created_at),
            ]
        )
    filename = f"corporate-card-erp-{datetime.now(UTC).strftime('%Y%m%d%H%M%S')}.csv"
    export = ErpExport(
        organization_id=ctx.organization_id,
        filename=filename,
        row_count=len(claims),
        total_amount_cents=total,
        generated_by_member_id=acting_member_id,
    )
    ctx.db.add(export)
    await ctx.db.flush()
    for claim in claims:
        claim.erp_export_id = export.id
    await ctx.db.commit()
    await ctx.db.refresh(export)
    return {
        "export": _erp_export_dict(export),
        "filename": filename,
        "row_count": len(claims),
        "total_amount": total,
        "total_amount_cents": total,
        "csv": output.getvalue(),
    }


# The assistant's map of the product. It is written here, next to the routes
# that implement each capability, so an added feature is one line away from
# being something the assistant can tell a user about. Keep tab ids in step
# with the frontend's `Tab` union -- they are what "open the X page" refers to.
APP_CAPABILITIES = [
    ("dashboard", "Dashboard", "Spend, pending approvals and shortcuts for the signed-in role."),
    ("inbox", "Inbox", "Claims that need the user's attention: rejected, needs-info, policy-blocked."),
    ("cards", "Cards", "Corporate card register: each card's monthly limit, this month's usage and status."),
    ("submit", "Submit settlement", "File a settlement: upload a receipt, AI extracts the fields, then submit for approval."),
    ("pre_spend", "Pre-spend approval", "Request approval BEFORE spending. Required for restricted categories."),
    ("usage", "Usage overview", "Per-member and per-category usage against limits."),
    ("monitoring", "Monitoring", "Finance control view: spend forecast, risk heatmap, evidence and ERP handoff."),
    ("anomalies", "My anomalies", "Claims flagged against the user: duplicates, missing receipts, policy exceptions."),
    ("history", "Settlement history", "Every settlement the user may see, with its approval trail."),
    ("approvals", "Approval queue", "Approve or reject submitted settlements and inspect the approval path."),
    ("analytics", "Statistics", "Category and lifecycle analysis of settlement spend."),
    ("upload", "Card statement upload", "Upload an issuer statement and reconcile rows against claims."),
    ("erp", "ERP export", "Export approved settlements to the accounting system."),
    ("qa", "Q&A", "Ask corporate-card policy questions; answers are logged for the organization."),
    ("members", "Org members", "Members, app roles and card assignment."),
]


def _assistant_capability_text() -> str:
    return "\n".join(f"- {label} (tab id: {tab}): {desc}" for tab, label, desc in APP_CAPABILITIES)


async def _assistant_workspace_facts(ctx: PluginContext, acting_member_id: str) -> list[str]:
    """A compact, factual snapshot the assistant may quote.

    Only figures the app already computes for its own screens -- the assistant
    must be able to say "3 cards are over limit" because that is true of this
    workspace right now, not because it sounded plausible.
    """
    cards = await ctx.repo(CorporateCard).list(order_by="member_name", limit=500)
    claims = await _claims(ctx)
    pre_spend = await _pre_spend_requests(ctx)
    statement_rows = await _statement_rows(ctx)

    period = datetime.now(UTC).strftime("%Y-%m")
    spend_by_last4: dict[str, int] = {}
    for claim in claims:
        if not str(getattr(claim, "transaction_date", "") or "").startswith(period):
            continue
        last4 = str(getattr(claim, "card_last4", "") or "").strip()[-4:]
        if last4:
            spend_by_last4[last4] = spend_by_last4.get(last4, 0) + int(claim.amount_cents or 0)

    over, near = [], []
    total_limit = 0
    for card in cards:
        limit = int(card.monthly_limit_cents or 0)
        total_limit += limit
        if limit <= 0:
            continue
        used = spend_by_last4.get(str(card.last4 or "").strip()[-4:], 0)
        pct = round(used / limit * 100)
        if pct >= 100:
            over.append(f"{card.member_name} (****{card.last4}) at {pct}%")
        elif pct >= 80:
            near.append(f"{card.member_name} (****{card.last4}) at {pct}%")

    pending = [c for c in claims if c.state == "pending"]
    steps_by_claim = await _steps_for_claims(ctx, [c.id for c in pending])
    mine = sum(
        1
        for c in pending
        if any(
            s.state == "pending" and str(s.approver_member_id or "") == str(acting_member_id)
            for s in steps_by_claim.get(c.id, [])
        )
    )

    facts = [
        f"Current period: {period}.",
        f"Registered cards: {len(cards)} ({sum(1 for c in cards if c.status == 'active')} active).",
        f"Combined monthly limit: {total_limit}.",
        f"Settlement claims: {len(claims)} total, {len(pending)} pending, "
        f"{sum(1 for c in claims if c.state == 'approved')} approved, "
        f"{sum(1 for c in claims if c.state == 'rejected')} rejected.",
        f"Settlements waiting on THIS user's decision: {mine}.",
        f"Pre-spend requests pending: {sum(1 for p in pre_spend if p.state == 'pending')}.",
        f"Statement rows needing a claim: {sum(1 for r in statement_rows if r.match_status in STATEMENT_NEEDS_CLAIM_STATUSES)}.",
        f"Policy-blocked claims: {sum(1 for c in claims if c.policy_status == 'blocked')}.",
    ]
    facts.append(f"Cards over their limit: {'; '.join(over) if over else 'none'}.")
    facts.append(f"Cards at 80-99% of limit: {'; '.join(near) if near else 'none'}.")
    return facts


def _pick_lang(lang: str, en: str, ko: str, ja: str) -> str:
    """Choose the UI string for the Palette OS language (ko / ja, else English)."""
    if lang == "ko":
        return ko
    if lang == "ja":
        return ja
    return en


def _assistant_offline_answer(question: str, facts: list[str], lang: str) -> str:
    """Answer without an LLM, from the capability map and the live figures.

    The assistant is meant to be useful on a machine with no model configured,
    so this is a real fallback rather than an apology: it routes the user to
    the right screen and quotes the numbers that screen would show.
    """
    q = question.lower()
    hits = [
        (label, desc)
        for _tab, label, desc in APP_CAPABILITIES
        if label.lower() in q or any(w in q for w in label.lower().split())
    ]
    keyword_map = [
        (("approve", "approval", "sign off", "결재", "승인", "承認", "決裁"), "Approval queue"),
        (("submit", "file", "claim", "expense", "정산", "精算", "経費"), "Submit settlement"),
        (("card", "limit", "카드", "한도", "カード", "限度"), "Cards"),
        (("receipt", "evidence", "영수증", "領収書", "証憑"), "Submit settlement"),
        (("statement", "reconcile", "명세", "明細", "照合"), "Card statement upload"),
        (("export", "erp", "accounting", "会計"), "ERP export"),
        (("policy", "rule", "allowed", "규정", "規程", "ポリシー"), "Q&A"),
        (("pre-spend", "pre spend", "before", "사전", "事前"), "Pre-spend approval"),
    ]
    if not hits:
        for words, label in keyword_map:
            if any(w in q for w in words):
                hits = [(label, next(d for _t, l, d in APP_CAPABILITIES if l == label))]
                break

    lines: list[str] = []
    if hits:
        label, desc = hits[0]
        lines.append(
            _pick_lang(
                lang,
                f"Open **{label}** — {desc}",
                f"**{label}** 화면에서 처리할 수 있습니다 — {desc}",
                f"**{label}** 画面で対応できます — {desc}",
            )
        )
    else:
        lines.append(
            _pick_lang(
                lang,
                "Here is what this workspace can do:",
                "이 워크스페이스에서 할 수 있는 일입니다:",
                "このワークスペースでできることは次のとおりです:",
            )
        )
        lines += [f"- {label}: {desc}" for _t, label, desc in APP_CAPABILITIES[:6]]
    lines.append("")
    lines.append(_pick_lang(lang, "Right now:", "현재 상태:", "現在の状況:"))
    lines += [f"- {f}" for f in facts[:6]]
    lines.append("")
    lines.append(
        _pick_lang(
            lang,
            "(No language model is configured, so this answer comes from the app's own data.)",
            "(언어 모델이 설정되지 않아 앱 데이터 기준으로 답변했습니다.)",
            "(言語モデルが設定されていないため、アプリのデータに基づいて回答しました。)",
        )
    )
    return "\n".join(lines)


@router.post("/assistant", dependencies=READ)
async def assistant(
    payload: AssistantIn,
    request: FastAPIRequest,
    ctx: PluginContext = Depends(get_plugin_context),
) -> dict[str, Any]:
    """In-app assistant: answers about this app's features AND this workspace.

    Read-only by design. It explains and points at screens; it never files,
    approves or exports anything on the user's behalf, so a wrong answer costs
    a wasted click rather than a wrong settlement.
    """
    acting_member_id = _acting_member_id(ctx, request)
    try:
        facts = await _assistant_workspace_facts(ctx, acting_member_id)
    except Exception as exc:  # a broken figure must not take the assistant down
        ctx.logger.warning("Assistant workspace snapshot failed: %s", exc)
        facts = []

    system = (
        "You are the assistant built into the Palette corporate-card app. "
        "Answer ONLY about this app and the workspace data given below.\n\n"
        "Screens available to the user:\n" + _assistant_capability_text() + "\n\n"
        "Live workspace facts (authoritative -- prefer these over any assumption):\n"
        + "\n".join(f"- {f}" for f in facts)
        + "\n\nRules: be concise, 120 words or fewer unless asked for detail. "
        "When a task belongs to a screen, name that screen exactly as written above. "
        "Quote the figures above rather than estimating. If the answer is not in "
        "the app or the facts, say so plainly and suggest the closest screen. "
        "Never invent card numbers, amounts, people or approvals. "
        "Do not claim to have performed an action -- you can explain and point, not act."
        + _pick_lang(payload.lang, "\nReply in English.", "\nReply in Korean.", "\nReply in Japanese.")
    )
    transcript = "\n".join(
        f"{turn.role.upper()}: {turn.content}" for turn in payload.history[-8:]
    )
    user_content = (f"{transcript}\nUSER: {payload.question}" if transcript else payload.question)

    try:
        answer, source, model = await _llm_chat_text(
            ctx,
            system=system,
            user_content=user_content,
            router_model=(
                _config_value(ctx, "LLM_ROUTER_FAST_MODEL")
                or _config_value(ctx, "LLM_ROUTER_TEXT_MODEL")
                or "text_fast"
            ),
            json_object=False,
            purpose="assistant",
        )
    except HTTPException as exc:
        ctx.logger.warning("Assistant LLM unavailable, answering locally: %s", exc.detail)
    except Exception as exc:
        ctx.logger.warning("Assistant LLM failed, answering locally: %s", exc)
    else:
        if answer.strip():
            return {"answer": answer.strip(), "source": source, "model": model}

    return {
        "answer": _assistant_offline_answer(payload.question, facts, payload.lang),
        "source": "local_app_context",
        "model": None,
    }


@router.post("/policy-question", dependencies=WRITE)
async def policy_question(
    payload: PolicyQuestionIn,
    request: FastAPIRequest,
    ctx: PluginContext = Depends(get_plugin_context),
) -> dict[str, Any]:
    acting_member_id = _acting_member_id(ctx, request)
    answer, source = await _ask_policy_question(ctx, payload)
    item = PolicyQuestion(
        organization_id=ctx.organization_id,
        asked_by_member_id=acting_member_id,
        question=payload.question,
        answer=answer,
        source=source,
    )
    ctx.db.add(item)
    await ctx.db.commit()
    await ctx.db.refresh(item)
    return _policy_question_dict(item)
