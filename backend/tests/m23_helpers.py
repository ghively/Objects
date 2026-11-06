"""M23 test helpers: the overlay fixture space, the monitoring fixtures and the work service.

``copy_space`` copies M22's ``space-work`` and then ``space-work-m23`` over it (synthetic data:
Meeting / Person / DailyNote types, today's daily note with a Focus section, three meetings,
Pat Example, Waiting on Pat and Scanner firmware). The originals are never touched.
"""

from __future__ import annotations

import shutil
from pathlib import Path

from objectapp import workfields
from objectapp.space import Space
from objectapp.workservice import WorkService

__all__ = ["FIXTURES", "add_project_work_fields", "copy_space", "monitoring", "service"]

FIXTURES = Path(__file__).parent / "fixtures"


def copy_space(tmp: Path) -> Path:
    """A copy of ``space-work`` with ``space-work-m23`` copied over it, at ``tmp / "space"``."""
    root = Path(tmp) / "space"
    shutil.copytree(FIXTURES / "space-work", root)
    shutil.copytree(FIXTURES / "space-work-m23", root, dirs_exist_ok=True)
    return root


def monitoring(tmp: Path) -> Path:
    """A copy of ``fixtures/monitoring`` at ``tmp / "monitoring"``."""
    dest = Path(tmp) / "monitoring"
    shutil.copytree(FIXTURES / "monitoring", dest)
    return dest


def service(space: Space) -> WorkService:
    """The app's work service as `create_app` builds it, with no Jira site and "Gene"."""
    return WorkService(space, jira_site=lambda: None, user_name=lambda: "Gene")


def add_project_work_fields(space: Space) -> None:
    """What ``POST /api/types/project/work-fields`` does: add the work fields to Project."""
    t, rev = space.refresh_type("project")
    new, _added, _skipped = workfields.with_work_fields(t, space.types)
    space.save_type(new, rev)
