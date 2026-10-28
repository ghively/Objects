"""Test support for M6 (whiteboards): the synthetic `space-whiteboard` fixture.

Imported by the M6 test files as ``from wb_support import ...`` (``backend/tests`` has no
``__init__.py``, so pytest's default rootdir-prepend import mode puts this folder on
``sys.path``). ``conftest.py`` is deliberately not involved.
"""

from __future__ import annotations

import hashlib
import shutil
from pathlib import Path

FIXTURE = Path(__file__).parent / "fixtures" / "space-whiteboard"


def copy_whiteboard_space(tmp_path: Path) -> Path:
    """A fresh copy of `space-whiteboard` inside ``tmp_path``; returns its root."""
    dest = tmp_path / "space-whiteboard"
    shutil.copytree(FIXTURE, dest)
    return dest


def tree_hashes(root: Path) -> dict[str, str]:
    """sha256 of every file under ``root`` (dot-folders included), keyed by POSIX relative path."""
    return {
        p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(root.rglob("*"))
        if p.is_file()
    }
