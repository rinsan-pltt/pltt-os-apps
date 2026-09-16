"""The org id stamped on new rows must be the one the org-isolation policy
compares against, or every INSERT fails with InsufficientPrivilegeError on the
hosted server ("new row violates row-level security policy") while passing
locally, where create_all never installs the policy. See orgscope.py.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

from newsletter_backend.api import orgscope


class _Result:
    def __init__(self, value):
        self._value = value

    def scalar(self):
        return self._value


class _FakeDb:
    """Stands in for ctx.db: records queries, returns a canned GUC value."""

    def __init__(self, guc, *, raises=False):
        self.guc = guc
        self.raises = raises
        self.info: dict = {}
        self.calls = 0

    async def execute(self, _stmt):
        self.calls += 1
        if self.raises:
            raise RuntimeError("no database")
        return _Result(self.guc)


def _ctx(db, organization_id=2):
    return SimpleNamespace(db=db, organization_id=organization_id)


def test_uses_the_rls_session_org_id_when_it_differs():
    """The hosted case: ctx.organization_id is the organisation id (2) while the
    policy matches on the platform's tenancy id."""
    db = _FakeDb("4294967304")
    assert asyncio.run(orgscope.rls_org_id(_ctx(db))) == 4294967304


def test_falls_back_when_guc_is_unset():
    """pltt dev / SQLite: no GUC, no RLS — ctx.organization_id stays correct."""
    for unset in (None, "", "   "):
        db = _FakeDb(unset)
        assert asyncio.run(orgscope.rls_org_id(_ctx(db))) == 2


def test_falls_back_on_non_numeric_guc():
    db = _FakeDb("not-a-number")
    assert asyncio.run(orgscope.rls_org_id(_ctx(db))) == 2


def test_falls_back_when_the_lookup_itself_fails():
    """A write must never fail because the org-id probe did."""
    db = _FakeDb(None, raises=True)
    assert asyncio.run(orgscope.rls_org_id(_ctx(db))) == 2


def test_result_is_cached_per_session():
    db = _FakeDb("77")
    async def twice():
        return await orgscope.rls_org_id(_ctx(db)), await orgscope.rls_org_id(_ctx(db))

    assert asyncio.run(twice()) == (77, 77)
    assert db.calls == 1  # one probe per session, not per write


def test_no_db_returns_context_org_id():
    assert asyncio.run(orgscope.rls_org_id(SimpleNamespace(db=None, organization_id=9))) == 9


def test_org_repo_is_scoped_to_the_resolved_id():
    from newsletter_backend.api.models import Document

    db = _FakeDb("4294967304")
    repo = asyncio.run(orgscope.org_repo(_ctx(db), Document))
    assert repo.organization_id == 4294967304
    assert repo.model is Document
