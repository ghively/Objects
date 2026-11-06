# M20 CLI spike: the MCP tool-call timeout

Run on 2026-11-06 by M20 Task 1 (`backend/tests/test_m20_live_cli.py`, `OBJECT_LIVE_CLAUDE=1`), on Gene's Windows 11 PC, with M17's `CLI_FLAGS` (`--permission-mode dontAsk`, `--strict-mcp-config`, `--setting-sources project,local`, ...), `--model haiku` and `--no-session-persistence`. The run used a temp agent folder under a temp `OBJECT_STATE_DIR` (M17's `make_agent`, with the `claudeMdExcludes` skip list) and a hand-built `--mcp-config` naming one stdio test server, written into the test's temp folder. Its one tool, `slow`, sleeps 45 seconds and answers "slow done". Nothing read `~/.claude` or any token.

## CLI version

`claude --version`: **2.1.317 (Claude Code)**.

## Result

No stop-and-ask. The CLI honours `MCP_TOOL_TIMEOUT` (milliseconds) from its environment, so M20's "delegation" contributor sets `MCP_TOOL_TIMEOUT = (DELEGATE_TIMEOUT + 60) * 1000` (300000) on every agent run as planned, and `DELEGATE_TIMEOUT` stays 240 s.

| Check (`test_mcp_tool_timeout_is_honoured`) | Result |
|---|---|
| `MCP_TOOL_TIMEOUT=20000` | Pass. The `slow` call's `tool_result` has `is_error: true` and the text `MCP server "spike" tool "slow" timed out after 20s`. The whole run took 28.8 s, so the CLI cut the call at 20 s instead of waiting the tool's 45 s. |
| `MCP_TOOL_TIMEOUT=120000` | Pass. The call answers "slow done" without an error, after the tool's full 45 s (the run took 53.4 s). |

## MCP_TOOL_TIMEOUT

- It isn't listed in `claude --help` of 2.1.317, but it is read from the CLI's environment and applies per tool call.
- A timed-out call doesn't end the run: the model gets the error as the tool's result and goes on.
- The timeout error text names the server, the tool and the seconds: `MCP server "<server>" tool "<tool>" timed out after <n>s`.
- A 45 s call worked with 120 s set, so the CLI's own default is not what limits a `delegate` call once the variable is set. A contributor's `env` goes into the run's environment (`agentrun.build_run` through `_run_env`), so the value the "delegation" contributor sets reaches the CLI.
