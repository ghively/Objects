# M18 CLI notes

Written 2026-11-06 by M18 Task 1 (`docs/superpowers/plans/2026-11-05-m18-learning.md`, Step 4).

## What was checked

- CLI version: `claude --version` answers `2.1.317 (Claude Code)`, the version the plan was written against.
- Test: `backend/tests/test_m18_live_cli.py::test_fork_flags_parse`, run once with `OBJECT_LIVE_CLAUDE=1`. It passed.
- Setup: M17's live setup (`test_m17_live_cli.make_agent`: a temp agent folder under a temp state dir, its long path, the parent-session variables removed), M17's `CLI_FLAGS`, `--model haiku`, an empty MCP config, the run settings with `claudeMdExcludes`.
- The run: `--resume <random UUID> --fork-session --no-session-persistence`, with the first line of the review prompts on stdin.

## Result

- Exit code 1, with no model call: `num_turns` 0 and cost 0.
- The CLI gave its unknown-session answer in two places:
  - stderr: `No conversation found with session ID: <the UUID>`;
  - the `result` event: `is_error: true`, `subtype: "error_during_execution"`, and `errors: ["No conversation found with session ID: <the UUID>"]`.
- None of the three flags drew "unknown option", and the CLI didn't refuse them together. `--fork-session` and `--no-session-persistence` parse with `--resume` and M17's flags (`-p`, `--output-format stream-json`, `--permission-mode dontAsk`, ...).
- One thing we saw: the `result` event's `session_id` was a new UUID, not the one passed to `--resume`. This fits `--fork-session` ("create a new session ID instead of reusing the original"). The fake does the same for `--resume <id> --fork-session`.

## Decision

Nothing differs from the plan. Reviews keep `--resume <session> --fork-session --no-session-persistence`.

When a resume fails (for example the session is gone), M10's resume-then-fresh retry (`ai.run_turn`) replays the transcript in a fresh run. That retry covers any `--resume` run that fails before it answers, the exit-1 unknown-session answer above included.

## Still to check by hand (Gene, `m18-acceptance.md`)

Tests never write a session to `~/.claude`, so they can't check how the fork really behaves. In real use:

- after a review, the chat's own session id is unchanged;
- the chat's next turn doesn't see the review's messages.
