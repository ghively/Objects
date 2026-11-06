# M19 CLI spike: outside MCP servers in `--mcp-config`

Run on 2026-11-06 by M19 Task 1 (`backend/tests/test_m19_live_cli.py`, `OBJECT_LIVE_CLAUDE=1`), on Gene's Windows 11 PC, with M17's `CLI_FLAGS` (`--permission-mode dontAsk`, `--strict-mcp-config`, `--setting-sources project,local`, ...), `--model haiku` and `--no-session-persistence`. Each run used a temp agent folder under a temp `OBJECT_STATE_DIR` (M17's `make_agent`) and a hand-built `--mcp-config` file naming the fake MCP server (`backend/tests/fake_mcp_server.py`). Secret values were synthetic `s3cret-…` strings, in the CLI's environment only.

## CLI version

`claude --version`: **2.1.317 (Claude Code)**.

## Result

No stop-and-ask. `--strict-mcp-config` let no other server in, and `${VAR}` was expanded in `env`, `args` and `headers`. Later tasks build on the findings below.

| Check (test) | Result |
|---|---|
| `test_mcp_config_shapes_and_expansion` | Pass. The stdio, HTTP and SSE entries all show `"status": "connected"` in the `init` event. Its `tools` list `mcp__<name>__echo`/`add`/`whoami` for each. `whoami` on the stdio server answers the secret given as `env: {"FAKE_KEY": "${OBJECT_MCP_T1}"}`. A second stdio server whose **args** hold `${OBJECT_MCP_T4}` (the name of the variable it requires) also starts and answers, so args are expanded. The HTTP and SSE servers need `Authorization: Bearer <token>` and answer 401 without it. They connect with `headers: {"Authorization": "Bearer ${OBJECT_MCP_T2}"}`, so headers are expanded. `mcp.json` holds only the references. |
| `test_unset_and_default_vars` | Pass. `${VAR:-default}` gives the default when VAR is unset. An **unset `${VAR}` is left as written**: the server starts and sees the literal text `${OBJECT_MCP_UNSET_Q9}`. The CLI neither empties it nor refuses the config. `mcpprobe.expand_refs` follows this. |
| `test_only_listed_servers_reach_a_run` | Pass. With `--strict-mcp-config`, the `init` event's `mcp_servers` names are exactly the config's names (`only-one`, `only_two`). None of Gene's own servers appear. |
| `test_server_allow_and_tool_deny` | Pass. Under `dontAsk`, `--allowedTools mcp__fake` with `--disallowedTools mcp__fake__add` leaves `echo` working. `mcp__fake__add` is **removed from the run's tool list**: the `init` `tools` holds only `mcp__fake__echo` and `mcp__fake__whoami`, and a call of it answers `is_error` with "No such tool available: mcp__fake__add". A whole-server allow plus a per-tool deny therefore behaves as M19 needs. |
| `test_windows_cmd_shim` | Pass. A stdio `command` that is a `.cmd` file (`fake-mcp.cmd`) **starts as given**, as does `cmd /c fake-mcp.cmd`. |
| `test_tool_name_normalisation` | Pass. See "Tool names". |

## Entry shapes (as accepted)

- `{"type": "stdio", "command": "<exe>", "args": ["..."], "env": {"KEY": "${OBJECT_MCP_…}"}}`
- `{"type": "http", "url": "http://127.0.0.1:<port>/mcp", "headers": {"Authorization": "Bearer ${OBJECT_MCP_…}"}}`
- `{"type": "sse", "url": "http://127.0.0.1:<port>/sse", "headers": {"Authorization": "Bearer ${OBJECT_MCP_…}"}}`

`${VAR}` and `${VAR:-default}` are expanded from the CLI's own environment in `env` values, `args` and `headers` values. An unset `${VAR}` without a default stays literal.

## Tool names

The CLI names a tool `mcp__<server>__<tool>`. In both the server name and the tool name, it replaces **every character outside `[A-Za-z0-9_-]` with `_`**:

- the fake's `get-item.v2` on server `odd-srv` is `mcp__odd-srv__get-item_v2`;
- a server named `odd.dot` becomes `mcp__odd_dot__…`.

Dashes and underscores are kept as they are. Object's server names already fullmatch `[A-Za-z0-9_-]{1,64}`, so they are unchanged. `mcpgateway.tool_id(server, tool)` is therefore `"mcp__" + server + "__" + re.sub(r"[^A-Za-z0-9_-]", "_", tool)`.

## .cmd

A `.cmd` (or `.bat`) stdio command starts without help on native Windows with 2.1.317, so `mcpstore.cli_entry` passes `command` as given and **doesn't wrap it in `cmd /c`**. T3's optional `.cmd` wrap test doesn't apply.

## OAuth

No OAuth for `--mcp-config` servers. The installed CLI signs in to an MCP server only through `claude mcp login <name>`, for a server configured in Gene's own Claude Code user or local config (`claude mcp login --help`, `claude mcp add --help`: `--client-id`/`--callback-port`). Those commands write Gene's Claude Code config, and their tokens go into Claude Code's credential store. Object must never write or read either. So M19 offers headers and a bearer token, and no OAuth. A URL server that answers 401 fails "Test" with the message that it refused the credentials and that Object can't do an OAuth sign-in yet.

## Also seen

- CLI 2.1.317 defers MCP tools behind its own `ToolSearch` tool: the model often calls `ToolSearch` before an `mcp__…` tool. `ToolSearch` isn't in `--allowedTools`, but it ran under `dontAsk`. It changes nothing for M19.
- The CLI shows a tool's structured answer in the `tool_result` (`{"result": "<text>"}` for the fake's string tools). The fake `claude` passes the plain text content instead. Tests that compare a live answer unwrap it.
