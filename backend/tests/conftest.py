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
