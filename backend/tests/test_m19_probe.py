"""M19 Task 4: listing an outside MCP server's tools (`mcpprobe`).

Entries are written by hand in `mcpstore.cli_entry`'s shapes, so this lane doesn't wait for T3.
Every server is the synthetic fake (`fake_mcp_server.py`); every secret is a synthetic
``s3cret-...`` string, compared and never printed.
"""

from __future__ import annotations

import hashlib
import http.server
import logging
import os
import socket
import sys
import threading
import time
from pathlib import Path

import pytest

from objectapp import mcpprobe
from objectapp.mcpmodel import TOOL_DESCRIPTION_MAX
from objectapp.mcpprobe import ProbeResult, expand_refs, probe_many, probe_sync

import fake_mcp_server

FAKE = str(Path(fake_mcp_server.__file__).resolve())
PY = sys.executable


def stdio_entry(*args: str, env: dict[str, str] | None = None) -> dict:
    return {"type": "stdio", "command": PY, "args": [FAKE, *args], "env": env or {}}


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture
def http_fake():
    started: list = []

    def start(mode: str = "http", **kw):
        url, stop = fake_mcp_server.serve_in_thread(mode, **kw)
        started.append(stop)
        return url

    yield start
    for stop in started:
        stop()


def _alive(pid: int) -> bool:
    """Whether a process is still running (never sends it a signal on Windows)."""
    if sys.platform == "win32":
        import ctypes

        kernel = ctypes.windll.kernel32
        handle = kernel.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not handle:
            return False
        try:
            code = ctypes.c_ulong()
            if not kernel.GetExitCodeProcess(handle, ctypes.byref(code)):
                return False
            return code.value == 259  # STILL_ACTIVE
        finally:
            kernel.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    # A zombie child still answers kill 0; it is gone once reaped.
    try:
        waited, _status = os.waitpid(pid, os.WNOHANG)
        return waited == 0
    except ChildProcessError:
        return True


def _snapshot(*roots: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for root in roots:
        for p in sorted(root.rglob("*")):
            if p.is_file():
                out[str(p)] = hashlib.sha256(p.read_bytes()).hexdigest()
            else:
                out[str(p)] = "dir"
    return out


# --- expand_refs -----------------------------------------------------------------------------


def test_expand_refs():
    env = {"A": "va", "E": ""}
    assert expand_refs("${A}", env) == "va"
    assert expand_refs("x-${A}-y", env) == "x-va-y"
    assert expand_refs("${B:-d}", env) == "d"
    assert expand_refs("${A:-d}", env) == "va"
    assert expand_refs("${E:-d}", env) == "d"
    # An unset ${VAR} stays as written (the CLI's behaviour, m19-cli-spike.md).
    assert expand_refs("${B}", env) == "${B}"
    assert expand_refs("$A and {A}", env) == "$A and {A}"
    nested = {"${A}": ["${A}", {"k": "${B:-z}"}, 3, None, True]}
    assert expand_refs(nested, env) == {"${A}": ["va", {"k": "z"}, 3, None, True]}
    # Only the given mapping is read, never Object's own environment.
    os.environ["OBJECT_MCP_PROBE_UNSEEN"] = "s3cret-env"
    try:
        assert expand_refs("${OBJECT_MCP_PROBE_UNSEEN}", {}) == "${OBJECT_MCP_PROBE_UNSEEN}"
    finally:
        del os.environ["OBJECT_MCP_PROBE_UNSEEN"]


# --- listing ---------------------------------------------------------------------------------


def test_stdio_lists_tools():
    r = probe_sync(stdio_entry("--require-env", "FAKE_KEY", env={"FAKE_KEY": "${OBJECT_MCP_X}"}),
                   {"OBJECT_MCP_X": "s3cret-p"})
    assert isinstance(r, ProbeResult)
    assert r.ok is True and r.error is None
    assert [name for name, _d in r.tools] == ["add", "echo", "whoami"]
    descriptions = dict(r.tools)
    assert descriptions["add"] == "Add two numbers."
    assert descriptions["echo"] == "Echo the text back."
    assert r.elapsed_ms > 0
    assert r.at.endswith("Z") and "T" in r.at


@pytest.mark.parametrize("mode", ["http", "sse"])
def test_http_and_sse_list_tools(http_fake, mode):
    url = http_fake(mode, require_bearer="s3cret-http")
    entry = {"type": mode, "url": url, "headers": {"Authorization": "Bearer ${OBJECT_MCP_Y}"}}
    r = probe_sync(entry, {"OBJECT_MCP_Y": "s3cret-http"})
    assert r.ok is True, r.error
    assert [name for name, _d in r.tools] == ["add", "echo", "whoami"]
    assert r.read_only == ("echo",)


class _Status500(http.server.BaseHTTPRequestHandler):
    def do_POST(self):  # noqa: N802
        self.send_response(500)
        self.send_header("Content-Length", "0")
        self.end_headers()

    do_GET = do_POST  # noqa: N815

    def log_message(self, *a):  # quiet
        pass


@pytest.fixture
def status_500():
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _Status500)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    yield f"http://127.0.0.1:{srv.server_address[1]}/mcp"
    srv.shutdown()
    srv.server_close()


def test_failure_modes(http_fake, status_500, tmp_path, monkeypatch):
    # A command that doesn't exist.
    r = probe_sync({"type": "stdio", "command": "no-such-mcp-command-zz", "args": [], "env": {}}, {})
    assert r.ok is False and r.error == "Couldn't start no-such-mcp-command-zz: not found."

    # --hang with a 1 s timeout: the timeout message, and the process tree is gone afterwards.
    pid_file = tmp_path / "pid.txt"
    code = ("import os, runpy, sys; open(sys.argv[1], 'w').write(str(os.getpid())); "
            "sys.argv = [sys.argv[2], '--hang']; runpy.run_path(sys.argv[0], run_name='__main__')")
    started = time.monotonic()
    r = probe_sync({"type": "stdio", "command": PY, "args": ["-c", code, str(pid_file), FAKE], "env": {}}, {},
                   timeout=1)
    assert time.monotonic() - started < 6
    assert r.ok is False and r.error == "The server didn't answer within 1 second."
    pid = int(pid_file.read_text())
    deadline = time.monotonic() + 5
    while _alive(pid) and time.monotonic() < deadline:
        time.sleep(0.05)
    assert not _alive(pid)

    # The default timeout's message is the Contract's.
    assert mcpprobe._timeout_message(20) == "The server didn't answer within 20 seconds."

    # --junk: the tools are still listed, never an exception.
    r = probe_sync(stdio_entry("--junk"), {})
    assert (r.ok and [n for n, _d in r.tools] == ["add", "echo", "whoami"]) or (not r.ok and r.error)

    # --require-env without the env: it stops before it answers, with its stderr.
    r = probe_sync(stdio_entry("--require-env", "FAKE_KEY"), {})
    assert r.ok is False
    assert r.error.startswith("The server stopped before it answered.")
    assert "missing FAKE_KEY" in r.error

    # A refused port.
    port = free_port()
    for mode, path in (("http", "/mcp"), ("sse", "/sse")):
        r = probe_sync({"type": mode, "url": f"http://127.0.0.1:{port}{path}", "headers": {}}, {})
        assert r.ok is False and r.error == "Couldn't connect to 127.0.0.1.", (mode, r.error)

    # 401 without the bearer: the OAuth message; a wrong path: 404; a 500.
    oauth = ("The server refused the credentials (401). If it needs an OAuth sign-in, Object can't do "
             "that yet; use a token or a header.")
    url = http_fake("http", require_bearer="s3cret-401")
    r = probe_sync({"type": "http", "url": url, "headers": {}}, {})
    assert r.ok is False and r.error == oauth
    sse_url = http_fake("sse", require_bearer="s3cret-401")
    r = probe_sync({"type": "sse", "url": sse_url, "headers": {}}, {})
    assert r.ok is False and r.error == oauth
    r = probe_sync({"type": "http", "url": url.replace("/mcp", "/nowhere"),
                    "headers": {"Authorization": "Bearer s3cret-401"}}, {})
    assert r.ok is False and r.error == "The server answered 404."
    r = probe_sync({"type": "http", "url": status_500, "headers": {}}, {})
    assert r.ok is False and r.error == "The server answered 500."

    # --many 0 lists nothing; --many 500 lists all 500 (pagination followed).
    r = probe_sync(stdio_entry("--many", "0"), {})
    assert r.ok is True and r.tools == ()
    r = probe_sync(stdio_entry("--many", "500"), {})
    assert r.ok is True and len(r.tools) == 500
    assert {n for n, _d in r.tools} == {f"t{i}" for i in range(500)}


def test_pagination_is_followed(monkeypatch):
    """A server answering in pages: every page's tools are listed."""
    from mcp import ClientSession

    real = ClientSession.list_tools
    seen: list = []

    async def paged(self, *, params=None):
        result = await real(self, params=None)
        cursor = getattr(params, "cursor", None)
        seen.append(cursor)
        page = 0 if cursor is None else int(cursor)
        chunk = result.tools[page * 2:page * 2 + 2]
        nxt = str(page + 1) if (page + 1) * 2 < len(result.tools) else None
        return result.model_copy(update={"tools": chunk, "next_cursor": nxt})

    monkeypatch.setattr(ClientSession, "list_tools", paged)
    r = probe_sync(stdio_entry("--many", "5"), {})
    assert r.ok is True, r.error
    assert [n for n, _d in r.tools] == sorted(f"t{i}" for i in range(5))
    assert seen == [None, "1", "2"]


def test_descriptions_capped():
    r = probe_sync(stdio_entry("--long-description"), {})
    assert r.ok is True
    description = dict(r.tools)["echo"]
    assert len(description) == TOOL_DESCRIPTION_MAX == 300
    assert description == fake_mcp_server.LONG_DESCRIPTION[:300]


def test_read_only_hints():
    r = probe_sync(stdio_entry(), {})
    assert r.read_only == ("echo",)
    r = probe_sync(stdio_entry("--many", "3"), {})
    assert r.ok is True and r.read_only == ()


def test_errors_are_redacted(http_fake, caplog, monkeypatch):
    caplog.set_level(logging.DEBUG)
    secret = "s3cret-redact-me"
    r = probe_sync(stdio_entry("--print-env-and-exit", env={"FAKE_KEY": "${OBJECT_MCP_R}"}),
                   {"OBJECT_MCP_R": secret}, redact_values=[secret])
    assert r.ok is False and secret not in r.error
    # With room for the whole environment, FAKE_KEY's line is in the tail, masked.
    monkeypatch.setattr(mcpprobe, "PROBE_STDERR_CHARS", 1_000_000)
    r = probe_sync(stdio_entry("--print-env-and-exit", env={"FAKE_KEY": "${OBJECT_MCP_R}"}),
                   {"OBJECT_MCP_R": secret}, redact_values=[secret])
    assert r.ok is False
    assert r.error.startswith("The server stopped before it answered.")
    assert "FAKE_KEY=••••••" in r.error  # its stderr tail, with the value masked
    assert secret not in r.error
    assert secret not in caplog.text

    bearer = "s3cret-bearer-echo"
    url = http_fake("http", require_bearer="s3cret-the-right-one")
    for mode, endpoint in (("http", url), ("sse", http_fake("sse", require_bearer="s3cret-the-right-one"))):
        r = probe_sync({"type": mode, "url": endpoint, "headers": {"Authorization": "Bearer ${OBJECT_MCP_B}"}},
                       {"OBJECT_MCP_B": bearer}, redact_values=[bearer])
        assert r.ok is False and "(401)" in r.error
        assert bearer not in r.error
    assert bearer not in caplog.text
    assert secret not in caplog.text


def test_stderr_tail_is_capped(monkeypatch):
    monkeypatch.setattr(mcpprobe, "PROBE_STDERR_CHARS", 50)
    r = probe_sync(stdio_entry("--print-env-and-exit"), {})
    assert r.ok is False
    head = "The server stopped before it answered."
    assert r.error.startswith(head)
    assert len(r.error) <= len(head) + 1 + 50


def test_probe_many_runs_in_parallel(tmp_path):
    targets = {f"k{i}": (stdio_entry("--hang"), {}, None) for i in range(3)}
    started = time.monotonic()
    results = probe_many(targets, timeout=1)
    elapsed = time.monotonic() - started
    assert set(results) == {"k0", "k1", "k2"}
    for r in results.values():
        assert r.ok is False and r.error == "The server didn't answer within 1 second."
    assert elapsed < 2.5, elapsed


def test_probe_many_keeps_each_result_apart(http_fake):
    url = http_fake("http", require_bearer="s3cret-many")
    results = probe_many({
        "ok-stdio": (stdio_entry(), {}, None),
        "ok-http": ({"type": "http", "url": url, "headers": {"Authorization": "Bearer ${T}"}},
                    {"T": "s3cret-many"}, None),
        "bad": ({"type": "stdio", "command": "no-such-mcp-command-zz", "args": [], "env": {}}, {}, None),
    })
    assert results["ok-stdio"].ok and results["ok-http"].ok
    assert results["bad"].error == "Couldn't start no-such-mcp-command-zz: not found."
    assert probe_many({}) == {}


def test_probe_uses_cwd(tmp_path):
    """A folder server starts in its folder (relative script paths resolve there)."""
    folder = tmp_path / "agent"
    folder.mkdir()
    (folder / "srv.py").write_text(
        "import runpy, sys\nsys.argv = [sys.argv[1]]\nrunpy.run_path(sys.argv[0], run_name='__main__')\n",
        encoding="utf-8")
    before = _snapshot(folder)
    r = probe_sync({"type": "stdio", "command": PY, "args": ["srv.py", FAKE], "env": {}}, {}, cwd=folder)
    assert r.ok is True, r.error
    assert _snapshot(folder) == before


def test_probe_writes_nothing(tmp_path, http_fake):
    state = Path(os.environ["OBJECT_STATE_DIR"])
    state.mkdir(parents=True, exist_ok=True)
    cwd = tmp_path / "cwd"
    cwd.mkdir()
    (cwd / "keep.txt").write_text("x", encoding="utf-8")
    url = http_fake("http")
    before = _snapshot(state, tmp_path)
    probe_sync(stdio_entry(), {}, cwd=cwd)
    probe_sync(stdio_entry("--require-env", "NOPE"), {}, cwd=cwd)
    probe_sync(stdio_entry("--hang"), {}, cwd=cwd, timeout=1)
    probe_sync({"type": "http", "url": url, "headers": {}}, {})
    assert _snapshot(state, tmp_path) == before
