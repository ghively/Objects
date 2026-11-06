"""A fake outside MCP server for the M19 tests (synthetic only; no real service behind it).

Built on the ``mcp`` server library's ``MCPServer``, as ``objectapp/mcp_server.py`` is. Run it as
``python fake_mcp_server.py [options]`` (stdio by default), or start its HTTP / SSE modes inside a
test with `serve_in_thread`.

Tools:

- ``echo(text)`` answers ``text`` (annotated ``readOnlyHint: true``);
- ``add(a, b)`` answers the sum;
- ``whoami()`` answers the value of the environment variable named by ``--require-env`` (empty
  without it), so a test can prove a secret arrived (tests compare it and never print it);
- ``--many N``: the tools ``t0`` ... ``t<N-1>`` instead of the three above (no annotations;
  ``--many 0`` lists no tools);
- ``--odd-name``: also a tool named ``get-item.v2``;
- ``--long-description``: ``echo``'s description is 1,000 characters long.

Modes:

- stdio (the default);
- ``--http PORT`` (streamable HTTP at ``/mcp``) and ``--sse PORT`` (``/sse``), on ``127.0.0.1``
  only;
- ``--require-bearer TOKEN``: HTTP / SSE requests without ``Authorization: Bearer TOKEN`` get a
  401 whose body echoes the ``Authorization`` header it got (a redaction test);
- ``--require-env NAME``: exits 3 at start with ``missing NAME`` on stderr when the variable is
  unset or empty;
- ``--print-env-and-exit``: prints every environment variable to stderr and exits 1 (a
  redaction test);
- ``--hang``: never answers ``initialize`` (it reads nothing and sleeps until killed);
- ``--junk``: writes non-JSON lines on stdout first, then serves stdio.
"""

from __future__ import annotations

import argparse
import os
import socket
import sys
import threading
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve()

LONG_DESCRIPTION = ("Echo the text back. " * 60)[:1000]


def build_server(*, require_env: str | None = None, many: int | None = None, odd_name: bool = False,
                 long_description: bool = False) -> Any:
    """The fake's ``MCPServer`` with its tools."""
    from mcp.server.mcpserver import MCPServer
    from mcp.types import ToolAnnotations

    server = MCPServer(name="fake")
    if many is not None:
        def numbered(i: int) -> Callable[[], str]:
            def tool() -> str:
                return f"t{i}"

            return tool

        for i in range(many):
            server.add_tool(numbered(i), name=f"t{i}", description=f"Fake tool number {i}.")
    else:
        def echo(text: str) -> str:
            """Echo the text back."""
            return text

        server.add_tool(echo, name="echo", description=LONG_DESCRIPTION if long_description else None,
                        annotations=ToolAnnotations(readOnlyHint=True))

        def add(a: float, b: float) -> str:
            """Add two numbers."""
            total = a + b
            return str(int(total)) if float(total).is_integer() else str(total)

        server.add_tool(add, name="add")

        def whoami() -> str:
            """The value of the variable named by --require-env."""
            return os.environ.get(require_env, "") if require_env else ""

        server.add_tool(whoami, name="whoami")
    if odd_name:
        def odd() -> str:
            """A tool whose name has a dash and a dot."""
            return "odd"

        server.add_tool(odd, name="get-item.v2")
    return server


def _bearer_gate(app: Any, token: str | None) -> Any:
    """An ASGI wrapper answering 401 (echoing the ``Authorization`` header) without the bearer."""
    if not token:
        return app
    want = f"Bearer {token}".encode()

    async def gated(scope: dict, receive: Callable, send: Callable) -> None:
        if scope.get("type") != "http":
            await app(scope, receive, send)
            return
        got = dict(scope.get("headers") or []).get(b"authorization", b"")
        if got == want:
            await app(scope, receive, send)
            return
        body = b"Unauthorized. Got Authorization: " + got
        await send({"type": "http.response.start", "status": 401,
                    "headers": [(b"content-type", b"text/plain"), (b"content-length", str(len(body)).encode())]})
        await send({"type": "http.response.body", "body": body})

    return gated


def _app(mode: str, server: Any, require_bearer: str | None) -> Any:
    if mode == "http":
        inner = server.streamable_http_app(host="127.0.0.1")
    elif mode == "sse":
        inner = server.sse_app(host="127.0.0.1")
    else:
        raise ValueError(f"unknown mode {mode!r}")
    return _bearer_gate(inner, require_bearer)


def _path(mode: str) -> str:
    return "/mcp" if mode == "http" else "/sse"


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def serve_in_thread(mode: str, *, require_bearer: str | None = None, require_env: str | None = None,
                    many: int | None = None, odd_name: bool = False, long_description: bool = False,
                    port: int | None = None) -> tuple[str, Callable[[], None]]:
    """Start the ``http`` or ``sse`` mode on a free ``127.0.0.1`` port in a thread.

    Returns ``(url, stop)``: the endpoint (``http://127.0.0.1:<port>/mcp`` or ``.../sse``) and a
    function that stops the server and waits for its thread.
    """
    import uvicorn

    server = build_server(require_env=require_env, many=many, odd_name=odd_name,
                          long_description=long_description)
    port = port or free_port()
    config = uvicorn.Config(_app(mode, server, require_bearer), host="127.0.0.1", port=port,
                            log_level="warning", lifespan="on")
    web = uvicorn.Server(config)
    thread = threading.Thread(target=web.run, name=f"fake-mcp-{mode}", daemon=True)
    thread.start()
    deadline = time.monotonic() + 20
    while not web.started:
        if not thread.is_alive() or time.monotonic() > deadline:
            raise RuntimeError("the fake MCP server didn't start")
        time.sleep(0.02)

    def stop() -> None:
        web.should_exit = True
        thread.join(timeout=10)

    return f"http://127.0.0.1:{port}{_path(mode)}", stop


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description="A fake MCP server for Object's tests.")
    mode = p.add_mutually_exclusive_group()
    mode.add_argument("--http", type=int, metavar="PORT")
    mode.add_argument("--sse", type=int, metavar="PORT")
    p.add_argument("--require-bearer", metavar="TOKEN")
    p.add_argument("--require-env", metavar="NAME")
    p.add_argument("--print-env-and-exit", action="store_true")
    p.add_argument("--hang", action="store_true")
    p.add_argument("--junk", action="store_true")
    p.add_argument("--many", type=int, metavar="N")
    p.add_argument("--odd-name", action="store_true")
    p.add_argument("--long-description", action="store_true")
    a = p.parse_args(argv)

    if a.print_env_and_exit:
        for key, value in sorted(os.environ.items()):
            sys.stderr.write(f"{key}={value}\n")
        sys.stderr.flush()
        return 1
    if a.require_env and not os.environ.get(a.require_env):
        sys.stderr.write(f"missing {a.require_env}\n")
        sys.stderr.flush()
        return 3
    if a.hang:
        while True:
            time.sleep(1)
    server = build_server(require_env=a.require_env, many=a.many, odd_name=a.odd_name,
                          long_description=a.long_description)
    if a.http is not None or a.sse is not None:
        import uvicorn

        which = "http" if a.http is not None else "sse"
        port = a.http if a.http is not None else a.sse
        uvicorn.run(_app(which, server, a.require_bearer), host="127.0.0.1", port=port, log_level="warning")
        return 0
    if a.junk:
        sys.stdout.write("this is not json\n{nope\n")
        sys.stdout.flush()
    server.run("stdio")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
