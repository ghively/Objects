# How Object milestones are built

Lessons from M1–M8. Read this before planning or running the next build.

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

## Cost levers

- **Applied from M5 on:** each task runs only its own tests and those of modules it touched; the full suites run at integration and at the gate.
- Mechanical tasks (fixtures, strings) can use a cheaper model.
- Keep the PC awake for the whole run (`request_keep_awake`); a sleeping machine paused M2 for a weekend.

## Pausing and resuming

A running workflow can't be edited. Stop it with `TaskStop` and relaunch with the same `scriptPath` and `resumeFromRunId`: unchanged agents replay from cache, edited or new ones run live. Anything in flight when it is stopped is redone, and its half-written files are still in the tree for the rerun to pick up.

- To change a script mid-run, keep every already-run `agent()` prompt byte-identical. Add new functions for the later stages instead of editing shared ones, or the cached prefix misses and finished work reruns.
- Swap at a cheap moment: just after a single-agent step starts, such as an integrate step.
- A session usage limit fails every in-flight agent with "session limit". Resume after the reset; nothing finished is lost.
- A container restart also stops the run, and resuming in the same session works. Resume cannot move to another session or machine, so move only at a milestone boundary, after a push.

## Lessons from M4–M8 (cloud runs, 2026-10-26 to 28)

- **The real speed limit is CPUs.** A workflow runs at most CPUs−2 agents at once, which is 2 on the 4-CPU cloud container. Lanes beyond that just queue. A 16-core machine would have cut the M4–M7 run by about 30%, not more: the single-agent steps (reconcile, integrate, fix, gate) don't parallelise.
- **Plan ahead, in parallel.** Plans only write docs, so the M5, M6 and M7 plans were written by background agents during the M4 build. They are outside the workflow's agent cap. Each plan then got a reconcile pass against the code actually built before its build.
- **Two milestones at once.** M5 and M6 were built together in one tree: M6's tasks only created new files, and all of its edits to shared files waited for its integrate task, after M5's. This worked with no file clashes.
- **Dependencies up front.** All new npm packages for M5–M7 were installed in two commits before the builds, so no parallel task ever edited `package.json`. M8 did the same in its first step. Use `npm ci` everywhere else: a newer npm rewrites the lockfile (it drops the `libc` fields).
- **Less ceremony** (Gene, 2026-10-26):
  - Plan critics were dropped.
  - One combined review per milestone replaced three lenses.
  - The gate became suites + type check + build + acceptance scripts, without screenshots.
  - Quality held, and the single review still found real bugs each time (blocking findings: M4 1, M5 1, M6 4, M7 4, M8 2; M3's full three-lens review found 11).
- **Verify the gate yourself.** M8's gate reported one known timing flake. A fresh run on a quiet machine showed a deterministic failure as well: a palette test that expected 11 actions when there were 12. Rerun the full suites and every acceptance script after each workflow, on a quiet machine, before calling it done.
- **Timing tests need a quiet box.** The 1MB split test is now best-of-5 after a warm-up, with the same 300 ms bar, because single runs failed 1 in 3 even on old code. Rerun any timing failure alone before calling it real.
- **Never `pkill -f` a pattern that also matches your own shell's command line.** It kills the shell running the command.

## Ground rules

Fidelity to Capacities is the bar; don't over-engineer. Never touch `C:\Git\wiki`. No real CPI data in the repo; fixtures are synthetic. `.reference/` is Capacities' unpacked app and recovered source: read it for behaviour, labels and CSS values, never copy its code. Only a trimmed `reference/` subset (models, English strings, CSS) is committed so a cloud session can continue.
