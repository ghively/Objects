"""``POST /api/import/scan`` `{path, leaveOut}` -> the scan report (M26). Reads only; writes nothing.

``404`` ``{detail}`` no such file or folder (as every other route reports). The answer names
files, kinds and lines, never a matched value.

`scan_root` is the one rule for what a scan path may name, shared with ``POST
/api/import/batches`` (`api_import_agent`) and ``POST /v1/import/scan`` (`api_v1_tools`): an
absolute path to something that exists. A blank or relative path would be the server's
working folder, ``~`` the whole home folder, and a path too long for the OS raises on
``exists()``; all answer 404 and scan nothing (audit 2026-11-07 #12, sweep 2026-11-08).
"""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .importscan import scan_tree

__all__ = ["NO_SOURCE", "router", "scan_root"]

NO_SOURCE = "There is no file or folder at this path."


class ScanRequest(BaseModel):
    path: str
    leaveOut: list[str] = Field(default_factory=list)


def scan_root(path: str) -> Path | None:
    """The folder or file a scan request names, or None when there is nothing to scan."""
    text = str(path).strip().strip('"').strip()
    if not text or "\x00" in text:
        return None
    root = Path(os.path.expanduser(text))
    if not root.is_absolute():
        return None
    try:
        home = Path(os.path.expanduser("~")).resolve()
        if root.resolve() == home:  # ``~`` or the home folder itself: never an import source
            return None
        if not root.exists():
            return None
    except (OSError, ValueError):  # a path too long for the OS to stat, and the like
        return None
    return root


def router(ctx=None) -> APIRouter:
    r = APIRouter()

    @r.post("/import/scan")
    def scan(req: ScanRequest):
        root = scan_root(req.path)
        if root is None:
            return JSONResponse({"detail": NO_SOURCE}, status_code=404)
        return scan_tree(root, req.leaveOut).to_json()

    return r
