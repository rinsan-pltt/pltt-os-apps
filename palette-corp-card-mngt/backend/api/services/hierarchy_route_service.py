"""Corporate-card approval routing adapter.

This module keeps Org Explorer broker details out of the API layer. Callers pass
Corporate Card domain data and receive a normalized approval snapshot.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException
from palette_sdk import PluginContext
from palette_sdk.services import BrokerCallError, services

from services.hierarchy_approval_service import (
    HierarchyApprovalError,
    SOURCE as LOCAL_HIERARCHY_SOURCE,
    resolve_approval_path as resolve_local_approval_path,
)

FINANCE_APPROVAL_PROFILE = "finance_approval"
ORGX_ROUTE_PREVIEW_TARGET = "orgx/v1#hierarchy.route.preview"
ORGX_ROUTE_RESOLVE_TARGET = "orgx/v1#hierarchy.route.resolve"
POLICY_DOMAIN = "corporate_card"
DEFAULT_COUNTRY = "KR"
MAX_APPROVAL_STEPS = 3


@dataclass(frozen=True)
class ApprovalRouteResult:
    snapshot: dict[str, Any]
    approvers: list[dict[str, Any]]


class CorporateCardHierarchyRouteService:
    def __init__(
        self,
        ctx: PluginContext,
        *,
        members: list[dict[str, Any]] | None = None,
        profile_code: str = FINANCE_APPROVAL_PROFILE,
    ) -> None:
        self.ctx = ctx
        self.members = members or []
        self.profile_code = profile_code

    async def preview_route(self, **kwargs: Any) -> ApprovalRouteResult:
        return await self._route(target=ORGX_ROUTE_PREVIEW_TARGET, **kwargs)

    async def resolve_route(self, **kwargs: Any) -> ApprovalRouteResult:
        return await self._route(target=ORGX_ROUTE_RESOLVE_TARGET, **kwargs)

    async def _route(
        self,
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
    ) -> ApprovalRouteResult:
        payload = self._orgx_payload(
            requester_member_id=requester_member_id,
            amount=amount,
            currency=currency,
            category=category,
            transaction=transaction,
            selectors=selectors,
            policy_evaluation=policy_evaluation,
            workflow_type=workflow_type,
        )
        try:
            result = await services(self.ctx).call(target, payload)
            snapshot = result if isinstance(result, dict) else {"result": result}
            if snapshot.get("ok") is False:
                raise RuntimeError(str(snapshot.get("error") or "Org hierarchy route failed"))
            snapshot.setdefault("source", "os_broker")
            snapshot.setdefault("resolver_source", target)
            snapshot.setdefault("profile_code", self.profile_code)
        except (BrokerCallError, RuntimeError) as exc:
            self.ctx.logger.warning("Hierarchy broker call failed, falling back to local hierarchy: %s", exc)
            snapshot = self._local_snapshot(
                requester_member_id=requester_member_id,
                amount=amount,
                currency=currency,
                category=category,
                policy_evaluation=policy_evaluation,
                workflow_type=workflow_type,
            )
            snapshot.setdefault("resolver_source", LOCAL_HIERARCHY_SOURCE)

        return self._normalize_result(snapshot, requester_member_id=requester_member_id)

    def _orgx_payload(
        self,
        *,
        requester_member_id: str,
        amount: int,
        currency: str,
        category: str,
        transaction: dict[str, Any] | None,
        selectors: dict[str, Any] | None,
        policy_evaluation: dict[str, Any] | None,
        workflow_type: str,
    ) -> dict[str, Any]:
        transaction_payload = {
            "amount": amount,
            "currency": currency,
            "category": category,
            "domain": POLICY_DOMAIN,
            "workflow_type": workflow_type,
        }
        transaction_payload.update(transaction or {})

        selector_payload = {
            "requester_member_id": requester_member_id,
            "category": category,
        }
        selector_payload.update(selectors or {})
        if policy_evaluation:
            transaction_payload["policy_status"] = policy_evaluation.get("status")
            transaction_payload["policy_evaluation"] = policy_evaluation
            selector_payload.update(policy_evaluation.get("routing_hints") or {})

        payload: dict[str, Any] = {
            "profile_code": self.profile_code,
            "max_steps": MAX_APPROVAL_STEPS,
            "transaction": transaction_payload,
            "selectors": selector_payload,
        }
        requester = self._member_by_id(requester_member_id)
        requester_email = _clean(requester.get("email")) if requester else None
        if requester_email:
            payload["email"] = requester_email
        else:
            payload["employee_id"] = requester_member_id
        return payload

    def _local_snapshot(
        self,
        *,
        requester_member_id: str,
        amount: int,
        currency: str,
        category: str,
        policy_evaluation: dict[str, Any] | None = None,
        workflow_type: str,
    ) -> dict[str, Any]:
        routing_hints = policy_evaluation.get("routing_hints") if isinstance(policy_evaluation, dict) else {}
        try:
            return resolve_local_approval_path(
                requester_member_id=requester_member_id,
                amount=amount,
                currency=currency,
                category=category,
                workflow_type=workflow_type,
                requires_finance_review=bool(isinstance(routing_hints, dict) and routing_hints.get("requires_finance_review")),
            )
        except HierarchyApprovalError as exc:
            raise HTTPException(status_code=503, detail=f"Approval hierarchy could not be loaded: {exc}") from exc

    def _normalize_result(self, snapshot: dict[str, Any], *, requester_member_id: str) -> ApprovalRouteResult:
        warnings = _list_value(snapshot.get("warnings"))
        resolver_source = str(snapshot.get("resolver_source") or snapshot.get("source") or LOCAL_HIERARCHY_SOURCE)
        raw_steps = snapshot.get("approvers") or snapshot.get("steps") or snapshot.get("approval_steps")
        normalized: list[dict[str, Any]] = []
        for index, item in enumerate(raw_steps if isinstance(raw_steps, list) else [], start=1):
            approver = self._normalize_approver(item, index=index, resolver_source=resolver_source)
            if approver is None:
                continue
            if approver.get("member_id") == requester_member_id:
                warnings.append("Requester was removed from the approval path because self-approval is not allowed.")
                continue
            if not approver.get("member_id"):
                warnings.append(f"Approver {approver.get('name') or index} could not be mapped to a Palette member.")
                continue
            normalized.append(approver)

        normalized = normalized[:MAX_APPROVAL_STEPS]
        snapshot["warnings"] = warnings
        snapshot["approvers"] = normalized
        snapshot["steps"] = normalized
        snapshot.setdefault("profile_code", self.profile_code)
        snapshot.setdefault("notification_events", [])
        if not normalized:
            suffix = f" {' '.join(warnings)}" if warnings else ""
            raise HTTPException(status_code=400, detail=f"No approval path could be resolved for this requester.{suffix}")
        return ApprovalRouteResult(snapshot=snapshot, approvers=normalized)

    def _normalize_approver(self, item: Any, *, index: int, resolver_source: str) -> dict[str, Any] | None:
        if not isinstance(item, dict):
            return None
        raw_approver = item.get("approver") if isinstance(item.get("approver"), dict) else item
        if not isinstance(raw_approver, dict):
            return None
        participation = item.get("participation") if isinstance(item.get("participation"), dict) else {}
        kind = _clean(item.get("kind") or participation.get("kind") or raw_approver.get("kind") or "approver")
        required = item.get("required")
        if kind in {"cc", "notify"} or required is False:
            return None

        email = _clean(raw_approver.get("email") or item.get("email"))
        mapped_member = self._member_by_email(email) if email else None
        member_id = (
            _clean(mapped_member.get("id")) if mapped_member else None
        ) or _clean(raw_approver.get("member_id") or item.get("member_id") or item.get("approver_member_id"))

        return {
            "step": int(item.get("step") or item.get("step_order") or index),
            "member_id": member_id,
            "name": (
                _clean(raw_approver.get("name") or raw_approver.get("display_name") or item.get("name"))
                or "Approver"
            ),
            "title": _clean(raw_approver.get("title") or item.get("title") or item.get("approver_title")),
            "reason": _clean(item.get("reason") or item.get("role") or item.get("node_id")) or "approval_path",
            "source": _clean(item.get("source")) or resolver_source,
            "resolver_source": _clean(item.get("resolver_source")) or resolver_source,
            "org_employee_id": _clean(raw_approver.get("id") or raw_approver.get("employee_id")),
            "email": email,
        }

    def _member_by_id(self, member_id: str) -> dict[str, Any] | None:
        return next((member for member in self.members if _clean(member.get("id")) == member_id), None)

    def _member_by_email(self, email: str | None) -> dict[str, Any] | None:
        if not email:
            return None
        email_key = email.lower()
        return next((_m for _m in self.members if _clean(_m.get("email")).lower() == email_key), None)


def _clean(value: Any) -> str:
    return str(value or "").strip()


def _list_value(value: Any) -> list[Any]:
    return list(value) if isinstance(value, list) else []
