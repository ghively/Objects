"""M19 Task 3: the MCP servers file (`mcpstore`), with secrets kept apart. Synthetic values only."""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from objectapp import mcpstore
from objectapp.mcpmodel import McpServerInput
from objectapp.mcpprobe import ProbeResult
from objectapp.mcpstore import (
    McpConflict,
    McpInvalid,
    McpNotFound,
    McpReadOnly,
    McpStore,
    MissingSecret,
    cli_entry,
    secret_env_name,
)
from objectapp.secretstore import SecretStore

REF = re.compile(r"^\$\{(OBJECT_MCP_[0-9A-F]{12})\}$")


@pytest.fixture
def state(tmp_path: Path) -> Path:
    return tmp_path / "state"


@pytest.fixture
def secrets(state: Path) -> SecretStore:
    return SecretStore(state)


@pytest.fixture
def store(state: Path, secrets: SecretStore) -> McpStore:
    return McpStore(state, secrets)


def _files(folder: Path) -> list[str]:
    return sorted(p.name for p in folder.iterdir()) if folder.exists() else []


def _cmd(name: str = "fake", **kw: Any) -> McpServerInput:
    base: dict[str, Any] = {"name": name, "kind": "command", "command": "python", "args": ["x.py"]}
    return McpServerInput(**{**base, **kw})


def _url(name: str = "remote", **kw: Any) -> McpServerInput:
    base: dict[str, Any] = {"name": name, "kind": "url", "url": "https://host.example/mcp"}
    return McpServerInput(**{**base, **kw})


def _servers_raw(state: Path) -> str:
    return (state / "mcp-servers.json").read_text(encoding="utf-8")


def test_list_never_writes(state: Path, store: McpStore) -> None:
    assert store.list() == []
    assert store.read_only_reason() is None
    with pytest.raises(McpNotFound):
        store.get("01JC7ZK3T9Q4M2X8B5N6R1V0WE")
    assert _files(state) == []


def test_create_command_server(state: Path, store: McpStore, secrets: SecretStore) -> None:
    rec = store.create(
        _cmd(env=[{"key": "LOG", "value": "info"}, {"key": "FAKE_KEY", "value": "s3cret-1", "secret": True}])
    )
    sid = rec.data["id"]
    assert re.fullmatch(r"[0-9A-HJKMNP-TV-Z]{26}", sid)
    raw = _servers_raw(state)
    assert "s3cret-1" not in raw
    data = json.loads(raw)
    assert data["schemaVersion"] == 1
    [entry] = data["servers"]
    assert entry["name"] == "fake" and entry["kind"] == "command" and entry["enabled"] is True
    assert entry["command"] == "python" and entry["args"] == ["x.py"]
    assert entry["env"] == [{"key": "LOG", "value": "info", "secret": False}, {"key": "FAKE_KEY", "secret": True}]
    assert entry["createdAt"] == entry["updatedAt"]
    assert secrets.get(f"mcp:{sid}:env:FAKE_KEY") == "s3cret-1"
    assert "s3cret-1" not in json.dumps(rec.data)

    api = rec.to_api(secrets, None)
    assert api["env"] == [
        {"key": "LOG", "value": "info", "secret": False, "set": True},
        {"key": "FAKE_KEY", "value": None, "secret": True, "set": True},
    ]
    assert api["id"] == sid and api["revision"] == rec.revision
    assert api["missingSecrets"] == [] and api["lastTest"] is None
    assert api["transport"] is None and api["url"] is None and api["headers"] == [] and api["bearer"] is False
    assert "s3cret-1" not in json.dumps(api)
    assert store.list()[0].revision == rec.revision
    assert store.get(sid).data == rec.data


def test_to_api_last_test(store: McpStore, secrets: SecretStore) -> None:
    rec = store.create(_cmd())
    result = ProbeResult(True, (("echo", "Echo text"), ("add", "")), None, 42, "2026-11-06T09:00:00.000Z")
    assert rec.to_api(secrets, result)["lastTest"] == {
        "ok": True,
        "tools": [{"name": "echo", "description": "Echo text"}, {"name": "add", "description": ""}],
        "error": None,
        "elapsedMs": 42,
        "at": "2026-11-06T09:00:00.000Z",
    }


def test_create_url_server_with_bearer_and_header(state: Path, store: McpStore, secrets: SecretStore) -> None:
    rec = store.create(
        _url(
            headers=[{"name": "X-Api-Key", "value": "s3cret-hdr", "secret": True}, {"name": "X-Plain", "value": "p"}],
            bearer="s3cret-bearer",
            bearerAction="set",
        )
    )
    sid = rec.data["id"]
    raw = _servers_raw(state)
    assert "s3cret-hdr" not in raw and "s3cret-bearer" not in raw
    [entry] = json.loads(raw)["servers"]
    assert entry["bearer"] is True and entry["transport"] == "http"
    assert entry["command"] is None and entry["args"] == [] and entry["env"] == []
    assert entry["headers"] == [{"name": "X-Api-Key", "secret": True}, {"name": "X-Plain", "value": "p", "secret": False}]
    assert secrets.get(f"mcp:{sid}:bearer") == "s3cret-bearer"
    assert secrets.get(f"mcp:{sid}:header:x-api-key") == "s3cret-hdr"
    api = rec.to_api(secrets, None)
    assert api["headers"][0] == {"name": "X-Api-Key", "value": None, "secret": True, "set": True}
    assert api["bearer"] is True


def _big(n: int) -> str:
    return "s3cret-" + "x" * (n - 7)


# (label, setup, input, status, message, a value no message may hold)
CASES: list[tuple[str, Callable[[McpStore], None] | None, Callable[[], McpServerInput], int, str, str | None]] = [
    ("reserved object", None, lambda: _cmd("object"), 422, "That name is taken by Object.", None),
    ("reserved object-agent", None, lambda: _cmd("object-agent"), 422, "That name is taken by Object.", None),
    ("reserved Object", None, lambda: _cmd("Object"), 422, "That name is taken by Object.", None),
    ("space", None, lambda: _cmd("my server"), 422, "Use 1-64 letters, digits, - or _.", None),
    ("slash", None, lambda: _cmd("a/b"), 422, "Use 1-64 letters, digits, - or _.", None),
    ("empty name", None, lambda: _cmd(""), 422, "Use 1-64 letters, digits, - or _.", None),
    ("65 chars", None, lambda: _cmd("a" * 65), 422, "Use 1-64 letters, digits, - or _.", None),
    ("taken", lambda s: s.create(_cmd("github")), lambda: _cmd("GitHub"), 409, "Another server already has this name.", None),
    ("env a-b", None, lambda: _cmd(env=[{"key": "a-b", "value": "v"}]), 422, "a-b isn't a valid variable name.", None),
    ("env X=Y", None, lambda: _cmd(env=[{"key": "X=Y", "value": "v"}]), 422, "X=Y isn't a valid variable name.", None),
    (
        "env duplicate",
        None,
        lambda: _cmd(env=[{"key": "TOKEN", "value": "a"}, {"key": "TOKEN", "value": "b"}]),
        422,
        "TOKEN isn't a valid variable name.",
        None,
    ),
    ("header space", None, lambda: _url(headers=[{"name": "X Key", "value": "v"}]), 422, "That header name isn't valid.", None),
    ("header colon", None, lambda: _url(headers=[{"name": "X:Key", "value": "v"}]), 422, "That header name isn't valid.", None),
    (
        "header duplicate",
        None,
        lambda: _url(headers=[{"name": "X-A", "value": "1"}, {"name": "x-a", "value": "2"}]),
        422,
        "That header name isn't valid.",
        None,
    ),
    (
        "header CRLF",
        None,
        lambda: _url(headers=[{"name": "X-A", "value": "v\r\nInjected: 1"}]),
        422,
        "That header name isn't valid.",
        "Injected",
    ),
    (
        "secret header CRLF",
        None,
        lambda: _url(headers=[{"name": "X-A", "value": "s3cret-z\r\nInjected: 1", "secret": True}]),
        422,
        "That header name isn't valid.",
        "s3cret-z",
    ),
    ("file url", None, lambda: _url(url="file:///c:/x"), 422, "Use an http:// or https:// address.", None),
    ("javascript url", None, lambda: _url(url="javascript:alert(1)"), 422, "Use an http:// or https:// address.", None),
    ("ftp url", None, lambda: _url(url="ftp://h"), 422, "Use an http:// or https:// address.", None),
    ("no host", None, lambda: _url(url="http://"), 422, "Use an http:// or https:// address.", None),
    ("no url", None, lambda: _url(url=None), 422, "Use an http:// or https:// address.", None),
    ("url with command", None, lambda: _url(command="npx"), 422, "Use an http:// or https:// address.", None),
    ("empty command", None, lambda: _cmd(command=""), 422, "Enter the command.", None),
    ("no command", None, lambda: _cmd(command=None), 422, "Enter the command.", None),
    ("dash command", None, lambda: _cmd(command="-p"), 422, "That command can't be run.", None),
    ("NUL command", None, lambda: _cmd(command="py\x00thon"), 422, "That command can't be run.", None),
    ("command with url", None, lambda: _cmd(url="https://h/"), 422, "That command can't be run.", None),
    (
        "plain arg ${}",
        None,
        lambda: _cmd(args=["${OBJECT_API_TOKEN}"]),
        422,
        "Use a secret for values with ${…}.",
        "${OBJECT_API_TOKEN}",
    ),
    (
        "plain env ${}",
        None,
        lambda: _cmd(env=[{"key": "H", "value": "${HOME}"}]),
        422,
        "Use a secret for values with ${…}.",
        "${HOME}",
    ),
    (
        "plain header ${}",
        None,
        lambda: _url(headers=[{"name": "X-A", "value": "${X}"}]),
        422,
        "Use a secret for values with ${…}.",
        "${X}",
    ),
    ("command ${}", None, lambda: _cmd(command="${X}"), 422, "Use a secret for values with ${…}.", "${X}"),
    ("url ${}", None, lambda: _url(url="https://h/${X}"), 422, "Use a secret for values with ${…}.", "${X}"),
    (
        "bearer and Authorization",
        None,
        lambda: _url(headers=[{"name": "Authorization", "value": "s3cret-auth", "secret": True}], bearer="s3cret-b", bearerAction="set"),
        422,
        "Use either a bearer token or an Authorization header.",
        "s3cret-b",
    ),
    (
        "secret too long",
        None,
        lambda: _cmd(env=[{"key": "K", "value": _big(16385), "secret": True}]),
        422,
        "That secret is too long.",
        _big(16385),
    ),
    (
        "secret with NUL",
        None,
        lambda: _cmd(env=[{"key": "K", "value": "s3cret-\x00nul", "secret": True}]),
        422,
        "That secret is too long.",
        "s3cret-",
    ),
    ("51 args", None, lambda: _cmd(args=["a"] * 51), 422, "Up to 50 arguments.", None),
    (
        "51 env rows",
        None,
        lambda: _cmd(env=[{"key": f"K{i}", "value": "v"} for i in range(51)]),
        422,
        "Up to 50 environment variables.",
        None,
    ),
    (
        "51 header rows",
        None,
        lambda: _url(headers=[{"name": f"X-{i}", "value": "v"} for i in range(51)]),
        422,
        "Up to 50 headers.",
        None,
    ),
    (
        "51st server",
        lambda s: [s.create(_cmd(f"s{i}")) for i in range(50)] and None,
        lambda: _cmd("s50"),
        422,
        "Up to 50 servers.",
        None,
    ),
    (
        "new secret without value",
        None,
        lambda: _cmd(env=[{"key": "API_KEY", "value": None, "secret": True}]),
        422,
        "Enter a value for API_KEY.",
        None,
    ),
    ("bearer set without token", None, lambda: _url(bearerAction="set"), 422, "Enter a value for the bearer token.", None),
]


@pytest.mark.parametrize(("label", "setup", "make", "status", "message", "hidden"), CASES, ids=[c[0] for c in CASES])
def test_validation_table(
    store: McpStore,
    state: Path,
    label: str,
    setup: Callable[[McpStore], None] | None,
    make: Callable[[], McpServerInput],
    status: int,
    message: str,
    hidden: str | None,
) -> None:
    if setup is not None:
        setup(store)
    before = _files(state)
    raw_before = (state / "mcp-servers.json").read_bytes() if (state / "mcp-servers.json").exists() else None
    with pytest.raises((McpInvalid, McpConflict)) as info:
        store.create(make())
    err = info.value
    assert err.status == status
    assert err.message == message
    assert str(err) == message
    if status == 409:
        assert isinstance(err, McpConflict) and err.current_revision is None
    if hidden is not None:
        assert hidden not in err.message
    assert _files(state) == before
    if raw_before is not None:
        assert (state / "mcp-servers.json").read_bytes() == raw_before


def test_save_keeps_secrets_and_checks_revision(store: McpStore, secrets: SecretStore) -> None:
    rec = store.create(
        _url(
            headers=[{"name": "X-Api-Key", "value": "s3cret-hdr", "secret": True}],
            bearer="s3cret-bearer",
            bearerAction="set",
        )
    )
    sid = rec.data["id"]
    # keep: the secret row's value None keeps the stored value, bearerAction "keep" keeps the token
    rec2 = store.save(sid, _url(headers=[{"name": "X-Api-Key", "value": None, "secret": True}]), rec.revision)
    assert secrets.get(f"mcp:{sid}:header:x-api-key") == "s3cret-hdr"
    assert secrets.get(f"mcp:{sid}:bearer") == "s3cret-bearer"
    assert rec2.data["bearer"] is True and rec2.data["createdAt"] == rec.data["createdAt"]
    # remove the bearer
    rec3 = store.save(
        sid, _url(headers=[{"name": "X-Api-Key", "value": None, "secret": True}], bearerAction="remove"), rec2.revision
    )
    assert secrets.get(f"mcp:{sid}:bearer") is None and rec3.data["bearer"] is False
    # turn the secret row plain: its secret goes
    rec4 = store.save(sid, _url(headers=[{"name": "X-Api-Key", "value": "plain-now"}]), rec3.revision)
    assert secrets.keys(f"mcp:{sid}:") == []
    assert rec4.data["headers"] == [{"name": "X-Api-Key", "value": "plain-now", "secret": False}]
    # a stale base revision
    with pytest.raises(McpConflict) as info:
        store.save(sid, _url(), rec.revision)
    assert info.value.current_revision == rec4.revision
    # a changed name
    with pytest.raises(McpInvalid) as bad:
        store.save(sid, _url("other"), rec4.revision)
    assert bad.value.message == "A server's name can't be changed."
    # a row that wasn't secret before, now secret without a value
    with pytest.raises(McpInvalid) as missing:
        store.save(sid, _url(headers=[{"name": "X-Api-Key", "value": None, "secret": True}]), rec4.revision)
    assert missing.value.message == "Enter a value for X-Api-Key."
    with pytest.raises(McpNotFound):
        store.save("01JC7ZK3T9Q4M2X8B5N6R1V0WE", _url(), rec4.revision)


def test_save_removes_a_removed_rows_secret(store: McpStore, secrets: SecretStore) -> None:
    rec = store.create(
        _cmd(env=[{"key": "A", "value": "s3cret-a", "secret": True}, {"key": "TOKEN", "value": "s3cret-t", "secret": True}])
    )
    sid = rec.data["id"]
    with pytest.raises(McpInvalid) as info:
        store.save(sid, _cmd(env=[{"key": "NEW", "value": None, "secret": True}]), rec.revision)
    assert info.value.message == "Enter a value for NEW."
    rec2 = store.save(sid, _cmd(env=[{"key": "A", "value": "s3cret-a2", "secret": True}]), rec.revision)
    assert secrets.keys(f"mcp:{sid}:") == [f"mcp:{sid}:env:A"]
    assert secrets.get(f"mcp:{sid}:env:A") == "s3cret-a2"
    assert rec2.revision != rec.revision


def test_save_rolls_back_secrets_when_the_file_write_fails(
    store: McpStore, secrets: SecretStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    rec = store.create(_cmd(env=[{"key": "A", "value": "s3cret-old", "secret": True}]))
    sid = rec.data["id"]
    raw_before = (store.path).read_bytes()
    real = mcpstore.atomic_write

    def failing(path: Path, data: bytes, *a: Any, **kw: Any) -> None:
        if Path(path).name == "mcp-servers.json":
            raise OSError("disk full")
        real(path, data, *a, **kw)

    monkeypatch.setattr(mcpstore, "atomic_write", failing)
    with pytest.raises(OSError):
        store.save(
            sid,
            _cmd(env=[{"key": "A", "value": "s3cret-new", "secret": True}, {"key": "B", "value": "s3cret-b", "secret": True}]),
            rec.revision,
        )
    assert secrets.get(f"mcp:{sid}:env:A") == "s3cret-old"
    assert secrets.keys(f"mcp:{sid}:") == [f"mcp:{sid}:env:A"]
    with pytest.raises(OSError):
        store.create(_cmd("second", env=[{"key": "C", "value": "s3cret-c", "secret": True}]))
    assert not any(k.endswith(":env:C") for k in secrets.keys())
    assert store.path.read_bytes() == raw_before


def test_unknown_keys_kept(state: Path, store: McpStore) -> None:
    keep = store.create(_cmd("keep"))
    other = store.create(_cmd("other"))
    data = json.loads(_servers_raw(state))
    data["note"] = 1
    data["servers"][0]["x"] = [1]
    (state / "mcp-servers.json").write_text(json.dumps(data), encoding="utf-8")
    assert store.get(keep.data["id"]).data["x"] == [1]
    store.save(other.data["id"], _cmd("other", enabled=False), store.get(other.data["id"]).revision)
    after = json.loads(_servers_raw(state))
    assert after["note"] == 1 and after["servers"][0]["x"] == [1]
    assert after["servers"][1]["enabled"] is False
    # a server's own unknown keys survive its own save too
    rec = store.save(keep.data["id"], _cmd("keep", args=["y.py"]), store.get(keep.data["id"]).revision)
    assert rec.data["x"] == [1] and rec.data["args"] == ["y.py"]


def test_newer_schema_is_read_only(state: Path, store: McpStore) -> None:
    state.mkdir(parents=True)
    entry = {
        "id": "01JC7ZK3T9Q4M2X8B5N6R1V0WE",
        "name": "future",
        "enabled": True,
        "kind": "command",
        "command": "python",
        "args": [],
        "env": [],
        "createdAt": "2026-11-05T09:00:00.000Z",
        "updatedAt": "2026-11-05T09:00:00.000Z",
    }
    raw = json.dumps({"schemaVersion": 2, "servers": [entry]}).encode()
    (state / "mcp-servers.json").write_bytes(raw)
    assert [r.data["name"] for r in store.list()] == ["future"]
    assert store.read_only_reason() == "These MCP servers were saved by a newer version of Object."
    rec = store.get(entry["id"])
    with pytest.raises(McpReadOnly) as info:
        store.create(_cmd())
    assert info.value.status == 423
    with pytest.raises(McpReadOnly):
        store.save(entry["id"], _cmd("future"), rec.revision)
    with pytest.raises(McpReadOnly):
        store.delete(entry["id"])
    assert (state / "mcp-servers.json").read_bytes() == raw


def test_unreadable_file_is_kept_aside(state: Path, store: McpStore) -> None:
    state.mkdir(parents=True)
    (state / "mcp-servers.json").write_text("{nope", encoding="utf-8")
    assert store.list() == []
    assert store.read_only_reason() is None
    assert store.unreadable() is True
    assert _files(state) == ["mcp-servers.json"]
    store.create(_cmd())
    aside = [n for n in _files(state) if n.startswith("mcp-servers.unreadable-")]
    assert len(aside) == 1 and aside[0].endswith(".json")
    assert (state / aside[0]).read_text(encoding="utf-8") == "{nope"
    assert [r.data["name"] for r in store.list()] == ["fake"]
    assert store.unreadable() is False


@pytest.mark.parametrize("target", ["mcp-servers.json", "secrets.json"])
def test_a_passing_read_failure_never_drops_servers(state: Path, store: McpStore, secrets: SecretStore,
                                                     monkeypatch, target: str) -> None:
    first = store.create(_cmd("first", env=[{"key": "A", "value": "s3cret-a", "secret": True}]))
    secrets.set("var:GH_TOKEN", "s3cret-var")
    servers_before = (state / "mcp-servers.json").read_bytes()
    secrets_before = (state / "secrets.json").read_bytes()
    real = Path.read_bytes

    def flaky(self: Path) -> bytes:  # the file is locked while the write runs (antivirus, backup)
        if self.name == target:
            raise PermissionError(13, "sharing violation")
        return real(self)

    monkeypatch.setattr(Path, "read_bytes", flaky)
    with pytest.raises(PermissionError):
        store.create(_cmd("second", env=[{"key": "B", "value": "s3cret-b", "secret": True}]))
    monkeypatch.undo()
    assert (state / "mcp-servers.json").read_bytes() == servers_before
    assert (state / "secrets.json").read_bytes() == secrets_before
    assert [r.data["name"] for r in store.list()] == ["first"]
    assert first.data["id"] in (state / "mcp-servers.json").read_text(encoding="utf-8")


def test_delete_removes_its_secrets(store: McpStore, secrets: SecretStore) -> None:
    gone = store.create(_cmd("gone", env=[{"key": "A", "value": "s3cret-a", "secret": True}]))
    kept = store.create(_cmd("kept", env=[{"key": "B", "value": "s3cret-b", "secret": True}]))
    secrets.set("var:GH_TOKEN", "s3cret-var")
    store.delete(gone.data["id"])
    assert secrets.keys(f"mcp:{gone.data['id']}:") == []
    assert secrets.get(f"mcp:{kept.data['id']}:env:B") == "s3cret-b"
    assert secrets.get("var:GH_TOKEN") == "s3cret-var"
    assert [r.data["name"] for r in store.list()] == ["kept"]
    with pytest.raises(McpNotFound):
        store.delete(gone.data["id"])


def test_cli_entry_shapes(state: Path, store: McpStore, secrets: SecretStore) -> None:
    rec = store.create(
        _cmd(env=[{"key": "LOG", "value": "info"}, {"key": "FAKE_KEY", "value": "s3cret-1", "secret": True}])
    )
    sid = rec.data["id"]
    entry, env = cli_entry(rec.data, secrets)
    name = secret_env_name(f"mcp:{sid}:env:FAKE_KEY")
    assert entry == {"type": "stdio", "command": "python", "args": ["x.py"], "env": {"LOG": "info", "FAKE_KEY": "${" + name + "}"}}
    assert REF.fullmatch(entry["env"]["FAKE_KEY"])
    assert env == {name: "s3cret-1"}

    url = store.create(
        _url(headers=[{"name": "X-Api-Key", "value": "s3cret-h", "secret": True}], bearer="s3cret-b", bearerAction="set")
    )
    uid = url.data["id"]
    entry, env = cli_entry(url.data, secrets)
    hname = secret_env_name(f"mcp:{uid}:header:x-api-key")
    bname = secret_env_name(f"mcp:{uid}:bearer")
    assert entry == {
        "type": "http",
        "url": "https://host.example/mcp",
        "headers": {"X-Api-Key": "${" + hname + "}", "Authorization": "Bearer ${" + bname + "}"},
    }
    assert env == {hname: "s3cret-h", bname: "s3cret-b"}
    sse = store.create(_url("sse-one", transport="sse", headers=[{"name": "X-Plain", "value": "p"}]))
    assert cli_entry(sse.data, secrets) == ({"type": "sse", "url": "https://host.example/mcp", "headers": {"X-Plain": "p"}}, {})

    assert secret_env_name("mcp:x:bearer") == secret_env_name("mcp:x:bearer")
    assert re.fullmatch(r"OBJECT_MCP_[0-9A-F]{12}", secret_env_name("mcp:x:bearer"))
    assert secret_env_name("mcp:x:bearer") != secret_env_name("mcp:y:bearer")

    (state / "secrets.json").unlink()
    with pytest.raises(MissingSecret) as info:
        cli_entry(rec.data, secrets)
    assert info.value.keys == ["FAKE_KEY"]
    assert "s3cret" not in str(info.value)
    assert rec.to_api(secrets, None)["missingSecrets"] == ["FAKE_KEY"]
    assert rec.to_api(secrets, None)["env"][1]["set"] is False
    with pytest.raises(MissingSecret) as info2:
        cli_entry(url.data, secrets)
    assert info2.value.keys == ["X-Api-Key", "Authorization"]
    assert url.to_api(secrets, None)["missingSecrets"] == ["X-Api-Key", "Authorization"]


def test_cmd_command_is_passed_as_given(store: McpStore, secrets: SecretStore) -> None:
    """The T1 spike found the CLI starts a `.cmd` command as given, so `cli_entry` doesn't wrap it."""
    rec = store.create(_cmd(command="fake-mcp.cmd", args=["--x"]))
    entry, _ = cli_entry(rec.data, secrets)
    assert entry["command"] == "fake-mcp.cmd" and entry["args"] == ["--x"]


def test_revision_is_the_entrys_hash(store: McpStore) -> None:
    import hashlib

    from objectapp.jsonstore import dump_json

    rec = store.create(_cmd())
    assert rec.revision == hashlib.sha256(dump_json(rec.data)).hexdigest()
