"""Approval workflow helpers for Corporate Card."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from palette_sdk import PluginContext
from sqlalchemy import select

from models import ApprovalStep

APPROVAL_SUBMITTED = "approval_submitted"
APPROVAL_APPROVED = "approval_approved"
APPROVAL_REJECTED = "approval_rejected"
APPROVAL_RESUBMITTED = "approval_resubmitted"


class InAppApprovalNotificationAdapter:
    """Stores notification intent in approval snapshots.

    The frontend already renders actionable work through /summary, pending_for_me,
    Inbox, Approvals, and badge counts. These events make that work item creation
    explicit without binding the app to a future platform notification broker.
    """

    def event(
        self,
        event_type: str,
        *,
        claim_id: int | None = None,
        request_id: int | None = None,
        requester_member_id: str | None = None,
        approver_member_id: str | None = None,
        actor_member_id: str | None = None,
        state: str | None = None,
    ) -> dict[str, Any]:
        return {
            "type": event_type,
            "channel": "in_app_work_item",
            "claim_id": claim_id,
            "request_id": request_id,
            "requester_member_id": requester_member_id,
            "approver_member_id": approver_member_id,
            "actor_member_id": actor_member_id,
            "state": state,
            "created_at": datetime.now(UTC).isoformat(),
        }


class ApprovalWorkflowService:
    def __init__(
        self,
        ctx: PluginContext,
        *,
        notifier: InAppApprovalNotificationAdapter | None = None,
    ) -> None:
        self.ctx = ctx
        self.notifier = notifier or InAppApprovalNotificationAdapter()

    async def create_claim_steps(
        self,
        *,
        claim_id: int,
        requester_member_id: str,
        approvers: list[dict[str, Any]],
        default_reason: str = "approval_path",
    ) -> list[dict[str, Any]]:
        events: list[dict[str, Any]] = []
        for index, approver in enumerate(approvers, start=1):
            approver_member_id = approver.get("member_id")
            self.ctx.db.add(
                ApprovalStep(
                    organization_id=self.ctx.organization_id,
                    claim_id=claim_id,
                    step_order=int(approver.get("step") or index),
                    approver_member_id=approver_member_id,
                    approver_name=approver.get("name") or "Approver",
                    approver_title=approver.get("title"),
                    reason=approver.get("reason") or default_reason,
                    source=approver.get("source") or "approval_workflow",
                    resolver_source=approver.get("resolver_source") or approver.get("source") or "approval_workflow",
                    state="pending",
                )
            )
            events.append(
                self.notifier.event(
                    APPROVAL_SUBMITTED,
                    claim_id=claim_id,
                    requester_member_id=requester_member_id,
                    approver_member_id=approver_member_id,
                    state="pending",
                )
            )
        return events

    def submitted_pre_spend_events(
        self,
        *,
        request_id: int,
        requester_member_id: str,
        approvers: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        return [
            self.notifier.event(
                APPROVAL_SUBMITTED,
                request_id=request_id,
                requester_member_id=requester_member_id,
                approver_member_id=approver.get("member_id"),
                state="pending",
            )
            for approver in approvers
        ]

    def decision_event(
        self,
        event_type: str,
        *,
        claim_id: int | None = None,
        request_id: int | None = None,
        requester_member_id: str,
        actor_member_id: str,
        state: str,
    ) -> dict[str, Any]:
        return self.notifier.event(
            event_type,
            claim_id=claim_id,
            request_id=request_id,
            requester_member_id=requester_member_id,
            actor_member_id=actor_member_id,
            state=state,
        )

    async def pending_steps_for_claim(self, *, claim_id: int) -> list[ApprovalStep]:
        stmt = (
            select(ApprovalStep)
            .where(
                ApprovalStep.organization_id == self.ctx.organization_id,
                ApprovalStep.claim_id == claim_id,
                ApprovalStep.state == "pending",
            )
            .order_by(ApprovalStep.step_order)
        )
        return list((await self.ctx.db.execute(stmt)).scalars().all())
