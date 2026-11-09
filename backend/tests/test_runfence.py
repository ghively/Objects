"""The run fence (sweep 2026-11-08): an agent run can't use the app's own ``/api`` routes.

`runfence.peer_pid` finds the process behind a loopback connection with psutil (cached about
two seconds); `runfence.is_run_process` tells whether that process is a running agent run or
one of its descendants; `RunFenceMiddleware` refuses such requests with 403 unless they are
``/api/v1`` calls carrying a bearer token (the MCP servers' path) or static files.
"""

from __future__ import annotations

import json
import socket
import subprocess
import sys
import textwrap
import threading
import time
import types
from collections import namedtuple
from pathlib import Path

import httpx
import psutil
import pytest
import uvicorn
from fake_claude import install
from fastapi.testclient import TestClient

from objectapp import agentrun, runfence
from objectapp import settings as device_settings
from objectapp.agentmodel import DEFAULT_AGENT_ID
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.tokens import TokenStore

Addr = namedtuple("Addr", "ip port")
Conn = namedtuple("Conn", "fd family type laddr raddr status pid")


def _conn(port: int, pid: int | None, ip: str = "127.0.0.1") -> Conn:
    return Conn(3, socket.AF_INET, socket.SOCK_STREAM, Addr(ip, port), Addr(ip, 8790), "ESTABLISHED", pid)


class FakePsutil:
    """A stand-in for the psutil module: canned connections and a canned process tree."""

    AccessDenied = psutil.AccessDenied
    NoSuchProcess = psutil.NoSuchProcess
    Error = psutil.Error

    def __init__(self, conns: list[Conn], tree: dict[int, int | None] | None = None) -> None:
        self.conns = conns
        self.tree = tree or {}
        self.scans = 0
        self.fail: Exception | None = None

    def net_connections(self, kind: str = "inet") -> list[Conn]:
        assert kind == "tcp"
        self.scans += 1
        if self.fail is not None:
            raise self.fail
        return list(self.conns)

    def Process(self, pid: int):
        if pid not in self.tree:
            raise psutil.NoSuchProcess(pid)
        tree = self.tree

        class Proc:
            def parents(self_inner):
                out = []
                cur = tree.get(pid)
                while cur is not None:
                    out.append(types.SimpleNamespace(pid=cur))
                    cur = tree.get(cur)
                return out

        return Proc()


@pytest.fixture
def fake_psutil(monkeypatch: pytest.MonkeyPatch) -> FakePsutil:
    fake = FakePsutil([_conn(40001, 501), _conn(40002, None)], tree={501: 500, 500: 1, 600: 1, 1: None})
    monkeypatch.setattr(runfence, "psutil", fake)
    runfence.reset_cache()
    return fake


# -- peer_pid ------------------------------------------------------------------------------------


def test_peer_pid_finds_the_process_behind_a_client_port(fake_psutil: FakePsutil) -> None:
    assert runfence.peer_pid("127.0.0.1", 40001) == 501


def test_peer_pid_is_none_for_an_unknown_port_or_an_unowned_connection(fake_psutil: FakePsutil) -> None:
    assert runfence.peer_pid("127.0.0.1", 40002) is None  # psutil saw it but not its pid
    assert runfence.peer_pid("127.0.0.1", 49999) is None  # not connected at all


def test_peer_pid_caches_the_table_for_about_two_seconds(fake_psutil: FakePsutil, monkeypatch) -> None:
    now = [1000.0]
    monkeypatch.setattr(runfence, "_now", lambda: now[0])
    assert runfence.peer_pid("127.0.0.1", 40001) == 501
    assert runfence.peer_pid("127.0.0.1", 40001) == 501
    assert runfence.peer_pid("127.0.0.1", 40002) is None  # a known port with no pid is cached too
    assert fake_psutil.scans == 1
    fake_psutil.conns = [_conn(40001, 777)]
    now[0] += 1.0
    assert runfence.peer_pid("127.0.0.1", 40001) == 501  # still the cached answer
    assert fake_psutil.scans == 1
    now[0] += 1.5  # past the two seconds
    assert runfence.peer_pid("127.0.0.1", 40001) == 777
    assert fake_psutil.scans == 2


def test_peer_pid_rescans_for_a_port_it_has_not_seen(fake_psutil: FakePsutil, monkeypatch) -> None:
    monkeypatch.setattr(runfence, "_now", lambda: 1000.0)
    assert runfence.peer_pid("127.0.0.1", 40001) == 501
    fake_psutil.conns.append(_conn(40003, 600))
    assert runfence.peer_pid("127.0.0.1", 40003) == 600  # a new connection: one more scan
    assert fake_psutil.scans == 2


def test_peer_pid_lets_through_and_logs_once_where_psutil_cannot_answer(fake_psutil: FakePsutil, caplog) -> None:
    fake_psutil.fail = psutil.AccessDenied(pid=None)
    with caplog.at_level("WARNING", logger="objectapp.runfence"):
        assert runfence.peer_pid("127.0.0.1", 40001) is None
        assert runfence.peer_pid("127.0.0.1", 40001) is None
    assert fake_psutil.scans == 1  # no retry once psutil said no
    [record] = caplog.records
    assert record.message.startswith(runfence.UNAVAILABLE_MESSAGE)


# -- is_run_process ------------------------------------------------------------------------------


def test_is_run_process_matches_the_run_itself_and_its_descendants(fake_psutil: FakePsutil) -> None:
    assert runfence.is_run_process(500, {500}) is True
    assert runfence.is_run_process(501, {500}) is True  # the run's child (an MCP server, a shell)
    assert runfence.is_run_process(600, {500}) is False  # another process entirely
    assert runfence.is_run_process(501, set()) is False
    assert runfence.is_run_process(12345, {500}) is False  # gone: no such process


# -- a real connection ---------------------------------------------------------------------------


CHILD = textwrap.dedent(
    """
    import socket, sys, time
    s = socket.create_connection(("127.0.0.1", int(sys.argv[1])))
    sys.stdout.write(f"{s.getsockname()[1]}\\n")
    sys.stdout.flush()
    time.sleep(30)
    """
)


def _psutil_can_list_connections() -> bool:
    try:
        psutil.net_connections(kind="tcp")
        return True
    except (psutil.AccessDenied, psutil.Error, OSError, NotImplementedError):
        return False


def test_peer_pid_finds_a_real_child_process() -> None:
    if not _psutil_can_list_connections():
        pytest.skip("psutil cannot list connections on this machine")
    runfence.reset_cache()
    with socket.socket() as server:
        server.bind(("127.0.0.1", 0))
        server.listen(1)
        port = server.getsockname()[1]
        child = subprocess.Popen([sys.executable, "-c", CHILD, str(port)], stdout=subprocess.PIPE, text=True)
        try:
            accepted, _addr = server.accept()
            with accepted:
                client_port = int(child.stdout.readline().strip())
                started = time.perf_counter()
                found = runfence.peer_pid("127.0.0.1", client_port)
                first = time.perf_counter() - started
                started = time.perf_counter()
                again = runfence.peer_pid("127.0.0.1", client_port)
                cached = time.perf_counter() - started
            if found is None:
                pytest.skip("psutil lists connections here but not their owning process")
            assert found == child.pid and again == child.pid
            assert runfence.is_run_process(child.pid, {child.pid})
            # the test process is this child's parent, so the child is "one of the run's processes"
            assert runfence.is_run_process(child.pid, {psutil.Process().pid})
            assert not runfence.is_run_process(child.pid, {psutil.Process().pid + 100000})
            print(f"\nruns fence lookup: scan {first * 1000:.2f} ms, cached {cached * 1000:.3f} ms")
        finally:
            child.kill()
            child.wait(10)


# -- the middleware ------------------------------------------------------------------------------

RUN_PID = 4242


@pytest.fixture
def run_registered():
    agentrun.register_run_pid(RUN_PID)
    try:
        yield RUN_PID
    finally:
        agentrun.unregister_run_pid(RUN_PID)


def test_run_pid_registry() -> None:
    assert RUN_PID not in agentrun.running_run_pids()
    agentrun.register_run_pid(RUN_PID)
    try:
        assert RUN_PID in agentrun.running_run_pids()
    finally:
        agentrun.unregister_run_pid(RUN_PID)
        agentrun.unregister_run_pid(RUN_PID)  # twice is fine
    assert RUN_PID not in agentrun.running_run_pids()


def test_middleware_refuses_a_run_process_on_the_apps_routes(space_dir: Path, monkeypatch, run_registered) -> None:
    peers = {"pid": RUN_PID, "asked": 0}

    def fake_peer(host: str, port: int) -> int | None:
        peers["asked"] += 1
        return peers["pid"]

    monkeypatch.setattr(runfence, "peer_pid", fake_peer)
    monkeypatch.setattr(runfence, "is_run_process", lambda pid, pids: pid in pids)
    app = create_app(Space(space_dir), None, watch=False)
    _rec, secret = TokenStore(space_dir).ephemeral("Assistant", "read", agent=DEFAULT_AGENT_ID)
    try:
        with TestClient(app) as http:
            res = http.get("/api/space")
            assert res.status_code == 403 and res.json() == {"detail": runfence.REFUSED_MESSAGE}
            res = http.post("/api/import/preview", json={})
            assert res.status_code == 403 and res.json()["detail"] == runfence.REFUSED_MESSAGE
            # the MCP servers' path: /api/v1 with a bearer token is not the fence's business
            res = http.get("/api/v1/whoami", headers={"Authorization": f"Bearer {secret}"})
            assert res.status_code == 200, res.text
            # /api/v1 without a token is still fenced (it would be 401 anyway)
            res = http.get("/api/v1/whoami")
            assert res.status_code == 403 and res.json()["detail"] == runfence.REFUSED_MESSAGE
            # another process is untouched
            peers["pid"] = RUN_PID + 1
            assert http.get("/api/space").status_code == 200
            peers["pid"] = None  # psutil couldn't tell: let through
            assert http.get("/api/space").status_code == 200
            # with no run running nothing is looked up
            agentrun.unregister_run_pid(RUN_PID)
            peers["pid"] = RUN_PID
            asked = peers["asked"]
            assert http.get("/api/space").status_code == 200
            assert peers["asked"] == asked
    finally:
        TokenStore.drop_ephemeral(secret)


class Live:
    """The app on a free loopback port, with the fake claude as its CLI (as the M18 tests do)."""

    def __init__(self, space_dir: Path, tmp_path: Path, monkeypatch) -> None:
        self.claude = install(tmp_path / "bin")
        self.log = tmp_path / "claude-log.jsonl"
        monkeypatch.setenv("FAKE_CLAUDE_LOG", str(self.log))
        _data, revision = device_settings.read()
        device_settings.patch({"claudePath": str(self.claude)}, revision)
        self.app = create_app(Space(space_dir), None, watch=False)
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            self.port = s.getsockname()[1]
        self.server = uvicorn.Server(uvicorn.Config(self.app, host="127.0.0.1", port=self.port, log_level="warning"))
        self.thread = threading.Thread(target=self.server.run, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.port}"
        self.http = httpx.Client(base_url=self.base, timeout=120)
        for _ in range(400):
            try:
                if self.http.get("/api/space").status_code == 200:
                    return
            except httpx.HTTPError:
                pass
            time.sleep(0.05)
        raise AssertionError("the app didn't start")

    def chat(self, prompt: str) -> list[dict]:
        body = {"mode": "chat", "prompt": prompt, "contextPaths": [], "history": []}
        res = self.http.post("/api/ai/chat", json=body)
        assert res.status_code == 200, res.text
        frames = _frames(res.text)
        assert frames[-1]["type"] == "done", frames[-1]
        return frames

    def runs(self) -> list[dict]:
        if not self.log.exists():
            return []
        return [json.loads(line) for line in self.log.read_text(encoding="utf-8").splitlines() if line]

    def stop(self) -> None:
        self.http.close()
        self.server.should_exit = True
        self.thread.join(30)


def _frames(raw: str) -> list[dict]:
    out = []
    for frame in raw.replace("\r\n", "\n").split("\n\n"):
        data = [line[5:].lstrip(" ") for line in frame.split("\n") if line.startswith("data:")]
        if data:
            out.append(json.loads("\n".join(data)))
    return out


@pytest.fixture
def live(space_dir: Path, tmp_path: Path, monkeypatch):
    if not _psutil_can_list_connections():
        pytest.skip("psutil cannot list connections on this machine")
    runfence.reset_cache()
    env = Live(space_dir, tmp_path, monkeypatch)
    try:
        yield env
    finally:
        env.stop()


def test_a_run_cannot_reach_the_apps_routes_but_its_mcp_server_can(live: Live) -> None:
    """The fake CLI (the run's root process) GETs the app's routes itself and starts Object's own
    MCP server, which talks to /api/v1 with the run's token."""
    own = f"{live.base}/api/objects"
    v1 = f"{live.base}/api/v1/whoami"
    frames = live.chat(f"Please check.\nFAKE:curl {own}\nFAKE:curl {v1}\nFAKE:mcp:object:schema:{{}}")
    text = frames[-1]["text"]
    assert f"curl {own} -> 403" in text, text
    assert runfence.REFUSED_MESSAGE in text
    assert f"curl {v1} -> 200" in text, text
    [schema] = [f for f in frames if f.get("type") == "tool" and f.get("name") == "schema"
                and f.get("result") is not None]
    assert schema["isError"] is False, schema
    assert "types" in schema["result"]
    # the test process (not a run) was never fenced
    assert live.http.get("/api/objects").status_code == 200


def test_other_clients_are_untouched_while_a_run_is_running(live: Live) -> None:
    out: list[list[dict]] = []
    thread = threading.Thread(target=lambda: out.append(live.chat("FAKE:wait")), daemon=True)
    thread.start()
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline and not live.runs():
        time.sleep(0.05)
    [run] = live.runs()
    try:
        assert run["pid"] in agentrun.running_run_pids()
        res = live.http.get("/api/objects")
        assert res.status_code == 200
        with httpx.Client(base_url=live.base, timeout=30) as fresh:  # a brand-new connection
            assert fresh.get("/api/space").status_code == 200
    finally:
        Path(str(live.log) + ".go").touch()
        thread.join(60)
    assert out and out[0][-1]["type"] == "done"
    assert run["pid"] not in agentrun.running_run_pids()
