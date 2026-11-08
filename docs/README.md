# Object documentation

A map of everything in `docs/` and the guides at the repo root. Start with the [README](../README.md) for what
Object is and how to run it.

## Using Object

| Document | What it covers |
|---|---|
| [README](../README.md) | Features, screenshots, quick start, connecting an AI assistant over MCP |
| [Behaviour catalog](behavior-catalog.md) | How Object behaves: every label, menu, option, shortcut and their order. The reference when a detail is in question |
| In the app: **Help & Resources** | Keyboard shortcuts, Getting started, Markdown reference |

## How it is designed

| Spec | Scope |
|---|---|
| [Object design](superpowers/specs/2026-10-23-object-design.md) | The object model: spaces, types, properties, views, collections, queries, daily notes, tasks, whiteboards, the on-disk format |
| [Agents](superpowers/specs/2026-11-05-agents-design.md) | Agents as Claude Code project folders, tools, learning, the MCP gateway, A2A and delegation, schedules (M16-M21) |
| [Work dashboard](superpowers/specs/2026-11-05-work-dashboard-design.md) | The Work section, its data model, the brain dump and the agent loop (M22-M24) |
| [Import and migration](superpowers/specs/2026-11-06-import-migration-design.md) | Provenance and re-runs, readers and the sensitive-content scan, the agent workflow (M25-M27) |
| [Object Team](superpowers/specs/2026-10-28-object-team-design.md) | Parked; not built |

## Status and history

| Document | What it is |
|---|---|
| [Remaining work](superpowers/plans/remaining-work.md) | The status page: what is built, the last gate, what is open, decisions waiting on the owner |
| [Handoff](../HANDOFF.md) | Where things stand and what to do first |
| [Continue](../CONTINUE.md) | How to resume work and run a build |
| [Bug audit, 2026-11-07](superpowers/plans/bug-audit-2026-11-07.md) | 46 findings, their fixes, the gate after, and the owner's decisions |
| [Audits](superpowers/plans/) | `audit-2026-10-28.md`, `audit-2026-11-01.md`, `polish-audit-2026-11-02.md` |
| [Hands-on checklist](superpowers/plans/hands-on-checklist.md) | The M1-M9 checks merged into one list |

## Milestones

Each milestone has a plan (`superpowers/plans/2026-…-mN-….md`) and an acceptance file (`mN-acceptance.md`) with
the owner's hands-on checks, the deviations from the plan, and the command for its acceptance script
(`scripts/mN_acceptance.py`).

| | Milestones |
|---|---|
| **Base app** | M1 shell, objects, editor · M2 types and properties · M3 views, collections, queries · M4 calendar, daily notes, tasks · M5 search, palette, backlinks, graph · M6 whiteboards and pen · M7 blocks, light mode, polish · M8 deferred features · M9 completeness gaps |
| **Extensions** | M10 AI assistant · M11 local API and MCP server · M12 property kinds · M13 view layouts · M14 automations · M15 importers |
| **Agents** | M16 chat polish and model picker · M17 agents and tools · M18 learning · M19 MCP gateway · M20 A2A and delegation · M21 schedules |
| **Work** | M22 work model · M23 Work section · M24 brain dump and agent loop |
| **Import** | M25 provenance and re-runs · M26 readers and scan · M27 agent workflow |

CLI spikes and notes from building them: `m17-cli-spike.md`, `m18-cli-notes.md`, `m19-cli-spike.md`, `m20-spike.md`.

## Building Object

| Document | What it is |
|---|---|
| [CLAUDE.md](../CLAUDE.md) | The ground rules for anyone, human or agent, working on the code |
| [Build process](superpowers/build-process.md) | How milestones are built: parallel lanes by file ownership, one review, one fix pass, the gate |
| [`scripts/workflows/`](../scripts/workflows/) | The saved build workflow scripts |
| [`scripts/screenshots/`](../scripts/screenshots/README.md) | How the README screenshots are made from a synthetic demo space |
| [Front end](../frontend/README.md) | The React app: structure and commands |
| [KiwiFS evaluation](kiwifs-evaluation.md) | A 2026-10-28 evaluation of KiwiFS as a storage back end |
