"""M30 fix pass: what an outside agent reads of a batch's entities, and the import start while the
entities are being written (plan ``2026-11-09-m30-entity-extraction.md``).

- v1 / MCP ``import_entities`` never names an object excluded from AI: its Sources, the values and
  summary lines only they say, and an ``existing`` object that is excluded, are left out.
- ``POST /api/import/start`` answers 409 while the filing worker writes a batch's entities.
"""

from __future__ import annotations

import threading
from typing import Any

import pytest
from test_m30_api import (  # noqa: F401 - the fixtures
    Env,
    _accept_all,
    _import,
    _mcp,
    _to_entities,
    _token,
    _wait,
    env,
    fake,
)

from objectapp.importers import batches, entitywrite


def _paths(e: Env, batch: str) -> dict[str, str]:
    _data, items = batches.load_batch(e.root, batch)
    return {it["sourcePath"]: it["path"] for it in items if it.get("path") and not it.get("entity")}


def _hide(e: Env, rel: str) -> None:
    """Exclude the Source at ``rel`` from AI the way a hand-edit outside Object would."""
    space = e.client.app.state.space
    data = (e.root / rel).read_bytes()
    assert data.startswith(b"---\n")
    (e.root / rel).write_bytes(b"---\nexcludeFromAI: true\n" + data[4:])
    space.rescan_file(rel)


def _all_paths(view: dict[str, Any]) -> set[str]:
    out: set[str] = set()
    for x in view["entities"]:
        out |= {p["path"] for p in x["pages"]} | set(x["mainPages"])
        if x["existing"]:
            out.add(x["existing"]["path"])
        for v in x["values"]:
            out |= {s["path"] for s in v["sources"]}
            for c in v["conflict"] or []:
                out |= {s["path"] for s in c["sources"]}
    return out


def test_v1_import_entities_leaves_out_what_is_excluded_from_ai(env: Env) -> None:
    e = env
    space = e.client.app.state.space
    own, own_v = space.create_object("host", "APP01")  # Gene's own Host: the entity's `existing`
    space.update_properties(own, {"excludeFromAI": True}, own_v)
    batch = _import(e)
    _to_entities(e, batch)
    paths = _paths(e, batch)
    app01_page = paths["Hosts/APP01.md"]

    full = e.client.get(f"/api/import/batches/{batch}/entities").json()  # Gene sees everything
    app01 = next(x for x in full["entities"] if x["name"] == "APP01")
    assert app01["existing"]["path"] == own
    assert app01_page in {p["path"] for p in app01["pages"]}

    _hide(e, app01_page)
    full = e.client.get(f"/api/import/batches/{batch}/entities").json()
    r = e.client.get("/api/v1/import/entities", params={"batch": batch}, headers=_token(e))
    assert r.status_code == 200, r.text
    view = r.json()
    hidden = {own, app01_page}
    assert not _all_paths(view) & hidden
    assert app01_page in _all_paths(full)  # the app's own view is unchanged

    host = next(x for x in view["entities"] if x["name"] == "APP01")
    assert host["existing"] is None
    assert app01_page not in host["mainPages"]
    keys = {v["key"] for v in host["values"]}
    assert "fqdn" not in keys  # only the hidden Source says it
    assert "The Payroll server at HQ." not in host["summary"]
    assert "Payroll runs on it." in host["summary"]  # from Payroll's page, still shown
    payroll = next(x for x in view["entities"] if x["name"] == "Payroll")
    assert "Runs on APP01." not in payroll["summary"]
    # Windows Server 2019 is named on the hidden page only: not listed at all.
    assert "Windows Server 2019" not in {x["name"] for x in [*view["entities"], *view["leftOut"]]}
    assert "Windows Server 2019" in {x["name"] for x in [*full["entities"], *full["leftOut"]]}

    _server, call = _mcp(e)
    assert not _all_paths(call("import_entities", batch=batch)) & hidden


def test_start_refused_while_entities_are_written(env: Env, monkeypatch: pytest.MonkeyPatch) -> None:
    e = env
    batch = _import(e)
    _to_entities(e, batch)
    view = e.client.get(f"/api/import/batches/{batch}/entities").json()
    assert e.client.put(f"/api/import/batches/{batch}/entities/review", json=_accept_all(view)).status_code == 200

    entered, release = threading.Event(), threading.Event()
    real = entitywrite.write_entities

    def slow(*args: Any, **kwargs: Any) -> Any:
        entered.set()
        assert release.wait(30)
        return real(*args, **kwargs)

    monkeypatch.setattr(entitywrite, "write_entities", slow)
    assert e.client.post(f"/api/import/batches/{batch}/entities/write", json={}).status_code == 202
    try:
        assert entered.wait(30)
        pv = e.client.post("/api/import/preview", json={"source": {"path": str(e.src)}, "target": "currentSpace"})
        assert pv.status_code == 200, pv.text
        r = e.client.post("/api/import/start", json={"previewId": pv.json()["previewId"], "mapping": pv.json()["mapping"],
                                                     "target": {"kind": "currentSpace"}})
        assert r.status_code == 409, r.text
        assert r.json()["detail"] == "Another import is running."
    finally:
        release.set()
    assert _wait(e, batch, {"done", "failed"})["state"] == "done"
