"""``GET /api/app`` (sweep 2026-11-08): the app's version for the Settings footer."""

import importlib.metadata
from pathlib import Path

from fastapi.testclient import TestClient

from objectapp import api_app
from objectapp.server import create_app
from objectapp.space import Space


def test_app_route_returns_the_installed_version(space_dir: Path):
    client = TestClient(create_app(Space(space_dir), None, watch=False))
    resp = client.get("/api/app")
    assert resp.status_code == 200
    body = resp.json()
    assert body == {"version": importlib.metadata.version("objectapp")}
    assert body["version"] and body["version"] != "dev"


def test_app_version_falls_back_to_dev_when_not_installed(monkeypatch):
    def missing(name: str) -> str:
        raise importlib.metadata.PackageNotFoundError(name)

    monkeypatch.setattr(importlib.metadata, "version", missing)
    assert api_app.app_version() == "dev"
