"""M33: the desktop window. ``objectapp`` picks the frameless Electron shell (``desktop/``) or the
pywebview window, starts the shell as a child with its launch JSON in the child's environment
(``OBJECT_DESKTOP_LAUNCH``, never on its command line), writes the
keep-on-top line to its stdin, and stops the server when it exits. No Electron is needed here: the
child is a fake."""

from __future__ import annotations

import json
import os
import signal
import socket
import subprocess
import sys
import threading
import time
import types
import urllib.error
import urllib.request
from pathlib import Path
from typing import ClassVar

import pytest
from objectapp import __main__ as launcher
from objectapp import windowhost
from objectapp.uikey import HEADER
from objectapp.workseams import SeamUnavailable

READY = "object-desktop: ready\n"
LAUNCH_ENV = "OBJECT_DESKTOP_LAUNCH"


def _launch_of(child) -> dict:
    """What the shell was started with: the JSON in its environment."""
    return json.loads(child.kwargs["env"][LAUNCH_ENV])


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _port_is_free(port: int) -> bool:
    """Nothing listens on `port` any more (the server is stopped)."""
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=1):
            return False
    except OSError:
        return True


class _Stdin:
    def __init__(self, on_line=None) -> None:
        self.text = ""
        self.flushed = 0
        self.broken = False
        self.closed = False
        self._on_line = on_line

    def write(self, text: str) -> int:
        if self.broken or self.closed:
            raise BrokenPipeError
        self.text += text
        if self._on_line is not None:
            for line in text.splitlines():
                self._on_line(line)
        return len(text)

    def close(self) -> None:
        self.closed = True

    def flush(self) -> None:
        if self.broken:
            raise BrokenPipeError
        self.flushed += 1


class FakeChild:
    """A stand-in for the shell: prints `output`, then runs `script(child)` (the test's part,
    while the launcher waits) and exits with what `finish` was given. Like the shell, it closes
    when the quit line reaches its stdin (`quits=False`: it never does)."""

    created: ClassVar[list[FakeChild]] = []

    def __init__(self, argv, *, script=None, output=(READY,), exits=None, quits=True, **kwargs) -> None:
        self.argv = list(argv)
        self.kwargs = kwargs
        self.events: list[str] = []
        self.stdin = _Stdin(on_line=self._line)
        self._quits = quits
        self.returncode: int | None = exits
        self._done = threading.Event()
        if exits is not None:
            self._done.set()
        self._output = list(output)
        self.stdout = self._lines()
        self.terminated = False
        self.error: BaseException | None = None
        FakeChild.created.append(self)
        if script is not None:
            threading.Thread(target=self._run, args=(script,), daemon=True).start()

    def _lines(self):
        yield from self._output
        self._done.wait()

    def _run(self, script) -> None:
        try:
            script(self)
        except BaseException as exc:  # noqa: BLE001 - reported by the test
            self.error = exc
        finally:
            self.finish(0)

    def _line(self, line: str) -> None:
        self.events.append(f"stdin {line}")
        if self._quits and json.loads(line) == {"kind": "quit"}:
            self.finish(0)

    def finish(self, code: int) -> None:
        if self.returncode is None:
            self.returncode = code
            self.events.append(f"exit {code}")
        self._done.set()

    def poll(self) -> int | None:
        return self.returncode

    def wait(self, timeout: float | None = None) -> int:
        if not self._done.wait(timeout):
            raise subprocess.TimeoutExpired(self.argv, timeout)
        return self.returncode

    def terminate(self) -> None:
        self.terminated = True
        self.events.append("terminate")
        self.finish(-15)

    def kill(self) -> None:
        self.events.append("kill")
        self.finish(-9)


@pytest.fixture
def env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """A space, a state folder, an installed (fake) shell, and no window choice in the environment."""
    monkeypatch.setenv("OBJECT_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.delenv("OBJECT_WINDOW", raising=False)
    monkeypatch.delenv("OBJECT_WINDOW_FRAME", raising=False)
    monkeypatch.delenv("ELECTRON_OVERRIDE_DIST_PATH", raising=False)
    root = tmp_path / "space"
    root.mkdir()
    (root / "Note.md").write_text("Body\n", encoding="utf-8")
    desktop = tmp_path / "desktop"
    monkeypatch.setattr(launcher, "DESKTOP_DIR", desktop)
    FakeChild.created = []
    windowhost.set_opener(None)
    yield types.SimpleNamespace(root=root, desktop=desktop, port=_free_port(), tmp=tmp_path)
    windowhost.set_opener(None)


def _install_shell(desktop: Path, name: str = "electron") -> Path:
    package = desktop / "node_modules" / "electron"
    binary = package / "dist" / name
    binary.parent.mkdir(parents=True)
    binary.write_text("", encoding="utf-8")
    (package / "path.txt").write_text(name, encoding="utf-8")
    return binary


def _fake_webview(monkeypatch: pytest.MonkeyPatch) -> list[tuple]:
    calls: list[tuple] = []
    module = types.SimpleNamespace(
        create_window=lambda title, url, **kw: calls.append((title, url, kw)),
        start=lambda **kw: calls.append(("start", kw)),
    )
    monkeypatch.setitem(sys.modules, "webview", module)
    return calls


def _popen(monkeypatch: pytest.MonkeyPatch, **child_kwargs) -> None:
    monkeypatch.setattr(
        launcher.subprocess, "Popen", lambda argv, **kw: FakeChild(argv, **child_kwargs, **kw)
    )


# -- which window ------------------------------------------------------------------------------


def test_the_option_wins_over_the_environment_and_auto_is_the_default() -> None:
    assert launcher.window_choice(None, {}) == "auto"
    assert launcher.window_choice(None, {"OBJECT_WINDOW": "pywebview"}) == "pywebview"
    assert launcher.window_choice(None, {"OBJECT_WINDOW": " Electron "}) == "electron"
    assert launcher.window_choice("pywebview", {"OBJECT_WINDOW": "electron"}) == "pywebview"
    assert launcher.window_choice("auto", {"OBJECT_WINDOW": "nonsense"}) == "auto"
    assert launcher.window_choice(None, {"OBJECT_WINDOW": ""}) == "auto"
    with pytest.raises(ValueError, match="OBJECT_WINDOW must be auto, electron or pywebview"):
        launcher.window_choice(None, {"OBJECT_WINDOW": "tauri"})


def test_the_frame_choice_reads_the_same_way() -> None:
    assert launcher.frame_choice(None, {}) == "hidden"
    assert launcher.frame_choice(None, {"OBJECT_WINDOW_FRAME": "system"}) == "system"
    assert launcher.frame_choice("hidden", {"OBJECT_WINDOW_FRAME": "system"}) == "hidden"
    with pytest.raises(ValueError, match="OBJECT_WINDOW_FRAME must be hidden or system"):
        launcher.frame_choice(None, {"OBJECT_WINDOW_FRAME": "none"})


def test_the_shell_is_found_the_way_the_electron_package_finds_it(tmp_path: Path) -> None:
    desktop = tmp_path / "desktop"
    assert launcher.electron_binary(desktop, "linux", {}) is None
    package = desktop / "node_modules" / "electron"
    package.mkdir(parents=True)
    # The package without its binary (installed with scripts off) is not a shell.
    assert launcher.electron_binary(desktop, "linux", {}) is None
    (package / "path.txt").write_text("electron", encoding="utf-8")
    assert launcher.electron_binary(desktop, "linux", {}) is None
    binary = package / "dist" / "electron"
    binary.parent.mkdir()
    binary.write_text("", encoding="utf-8")
    assert launcher.electron_binary(desktop, "linux", {}) == binary

    # path.txt names the executable; without it the platform's usual name is tried.
    (package / "path.txt").unlink()
    assert launcher.electron_binary(desktop, "linux", {}) == binary
    assert launcher.electron_binary(desktop, "win32", {}) is None
    exe = package / "dist" / "electron.exe"
    exe.write_text("", encoding="utf-8")
    assert launcher.electron_binary(desktop, "win32", {}) == exe
    mac = package / "dist" / "Electron.app" / "Contents" / "MacOS" / "Electron"
    mac.parent.mkdir(parents=True)
    mac.write_text("", encoding="utf-8")
    assert launcher.electron_binary(desktop, "darwin", {}) == mac

    # ELECTRON_OVERRIDE_DIST_PATH, as in the package's index.js.
    other = tmp_path / "other"
    other.mkdir()
    (other / "electron").write_text("", encoding="utf-8")
    assert launcher.electron_binary(desktop, "linux", {"ELECTRON_OVERRIDE_DIST_PATH": str(other)}) == other / "electron"
    assert launcher.electron_binary(desktop, "win32", {"ELECTRON_OVERRIDE_DIST_PATH": str(other)}) is None


# -- the shell as a child ----------------------------------------------------------------------


def test_auto_starts_the_shell_and_stops_the_server_when_it_exits(env, monkeypatch, capsys) -> None:
    binary = _install_shell(env.desktop)
    webview = _fake_webview(monkeypatch)
    seen: dict = {}

    def script(child: FakeChild) -> None:
        launch = _launch_of(child)
        seen["launch"] = launch
        # The server is up while the window is open, and the link gives the cookie once.
        opener = urllib.request.build_opener(_NoRedirect)
        try:
            opener.open(launch["url"], timeout=5)
        except urllib.error.HTTPError as res:
            seen["open"] = (res.code, res.headers.get("set-cookie") or "")
        try:
            opener.open(launch["url"], timeout=5)
        except urllib.error.HTTPError as res:
            seen["again"] = res.headers.get("set-cookie")
        # Keep on top: one JSON line on the shell's stdin, with its own one-time link. (The
        # launcher offers it a moment after the shell said it was ready.)
        deadline = time.monotonic() + 5
        while not windowhost.can_open() and time.monotonic() < deadline:
            time.sleep(0.01)
        windowhost.open_window(f"http://127.0.0.1:{env.port}/?mini=work")
        seen["stdin"] = child.stdin.text
        seen["flushed"] = child.stdin.flushed

    _popen(monkeypatch, script=script)
    launcher.main(["--space", str(env.root), "--port", str(env.port)])

    (child,) = FakeChild.created
    assert child.error is None
    # Nothing of the launch (the one-time link) is on the command line, where other local users
    # can read it in the process list: it is in the child's environment only.
    assert child.argv == [str(binary), str(env.desktop)]
    assert not any("_open" in a or "code=" in a or "object-launch" in a for a in child.argv)
    assert LAUNCH_ENV in child.kwargs["env"]
    assert child.kwargs["stdin"] == subprocess.PIPE and child.kwargs["stdout"] == subprocess.PIPE
    launch = seen["launch"]
    assert set(launch) == {"url", "origin", "stateDir", "icon", "title", "frame"}
    assert launch["origin"] == f"http://127.0.0.1:{env.port}"
    assert launch["url"].startswith(f"http://127.0.0.1:{env.port}/_open?code=") and launch["url"].endswith("&next=/")
    assert launch["stateDir"] == str(env.tmp / "state")
    assert launch["title"] == "Object" and launch["frame"] == "hidden"
    assert launch["icon"] == str(env.tmp / "state" / "app-icon" / "app-icon-default.png")
    assert Path(launch["icon"]).is_file()
    assert seen["open"][0] == 303 and seen["open"][1].startswith(f"object-ui-{env.port}=")
    assert seen["again"] is None  # the link gives the key once

    line = json.loads(seen["stdin"])
    assert seen["stdin"].endswith("\n") and seen["stdin"].count("\n") == 1 and seen["flushed"] == 1
    assert set(line) == {"open", "kind"} and line["kind"] == "focus"
    assert line["open"].startswith(f"http://127.0.0.1:{env.port}/_open?code=")
    assert line["open"].endswith("&next=/%3Fmini%3Dwork")
    assert line["open"] != launch["url"]

    # The shell exited: the server is stopped, keep on top is gone, pywebview was never used.
    assert _port_is_free(env.port)
    assert windowhost.can_open() is False
    assert webview == []
    # Neither one-time link nor the key is printed.
    out = capsys.readouterr()
    assert "_open" not in out.out + out.err and "code=" not in out.out + out.err


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def test_the_server_answers_the_launch_key_while_the_shell_runs(env, monkeypatch) -> None:
    """The start-up probe (the key as a header) is the launcher's own; the window gets the cookie."""
    _install_shell(env.desktop)
    seen: dict = {}

    def script(child: FakeChild) -> None:
        with urllib.request.urlopen(f"http://127.0.0.1:{env.port}/api/space", timeout=5) as res:  # no key
            seen["bare"] = res.status

    def guarded(child: FakeChild) -> None:
        try:
            script(child)
        except urllib.error.HTTPError as res:
            seen["bare"] = res.code

    _popen(monkeypatch, script=guarded)
    launcher.main(["--space", str(env.root), "--port", str(env.port), "--window", "electron"])
    assert seen["bare"] == 401
    assert HEADER == "x-object-key"


def test_frame_system_reaches_the_shell(env, monkeypatch) -> None:
    _install_shell(env.desktop)
    _popen(monkeypatch, script=lambda child: None)
    launcher.main(["--space", str(env.root), "--port", str(env.port), "--frame", "system"])
    monkeypatch.setenv("OBJECT_WINDOW_FRAME", "system")
    launcher.main(["--space", str(env.root), "--port", str(env.port)])
    launcher.main(["--space", str(env.root), "--port", str(env.port), "--frame", "hidden"])
    frames = [_launch_of(c)["frame"] for c in FakeChild.created]
    assert frames == ["system", "system", "hidden"]


def test_the_app_icon_setting_reaches_the_shell(env, monkeypatch) -> None:
    _install_shell(env.desktop)
    state = env.tmp / "state"
    state.mkdir()
    (state / "settings.json").write_text(json.dumps({"appIcon": "purple"}), encoding="utf-8")
    _popen(monkeypatch, script=lambda child: None)
    launcher.main(["--space", str(env.root), "--port", str(env.port)])
    launch = _launch_of(FakeChild.created[0])
    assert launch["icon"] == str(state / "app-icon" / "app-icon-purple.png")


def test_the_shell_never_runs_as_plain_node(env, monkeypatch) -> None:
    """ELECTRON_RUN_AS_NODE in the person's environment would start Node, not the window."""
    _install_shell(env.desktop)
    monkeypatch.setenv("ELECTRON_RUN_AS_NODE", "1")
    _popen(monkeypatch, script=lambda child: None)
    launcher.main(["--space", str(env.root), "--port", str(env.port)])
    assert "ELECTRON_RUN_AS_NODE" not in FakeChild.created[0].kwargs["env"]
    assert FakeChild.created[0].kwargs["env"]["OBJECT_STATE_DIR"] == str(env.tmp / "state")


def test_the_launch_is_not_left_in_the_launchers_own_environment(env, monkeypatch) -> None:
    """Only the shell gets it: the launcher's environment (and anything else it starts) does not."""
    import os

    _install_shell(env.desktop)
    monkeypatch.delenv(LAUNCH_ENV, raising=False)
    _popen(monkeypatch, script=lambda child: None)
    launcher.main(["--space", str(env.root), "--port", str(env.port)])
    assert LAUNCH_ENV not in os.environ
    assert _launch_of(FakeChild.created[0])["url"].startswith(f"http://127.0.0.1:{env.port}/_open?code=")


# -- no shell, or a shell that does not start ---------------------------------------------------


def test_auto_without_a_shell_is_the_pywebview_window_as_before(env, monkeypatch, capsys) -> None:
    webview = _fake_webview(monkeypatch)
    monkeypatch.setattr(launcher.subprocess, "Popen", _must_not_start)
    launcher.main(["--space", str(env.root), "--port", str(env.port)])
    assert [c[0] for c in webview] == ["Object", "start"]
    assert webview[0][2] == {"width": 1440, "height": 900}
    assert capsys.readouterr().out == ""


def _must_not_start(*_args, **_kwargs):
    raise AssertionError("the shell must not be started")


def test_window_pywebview_forces_the_old_window(env, monkeypatch) -> None:
    _install_shell(env.desktop)
    webview = _fake_webview(monkeypatch)
    monkeypatch.setattr(launcher.subprocess, "Popen", _must_not_start)
    launcher.main(["--space", str(env.root), "--port", str(env.port), "--window", "pywebview"])
    monkeypatch.setenv("OBJECT_WINDOW", "pywebview")
    launcher.main(["--space", str(env.root), "--port", str(env.port)])
    assert [c[0] for c in webview] == ["Object", "start", "Object", "start"]


def test_window_electron_without_a_shell_says_how_to_install_it(env, monkeypatch, capsys) -> None:
    webview = _fake_webview(monkeypatch)
    with pytest.raises(SystemExit) as exit_:
        launcher.main(["--space", str(env.root), "--port", str(env.port), "--window", "electron"])
    assert exit_.value.code == 1
    err = capsys.readouterr().err
    assert "cd desktop && npm ci" in err
    assert err == launcher.SHELL_MISSING_MESSAGE + "\n"
    assert webview == [] and _port_is_free(env.port)


def test_a_bad_environment_choice_is_refused_plainly(env, monkeypatch, capsys) -> None:
    monkeypatch.setenv("OBJECT_WINDOW", "tauri")
    with pytest.raises(SystemExit) as exit_:
        launcher.main(["--space", str(env.root), "--port", str(env.port)])
    assert exit_.value.code == 2
    assert "OBJECT_WINDOW must be auto, electron or pywebview" in capsys.readouterr().err


@pytest.mark.parametrize("failure", ["cannot run", "exits before it is ready"])
def test_auto_falls_back_to_pywebview_and_says_so_in_one_line(env, monkeypatch, capsys, failure) -> None:
    _install_shell(env.desktop)
    webview = _fake_webview(monkeypatch)
    if failure == "cannot run":
        def popen(argv, **kw):
            raise OSError("exec format error")
        monkeypatch.setattr(launcher.subprocess, "Popen", popen)
    else:
        _popen(monkeypatch, output=(), exits=1)
    launcher.main(["--space", str(env.root), "--port", str(env.port)])
    assert [c[0] for c in webview] == ["Object", "start"]
    assert webview[0][1].startswith(f"http://127.0.0.1:{env.port}/_open?code=")
    out = capsys.readouterr().out
    assert out == launcher.SHELL_FALLBACK_MESSAGE + "\n"
    assert out.count("\n") == 1 and "pywebview" in out
    assert _port_is_free(env.port)


def test_window_electron_that_cannot_start_stops_with_a_plain_message(env, monkeypatch, capsys) -> None:
    _install_shell(env.desktop)
    webview = _fake_webview(monkeypatch)
    _popen(monkeypatch, output=(), exits=1)
    with pytest.raises(SystemExit) as exit_:
        launcher.main(["--space", str(env.root), "--port", str(env.port), "--window", "electron"])
    assert exit_.value.code == 1
    assert capsys.readouterr().err == launcher.SHELL_FAILED_MESSAGE + "\n"
    assert webview == [] and _port_is_free(env.port)


def test_a_shell_that_never_says_ready_is_stopped(env, monkeypatch) -> None:
    binary = _install_shell(env.desktop)
    made: list[FakeChild] = []

    def popen(argv, **kw):
        made.append(FakeChild(argv, output=(), **kw))
        return made[-1]

    assert launcher.start_shell(binary, {"url": "x"}, popen=popen, ready_timeout=0.2) is None
    assert made[0].terminated is True


def test_output_of_the_shell_is_not_repeated(env, monkeypatch, capsys) -> None:
    """Whatever the shell writes on its stdout is read for the ready line only, never printed."""
    _install_shell(env.desktop)
    _popen(monkeypatch, script=lambda child: None,
           output=("http://127.0.0.1:1/_open?code=leak\n", READY, "more _open?code=leak\n"))
    launcher.main(["--space", str(env.root), "--port", str(env.port)])
    out = capsys.readouterr()
    assert out.out == "" and out.err == ""


def test_browser_mode_never_starts_the_shell(env, monkeypatch) -> None:
    _install_shell(env.desktop)
    monkeypatch.setattr(launcher.subprocess, "Popen", _must_not_start)
    calls: list = []

    def open_in_browser(key, url, print_link=False):
        calls.append(url)
        raise KeyboardInterrupt

    monkeypatch.setattr(launcher, "_open_in_browser", open_in_browser)
    launcher.main(["--space", str(env.root), "--port", str(env.port), "--browser", "--window", "electron"])
    assert calls == [f"http://127.0.0.1:{env.port}/"]


def _record_server_stop(monkeypatch: pytest.MonkeyPatch, events: list[str]) -> None:
    """`SpaceHost.stop` adds "server stop" to `events`."""
    real_stop = launcher.SpaceHost.stop

    def stop(self) -> None:
        events.append("server stop")
        real_stop(self)

    monkeypatch.setattr(launcher.SpaceHost, "stop", stop)


def test_ctrl_c_stops_the_shell_before_the_server(env, monkeypatch) -> None:
    """Ctrl-C: the shell is asked to quit (it lets the page save), and only once it has exited
    is the server stopped. (Changed in the M33 fix pass: it was terminated at once.)"""
    _install_shell(env.desktop)

    class Interrupted(FakeChild):
        interrupted = False

        def wait(self, timeout=None):
            if not self.interrupted:
                self.interrupted = True
                raise KeyboardInterrupt
            return super().wait(timeout)

    events: list[str] = []
    _record_server_stop(monkeypatch, events)
    monkeypatch.setattr(launcher.subprocess, "Popen", lambda argv, **kw: Interrupted(argv, **kw))
    launcher.main(["--space", str(env.root), "--port", str(env.port)])
    (child,) = FakeChild.created
    assert child.terminated is False
    assert child.events == ['stdin {"kind": "quit"}', "exit 0"]
    assert child.stdin.closed is True
    assert events == ["server stop"]
    assert _port_is_free(env.port)


# -- stopping the shell ------------------------------------------------------------------------


def test_the_stop_wait_fits_the_pages_save_and_the_shells_drain() -> None:
    """The page gets 3 seconds to save, then the shell waits up to 2 for the last requests."""
    assert launcher.SHELL_STOP_SECONDS >= 3 + 2 + 0.5


def test_stopping_the_shell_asks_it_to_quit_first() -> None:
    child = FakeChild(["electron"])
    launcher._stop_shell(child)
    assert child.events == ['stdin {"kind": "quit"}', "exit 0"]
    assert child.stdin.text == '{"kind": "quit"}\n' and child.stdin.flushed >= 1
    assert child.stdin.closed is True  # and then its stdin ends: the parent is done with it
    assert child.terminated is False


def test_a_shell_that_does_not_quit_is_terminated_only_after_the_wait(monkeypatch) -> None:
    monkeypatch.setattr(launcher, "SHELL_STOP_SECONDS", 0.3)
    child = FakeChild(["electron"], quits=False)
    started = time.monotonic()
    launcher._stop_shell(child)
    assert child.events == ['stdin {"kind": "quit"}', "terminate", "exit -15"]
    assert time.monotonic() - started >= 0.3


def test_a_shell_that_ignores_terminate_is_killed(monkeypatch) -> None:
    monkeypatch.setattr(launcher, "SHELL_STOP_SECONDS", 0.1)
    monkeypatch.setattr(launcher, "SHELL_KILL_SECONDS", 0.1)

    class Stubborn(FakeChild):
        def terminate(self) -> None:
            self.terminated = True
            self.events.append("terminate")

    child = Stubborn(["electron"], quits=False)
    launcher._stop_shell(child)
    assert child.events == ['stdin {"kind": "quit"}', "terminate", "kill", "exit -9"]


def test_a_shell_whose_stdin_is_gone_is_still_stopped(monkeypatch) -> None:
    monkeypatch.setattr(launcher, "SHELL_STOP_SECONDS", 0.1)
    child = FakeChild(["electron"], quits=False)
    child.stdin.broken = True
    launcher._stop_shell(child)
    assert child.events == ["terminate", "exit -15"]


def test_a_shell_that_already_exited_is_left_alone() -> None:
    child = FakeChild(["electron"], exits=0)
    launcher._stop_shell(child)
    assert child.stdin.text == "" and child.terminated is False


def _until_the_launcher_waits(number: int, before) -> None:
    """Until the launcher has put its own handler on `number` (it does once the shell is ready)."""
    deadline = time.monotonic() + 5
    while signal.getsignal(number) is before and time.monotonic() < deadline:
        time.sleep(0.01)
    time.sleep(0.05)


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX signals")
@pytest.mark.parametrize("name", ["SIGTERM", "SIGHUP"])
def test_a_stop_signal_stops_the_shell_before_the_server(env, monkeypatch, name) -> None:
    """`kill <objectapp>` (or its terminal going away) takes Ctrl-C's path: the shell is asked to
    quit and has exited before the server stops; the signal's own handler is put back after."""
    _install_shell(env.desktop)
    number = getattr(signal, name)
    before = signal.getsignal(number)
    events: list[str] = []
    _record_server_stop(monkeypatch, events)

    def script(child: FakeChild) -> None:
        _until_the_launcher_waits(number, before)
        os.kill(os.getpid(), number)
        child._done.wait(5)  # the launcher asks it to quit; nothing else ends it

    _popen(monkeypatch, script=script)
    launcher.main(["--space", str(env.root), "--port", str(env.port)])
    (child,) = FakeChild.created
    assert child.events == ['stdin {"kind": "quit"}', "exit 0"]
    assert child.terminated is False
    assert events == ["server stop"]
    assert _port_is_free(env.port)
    assert signal.getsignal(number) is before


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX signals")
def test_a_second_stop_signal_does_not_cut_the_save_short(env, monkeypatch) -> None:
    _install_shell(env.desktop)
    before = signal.getsignal(signal.SIGTERM)
    events: list[str] = []
    _record_server_stop(monkeypatch, events)

    class Slow(FakeChild):
        def _line(self, line: str) -> None:
            self.events.append(f"stdin {line}")
            os.kill(os.getpid(), signal.SIGTERM)  # again, while it closes
            threading.Timer(0.3, self.finish, args=(0,)).start()

    def script(child: FakeChild) -> None:
        _until_the_launcher_waits(signal.SIGTERM, before)
        os.kill(os.getpid(), signal.SIGTERM)
        child._done.wait(5)

    monkeypatch.setattr(launcher.subprocess, "Popen", lambda argv, **kw: Slow(argv, script=script, **kw))
    launcher.main(["--space", str(env.root), "--port", str(env.port)])
    (child,) = FakeChild.created
    assert child.events == ['stdin {"kind": "quit"}', "exit 0"]
    assert events == ["server stop"]


@pytest.mark.skipif(sys.platform == "win32", reason="a POSIX script stands in for the shell")
def test_the_shell_sees_its_stdin_open_until_it_is_asked_to_quit(env, tmp_path) -> None:
    """The real pipe: a started shell does not see its stdin end at launch; it gets the quit
    line, then the end."""
    record = tmp_path / "stdin.txt"
    shell = tmp_path / "shell.py"
    shell.write_text(
        f"#!{sys.executable}\n"
        "import sys\n"
        f"out = open({str(record)!r}, 'a', buffering=1)\n"
        "print('object-desktop: ready', flush=True)\n"
        "for line in sys.stdin:\n"
        "    out.write('line ' + line)\n"
        "out.write('end\\n')\n",
        encoding="utf-8",
    )
    shell.chmod(0o755)
    child = launcher.start_shell(shell, {"url": "x"}, ready_timeout=10)
    assert child is not None
    time.sleep(1.0)
    assert child.poll() is None
    assert not record.exists() or record.read_text(encoding="utf-8") == ""
    launcher._stop_shell(child)
    assert child.poll() == 0
    assert record.read_text(encoding="utf-8") == 'line {"kind": "quit"}\nend\n'


# -- the keep-on-top line ----------------------------------------------------------------------


def test_line_opener_writes_one_json_line_per_window() -> None:
    stream = _Stdin()
    opener = windowhost.line_opener(stream, lambda url: f"one-time:{url}")
    opener("http://127.0.0.1:8812/?mini=work")
    opener("http://127.0.0.1:8812/?mini=work")
    lines = stream.text.splitlines()
    assert [json.loads(line) for line in lines] == [
        {"open": "one-time:http://127.0.0.1:8812/?mini=work", "kind": "focus"}
    ] * 2
    assert stream.text.endswith("\n") and stream.flushed == 2


def test_line_opener_says_keep_on_top_needs_the_window_when_the_shell_is_gone() -> None:
    stream = _Stdin()
    stream.broken = True
    opener = windowhost.line_opener(stream, lambda url: url)
    with pytest.raises(SeamUnavailable) as refused:
        opener("http://127.0.0.1:8812/?mini=work")
    assert refused.value.detail == windowhost.KEEP_ON_TOP_LATER
