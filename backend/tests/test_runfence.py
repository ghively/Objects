"""The run fence (sweep 2026-11-08): an agent run can't use the app's own ``/api`` routes.

`runfence.peer_pid` finds the process behind a loopback connection with psutil (cached about
two seconds); `runfence.is_run_process` tells whether that process is a running agent run or
one of its descendants; `RunFenceMiddleware` refuses such requests with 403 unless they are
``/api/v1`` calls carrying a bearer token (the MCP servers' path) or static files.
"""

from __future__ import annotations

import socket
import subprocess
import sys
import textwrap
import time
import types
from collections import namedtuple

import psutil
import pytest

from objectapp import runfence

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

    def Process(self, pid: int):  # noqa: N802 - psutil's name
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
