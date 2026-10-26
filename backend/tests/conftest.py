import shutil
from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / "fixtures"

# Folders added to `space-sample` for the M2 acceptance run (plan Task 20). The unit
# tests were written against the M1 sample, which has none of them (several check
# that `Tags/` or `Templates/` don't exist yet), so `space_dir` leaves them out.
M2_FOLDERS = frozenset({"Projects", "Tags", "Templates", "Attachments"})


def _skip_m2_folders(src: str, names: list[str]) -> set[str]:
    if Path(src) == FIXTURES / "space-sample":
        return {n for n in names if n in M2_FOLDERS}
    return set()


@pytest.fixture
def space_dir(tmp_path: Path) -> Path:
    """A fresh copy of the synthetic `space-sample` space, as M1 left it."""
    dest = tmp_path / "space-sample"
    shutil.copytree(FIXTURES / "space-sample", dest, ignore=_skip_m2_folders)
    return dest


@pytest.fixture
def full_space_dir(tmp_path: Path) -> Path:
    """A fresh copy of the whole `space-sample`, M2 acceptance fixtures included."""
    dest = tmp_path / "space-sample"
    shutil.copytree(FIXTURES / "space-sample", dest)
    return dest


@pytest.fixture
def calendar_space_dir(tmp_path: Path) -> Path:
    """A fresh copy of the synthetic M4 `space-calendar` space (tasks, daily notes, dates)."""
    dest = tmp_path / "space-calendar"
    shutil.copytree(FIXTURES / "space-calendar", dest)
    return dest


@pytest.fixture(autouse=True)
def _reminders_stay_in_the_sandbox(tmp_path_factory, monkeypatch):
    """M4 Task 6: every app lifespan runs the reminder scheduler.

    Keep its ledger out of the real per-user state folder and never spawn a
    real OS notification from a test (tests that check those set their own).
    """
    monkeypatch.setenv("OBJECT_STATE_DIR", str(tmp_path_factory.mktemp("object-state")))
    for name in ("OBJECT_CLOCK_FILE", "OBJECT_FAKE_NOTIFY_FILE"):
        monkeypatch.delenv(name, raising=False)
    from objectapp import notify

    monkeypatch.setattr(notify, "_launch", lambda argv, env: None)
