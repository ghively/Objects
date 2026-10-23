import shutil
from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def space_dir(tmp_path: Path) -> Path:
    """A fresh copy of the synthetic `space-sample` space."""
    dest = tmp_path / "space-sample"
    shutil.copytree(FIXTURES / "space-sample", dest)
    return dest
