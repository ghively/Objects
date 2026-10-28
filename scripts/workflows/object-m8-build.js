export const meta = {
  name: 'object-m8-deferred-features',
  description: 'Object M8: plan every feature M4-M7 deferred (local-only), install deps, build in lanes, integrate, review, fix, gate and push',
  phases: [
    { title: 'Plan', detail: 'write the M8 plan with a coverage table; install new deps' },
    { title: 'Build', detail: 'lanes in parallel, own tests per task' },
    { title: 'Finish', detail: 'integrate, one review, fix, gate, push' },
  ],
}

// Reference copy of the workflow that planned and built M8, 2026-10-27/28 (run wf_03f61fc8-dea).
// It hardcodes the plan path and the repo path /home/user/Objects; edit them before reuse.
// Args: {"date":"YYYY-MM-DD","branch":"<branch>"}. See CONTINUE.md and docs/superpowers/build-process.md.

const DATE = args.date, BRANCH = args.branch
const PLAN = 'docs/superpowers/plans/2026-10-27-m8-deferred-features.md'
const TRAILER = 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01T3LWvgj3Zkwn74UzsMJS6N'
const RULES = `
Repository: /home/user/Objects (git, current branch ${BRANCH}; stay on it, never switch, rebase or force-push). Linux cloud container (4 CPUs).
Read first: CLAUDE.md, CONTINUE.md, docs/superpowers/build-process.md, the spec docs/superpowers/specs/2026-10-23-object-design.md, docs/superpowers/plans/remaining-work.md, and the plan ${PLAN} (once it exists).
Rules:
- Gene (the owner) asked on ${DATE} for M8: build every Object feature that M4-M7 deferred, local-only. His hands-on checks come later: leave them as unchecked lists, never tick them.
- Fidelity to Object is the bar: labels, options, behaviour and CSS values come from reference/ (models in docs/design-notes, English strings in docs/strings.txt, CSS in docs/design.css) and docs/. Older docs say .reference/; here that means reference/. Where the trimmed reference is silent, make a sensible choice, mark it "our choice" and list it for Gene; never invent object schema beyond what the feature needs.
- File safety: opening never writes .md files; edits change only their own lines/bytes; deletes go to trash and restore; keep CRLF/BOM; atomic writes; revision checks (409 on stale); server binds 127.0.0.1; no network at runtime. Derived data (indexes, caches, history snapshots) never goes inside object files.
- Toolchain: uv (uv run pytest backend/tests -q), npm in frontend/ (npx vitest run, npx tsc -b --noEmit, npm run build). Use npm ci, never npm install, except the dependency task. No build task edits package.json, package-lock.json, pyproject.toml or uv.lock.
- Other agents work in this same tree at the same time on files they own: touch only your task's files. If a test fails in a file another agent owns, rerun once after a minute. "1MB body splits under 300ms" in editor/preserve.test.ts is load-sensitive: rerun it alone before calling it a failure.
- Commit only your own files with explicit paths (never git add -A or .); on index.lock wait and retry. Messages end with a blank line then:
${TRAILER}
- Do not push unless told to. No pywebview window: serve headless (BROWSER=true uv run objectapp --space <scratch copy> --port <free port> --browser, or as the acceptance scripts do). Playwright + Chromium preinstalled (require('playwright'), chromium.launch() with no options; never run playwright install). Leave no processes running; never pkill by a pattern that matches your own shell.
- If a step is impossible as written, make the smallest sensible deviation and report it.`

const IMPL = { type: 'object', properties: {
  status: { type: 'string', enum: ['done', 'partial', 'blocked'] }, summary: { type: 'string' },
  testsPassed: { type: 'boolean' }, deviations: { type: 'array', items: { type: 'string' } } },
  required: ['status', 'summary', 'testsPassed', 'deviations'] }
const VERDICT = { type: 'object', properties: {
  verdict: { type: 'string', enum: ['pass', 'fail'] },
  issues: { type: 'array', items: { type: 'object', properties: {
    severity: { type: 'string', enum: ['critical', 'important', 'minor'] }, file: { type: 'string' },
    problem: { type: 'string' }, fix: { type: 'string' } }, required: ['severity', 'problem', 'fix'] } } },
  required: ['verdict', 'issues'] }
const GATE = { type: 'object', properties: {
  passed: { type: 'boolean' }, backend: { type: 'string' }, frontend: { type: 'string' }, tsc: { type: 'string' },
  build: { type: 'string' }, acceptance: { type: 'string' }, failures: { type: 'array', items: { type: 'string' } },
  pushed: { type: 'boolean' }, head: { type: 'string' } },
  required: ['passed', 'backend', 'frontend', 'tsc', 'build', 'acceptance', 'failures', 'pushed', 'head'] }
const LANE = { type: 'object', properties: {
  first: { type: 'array', items: { type: 'integer' } },
  then: { type: 'array', items: { type: 'array', items: { type: 'integer' } } } }, required: ['first', 'then'] }
const PLANNED = { type: 'object', properties: {
  plan: { type: 'string' }, base: { type: 'string' }, lanes: { type: 'array', items: LANE },
  integrate: { type: 'integer' }, taskCount: { type: 'integer' }, deps: { type: 'array', items: { type: 'string' } },
  excluded: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' } },
  required: ['plan', 'base', 'lanes', 'integrate', 'taskCount', 'deps', 'excluded', 'notes'] }

phase('Plan')
const plan = await agent(`${RULES}\n\nWrite the Milestone 8 plan: "deferred Object features". Scope = every item in the "Not in M4", "Not in M5", "Not in M6" and "Not in M7" lists of docs/superpowers/plans/2026-10-26-m{4,5,6,7}-*.md (read each list in full, plus each plan's Change history and the acceptance docs' notes for anything else deferred), MINUS only what spec §2 puts out of scope: AI features (semantic related content, AI chat, Mermaid AI, transcription), anything needing the network at runtime (calendar feeds, Readwise, web-embed metadata fetching, integrations), accounts/sync/sharing, telemetry. Everything else is in, including: recurrence occurrence log, habit stats and Skip; custom recurrence rules; overdue catch-up dialog; reminders on other dates; turn a to-do block into a Task; Day view Timeline and Date references; slash {date} shortcuts; extended search page and Save as Query; clipboard/paste actions; calendar Backlinks and Date references; backlink display modes and section-default settings; graph PNG export; find in raw mode; merge object; whiteboard media nodes (image, PDF, audio, file, web link without fetching), connector-drop quick-create, Floating Inspector, presentation mode, clipboard copy/paste, version history, PNG export, Turn into / Add to whiteboard, keyboard resize, lock UI, board notes, move/resize ink, partial erase, pen tilt; block references and Copy block reference; inline text colour and highlight; indenting non-list blocks; per-list-item annotations; table formulas, sorting and CSV export; Turn into object/task; code syntax highlighting; focus and presentation modes; version history for objects; Mermaid PNG/SVG export (local); embedding collections/queries as live views; deleting a space folder (to the OS trash or a confirmed delete); language, decimal separator and time-zone settings (English strings only, but the settings work). Audio *recording* without transcription is in if local.

Format: follow docs/superpowers/plans/2026-10-26-m7-blocks-lightmode-polish.md: Goal, Architecture, Tech Stack (every new dependency with an exact version at least two weeks old and why; prefer none), Spec, Global Constraints, API contract, Review Focus (numbered, with test names), File Structure, a "Shared files and ordering" table giving each shared file to exactly one task, numbered tasks each with Files, Produces/Consumes, test names and a commit message (ending with a blank line then the trailer above), and a final milestone-acceptance task (scripts/m8_acceptance.py and docs/superpowers/plans/m8-acceptance.md with Gene's hand-check list). Add "## Coverage" mapping EVERY deferred item to a task number or to an exclusion with its spec §2 reason. Add "## Build lanes": each lane = tasks run first in order, then sub-lanes in parallel, each in order; plus the integrate task. Aim for 5+ lanes with disjoint files (e.g. tasks/calendar, search/references, whiteboard, editor blocks, app/settings/history). Keep tasks sized for one agent each (split big ones). Plan against the code as built now (read it). Save as ${PLAN}, add an "M8" section to docs/superpowers/plans/remaining-work.md (planned, scope summary), commit both. Return plan path, base = HEAD sha after your commit, lanes, integrate, taskCount, deps (exact npm install specs, empty if none), excluded items, notes.`,
  { label: 'M8:plan', phase: 'Plan', schema: PLANNED })
if (!plan) return { stopped: 'plan failed' }
log(`M8 plan: ${plan.taskCount} tasks, ${plan.lanes.length} lanes, deps: ${plan.deps.join(', ') || 'none'}`)

if (plan.deps.length) {
  const d = await agent(`${RULES}\n\nInstall the M8 dependencies in one commit before the build: cd frontend && npm install --save-exact ${plan.deps.join(' ')} (split into -D for type-only packages if the plan says so; Python ones via uv add if any are listed as Python). Check each version is at least two weeks old; if not, pick the newest that is and update the plan's Tech Stack. Then npx tsc -b --noEmit and npm run build must pass. Commit only the package files (and the plan if changed) with message "chore(deps): add M8 dependencies up front". Do not push.`,
    { label: 'M8:deps', phase: 'Plan', schema: IMPL })
  if (!d || d.status !== 'done') return { stopped: 'deps failed', plan, deps: d }
}

phase('Build')
const results = []
const task = async n => {
  const r = await agent(`${RULES}\n\nImplement Task ${n} of ${PLAN} (M8). Read the plan's header sections and your task section fully first and follow its interfaces exactly: other agents build against them in parallel. Write the plan's tests with the code. Run your task's own tests and those of modules you touched (not the full suites), plus cd frontend && npx tsc -b --noEmit if you touched frontend code. Commit with the plan's commit message.`,
    { label: `M8:task${n}`, phase: 'Build', schema: IMPL })
  results.push({ n, status: r ? r.status : 'died', deviations: r ? r.deviations : [] })
  if (!r || r.status !== 'done') log(`M8 task ${n}: ${r ? r.status + ' - ' + r.summary : 'agent died'}`)
  return r
}
const seq = async ns => { for (const n of ns) await task(n) }
await parallel(plan.lanes.map(l => async () => { await seq(l.first); await parallel(l.then.map(sub => () => seq(sub))) }))

phase('Finish')
const integ = await agent(`${RULES}\n\nAll M8 build lanes are done. Task results: ${JSON.stringify(results)}. Implement Task ${plan.integrate} (milestone acceptance) of ${PLAN}: write scripts/m8_acceptance.py, wire anything left unconnected so the API contract matches end to end (serve headless against a fixture copy and curl the new routes), finish any task reported partial or blocked above if you can, run npm run build and ALL tests (full suites), fix what fails, and leave Gene's hand-run checks as an unchecked list in docs/superpowers/plans/m8-acceptance.md. Commit.`,
  { label: 'M8:integrate', phase: 'Finish', schema: IMPL })

const rv = await agent(`${RULES}\n\nReview the M8 build (git log ${plan.base}..HEAD) against ${PLAN}, using its "Review Focus" and "Coverage" sections as the checklist. Cover correctness and integration (routes and fields agree end to end), file safety (no read path writes; writes minimal, atomic, revision-checked; deletes restorable; history and caches outside object files), coverage (every in-scope deferred item actually works, not just stubbed), and obvious fidelity misses against reference/ strings. Report only real, concrete issues with a fix. Do not edit or commit anything.`,
  { label: 'M8:review', phase: 'Finish', schema: VERDICT })
const issues = rv ? rv.issues.filter(i => i.severity !== 'minor') : []
log(`M8 review: ${issues.length} blocking`)
let fix = null
if (issues.length) fix = await agent(`${RULES}\n\nFix these M8 review findings (plan ${PLAN}). Keep tests green; add a test where a finding is a real bug. Commit.\nFindings: ${JSON.stringify(issues)}`,
  { label: 'M8:fix', phase: 'Finish', schema: IMPL })

let gate = null
for (let attempt = 0; attempt < 2 && !(gate && gate.passed); attempt++) {
  gate = await agent(`${RULES}\n\nGate for M8. Run: uv run pytest backend/tests -q; cd frontend && npx vitest run && npx tsc -b --noEmit && npm run build; scripts/m1_roundtrip.py on a copy of backend/tests/fixtures/space-sample, and every scripts/m2..m8_acceptance.py on backend/tests/fixtures/space-sample and space-v1. If anything fails, fix it (smallest change), commit, rerun what failed. When green: update docs/superpowers/plans/remaining-work.md (M8 built, results, what is left for Gene), CONTINUE.md and HANDOFF.md status lines, commit, then git push -u origin ${BRANCH} (retry 4x with 2/4/8/16 s backoff on network errors only). Report passed=true only if all green and pushed.`,
    { label: `M8:gate${attempt ? '-retry' : ''}`, phase: 'Finish', schema: GATE })
  if (gate && !gate.passed) log(`M8 gate attempt ${attempt + 1} red: ${gate.failures.join('; ')}`)
}
return { plan: { path: plan.plan, taskCount: plan.taskCount, lanes: plan.lanes, deps: plan.deps, excluded: plan.excluded, notes: plan.notes },
  results, integrate: integ && integ.status, review: { blocking: issues.length, fix: fix && fix.status }, gate }
