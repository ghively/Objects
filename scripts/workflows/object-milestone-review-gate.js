export const meta = {
  name: 'object-milestone-review-gate',
  description: 'Whole-milestone review (three lenses), one fix pass and the final gate for an already-built Object milestone',
  phases: [{ title: 'Review', detail: 'whole-branch review from three lenses' }, { title: 'Fix', detail: 'fix confirmed issues and rerun all tests' }],
}

// Args: {"plan":"docs/superpowers/plans/<plan>.md","base":"<sha before the milestone>","milestone":"Milestone 3"}
// Use this when the build is finished (or its run cache is gone, e.g. in a cloud session) and only the review, fix pass and gate remain.
const { plan: PLAN, base: BASE, milestone: MS } = args
const REPO = args.repo || 'the current working directory (the repository root)'
const RULES = `
Repository: ${REPO} (git repo). Plan: ${PLAN}. Spec: docs/superpowers/specs/2026-10-23-object-design.md. Visual reference: docs/README.md and its PNGs.
Rules:
- Read the plan's header sections (Global Constraints, API contract if present, Review Focus, File Structure) and YOUR task section fully before writing code. Follow interfaces exactly (names, signatures, fields): other agents build against them in parallel.
- TDD as the plan's steps say: failing tests first, run, implement, run green. Also keep ALL existing tests green (uv run pytest backend/tests -q; cd frontend && npx vitest run).
- Toolchain: Python via uv, Node via npm in frontend/. Use Bash with absolute paths.
- Commit only your own task's files with the plan's commit message, ending with a blank line and "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>". Another agent may be committing concurrently: on index.lock, wait and retry. Never git add -A; add explicit paths. Never commit .reference/, *.exe, Object*.zip, node_modules, dist.
- .reference/ is Object's unpacked app and design notes source: read for behaviour, option names, labels and CSS values only; in a clone it is the trimmed reference/ folder; never copy its code.
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

phase('Review')
const LENSES = [
  { key: 'correctness', p: 'correctness and integration: frontend and backend agree on every route and field; all tests pass; crash paths, unhandled errors, races in concurrent property writes, renames and type edits; the app works end to end (start it against a fixture copy and drive the API).' },
  { key: 'file-safety', p: 'file safety: prove or disprove with throwaway probes in a temp copy of the fixture space (do not commit them) that opening never writes .md files; property edits change only their lines; rename relink changes only link text in only linking files; change type, type rename, option rename and kind change cascades touch only what they must; deletes go to trash and are restorable; conflicts never overwrite; CRLF/BOM preserved.' },
  { key: 'fidelity', p: 'faithfulness to Object: compare property editors, add-property menu, Object Type Settings, pickers, chips, colours and labels against .reference (locale strings in strings.txt, CSS in design.css, models) and docs/. Report concrete mismatches with exact labels/values that this milestone should already have.' },
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
  blocking: issues.length, minor: minors.length,
  fix: fix && { status: fix.status, testsPassed: fix.testsPassed, summary: fix.summary },
  gate,
}
