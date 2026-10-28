# Audit repro scripts (2026-10-28)

These are the scratch scripts and tests that reproduced the findings in `docs/superpowers/plans/audit-2026-10-28.md`. Keep them as evidence and as a starting point for each fix's regression test. They are not part of the gate:
- `pytest` only collects `backend/tests`.
- `vitest` and `tsc` only look at `frontend/src`.

They were written in a Linux cloud container, so paths are hard-coded:
- **Repo root:** `/home/user/Objects`. On Windows, change it to your clone (e.g. `C:\Git\Objects`).
- **Scratch folder:** `/tmp/claude-0/.../scratchpad/audit-*`. Change it to any temp folder; `tempfile.mkdtemp()` with no `dir` works.

The scripts copy a fixture space from `backend/tests/fixtures/` to a temp folder before touching it. Never point them at the fixtures themselves or at a real space.

## How to run

- **Back end:** from the repo root, run `uv run python scripts/audit-2026-10-28/backend-core/r16.py` (after fixing the paths). `h.py` in each folder is the shared helper that copies a fixture.
- **Front end:** copy a `*.test.ts(x)` file into the matching `frontend/src/<area>/` folder, run `npx vitest run src/<area>/<file>`, then delete the copy.
  - **Shell repros:** set the device time zone, e.g. `TZ=America/New_York`. Each test sets the Time zone setting to `Pacific/Auckland` itself.
  - **Editor repros (`editor/*.audit.ts`):** use `run.sh` with `vitest.audit.config.mjs`.

## Map of finding to script

| Area | Finding (audit doc) | Script |
|---|---|---|
| backend-core | rename aborts halfway | `r16.py` |
| backend-core | U+2028 / NEL deletes keys | `r3.py`, `r4.py` |
| backend-core | case-only change_type overwrite | `r12.py` |
| backend-core | leading-dot title vanishes; dot attachments | `r1.py`, `r8.py` |
| backend-core | trash_type stranded | `r19.py` |
| backend-core | rename retargets other links | `r9.py` |
| backend-core | frontmatter link forms | `r7.py`, `r13.py`, `r14.py` |
| backend-core | long non-ASCII names; mixed EOL | `r17.py`, `r18.py` |
| backend-core | BOM/CRLF kept (passes) | `r11.py` |
| backend-features | Origin/Host not checked | `csrf.py`, `csrf2.py` |
| backend-features | reminder overflow stops all | `remind2.py`, `remind4.py` |
| backend-features | edit after trigger cancels reminder | `remind1.py`, `remind1b.py`, `remind3.py` |
| backend-features | calendar 500 on extreme dates | `weird.py`, `weird2.py` |
| backend-features | `.md` upload becomes an object | `mdatt.py` |
| backend-features | `/api/tasks/*` 500s; malformed-input 500s | `fuzz1.py`, `fuzz2.py`, `fuzz3.py` |
| backend-features | long CJK title 503 | `coll2.py` |
| editor | drag merge, code fence, escaping, lists, headings, raw blocks, refs | `ops*.audit.ts`, `rt.audit.ts`, `typed.audit.ts` |
| editor | autosave lost on switch or unmount | `as.audit.ts` |
| shell | time zone, link index, palette key, AZERTY | `zz_audit_shell*.test.ts` |
| whiteboard | save loop, frames, undo, ink, duplicate, nodeBox | `zzaudit*.test.ts(x)` |

The views-and-properties repros were temporary tests that were deleted after running. Each finding in the audit doc gives its exact input, so rebuild the test from that.
