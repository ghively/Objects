export const meta = {
  name: 'object-milestone-build',
  description: 'Build an Object milestone plan task by task in backend/frontend tracks with adversarial review, integration, whole-branch review and final gate',
  phases: [
    { title: 'Build', detail: 'backend and frontend tracks in parallel, each task reviewed and fixed' },
    { title: 'Integrate', detail: 'acceptance task' },
    { title: 'Review', detail: 'whole-branch review from three lenses' },
    { title: 'Fix', detail: 'fix confirmed issues and rerun all tests' },
  ],
}

const { plan: PLAN, base: BASE, backend: BACK, frontend: FRONT, integrate: INTEG, milestone: MS } = args
const REPO = args.repo || 'the current working directory (the repository root)'
const RULES = `
Repository: ${REPO} (git repo). Plan: ${PLAN}. Spec: docs/superpowers/specs/2026-10-23-object-design.md.
Rules:
- Read the plan's header sections (Global Constraints, API contract if present, Review Focus, File Structure) and YOUR task section fully before writing code. Follow interfaces exactly (names, signatures, fields): other agents build against them in parallel.
- TDD as the plan's steps say: failing tests first, run, implement, run green. Also keep ALL existing tests green (uv run pytest backend/tests -q; cd frontend && npx vitest run).
- Toolchain: Python via uv, Node via npm in frontend/. Use Bash with absolute paths.
- Commit only your own task's files with the plan's commit message, ending with a blank line and "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>". Another agent may be committing concurrently: on index.lock, wait and retry. Never git add -A; add explicit paths. Never commit *.exe, *.zip, node_modules, dist.
- Never read or modify C:\\Git\\wiki. Never put real CPI data in the repo; fixtures are synthetic.
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

async function buildTask(n) {
  let impl = await agent(`${RULES}\n\nImplement Task ${n} of the plan completely, including its tests and commit. Return the structured result.`,
    { label: `task${n}:build`, phase: 'Build', schema: IMPL })
  // Gene, 2026-10-26: no per-task review; one review after all tasks are complete.
  if (args.perTaskReview === false) return { n, impl }
  for (let round = 1; round <= 3; round++) {
    const review = await agent(`${RULES}\n\nYou are an adversarial reviewer of Task ${n} of the plan, just implemented (builder summary: ${JSON.stringify(impl)}).
Read Task ${n} and the code it produced (git log/show). Run its tests and the full suites yourself. Check every step is done, interfaces exactly as specified, tests assert what the plan says (not weakened), Global Constraints held (127.0.0.1, never write on read, minimal diffs, conflicts, atomic writes, no network), Review Focus items owned by this task are tested, and fidelity to the spec where the task names labels/options.
Fail only for real defects (critical/important). Default to fail if tests do not pass when you run them.`,
      { label: `task${n}:review${round}`, phase: 'Build', schema: VERDICT })
    if (!review) return { n, impl }
    const blocking = review.issues.filter(i => i.severity !== 'minor')
    if (review.verdict === 'pass' || !blocking.length) return { n, impl, rounds: round }
    impl = await agent(`${RULES}\n\nFix these review findings for Task ${n}, keep all tests green, commit "fix(task${n}): address review".\nFindings: ${JSON.stringify(blocking)}`,
      { label: `task${n}:fix${round}`, phase: 'Build', schema: IMPL })
  }
  log(`Task ${n}: still failing review after 3 rounds; carried to final review`)
  return { n, impl, unresolved: true }
}
async function track(ns) { const out = []; for (const n of ns) out.push(await buildTask(n)); return out }

phase('Build')
const [backend, frontend] = await parallel([() => track(BACK), () => track(FRONT)])
log(`Build done: backend ${backend.filter(Boolean).length}/${BACK.length}, frontend ${frontend.filter(Boolean).length}/${FRONT.length}`)

phase('Integrate')
const integ = await agent(`${RULES}\n\nBoth tracks are built. Implement Task ${INTEG} (milestone acceptance) of the plan. Wire anything the tracks left unconnected between frontend and backend (the API contract must match end to end: start the app on port 8791 against a copy of the fixture space with the server config builder, exercise the new routes with curl, stop it; leave no processes running). Run npm run build and ALL tests. Leave hand-run checks for Gene as an unchecked checklist in the acceptance doc. Commit.`,
  { label: 'integrate', phase: 'Integrate', schema: IMPL })

phase('Review')
const LENSES = [
  { key: 'correctness', p: 'correctness and integration: frontend and backend agree on every route and field; all tests pass; crash paths, unhandled errors, races in concurrent property writes, renames and type edits; the app works end to end (start it against a fixture copy and drive the API).' },
  { key: 'file-safety', p: 'file safety: prove or disprove with throwaway probes in a temp copy of the fixture space (do not commit them) that opening never writes .md files; property edits change only their lines; rename relink changes only link text in only linking files; change type, type rename, option rename and kind change cascades touch only what they must; deletes go to trash and are restorable; conflicts never overwrite; CRLF/BOM preserved.' },
  { key: 'fidelity', p: 'faithfulness to the design spec and behaviour catalog: compare property editors, add-property menu, Object Type Settings, pickers, chips, colours and labels against the spec and the behaviour catalog (docs/behavior-catalog.md). Report concrete mismatches with exact labels/values that this milestone should already have.' },
]
const reviews = await parallel(LENSES.map(l => () => agent(`${RULES}\n\nReview the WHOLE ${MS} build (all commits on master after ${BASE}) through one lens: ${l.p}\nReport only real issues with a concrete fix. Do not edit or commit anything.`,
  { label: `review:${l.key}`, phase: 'Review', schema: VERDICT })))
const all = reviews.filter(Boolean).flatMap(r => r.issues)
const issues = all.filter(i => i.severity !== 'minor'), minors = all.filter(i => i.severity === 'minor')
log(`Final review: ${issues.length} blocking, ${minors.length} minor`)

phase('Fix')
let fix = null
if (issues.length || minors.length) fix = await agent(`${RULES}\n\nFix every one of these whole-branch review findings (minor ones where cheap). Keep all tests green; add a test for each file-safety finding. Commit in logical commits.\nFindings: ${JSON.stringify(issues)}\nMinor: ${JSON.stringify(minors)}`,
  { label: 'fix:all', phase: 'Fix', schema: IMPL })
const gate = await agent(`${RULES}\n\nFinal gate. Run uv run pytest backend/tests -q, cd frontend && npx vitest run, npm run build, and scripts/m1_roundtrip.py on the fixture space. Report exact pass/fail counts. Confirm git status is clean apart from ignored files. Change code only if a test fails; then fix and commit.`,
  { label: 'final-gate', phase: 'Fix', schema: IMPL })
return {
  tasks: [...backend, ...frontend].filter(Boolean).map(t => ({ n: t.n, status: t.impl && t.impl.status, rounds: t.rounds, unresolved: !!t.unresolved })),
  integrate: integ && { status: integ.status, summary: integ.summary },
  blocking: issues.length, minor: minors.length,
  fix: fix && { status: fix.status, testsPassed: fix.testsPassed, summary: fix.summary },
  gate,
}
