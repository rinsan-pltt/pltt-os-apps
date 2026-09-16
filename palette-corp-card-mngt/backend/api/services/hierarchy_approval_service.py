"""JSON-backed approval hierarchy resolver.

This temporary provider reads a bundled employee hierarchy JSON file. The
public resolver shape is intentionally small so the data source can later be
swapped to a real hierarchy provider without changing claim creation.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

SOURCE = "local_json_hierarchy"
VALID_ROLES = {"employee", "manager", "department_head", "finance_head", "ceo"}
MAX_APPROVAL_STEPS = 3
REQUIRED_EMPLOYEE_FIELDS = {
    "member_id",
    "name",
    "email",
    "title",
    "department",
    "role",
    "reports_to",
}


class HierarchyApprovalError(RuntimeError):
    """Raised when the hierarchy source cannot be loaded or parsed."""


@dataclass(frozen=True)
class Employee:
    member_id: str
    name: str
    email: str
    title: str
    department: str
    role: str
    reports_to: str | None

    @classmethod
    def from_mapping(cls, raw: dict[str, Any], index: int) -> "Employee":
        missing = sorted(field for field in REQUIRED_EMPLOYEE_FIELDS if field not in raw)
        if missing:
            raise HierarchyApprovalError(f"Employee row {index} is missing required fields: {', '.join(missing)}")

        role = str(raw["role"]).strip().lower()
        if role not in VALID_ROLES:
            raise HierarchyApprovalError(f"Employee row {index} has invalid role: {raw['role']}")

        reports_to_raw = raw.get("reports_to")
        reports_to = str(reports_to_raw).strip() if reports_to_raw else None
        return cls(
            member_id=str(raw["member_id"]).strip(),
            name=str(raw["name"]).strip(),
            email=str(raw["email"]).strip(),
            title=str(raw["title"]).strip(),
            department=str(raw["department"]).strip(),
            role=role,
            reports_to=reports_to or None,
        )


class HierarchyApprovalService:
    def __init__(self, sample_path: str | Path | None = None) -> None:
        if sample_path is None:
            self.sample_path = _default_sample_path()
        else:
            path = Path(sample_path).expanduser()
            self.sample_path = path if path.is_absolute() else path.resolve()

    def resolve_approval_path(
        self,
        *,
        requester_member_id: str,
        amount: int,
        currency: str = "KRW",
        category: str | None = None,
        workflow_type: str = "corporate_card_settlement",
        requires_finance_review: bool = False,
    ) -> dict[str, Any]:
        employees = self._load_employees()
        by_member_id = _employee_map(employees)
        warnings = _global_validation_warnings(employees, by_member_id)
        policy = _policy_for_hierarchy(amount, currency, requires_finance_review=requires_finance_review)

        requester = by_member_id.get(requester_member_id)
        if requester is None:
            warnings.append(f"Requester {requester_member_id} is not present in the sample employee hierarchy.")
            return _snapshot(
                requester=None,
                approvers=[],
                warnings=warnings,
                policy=policy,
                category=category,
                workflow_type=workflow_type,
            )

        approvers: list[dict[str, Any]] = []
        seen_approver_ids: set[str] = set()
        finance_head = _finance_head(employees, warnings)

        def add_approver(employee: Employee | None, reason: str) -> None:
            if employee is None:
                return
            if employee.member_id == requester.member_id:
                warnings.append(f"{employee.name} was skipped because requesters cannot approve their own claim.")
                return
            if employee.member_id in seen_approver_ids:
                return
            seen_approver_ids.add(employee.member_id)
            approvers.append(_approver_dict(employee, len(approvers) + 1, reason))

        manager_chain, chain_has_cycle = _manager_chain(requester, by_member_id)
        if chain_has_cycle:
            warnings.append(f"Reporting cycle detected for requester {requester.member_id}.")
            return _snapshot(
                requester=requester,
                approvers=[],
                warnings=warnings,
                policy=policy,
                category=category,
                workflow_type=workflow_type,
            )

        if requester.role == "ceo":
            add_approver(finance_head, "executive_expense_review")
        elif not manager_chain:
            warnings.append(f"{requester.name} has no active reporting manager in the sample hierarchy.")
            add_approver(finance_head, "finance_verification")
        else:
            reporting_limit = MAX_APPROVAL_STEPS - 1 if requires_finance_review else MAX_APPROVAL_STEPS
            for index, manager in enumerate(manager_chain[:reporting_limit]):
                reason = "direct_manager" if index == 0 else "reporting_head"
                add_approver(manager, reason)
            if requires_finance_review:
                add_approver(finance_head, "finance_verification")

        if requires_finance_review and finance_head is None:
            warnings.append("Finance review was requested but no finance head is configured.")

        approvers = approvers[:MAX_APPROVAL_STEPS]

        if not approvers:
            warnings.append("No approver path could be resolved from the sample employee hierarchy.")

        return _snapshot(
            requester=requester,
            approvers=approvers,
            warnings=warnings,
            policy=policy,
            category=category,
            workflow_type=workflow_type,
        )

    def _load_employees(self) -> list[Employee]:
        try:
            raw = json.loads(self.sample_path.read_text(encoding="utf-8"))
        except OSError as exc:
            raise HierarchyApprovalError(f"Could not read employee hierarchy sample: {self.sample_path}") from exc
        except json.JSONDecodeError as exc:
            raise HierarchyApprovalError(f"Employee hierarchy sample is not valid JSON: {self.sample_path}") from exc

        rows = raw.get("employees") if isinstance(raw, dict) else raw
        if not isinstance(rows, list):
            raise HierarchyApprovalError("Employee hierarchy sample must be a list or an object with an employees list.")
        employees: list[Employee] = []
        for index, row in enumerate(rows, start=1):
            if not isinstance(row, dict):
                raise HierarchyApprovalError(f"Employee row {index} must be an object.")
            employees.append(Employee.from_mapping(row, index))
        return employees


def resolve_approval_path(
    *,
    requester_member_id: str,
    amount: int,
    currency: str = "KRW",
    category: str | None = None,
    workflow_type: str = "corporate_card_settlement",
    requires_finance_review: bool = False,
) -> dict[str, Any]:
    return HierarchyApprovalService().resolve_approval_path(
        requester_member_id=requester_member_id,
        amount=amount,
        currency=currency,
        category=category,
        workflow_type=workflow_type,
        requires_finance_review=requires_finance_review,
    )


def _default_sample_path() -> Path:
    configured = os.environ.get("EMPLOYEE_HIERARCHY_SAMPLE_PATH")
    if configured:
        path = Path(configured).expanduser()
        return path if path.is_absolute() else path.resolve()
    return Path(__file__).resolve().parents[1] / "sample_data" / "employee_hierarchy.sample.json"


def _employee_map(employees: list[Employee]) -> dict[str, Employee]:
    by_member_id: dict[str, Employee] = {}
    duplicates: set[str] = set()
    for employee in employees:
        if not employee.member_id:
            raise HierarchyApprovalError("Employee hierarchy sample contains a blank member_id.")
        if employee.member_id in by_member_id:
            duplicates.add(employee.member_id)
        by_member_id[employee.member_id] = employee
    if duplicates:
        raise HierarchyApprovalError(f"Duplicate member_id values in employee hierarchy sample: {', '.join(sorted(duplicates))}")
    return by_member_id


def _global_validation_warnings(employees: list[Employee], by_member_id: dict[str, Employee]) -> list[str]:
    warnings: list[str] = []
    finance_heads = [employee for employee in employees if employee.role == "finance_head"]
    if len(finance_heads) > 1:
        warnings.append(f"Multiple finance heads are configured; using {finance_heads[0].name}.")
    if not finance_heads:
        warnings.append("No finance head is configured in the sample employee hierarchy.")
    if not any(employee.role == "ceo" for employee in employees):
        warnings.append("No CEO is configured in the sample employee hierarchy.")

    for employee in employees:
        if employee.role != "ceo" and employee.reports_to and employee.reports_to not in by_member_id:
            warnings.append(f"{employee.name} reports to missing manager {employee.reports_to}.")
        if employee.role != "ceo" and not employee.reports_to:
            warnings.append(f"{employee.name} has no reporting manager.")
        _, has_cycle = _manager_chain(employee, by_member_id)
        if has_cycle:
            warnings.append(f"Reporting cycle detected for {employee.name}.")
    return warnings


def _finance_head(employees: list[Employee], warnings: list[str]) -> Employee | None:
    finance_heads = [employee for employee in employees if employee.role == "finance_head"]
    if not finance_heads:
        warnings.append("Finance verification could not be added because no finance head is configured.")
        return None
    return finance_heads[0]


def _manager_chain(requester: Employee, by_member_id: dict[str, Employee]) -> tuple[list[Employee], bool]:
    chain: list[Employee] = []
    seen = {requester.member_id}
    current = requester

    while current.reports_to:
        manager = by_member_id.get(current.reports_to)
        if manager is None:
            return chain, False
        if manager.member_id in seen:
            return chain, True
        seen.add(manager.member_id)
        chain.append(manager)
        current = manager
    return chain, False


def _policy_for_hierarchy(amount: int, currency: str, *, requires_finance_review: bool) -> dict[str, Any]:
    return {
        "tier": "hierarchy",
        "label": "Hierarchy-based approval",
        "currency": currency,
        "amount": amount,
        "max_steps": MAX_APPROVAL_STEPS,
        "requires_finance_review": requires_finance_review,
    }


def _approver_dict(employee: Employee, step: int, reason: str) -> dict[str, Any]:
    return {
        "step": step,
        "member_id": employee.member_id,
        "name": employee.name,
        "title": employee.title,
        "email": employee.email,
        "department": employee.department,
        "role": employee.role,
        "reason": reason,
    }


def _employee_dict(employee: Employee | None) -> dict[str, Any] | None:
    if employee is None:
        return None
    return {
        "member_id": employee.member_id,
        "name": employee.name,
        "email": employee.email,
        "title": employee.title,
        "department": employee.department,
        "role": employee.role,
        "reports_to": employee.reports_to,
    }


def _snapshot(
    *,
    requester: Employee | None,
    approvers: list[dict[str, Any]],
    warnings: list[str],
    policy: dict[str, Any],
    category: str | None,
    workflow_type: str,
) -> dict[str, Any]:
    return {
        "source": SOURCE,
        "requester": _employee_dict(requester),
        "approvers": approvers,
        "warnings": warnings,
        "workflow_type": workflow_type,
        "category": category,
        "policy": policy,
    }
