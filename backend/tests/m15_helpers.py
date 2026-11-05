"""Shared helpers for the M15 import tests: the synthetic fixture folders, zipped at run time."""

from __future__ import annotations

import shutil
import time
import zipfile
from pathlib import Path

FIXTURES = Path(__file__).parent / "fixtures"


def copy_fixture(name: str, dest: Path) -> Path:
    """A copy of ``fixtures/<name>`` at ``dest`` (never read the committed folder in place when
    a test might change it)."""
    shutil.copytree(FIXTURES / name, dest)
    return dest


def zip_folder(folder: Path, dest: Path, top: str | None = None) -> Path:
    """``folder`` zipped to ``dest`` (entries under ``top/`` when given)."""
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as zf:
        for p in sorted(folder.rglob("*")):
            if p.is_file():
                rel = p.relative_to(folder).as_posix()
                zf.write(p, f"{top}/{rel}" if top else rel)
    return dest


def snapshot(root: Path) -> dict[str, bytes]:
    return {
        p.relative_to(root).as_posix(): p.read_bytes()
        for p in sorted(root.rglob("*"))
        if p.is_file() and ".object-cache" not in p.parts
    }


def wait_job(client, job_id: str, timeout: float = 30.0) -> dict:
    deadline = time.monotonic() + timeout
    while True:
        job = client.get(f"/api/import/jobs/{job_id}").json()
        if job["phase"] in ("done", "failed", "cancelled"):
            return job
        if time.monotonic() > deadline:
            raise AssertionError(f"import job still {job['phase']}")
        time.sleep(0.02)
