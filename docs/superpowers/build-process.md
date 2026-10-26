# How Object milestones are built

Lessons from M1–M3. Read this before planning or running the next milestone's build.

## Pipeline

1. **Plan**: one plan per milestone in `docs/superpowers/plans/`, written by a writer agent, then reviewed by three critics (completeness and fidelity, buildability, file safety), then one resolve pass. Planning can overlap the previous milestone's build, because it only writes docs.
2. **Build**: a workflow script runs the tasks in tracks. Saved copy: `scripts/workflows/object-milestone-build.js`. Args: `plan`, `base`, `backend`, `frontend`, `integrate`, `milestone`, `perTaskReview`.
3. **Integrate**: the last plan task, acceptance (`scripts/mN_acceptance.py` and a hand-check checklist for Gene).
4. **Review once**: one whole-milestone review (correctness, file safety, fidelity to Capacities), then one fix pass, then the final gate. No per-task reviews (Gene, 2026-10-26).
5. **Verify** by hand, then Gene's hands-on check on a copy of the CPI export kept outside the repo.

## Parallelism: what limits it

The agents of one workflow share a single working tree. Two agents editing the same file at the same time can overwrite each other, and concurrent commits can hit `index.lock`. So the limit is file ownership, not the workflow engine.

- **M2 and M3 ran two tracks** (backend, frontend), each sequential inside. That was too cautious for the frontend: engines and pure modules (API client, filter/sort, group/calc), and independent feature areas (table, cards, collections, queries), touch separate files.
- **Rule for the next plan:** every plan has a "Shared files and ordering" table that gives each shared file (`App.tsx`, `Sidebar.tsx`, `TypePage.tsx`, `CustomizeMenu.tsx`, `server.py`, `space.py`, ...) to exactly one task. Tasks with disjoint file sets go in separate tracks; tasks that must edit a shared file run in order, or the shared edit is moved into the owner task. The M4 plan already does this.
- **Backend** tasks usually share `space.py` and `server.py`: keep them sequential in one track unless the plan splits those files first.
- **Worktree isolation** (`isolation: 'worktree'` on the agent) lets parallel writers overlap files safely, at the price of a merge step and ~0.5 s setup per agent. Use it when two tracks must touch the same file.
- Before launching, count tracks from the plan's Files lists, not by guess. Aim for three or four tracks when the lists allow it.

## Cost levers (not yet applied)

- Per-task runs currently execute the full backend and frontend suites. Running only the task's own tests, and the full suites once at the gate, would save a large share of build time at the cost of catching regressions later.
- Mechanical tasks (fixtures, strings) can use a cheaper model.
- Keep the PC awake for the whole run (`request_keep_awake`); a sleeping machine paused M2 for a weekend.

## Pausing and resuming

A running workflow can't be edited. Stop it with `TaskStop` and relaunch with the same `scriptPath` and `resumeFromRunId`: unchanged agents replay from cache, edited or new ones run live. Anything in flight when it is stopped is redone.

## Ground rules

Fidelity to Capacities is the bar; don't over-engineer. Never touch `C:\Git\wiki`. No real CPI data in the repo; fixtures are synthetic. `.reference/` is Capacities' unpacked app and recovered source: read it for behaviour, labels and CSS values, never copy its code. Only a trimmed `reference/` subset (models, English strings, CSS) is committed so a cloud session can continue.
