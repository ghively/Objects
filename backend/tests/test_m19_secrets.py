"""M19 Task 2: the state-dir secrets file (`secretstore`). Synthetic secrets only."""

from __future__ import annotations

import json
import os
import sys
import threading
from pathlib import Path

import pytest

from objectapp import secretstore
from objectapp.secretstore import SecretStore, check_var_name, lookup_var, redact, var_key

SID = "01JC7ZK3T9Q4M2X8B5N6R1V0WE"


@pytest.fixture
def state(tmp_path: Path) -> Path:
    return tmp_path / "state"


def _files(folder: Path) -> list[str]:
    return sorted(p.name for p in folder.iterdir()) if folder.exists() else []


def test_reads_never_write(state: Path) -> None:
    store = SecretStore(state)
    assert store.get("var:GH_TOKEN") is None
    assert store.has("var:GH_TOKEN") is False
    assert store.keys() == []
    assert store.keys("mcp:") == []
    assert store.values() == []
    assert _files(state) == []


def test_set_get_delete(state: Path) -> None:
    store = SecretStore(state)
    key = f"mcp:{SID}:bearer"
    store.set(key, "s3cret-a")
    raw = (state / "secrets.json").read_bytes()
    assert raw.endswith(b"\n") and not raw.endswith(b"\r\n")
    assert json.loads(raw) == {"version": 1, "secrets": {key: "s3cret-a"}}
    assert store.get(key) == "s3cret-a"
    assert store.has(key) is True
    assert store.keys("mcp:") == [key]
    assert SecretStore(state).get(key) == "s3cret-a"
    assert store.delete_prefix(f"mcp:{SID}:") == 1
    assert store.get(key) is None
    assert store.delete(key) is False


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX file modes")
def test_file_mode_is_0600(state: Path) -> None:
    SecretStore(state).set("var:GH_TOKEN", "s3cret-mode")
    assert (os.stat(state / "secrets.json").st_mode & 0o777) == 0o600


def test_set_many_is_one_write(state: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    store = SecretStore(state)
    store.set("a:3", "z-value")
    calls: list[Path] = []
    real = secretstore.atomic_write

    def counting(path: Path, data: bytes, check=None) -> None:  # type: ignore[no-untyped-def]
        calls.append(Path(path))
        real(path, data, check)

    monkeypatch.setattr(secretstore, "atomic_write", counting)
    store.set_many({"a:1": "x-value", "a:2": "y-value"}, remove=["a:3"])
    assert len(calls) == 1
    assert sorted(store.keys()) == ["a:1", "a:2"]


def test_bad_keys_and_values(state: Path) -> None:
    store = SecretStore(state)
    secret_long = "s3cret-" + "q" * (16385 - 7)
    secret_nul = "s3cret-nul\x00tail"
    for key, value in (
        ("no-colon", "s3cret-key"),
        ("UPPER:x", "s3cret-key"),
        ("var:bad\nkey", "s3cret-key"),
        ("var:LONG", secret_long),
        ("var:NUL", secret_nul),
        ("var:EMPTY", ""),
    ):
        with pytest.raises(ValueError) as err:
            store.set(key, value)
        if value:
            assert value not in str(err.value)
            assert "s3cret" not in str(err.value)
    with pytest.raises(ValueError) as err:
        store.set_many({"var:OK": "s3cret-ok", "var:NUL": secret_nul})
    assert "s3cret" not in str(err.value)
    assert _files(state) == []
    store.set("var:MAX", "m" * 16384)
    assert store.get("var:MAX") == "m" * 16384


def test_repr_hides_values(state: Path) -> None:
    store = SecretStore(state)
    store.set("var:GH_TOKEN", "s3cret-repr")
    store.get("var:GH_TOKEN")
    assert "s3cret-repr" not in repr(store)
    assert "s3cret-repr" not in str(store)


def test_unreadable_file_is_kept_aside(state: Path) -> None:
    state.mkdir(parents=True)
    (state / "secrets.json").write_bytes(b"{nope")
    store = SecretStore(state)
    assert store.get("var:GH_TOKEN") is None
    assert store.keys() == []
    assert _files(state) == ["secrets.json"]
    store.set("var:GH_TOKEN", "s3cret-new")
    aside = [p for p in state.iterdir() if p.name.startswith("secrets.unreadable-")]
    assert len(aside) == 1 and aside[0].suffix == ".json"
    assert aside[0].read_bytes() == b"{nope"
    assert store.get("var:GH_TOKEN") == "s3cret-new"


def test_unknown_top_level_keys_kept(state: Path) -> None:
    state.mkdir(parents=True)
    (state / "secrets.json").write_text(
        json.dumps({"version": 1, "secrets": {"var:A": "s3cret-old"}, "note": [1]}), encoding="utf-8"
    )
    SecretStore(state).set("var:B", "s3cret-b")
    data = json.loads((state / "secrets.json").read_text(encoding="utf-8"))
    assert data["note"] == [1]
    assert data["secrets"] == {"var:A": "s3cret-old", "var:B": "s3cret-b"}


def test_var_names() -> None:
    for ok in ("GH_TOKEN", "api_key", "_X", "A" * 64):
        check_var_name(ok)
    for reserved in (
        "PATH",
        "path",
        "CLAUDE_CONFIG_DIR",
        "ANTHROPIC_API_KEY",
        "OBJECT_API_TOKEN",
        "object_mcp_x",
        "HOME",
        "NODE_OPTIONS",
    ):
        with pytest.raises(ValueError, match="^Object can't set this variable\\.$"):
            check_var_name(reserved)
    for bad in ("a-b", "X=Y", "1A", "", "A\x00B", "A" * 65):
        with pytest.raises(ValueError, match="^That isn't a valid variable name\\.$"):
            check_var_name(bad)


def test_lookup_var(state: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OBJECT_STATE_DIR", str(state))
    assert var_key("GH_TOKEN") == "var:GH_TOKEN"
    assert lookup_var("GH_TOKEN") is None
    SecretStore().set(var_key("GH_TOKEN"), "s3cret-gh")
    assert lookup_var("GH_TOKEN") == "s3cret-gh"
    name = "USERPROFILE" if sys.platform == "win32" else "HOME"
    monkeypatch.setenv(name, "/synthetic/home")
    assert lookup_var(name) == "/synthetic/home"
    assert lookup_var("PATH") is None


def test_redact() -> None:
    assert redact("Bearer s3cret-abc failed", ["s3cret-abc"]) == "Bearer •••••• failed"
    assert redact("abc is short", ["abc"]) == "abc is short"
    assert redact("token s3cret-abcdef here", ["s3cret-abc", "s3cret-abcdef"]) == "token •••••• here"
    assert redact("nothing here", []) == "nothing here"


def test_concurrent_sets(state: Path) -> None:
    store = SecretStore(state)

    def work(i: int) -> None:
        store.set(f"var:K{i}", f"s3cret-{i}")

    threads = [threading.Thread(target=work, args=(i,)) for i in range(20)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(SecretStore(state).keys()) == 20
