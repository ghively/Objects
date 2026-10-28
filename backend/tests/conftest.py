import shutil
from pathlib import Path

import pytest
from objectapp import server as _server

FIXTURES = Path(__file__).parent / "fixtures"

# Starlette's TestClient sends ``Host: testserver``; the app answers only loopback hosts
# (audit 2026-10-28 #1), so the test suite adds that name. `test_local_origin` checks the
# production set with a 127.0.0.1 client.
_server.allowed_hosts = _server.LOOPBACK_HOSTS | {"testserver"}

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


@pytest.fixture
def links_space_dir(tmp_path: Path) -> Path:
    """A fresh copy of the synthetic M5 `space-links` space (links, mentions, resolution order)."""
    dest = tmp_path / "space-links"
    shutil.copytree(FIXTURES / "space-links", dest)
    return dest


# `*.exe` is git-ignored and never committed, so the placeholder executable the M7
# attachment tests need (opening it must be refused) is written into the copy here.
BLOCKS_TOOL_EXE = b"MZ placeholder exe bytes for the blocks fixture\n"


@pytest.fixture
def blocks_space_dir(tmp_path: Path) -> Path:
    """A fresh copy of the synthetic M7 `space-blocks` space (every block form, attachments)."""
    dest = tmp_path / "space-blocks"
    shutil.copytree(FIXTURES / "space-blocks", dest)
    (dest / "Attachments" / "tool.exe").write_bytes(BLOCKS_TOOL_EXE)
    return dest


@pytest.fixture
def m8_space_dir(tmp_path: Path) -> Path:
    """A fresh copy of the synthetic M8 `space-m8` space (custom repeats, logs, new syntax, media board)."""
    dest = tmp_path / "space-m8"
    shutil.copytree(FIXTURES / "space-m8", dest)
    return dest


@pytest.fixture(scope="session")
def _big_space(tmp_path_factory):
    from bigspace import make_big_space

    root = tmp_path_factory.mktemp("big-space") / "space-big"
    stats = make_big_space(root)
    return root, stats


@pytest.fixture(scope="session")
def big_space_dir(_big_space) -> Path:
    """The generated 5,000-object / 50,000-link space, built once per session. Read it only."""
    return _big_space[0]


@pytest.fixture(scope="session")
def big_space_stats(_big_space):
    """The `BigStats` of `big_space_dir`."""
    return _big_space[1]


@pytest.fixture(autouse=True)
def _search_cache_stays_in_the_sandbox(tmp_path_factory, monkeypatch):
    """M5: the search index lives in `.capacities-cache/` by default.

    Point `OBJECT_CACHE_DIR` at a per-test temporary folder so no test's space
    tree ever gains a cache (tests that check the default location unset it).
    """
    monkeypatch.setenv("OBJECT_CACHE_DIR", str(tmp_path_factory.mktemp("object-cache")))


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
