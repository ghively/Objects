# Milestone 19 acceptance: MCP gateway (in)

Plan: `2026-11-05-m19-mcp-gateway.md`. Design: `specs/2026-11-05-agents-design.md`, section 6 (MCP gateway (in)), with "Moving between machines" and the `.mcp.json` row (section 1), the Tools bullet (section 3), the Switches paragraph (section 4) and the Constraints line on secrets. Date: 2026-11-06. Built on Gene's Windows 11 PC on branch `feat/m16-m24` (shared with M16-M24), commits `0ced74b..bf6efce` plus this integration commit. Gene asked for M16-M24 to be built straight through, and on 2026-11-06 for two parallel tracks with one full gate per track; his hand checks below come later.

## What was built

- **Model and state files** (`mcpmodel.py`, `secretstore.py`, `mcpstore.py`): `<state>/mcp-servers.json` (servers by command or by URL, unknown keys kept, a newer schema read-only, an unreadable file copied aside before the next write) and `<state>/secrets.json` (secret env and header values, bearer tokens and `var:<NAME>` secret variables; atomic writes, `0600` on POSIX). Validation follows the Contract's table, and no message repeats a submitted value. A server's secrets and its entry change together or not at all.
- **Probe** (`mcpprobe.py`, the one network module): lists a server's tools over stdio, streamable HTTP and SSE with the `mcp` 2.3 client, with a 20 s timeout, the stdio process tree killed on failure, stderr capped at 2,000 characters, descriptions at 300, pagination followed, and errors redacted.
- **Gateway** (`mcpgateway.py`): the `gateway` (35) and `gateway-tools` (62) run contributors, the Tools tab group provider, `agentrun.SECRET_LOOKUP = secretstore.lookup_var`, and the in-memory tool cache. Enabled servers join chat, delegate and schedule runs with `${OBJECT_MCP_…}` references in `mcp.json` and the values only in the CLI's environment. Off tools go into `--disallowedTools` for gateway and folder servers alike. A server whose known tools are all off is left out.
- **Routes** (`api_mcp.py`): `/api/mcp-servers` (list, create, save, delete, Test), `/api/mcp-secrets` (list, set, delete), `POST /api/agents/{id}/tools/refresh`, and the `mcpServers` change event. `api_agents.agent_tool_groups` puts provider groups in place of catalogue groups.
- **Front end**: Settings > Integrations > "MCP servers" (list, switch, Test, Edit, Delete with "Confirm delete", the add/edit dialog) and "Secret variables"; the agent page's "Set…" per missing variable (`SetSecretDialog`); the Tools tab's server groups with their status lines ("Listing tools…", "Couldn't list tools: …", "Turned off in Settings > Integrations", "Needs secrets: …", "No tools").

## Integration (Task 9)

- The lanes' back end was connected end to end already. `scripts/m19_acceptance.py` serves a fixture copy headless and drives every new route. It also runs real chat turns through the fake `claude`, whose `FAKE:mcp` markers call the outside servers for real.
- `frontend/src/mcp/SecretVariables.tsx`: T7 shipped a local `LocalSetSecretDialog`. It now uses T8's `SetSecretDialog`, so Settings and the agent page share one dialog. Its tests (`SecretVariables.test.tsx`) pass unchanged.
- `backend/tests/test_m10_ai.py`: `test_ai_modules_use_no_network_client` now covers `mcpmodel.py`, `secretstore.py`, `mcpstore.py`, `mcpgateway.py` and `api_mcp.py`, and its banned set gains `httpx2`. `mcpprobe.py` is left out because it is the network module.
- `fake_claude.py` needed no new marker.

## Deviations from the plan

From the build lanes' reports, plus T9's own:

- **T1:** `fake_mcp_server.py` also has `--long-description` (`echo`'s description is 1,000 characters long) for T4's `test_descriptions_capped`. The live spike adds `test_unset_and_default_vars`. It found that an unset `${VAR}` stays literal, and `expand_refs` follows that. The spike found that a `.cmd` command starts as given, so `cli_entry` doesn't wrap it in `cmd /c`, and T3's optional wrap test doesn't apply (`m19-cli-spike.md`).
- **T5:** `mcpgateway` also has the helpers `gateway_key(rec)` and `folder_key(agent_id, name, server)` for the Contract's cache keys. The `GET /agents/{id}/tools` merge is in `api_agents.agent_tool_groups(rec)`, where a provider group replaces a catalogue group with the same id instead of being appended. `test_m19_gateway_run.py` has three extra tests: `tool_id`, the cache, and a folder-name clash in the groups.
- **T6:** a name-clash 409 is `{detail}` only, and a stale-revision 409 is `{detail, currentRevision}`. A 423 also carries `reason`. Our strings: "Enter a value." (an empty secret variable), "That value can't be used." (a value the store refuses), "That secret variable isn't set." (a 404 on delete). `GET /mcp-secrets` marks a name Object can't set as `set` when it resolves from Object's environment.
- **T6, review fix (Contract addition for Gene to approve):** `McpServersAnswer` gains `unreadable: boolean`. An unreadable `mcp-servers.json` lists no servers with `readOnlyReason: null` and `unreadable: true`, and the section shows "The MCP servers file can't be read." in place of "No MCP servers yet." Writes stay allowed, so the next one copies the bad file aside (it isn't in `readOnlyReason` for that reason).
- **Review fixes (2026-11-06):** the bodies of `POST`/`PUT /mcp-servers` and `PUT /mcp-secrets/{name}` are validated in the routes, so a malformed body gets our own 422, "That server can't be saved." or "That value can't be used." (our strings), never FastAPI's default answer, which echoes each submitted `input`. A run and the Tools tab refresh leave out a stored server that doesn't fit `McpServerFile`, a command server with no command and a URL server without an http(s) address; a run notes "Skipped the MCP server '<name>': it can't be read." (our string). The Test route still probes such an entry and answers its own error ("This server has no command or URL."). The write paths of `secrets.json` and `mcp-servers.json` treat a read error other than a missing file as fatal (the route gives the app's existing OSError answer and nothing changes), so a passing sharing violation can't drop the other secrets or servers; reads still take it as empty.
- **T7:** shipped the local Set dialog (swapped by T9 as above).
- **T9:**
  - `test_m10_ai.py`'s no-network test skips `from urllib.parse import …`, because `mcpstore` parses a server's URL with `urlsplit`. That is string parsing, not a client. Any other `urllib` import is still banned.
  - In `m19_acceptance.py`, the two `whoami` turns (checks 4 and 8) answer a secret on purpose: the fake server's tool returns it so the script can prove it arrived. Their chat frames, their agent transcripts and a library's DEBUG log copies of those frames (`chunk: b'data: …'`) are left out of check 10. Every other file, log line, answer and frame is searched.
  - Check 9 runs the `tagObject` turn as Researcher (`agentId`), so that `folder-fake` (M17's folder rule) is in its config as the plan expects.
  - Check 12 hashes the state dir and the space (agent folders included) around check 1's reads, check 3's Tests and checks 6 and 8's refreshes and Tools GET.
  - The milestone's own tests, `tsc` and the acceptance script were run here. The full gate (every suite, every `mN_acceptance.py`, the live spike again) is left to this track's gate, as the build workflow says.

No lane reported a task partial or blocked.

## Review

The one milestone review comes after integration. Where each Review Focus item is covered:

1. **A secret value leaking:** `test_m19_gateway_run.py::test_secret_values_never_in_files_args_or_logs`, `test_m19_probe.py::test_errors_are_redacted`, `test_m19_routes.py::test_no_answer_holds_a_secret`; acceptance check 10.
2. **Untrusted names and values:** `test_m19_store.py::test_validation_table`, `test_m19_secrets.py::test_var_names`.
3. **Switches not reaching the run:** `test_m19_gateway_run.py::test_switches_filter_the_run`, `::test_folder_server_off_tools_are_denied`, `::test_disabled_and_clashing_servers_left_out`, `::test_purposes_without_gateway`; the live spike's `test_server_allow_and_tool_deny`; acceptance checks 6, 7 and 9.
4. **Only the listed servers reach a run:** the live spike (`m19-cli-spike.md`); acceptance check 4.
5. **Probes that misbehave, and reads that write:** `test_m19_probe.py::test_failure_modes`, `test_m19_routes.py::test_reads_and_probes_write_nothing`; acceptance check 12.

## Automated results (Task 9, 2026-11-06)

| Suite | Command | Result |
|---|---|---|
| M19 back end | `uv run pytest backend/tests/test_m19_contract.py test_m19_secrets.py test_m19_store.py test_m19_probe.py test_m19_gateway_run.py test_m19_routes.py test_m19_live_cli.py test_m10_ai.py -q` | 183 passed, 7 skipped (the live spike tests skip without `OBJECT_LIVE_CLAUDE=1`) |
| M19 front end | `npx vitest run src/mcp src/settings/sections/Integrations src/agents src/api` | 38 files, 192 tests passed |
| Types | `npx tsc -b --noEmit` | clean |
| Lint (`src/mcp`) | `npm run lint -- src/mcp` | 0 errors; 4 warnings of kinds the code base already has |
| M19 acceptance | `uv run python scripts/m19_acceptance.py backend/tests/fixtures/<space>` | PASS on `space-sample` and `space-v1` (all 12 checks, 38 `[ok]` lines each) |
| Full gate | every suite, every `mN_acceptance.py`, the live spike | left to this track's gate |

Not verified here: the app's own window (pywebview), the new Settings group and Tools tab in a real browser (jsdom only), and a real outside MCP server with the real CLI (the T1 live spike used the fake server).

## Hand checks for Gene

On a copy of his export:

- [ ] Settings > Integrations shows "MCP servers" after API tokens. "Add MCP server" by Command adds a real stdio server you use (for example one started with `npx`). "Test" lists its tools.
- [ ] Add a URL server with a bearer token or an API-key header. "Test" lists its tools. Editing it shows "•••••• saved", never the value. A wrong token makes "Test" say the credentials were refused.
- [ ] `%LOCALAPPDATA%\object\secrets.json` holds the values and `mcp-servers.json` doesn't. Neither file is in any space folder or agent folder.
- [ ] In a chat, Assistant uses one of the server's tools without an Accept step, and the step shows in the chat.
- [ ] Researcher's Tools tab lists the server as its own group with its tools ("Listing tools…" first). Switching one tool off stops Researcher from using it. Switching the whole group off leaves the server out. Assistant still has it.
- [ ] Turning the server off in Settings removes it from every agent's chats. The Tools tab says "Turned off in Settings > Integrations".
- [ ] Your own Claude Code MCP servers (from your `~/.claude.json` or project files) don't appear in an agent chat. Ask the agent to list its tools.
- [ ] Put a `.mcp.json` with a `${VAR}` reference into an agent folder (or "Add agent folder…" for a copy from elsewhere). The Profile tab shows "Needs secrets: VAR". "Set…" fixes it, and the Tools tab then lists that server's tools.
- [ ] Delete a server: "Confirm delete" first. Its secrets are gone from `secrets.json`.
- [ ] "Hide AI features" hides the MCP servers group.
- [ ] Unlinked mentions still show on the object page.
