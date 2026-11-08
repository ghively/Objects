"""``POST /api/import/scan`` `{path, leaveOut}` -> the scan report (M26). Reads only; writes nothing.

``404`` no such file or folder. The answer names files, kinds and lines, never a matched value.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .importscan import scan_tree

__all__ = ["router"]


class ScanRequest(BaseModel):
    path: str
    leaveOut: list[str] = Field(default_factory=list)


def router(ctx=None) -> APIRouter:
    r = APIRouter()

    @r.post("/import/scan")
    def scan(req: ScanRequest):
        text = req.path.strip().strip('"')
        # A blank path is ``Path(".")``, the server's working folder (audit 2026-11-07 #12).
        root = Path(text).expanduser() if text.strip() else None
        if root is None or not root.exists():
            return JSONResponse({"error": "No such file or folder"}, status_code=404)
        return scan_tree(root, req.leaveOut).to_json()

    return r
