"""The v1-auth convention as an exhaustive sweep (audit 2026-11-22), so it can't drift.

The convention: every ``/api/v1`` route is reached two ways, and both must hold for
every route, forever. (a) Without an ``Authorization`` header a v1 request is an
``/api`` request like any other, so the launch key refuses it (`uikey.UiKeyMiddleware`
401s it before routing); (b) with an ``Authorization`` header the launch key steps
aside (``uikey._checked``), so the route itself must refuse a bad token with 401
(``v1guard.V1Guard.auth`` and friends); and (c) both hold for every HTTP method the
route serves, not just the obvious one.

This walks the surface the app itself registers — ``create_app``'s routers, through
`api_v1_tools._walk` (FastAPI 0.16x keeps an included router whole instead of
copying its routes into the parent, and that helper is the repo's own way in) — and
live-Tests every discovered (method, path) pair. A route added without an auth call
serves a bogus bearer its own answer (404, 422, 200…) instead of 401, and this
sweep fails naming it.

The sample values below exist only to get each request *past FastAPI's own 422 at
the door* and into the handler where its auth call lives: paths name an object that
doesn't exist, so even a sabotaged route answers 404, never 200, and never writes.
"""

from __future__ import annotations

import inspect
import re
import types
import typing
from pathlib import Path
from typing import Any
from urllib.parse import quote

import pytest
from fastapi import params as fastapi_params
from fastapi.testclient import TestClient
from pydantic import BaseModel
from pydantic_core import PydanticUndefined
from starlette.requests import Request

from objectapp.api_v1_tools import _walk
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.uikey import LaunchKey

PORT = 8814
BOGUS = {"Authorization": "Bearer sweep-bogus-token"}

# Routes the sweep must have found, whatever else changes: they cover every v1
# module's shape (api_v1, api_v1_synced, …), so the walk can't silently go empty.
SENTINELS = {
    ("GET", "/api/v1/whoami"),
    ("GET", "/api/v1/schema"),
    ("GET", "/api/v1/search"),
    ("GET", "/api/v1/object"),
    ("POST", "/api/v1/query"),
    ("POST", "/api/v1/synced/{type_id}"),
}
MIN_ROUTES = 40  # 83 when written; a floor, so pruning routes can't fail the sweep

SAMPLES: dict[str, Any] = {
    "path": "Sweep/None.md",
    "source": "Sweep/None.md",
    "target": "Sweep/None.md",
    "date": "2026-01-01",
    "version": "none",
    "baseVersion": "none",
    "versionId": "none",
    "revision": "none",
    "sourceVersion": "none",
    "targetVersion": "none",
    "stepId": "none",
    "stepRev": "none",
    "start": 0,
    "end": 0,
    "limit": 1,
    "q": "",
}


@pytest.fixture
def keyed(space_dir: Path):
    """The app as the launcher serves it: with a launch key, so (a) is checked too."""
    key = LaunchKey(PORT)
    app = create_app(Space(space_dir), None, watch=False, ui_key=key)
    with TestClient(app, base_url=f"http://127.0.0.1:{PORT}") as client:
        yield client, key


def _sample(name: str, ann: Any) -> Any:
    """A value FastAPI accepts for a parameter named `name` with annotation `ann`."""
    if name in SAMPLES:
        return SAMPLES[name]
    origin = typing.get_origin(ann)
    if origin is typing.Literal:
        return next((a for a in typing.get_args(ann) if a is not None), "sweep")
    if origin in (typing.Union, types.UnionType):
        args = [a for a in typing.get_args(ann) if a is not type(None)]
        models = [a for a in args if inspect.isclass(a) and issubclass(a, BaseModel)]
        if models:
            return _sample_body(models[0])
        if str in args:
            return "sweep"
        return _sample(name, args[0]) if args else None
    if inspect.isclass(ann) and issubclass(ann, BaseModel):
        return _sample_body(ann)
    if origin is dict:
        return {}
    if origin in (list, tuple, set, frozenset):
        return []
    if ann is bool:
        return False
    if ann is int:
        return 0
    if ann is float:
        return 0.0
    return "sweep"


def _sample_body(model: type[BaseModel]) -> dict[str, Any]:
    """The least body `model` accepts: a value per required field."""
    return {
        name: _sample(name, field.annotation)
        for name, field in model.model_fields.items()
        if field.is_required()
    }


def _planned(path: str, methods: list[str], endpoint: Any) -> list[tuple[str, str, Any]]:
    """(method, url, body | None) per `methods`: requests that reach the endpoint's
    own code (past FastAPI's param validation), so its auth call is what answers."""
    try:
        hints = typing.get_type_hints(endpoint)
    except Exception:  # noqa: BLE001 - an unresolvable hint: no body model found
        hints = {}
    path_names = set(re.findall(r"\{([^}:]+)", path))
    query: dict[str, Any] = {}
    body: Any = None
    for name, param in inspect.signature(endpoint).parameters.items():
        hint = hints.get(name)
        if name in path_names or hint is Request:
            continue
        if inspect.isclass(hint) and issubclass(hint, BaseModel):
            body = _sample_body(hint)
            continue
        required = param.default is inspect.Parameter.empty or (
            isinstance(param.default, fastapi_params.Query)
            and param.default.default is PydanticUndefined
        )
        if required:
            query[name] = _sample(name, hint if hint is not None else str)
    url = path
    for name in path_names:
        url = url.replace(f"{{{name}}}", str(SAMPLES.get(name, "sweep")))
    if query:
        url += "?" + "&".join(f"{k}={quote(str(v), safe='')}" for k, v in sorted(query.items()))
    return [(method, url, body) for method in methods]


def _surface(app: Any) -> list[tuple[str, str, Any]]:
    """(method, path, endpoint) for every method every /api/v1 route serves."""
    out: list[tuple[str, str, Any]] = []
    for full, route in sorted(_walk(app.router.routes, ""), key=lambda pair: pair[0]):
        if full.startswith("/api/v1"):
            methods = [m for m in sorted(getattr(route, "methods", None) or ()) if m not in ("HEAD", "OPTIONS")]
            for method in methods:
                out.append((method, full, route.endpoint))
    return out


def _calls(app: Any) -> list[tuple[str, str, Any]]:
    """Every (method, url, body) the sweep makes: one plan per (method, endpoint),
    so a POST sharing a path with a GET gets the POST endpoint's own body."""
    planned: list[tuple[str, str, Any]] = []
    for method, path, endpoint in _surface(app):
        planned.extend(_planned(path, [method], endpoint))
    return planned


def test_the_sweep_finds_the_whole_v1_surface(keyed) -> None:
    _client, _key = keyed
    surface = _surface(_client.app)
    # Not vacuous: the walk really emptied into the sweep (and can't silently
    # shrink to nothing if FastAPI's router layout moves again).
    assert len(surface) >= MIN_ROUTES, f"only {len(surface)} v1 (method, path) pairs found"
    missing = SENTINELS - {(m, p) for m, p, _e in surface}
    assert not missing, f"the sweep missed known v1 routes: {sorted(missing)}"


def test_no_key_and_no_token_reaches_no_v1_route(keyed) -> None:
    """(a) Without an Authorization header the launch key gate applies to v1 too."""
    client, _key = keyed
    reached = [
        f"{method} {url} answered {res.status_code} with neither key nor token"
        for method, url, body in _calls(client.app)
        if (res := client.request(method, url, json=body)).status_code == 200
    ]
    assert not reached, "v1 routes answered 200 without the launch key:\n" + "\n".join(reached)


def test_a_bogus_bearer_token_is_401_on_every_v1_route(keyed) -> None:
    """(b) An Authorization header bypasses the launch key — and must meet a token check."""
    client, _key = keyed
    refused = [
        f"{method} {url} answered {res.status_code} ({res.text[:120]}) for a bogus bearer"
        for method, url, body in _calls(client.app)
        if (res := client.request(method, url, json=body, headers=BOGUS)).status_code != 401
    ]
    assert not refused, (
        "v1 routes that did not refuse a bogus bearer with 401 "
        "(a missing auth call, or params this sweep can't build):\n" + "\n".join(refused)
    )


def test_every_method_a_v1_route_serves_behaves_the_same(keyed) -> None:
    """(c) The gate holds for each method the route serves, not just the first."""
    client, _key = keyed
    by_path: dict[str, dict[str, tuple[str, Any, Any]]] = {}
    for method, path, endpoint in _surface(client.app):
        call = _planned(path, [method], endpoint)[0]
        by_path.setdefault(path, {})[method] = (call[1], call[2], endpoint)
    disagreed = []
    for path, per_method in sorted(by_path.items()):
        if len(per_method) < 2:
            continue
        plain = {
            m: client.request(m, url, json=body).status_code
            for m, (url, body, _ep) in per_method.items()
        }
        bearer = {
            m: client.request(m, url, json=body, headers=BOGUS).status_code
            for m, (url, body, _ep) in per_method.items()
        }
        if len(set(plain.values())) > 1 or len(set(bearer.values())) > 1:
            disagreed.append(f"{path}: keyless {plain}, bogus bearer {bearer}")
    assert not disagreed, "one route, several methods, different gates:\n" + "\n".join(disagreed)
