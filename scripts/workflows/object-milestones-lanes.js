export const meta = {
  name: 'object-finish-all-milestones',
  description: 'Object: M3 review/fix/gate, M4 build, then M5 and M6 built concurrently from pre-written plans, then M7; gate and push after each',
  phases: [
    { title: 'M3', detail: 'whole-milestone review, fix pass, gate' },
    { title: 'M4', detail: 'reconcile plan with M3, build lanes, integrate, review, fix, gate' },
    { title: 'M5+M6', detail: 'reconcile pre-written plans, build both concurrently, integrate M5 then M6, review, fix, gate' },
    { title: 'M7', detail: 'reconcile, build, integrate, review, fix, gate' },
  ],
}

// Reference copy of the workflow that built M3 (review) through M7, 2026-10-26/27 (run wf_30d24e71-37e).
// It hardcodes the plan paths, the repo path /home/user/Objects and the milestone order; edit them before reuse.
// Args: {"date":"YYYY-MM-DD","branch":"<branch>"}. See CONTINUE.md and docs/superpowers/build-process.md.

const DATE = args.date, BRANCH = args.branch
const REPO = '/home/user/Objects'
const TRAILER = 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01T3LWvgj3Zkwn74UzsMJS6N'
const RULES = `
Repository: ${REPO} (git, current branch ${BRANCH}; stay on it, never switch, rebase or force-push). Linux cloud container, not Gene's Windows PC.
Read first: CLAUDE.md, CONTINUE.md, docs/superpowers/build-process.md, the spec docs/superpowers/specs/2026-10-23-object-design.md, and the plan named below (its header sections: Global Constraints, API contract, Review Focus, File Structure, Shared files and ordering).
Rules:
- Gene (the owner) said on ${DATE}: finish all remaining milestones now. That overrides "don't start the next milestone until Gene says so". His hands-on checks still happen later: leave them as unchecked lists in the acceptance docs, never tick them yourself.
- Fidelity to the design spec and behaviour catalog is the bar: labels, options, behaviour and CSS values come from the spec and the behaviour catalog (docs/behavior-catalog.md). If they are silent, say so and use the closest evidence; never invent schema.
- File safety: opening never writes .md files; edits change only their own lines; deletes go to trash; keep CRLF/BOM; atomic writes; server binds 127.0.0.1 only. No real CPI data; fixtures are synthetic.
- Toolchain: uv for Python (uv run pytest backend/tests -q), npm in frontend/ (npx vitest run, npx tsc -b --noEmit, npm run build). Use npm ci, never npm install, unless your task adds a dependency (then commit the lockfile change it needs and nothing else). Never commit an unrelated package-lock.json diff.
- Other agents work in this same working tree at the same time on files they own. Touch only files your task owns. If a test fails in a file another agent owns and is mid-edit, rerun once after a minute before deciding. The vitest test "1MB body splits under 300ms" in editor/preserve.test.ts is load-sensitive: rerun it alone before calling it a failure.
- Commit only your own files with explicit paths (never git add -A or git add .). On index.lock, wait and retry. Commit messages end with a blank line then:
${TRAILER}
- Never commit *.exe, *.zip, node_modules, dist.
- Do not push unless your prompt says to. Do not launch the pywebview window (no display); run the server headless (the acceptance scripts show how: create_app / build_server_config with uvicorn on 127.0.0.1). Playwright with Chromium is preinstalled (require('playwright'), chromium.launch() with no options; never run playwright install) for screenshots of the built app. Leave no processes running.
- If a plan step is impossible as written, make the smallest sensible deviation and report it.`

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
  integrate: { type: 'integer' }, taskCount: { type: 'integer' }, notes: { type: 'string' } },
  required: ['plan', 'base', 'lanes', 'integrate', 'taskCount', 'notes'] }

const LENSES = [
  { key: 'correctness', p: 'correctness and integration: frontend and backend agree on every route and field of the plan\'s API contract; all tests pass; crash paths, unhandled errors, races in concurrent writes; the app works end to end (serve it headless against a fixture copy, drive the API with curl, and load the built UI in Playwright).' },
  { key: 'file-safety', p: 'file safety: with throwaway probes in a temp copy of the fixture spaces (never committed), prove or disprove that opening and every read route write nothing, each write changes only what it must (only its own lines, only the files it must, only its own .object/ file), deletes go to trash and restore byte-identically, stale revisions get 409 and never overwrite, CRLF/BOM survive.' },
  { key: 'fidelity', p: 'faithfulness to the design spec and behaviour catalog: compare this milestone\'s screens, menus, labels, option names, defaults, orders, colours and spacing against the spec and the behaviour catalog (docs/behavior-catalog.md); take Playwright screenshots of the built app on a fixture copy to compare. Report concrete mismatches with the exact expected label or value.' },
]

async function gateAndPush(ms, planPath, m) {
  const scripts = `uv run python scripts/m1_roundtrip.py <copy>, and every scripts/m2_acceptance.py ... scripts/m${m}_acceptance.py that exists, each on backend/tests/fixtures/space-sample and space-v1 (the m2+ scripts copy the space themselves; m1_roundtrip also copies, but pass it a copy anyway), plus any fixture space the plan adds`
  for (let attempt = 0; attempt < 3; attempt++) {
    const g = await agent(`${RULES}\n\nFinal gate for ${ms} (plan ${planPath}). Run: uv run pytest backend/tests -q; cd frontend && npx vitest run; npx tsc -b --noEmit; npm run build; ${scripts}. Serve the built app headless on a scratch copy of space-sample and load it in Playwright to confirm it renders this milestone's screens without console errors. Report exact counts. If anything fails, fix it (smallest change, with a test), commit, and rerun everything. When all is green: update docs/superpowers/plans/remaining-work.md (${ms} built, automated results, what is left for Gene), CONTINUE.md and HANDOFF.md status lines (note that Gene on ${DATE} asked for all milestones to be built; his hand-checks are pending), commit them, then git push -u origin ${BRANCH} (retry up to 4 times with 2/4/8/16 s backoff on network errors only). Confirm git status is clean apart from ignored files. Report passed=true only if every suite and script is green and the push succeeded.`,
      { label: `${ms}:gate${attempt ? '-retry' + attempt : ''}`, phase: ms, schema: GATE })
    if (g && g.passed) { log(`${ms} gate green: ${g.backend} / ${g.frontend}; pushed ${g.head}`); return g }
    log(`${ms} gate not green (attempt ${attempt + 1}): ${g ? g.failures.join('; ') : 'agent died'}`)
  }
  return null
}

async function reviewFix(ms, planPath, base) {
  const reviews = await parallel(LENSES.map(l => () => agent(`${RULES}\n\nReview the WHOLE ${ms} build: every commit in git log ${base}..HEAD, against the plan ${planPath}. Use the plan's "Review Focus" section as your checklist, through one lens: ${l.p}\nReport only real issues with a concrete fix. Do not edit or commit anything.`,
    { label: `${ms}:review:${l.key}`, phase: ms, schema: VERDICT })))
  const all = reviews.filter(Boolean).flatMap(r => r.issues)
  const blocking = all.filter(i => i.severity !== 'minor'), minors = all.filter(i => i.severity === 'minor')
  log(`${ms} review: ${blocking.length} blocking, ${minors.length} minor`)
  if (!all.length) return { blocking: 0, minor: 0 }
  const fix = await agent(`${RULES}\n\nFix every one of these whole-milestone review findings for ${ms} (plan ${planPath}); minor ones where cheap, and say which minor ones you left and why. Keep all tests green; add a test for each correctness or file-safety finding. Commit in logical commits.\nBlocking: ${JSON.stringify(blocking)}\nMinor: ${JSON.stringify(minors)}`,
    { label: `${ms}:fix`, phase: ms, schema: IMPL })
  return { blocking: blocking.length, minor: minors.length, fix }
}

async function build(ms, planPath, lanes, integ) {
  const results = []
  const task = async n => {
    const r = await agent(`${RULES}\n\nImplement Task ${n} of ${planPath} (${ms}). Read the plan's header sections and your task section fully first and follow its interfaces exactly: other agents build against them in parallel. TDD as the steps say. Run your task's tests and the full suite of your side (backend: uv run pytest backend/tests -q; frontend: cd frontend && npx vitest run && npx tsc -b --noEmit). Commit with the plan's commit message.`,
      { label: `${ms}:task${n}`, phase: ms, schema: IMPL })
    results.push({ n, status: r ? r.status : 'died', deviations: r ? r.deviations : [] })
    if (!r || r.status !== 'done') log(`${ms} task ${n}: ${r ? r.status + ' - ' + r.summary : 'agent died'}`)
    return r
  }
  const seq = async ns => { for (const n of ns) await task(n) }
  await parallel(lanes.map(l => async () => { await seq(l.first); await parallel(l.then.map(sub => () => seq(sub))) }))
  const integR = await agent(`${RULES}\n\nAll build lanes of ${ms} are done. Task results: ${JSON.stringify(results)}. Implement Task ${integ} (milestone acceptance) of ${planPath}: write scripts/m${ms.slice(1)}_acceptance.py if the plan asks for it, wire anything the lanes left unconnected so the API contract matches end to end (serve headless against a fixture copy and curl the new routes), finish any task reported partial or blocked above if you can, run npm run build and ALL tests, and leave Gene's hand-run checks as an unchecked list in docs/superpowers/plans/m${ms.slice(1)}-acceptance.md. Commit.`,
    { label: `${ms}:integrate`, phase: ms, schema: IMPL })
  return { results, integrate: integR && integR.status }
}

async function planMilestone(ms, m, title) {
  const plan = await agent(`${RULES}\n\nWrite the ${ms} implementation plan: "${title}". Sources: docs/superpowers/plans/remaining-work.md (the ${ms} bullets are the scope), the spec and the behaviour catalog (docs/behavior-catalog.md), and what M1-M${m - 1} actually built (read the code, not just older plans). Follow the format of docs/superpowers/plans/2026-10-26-m4-calendar-daily-tasks.md exactly: Goal, Architecture, Tech Stack (name any new dependency and why), Spec, Roadmap, Global Constraints (carried forward + new), API contract, Review Focus (numbered, each with the test names that prove it), File Structure, a "Shared files and ordering" table giving each shared file to exactly one task, then numbered tasks each with Files, Produces/Consumes, TDD steps with test names, and a commit message; the last task is milestone acceptance (scripts/m${m}_acceptance.py and m${m}-acceptance.md). Plan for at least 3 build lanes where file ownership allows (build-process.md). Add a section "## Build lanes" stating the lanes as: each lane = tasks run first in order, then sub-lanes run in parallel, each in order; and the integrate task. Every quoted UI string must exist verbatim in the strings file or be marked "our string". Save as docs/superpowers/plans/${DATE}-m${m}-<short-slug>.md and commit it. Return the path as plan; set base to the current HEAD sha, lanes, integrate and taskCount as written.`,
    { label: `${ms}:plan:write`, phase: ms, schema: PLANNED })
  if (!plan) return null
  const CRITICS = [
    'completeness and fidelity: every remaining-work.md bullet for this milestone is covered; every label/option/default matches the spec; nothing invented beyond the spec (unless the spec says so, e.g. pen ink); nothing deferred silently',
    'buildability: interfaces are exact and consistent between tasks and with the code M1-M' + (m - 1) + ' actually built (check real names in the repo); each task is buildable by one agent with the stated files; test names are concrete; the build lanes really have disjoint files',
    'file safety: no read path writes; writes are minimal, atomic, EOL/BOM-preserving, revision-checked; derived data (indexes, caches) lives outside object files and is rebuildable; deletes restorable',
  ]
  const crit = await parallel(CRITICS.map((c, i) => () => agent(`${RULES}\n\nCritique the plan ${plan.plan} for ${ms} through one lens: ${c}. Report only real issues with a concrete fix. Do not edit anything.`,
    { label: `${ms}:plan:critic${i + 1}`, phase: ms, schema: VERDICT })))
  const issues = crit.filter(Boolean).flatMap(r => r.issues)
  log(`${ms} plan critics: ${issues.length} issues`)
  const resolved = await agent(`${RULES}\n\nResolve these critic findings in the plan ${plan.plan} in one pass (edit the plan; keep its format and the "## Build lanes" section accurate), then commit "docs(plan): resolve M${m} plan critic issues". Findings: ${JSON.stringify(issues)}. Return the plan path, base = HEAD sha after your commit, and the final lanes, integrate task and task count.`,
    { label: `${ms}:plan:resolve`, phase: ms, schema: PLANNED })
  return resolved || plan
}

// ---- Lighter ceremony (Gene, 2026-10-26): from the M4 review on, one combined review per milestone, a gate without screenshots, at most 2 gate attempts.
async function reviewLite(ms, planPath, base) {
  const rv = await agent(`${RULES}\n\nReview the ${ms} build (git log ${base}..HEAD) against the plan ${planPath}, using its "Review Focus" section as the checklist. Cover correctness and integration (routes and fields agree end to end), file safety (no read path writes; writes minimal, atomic, revision-checked; deletes restorable) and obvious fidelity misses against the spec and behaviour catalog. Report only real, concrete issues with a fix; skip style and speculation. Do not edit or commit anything.`,
    { label: `${ms}:review`, phase: ms === 'M4' ? 'M4' : (ms === 'M7' ? 'M7' : 'M5+M6'), schema: VERDICT })
  const issues = rv ? rv.issues.filter(i => i.severity !== 'minor') : []
  log(`${ms} review: ${issues.length} blocking`)
  if (!issues.length) return { blocking: 0 }
  const fix = await agent(`${RULES}\n\nFix these ${ms} review findings (plan ${planPath}). Keep tests green; add a test only where a finding is a real bug. Commit.\nFindings: ${JSON.stringify(issues)}`,
    { label: `${ms}:fix`, phase: ms === 'M4' ? 'M4' : (ms === 'M7' ? 'M7' : 'M5+M6'), schema: IMPL })
  return { blocking: issues.length, fix: fix && fix.status }
}
async function gateLite(ms, planPath, m, ph) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const g = await agent(`${RULES}\n\nGate for ${ms} (plan ${planPath}). Run: uv run pytest backend/tests -q; cd frontend && npx vitest run && npx tsc -b --noEmit && npm run build; and each scripts/m*_acceptance.py up to m${m} once on backend/tests/fixtures/space-sample. If anything fails, fix it (smallest change), commit, rerun what failed. When green: update docs/superpowers/plans/remaining-work.md (${ms} built, results, what is left for Gene), CONTINUE.md and HANDOFF.md status lines, commit, then git push -u origin ${BRANCH} (retry 4x with 2/4/8/16 s backoff on network errors only). Report passed=true only if all green and pushed.`,
      { label: `${ms}:gate${attempt ? '-retry' : ''}`, phase: ph, schema: GATE })
    if (g && g.passed) { log(`${ms} gate green: ${g.backend} / ${g.frontend}; pushed ${g.head}`); return g }
    log(`${ms} gate not green (attempt ${attempt + 1}): ${g ? g.failures.join('; ') : 'agent died'}`)
  }
  return null
}

const summary = []

// ---- M3: built already; review, fix, gate
phase('M3')
const M3PLAN = 'docs/superpowers/plans/2026-10-26-m3-views-collections-queries.md'
const r3 = await reviewFix('M3', M3PLAN, '39432ce')
const g3 = await gateAndPush('M3', M3PLAN, 3)
summary.push({ ms: 'M3', review: r3, gate: g3 })
if (!g3) return { stopped: 'M3 gate red', summary }

// ---- M4: planned; reconcile with what M3 built, then build
phase('M4')
const M4PLAN = 'docs/superpowers/plans/2026-10-26-m4-calendar-daily-tasks.md'
const rec = await agent(`${RULES}\n\nThe M4 plan ${M4PLAN} was written against the M3 plan, before M3 was built and reviewed. Re-read what M3 actually built (backend/objectapp/{jsonstore,uistate,rows,space,server}.py, frontend/src/{views,types,shell,nav,api}/*, App.tsx) and the M3 review fixes in git log, and correct every interface name, signature, field, file path and test baseline in the M4 plan that drifted. Change nothing else in its scope. Its "Updated" calendar section stays (Gene has not cut it). Commit "docs(plan): reconcile M4 plan with built M3". Return plan path, base = HEAD sha after your commit, lanes exactly as the plan defines them (backend Tasks 1-6 in order; frontend Task 7 first, then the tasks sub-lane 8-11 and the calendar sub-lane 12-15 in parallel), integrate = 16, taskCount = 16, and notes listing what you changed.`,
  { label: 'M4:reconcile', phase: 'M4', schema: PLANNED })
const p4 = rec || { plan: M4PLAN, base: 'HEAD', lanes: [{ first: [1, 2, 3, 4, 5, 6], then: [] }, { first: [7], then: [[8, 9, 10, 11], [12, 13, 14, 15]] }], integrate: 16 }
const b4 = await build('M4', p4.plan, p4.lanes, p4.integrate)
const r4 = await reviewLite('M4', p4.plan, p4.base)
const g4 = await gateLite('M4', p4.plan, 4, 'M4')
summary.push({ ms: 'M4', build: b4, review: r4, gate: g4 })
if (!g4) return { stopped: 'M4 gate red', summary }

// ---- M5-M7 (revised for speed): plans were written, critiqued and resolved ahead of time, deps installed up front.
// M5 and M6 build concurrently (M6 only creates new files until its integrate task), then M7.
const PLANS = {
  M5: 'docs/superpowers/plans/2026-10-26-m5-search-palette-backlinks-graph.md',
  M6: 'docs/superpowers/plans/2026-10-26-m6-whiteboards-pen.md',
  M7: 'docs/superpowers/plans/2026-10-26-m7-blocks-lightmode-polish.md',
}
async function reconcile(ms, planPath, extra) {
  return agent(`${RULES}\n\nThe ${ms} plan ${planPath} was written before M4 (and, for M7, before M5 and M6) were built. Re-read what is actually built now (backend/objectapp/*.py, frontend/src/**, git log) and correct every interface name, signature, field, file path, fixture count and test baseline in the plan that drifted. ${extra} Keep its scope and its "## Build lanes" section (fix lanes only if a file-ownership clash makes them unsafe). Commit "docs(plan): reconcile ${ms} plan with built code". Return plan path, base = HEAD sha after your commit, the lanes, integrate task, task count, and notes listing what you changed.`,
    { label: `${ms}:reconcile`, phase: ms === 'M7' ? 'M7' : 'M5+M6', schema: PLANNED })
}
async function buildLanes(ms, planPath, lanes, ph) {
  const results = []
  const task = async n => {
    const r = await agent(`${RULES}\n\nImplement Task ${n} of ${planPath} (${ms}). Read the plan's header sections and your task section fully first and follow its interfaces exactly: other agents build against them in parallel${ms === 'M6' ? '; M5 is also being built in this tree right now, so until the integrate task create only new files, never edit a pre-existing file' : ''}. Write the plan's tests with the code (no need to show a failing run first). Run your task's own tests and the test files for modules you touched (not the full suites: those run at integration and the gate), plus cd frontend && npx tsc -b --noEmit if you touched frontend code. Never edit package.json, package-lock.json, pyproject.toml or uv.lock: dependencies are already installed. Commit with the plan's commit message.`,
      { label: `${ms}:task${n}`, phase: ph, schema: IMPL })
    results.push({ n, status: r ? r.status : 'died', deviations: r ? r.deviations : [] })
    if (!r || r.status !== 'done') log(`${ms} task ${n}: ${r ? r.status + ' - ' + r.summary : 'agent died'}`)
    return r
  }
  const seq = async ns => { for (const n of ns) await task(n) }
  await parallel(lanes.map(l => async () => { await seq(l.first); await parallel(l.then.map(sub => () => seq(sub))) }))
  return results
}
async function integrate(ms, planPath, integ, results, ph) {
  const r = await agent(`${RULES}\n\nAll build lanes of ${ms} are done. Task results: ${JSON.stringify(results)}. Implement Task ${integ} (milestone acceptance${ms === 'M6' ? ' and wiring: all edits to pre-existing shared files happen here, on top of the integrated M5' : ''}) of ${planPath}: write scripts/m${ms.slice(1)}_acceptance.py if the plan asks for it, wire anything left unconnected so the API contract matches end to end (serve headless against a fixture copy and curl the new routes), finish any task reported partial or blocked above if you can, run npm run build and ALL tests (full suites), fix what fails, and leave Gene's hand-run checks as an unchecked list in docs/superpowers/plans/m${ms.slice(1)}-acceptance.md. Commit.`,
    { label: `${ms}:integrate`, phase: ph, schema: IMPL })
  return r && r.status
}

phase('M5+M6')
const [p5, p6] = await parallel([
  () => reconcile('M5', PLANS.M5, 'M6 is built concurrently and only creates new files until its integrate task, so M5 keeps ownership of the shared app files.'),
  () => reconcile('M6', PLANS.M6, 'M5 is built concurrently and owns all pre-existing shared files; make sure every M6 task except the integrate task only creates new files, and that no M6 new file path collides with a file the M5 plan creates.'),
])
if (!p5 || !p6) return { stopped: 'M5/M6 reconcile failed', summary }
const [res5, res6] = await parallel([
  () => buildLanes('M5', p5.plan, p5.lanes, 'M5+M6'),
  () => buildLanes('M6', p6.plan, p6.lanes, 'M5+M6'),
])
const i5 = await integrate('M5', p5.plan, p5.integrate, res5, 'M5+M6')
const i6 = await integrate('M6', p6.plan, p6.integrate, res6, 'M5+M6')
const [r5, r6] = await parallel([() => reviewLite('M5', p5.plan, p5.base), () => reviewLite('M6', p6.plan, p6.base)])
const g56 = await gateLite('M5+M6', `${p5.plan} and ${p6.plan}`, 6, 'M5+M6')
summary.push({ ms: 'M5', build: res5, integrate: i5, review: r5 }, { ms: 'M6', build: res6, integrate: i6, review: r6, gate: g56 })
if (!g56) return { stopped: 'M5+M6 gate red', summary }

phase('M7')
const p7 = await reconcile('M7', PLANS.M7, 'M5 and M6 are now built and integrated; M7 may touch any file.')
if (!p7) return { stopped: 'M7 reconcile failed', summary }
const res7 = await buildLanes('M7', p7.plan, p7.lanes, 'M7')
const i7 = await integrate('M7', p7.plan, p7.integrate, res7, 'M7')
const r7 = await reviewLite('M7', p7.plan, p7.base)
const g7 = await gateLite('M7', p7.plan, 7, 'M7')
summary.push({ ms: 'M7', build: res7, integrate: i7, review: r7, gate: g7 })
if (!g7) return { stopped: 'M7 gate red', summary }
return { stopped: null, summary }
