// M22: the pure step rules, ported 1:1 from `backend/objectapp/workrules.py` (plan
// `2026-11-05-m22-work-model.md`, Contract "Pure rules"). The server decides; the front end
// uses these for display and optimistic UI. Parity: `__fixtures__/step-cases.json`.
import type { LabelOption, Stage, StepAction, StepKind, StepState, StepValue, Turn, WorkRole } from '@/api/types'
import { STEP_KIND_LABELS, STEP_STATE_LABELS } from '@/api/types'

export const DONE_VISIBLE_DAYS = 14

/** A move the rules refuse; `message` is the text the server answers with (422). */
export class IllegalMoveError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IllegalMoveError'
  }
}

/** A step as the rules need it: a `StepValue` or anything shaped like one (the fixture's rows). */
export type RuleStep = Pick<StepValue, 'kind' | 'state' | 'text'> & Partial<Omit<StepValue, 'kind' | 'state' | 'text'>> & {
  [extra: string]: unknown
}

/** The status property as the rules need it (a `PropertyDef` fits). */
export interface StatusDefLike {
  options: { set?: Pick<LabelOption, 'id' | 'text' | 'statusCategory'>[] }
}

// -- messages (the server's, verbatim) ------------------------------------------------------

const MSG_NOT_CURRENT = 'Finish the steps before this one first.'
const MSG_DONE_APPROVE_REOPEN = 'A done Approve step never reopens.'
const MSG_ONLY_YOU = 'Only you can do this to a step.'
const MSG_ONLY_AGENT_RESULT = "Only the agent reports a step's result."
const MSG_ONLY_AGENT_APPROVE_DONE = 'Only the agent marks an Approve step done.'
const MSG_ANSWER_TEXT = 'An answer needs text.'
const MSG_SAY_WHAT = 'Say what happened.'
const MSG_NOT_BEFORE = 'Only an Approve step takes a Not before time.'
const wrongKind = (kind: StepKind) => `This doesn't apply to a ${STEP_KIND_LABELS[kind]} step.`
const wrongState = (state: StepState) => `This step is already ${STEP_STATE_LABELS[state].toLowerCase()}.`

// -- the actions table ----------------------------------------------------------------------

const ACTIONS: readonly StepAction[] = ['answer', 'done', 'approve', 'decline', 'run', 'reopen', 'complete', 'fail']
const ALL_KINDS: readonly StepKind[] = ['question', 'do', 'approve', 'agent']

interface Move {
  kinds: readonly StepKind[]
  from: readonly StepState[]
  roles: readonly WorkRole[]
}

/** Every allowed (action, kind, from state, role), as the Contract's table lists them. */
const MOVES: Record<StepAction, readonly Move[]> = {
  answer: [{ kinds: ['question'], from: ['open'], roles: ['user'] }],
  done: [
    { kinds: ['do'], from: ['open'], roles: ['user'] },
    { kinds: ['agent'], from: ['open', 'approved'], roles: ['user', 'agent'] },
  ],
  approve: [{ kinds: ['approve'], from: ['open'], roles: ['user'] }],
  decline: [{ kinds: ['approve'], from: ['open', 'approved'], roles: ['user'] }],
  run: [{ kinds: ['agent'], from: ['open'], roles: ['user', 'app'] }],
  reopen: [{ kinds: ALL_KINDS, from: ['approved', 'declined', 'done'], roles: ['user'] }],
  complete: [
    { kinds: ['approve'], from: ['approved'], roles: ['agent'] },
    { kinds: ['agent'], from: ['open', 'approved'], roles: ['agent'] },
  ],
  fail: [{ kinds: ['approve', 'agent'], from: ['approved'], roles: ['agent'] }],
}

/** Actions taken on a finished step (everything else moves the current step forward). */
const isForward = (action: StepAction) => action !== 'reopen'

const roleMessage = (role: WorkRole) => (role === 'user' ? MSG_ONLY_AGENT_RESULT : MSG_ONLY_YOU)

/** The reason an action is refused (text and Not before aside), or null when it is allowed. */
function refusal(steps: readonly RuleStep[], index: number, action: StepAction, role: WorkRole): string | null {
  const moves = MOVES[action]
  // The role may never take this action, on any kind.
  if (!moves.some((m) => m.roles.includes(role))) return roleMessage(role)
  const step = steps[index]
  const cur = currentIndex(steps)
  // Not the current step: forward actions only on it, nothing on a step after it.
  if (cur !== null && index > cur) return MSG_NOT_CURRENT
  // Wrong kind: the action never applies to this kind (for anyone), or only for another role.
  const forKind = moves.filter((m) => m.kinds.includes(step.kind))
  if (forKind.length === 0) {
    if (action === 'done' && step.kind === 'approve') return MSG_ONLY_AGENT_APPROVE_DONE
    return wrongKind(step.kind)
  }
  const mine = forKind.filter((m) => m.roles.includes(role))
  if (mine.length === 0) return roleMessage(role)
  // Wrong state.
  if (action === 'reopen' && step.kind === 'approve' && step.state === 'done') return MSG_DONE_APPROVE_REOPEN
  if (!mine.some((m) => m.from.includes(step.state))) return wrongState(step.state)
  if (isForward(action) && index !== cur) return wrongState(step.state)
  return null
}

// -- reads ----------------------------------------------------------------------------------

/** The first step that is neither Done nor Declined, or null. */
export function currentIndex(steps: readonly Pick<RuleStep, 'state'>[]): number | null {
  const i = steps.findIndex((s) => s.state !== 'done' && s.state !== 'declined')
  return i < 0 ? null : i
}

const TEXT_STAGES: Record<string, Stage> = {
  'not started': 'notStarted',
  planned: 'notStarted',
  'next up': 'ready',
  'in progress': 'doing',
  'on hold': 'parked',
  done: 'done',
  completed: 'done',
}
const CATEGORY_STAGES: Record<string, Stage> = {
  'not-started': 'notStarted',
  'in-progress': 'doing',
  blocked: 'parked',
  done: 'done',
}
/** `typemodel.status_category`'s map, for an option that carries no category. */
const TEXT_CATEGORIES: Record<string, string> = {
  'not started': 'not-started',
  'next up': 'not-started',
  'in progress': 'in-progress',
  'on hold': 'blocked',
  blocked: 'blocked',
  done: 'done',
  complete: 'done',
}
const fold = (text: string) => text.toLowerCase().split(/\s+/).filter(Boolean).join(' ')

/** The stage of an item by Object's own status (never the Desk status). */
export function stageOf(status: string | null | undefined, statusDef: StatusDefLike | null | undefined): Stage {
  if (status === null || status === undefined || !status.trim()) return 'notStarted'
  const key = fold(status)
  const byText = TEXT_STAGES[key]
  if (byText) return byText
  const option = (statusDef?.options.set ?? []).find((o) => fold(o.text) === key || o.id === status)
  const category = option?.statusCategory ?? TEXT_CATEGORIES[key] ?? 'not-started'
  return CATEGORY_STAGES[category] ?? 'notStarted'
}

export const isDone = (stage: Stage): boolean => stage === 'done'

const deskResolution = (deskStatus: string | null | undefined): 'Resolved' | 'Closed' | null => {
  const key = fold(deskStatus ?? '')
  if (key === 'resolved') return 'Resolved'
  if (key === 'closed') return 'Closed'
  return null
}

/** Whose turn it is, in the Contract's order (a desk resolution beats On Hold). */
export function whoseTurn(stage: Stage, steps: readonly RuleStep[], deskStatus: string | null | undefined): Turn {
  if (stage === 'done') return 'none'
  if (deskResolution(deskStatus)) return 'close'
  if (stage === 'parked') return 'parked'
  if (steps.length === 0) return 'none'
  const cur = currentIndex(steps)
  if (cur === null) return 'close'
  const step = steps[cur]
  if (step.kind === 'question' || step.kind === 'do') return 'you'
  if (step.kind === 'approve') return step.state === 'open' ? 'approve' : 'agent'
  return 'agent'
}

/** "Resolved"/"Closed" when the desk says so on an item that isn't done. */
export function deskSays(stage: Stage, deskStatus: string | null | undefined): 'Resolved' | 'Closed' | null {
  return stage === 'done' ? null : deskResolution(deskStatus)
}

const toTime = (d: Date | string | null | undefined): number | null => {
  if (d === null || d === undefined || d === '') return null
  const t = (d instanceof Date ? d : new Date(d)).getTime()
  return Number.isNaN(t) ? null : t
}

/** Done within the last `DONE_VISIBLE_DAYS` (from `completed`, else `lastUpdated`). */
export function recentlyDone(
  doneAt: Date | string | null | undefined,
  lastUpdated: Date | string | null | undefined,
  now: Date,
): boolean {
  const at = toTime(doneAt) ?? toTime(lastUpdated)
  if (at === null) return false
  return now.getTime() - at < DONE_VISIBLE_DAYS * 24 * 3600 * 1000
}

/** `ABC-123` is Jira, any other id ServiceNow, no id null. */
export function inferSystem(ticketId: string | null | undefined): 'Jira' | 'ServiceNow' | null {
  const id = (ticketId ?? '').trim()
  if (!id) return null
  return /^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(id) ? 'Jira' : 'ServiceNow'
}

const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'] as const

/** "Moderate" reads as Medium; the four options by case; anything else unchanged. */
export function normalizeDeskPriority(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return null
  const key = text.trim().toLowerCase()
  if (key === 'moderate') return 'Medium'
  return PRIORITIES.find((p) => p.toLowerCase() === key) ?? text
}

/** The ticket's link: its own link, else the Jira browse page, else null. */
export function ticketUrl(
  system: string | null | undefined,
  ticketId: string | null | undefined,
  link: string | null | undefined,
  jiraSite: string | null | undefined,
): string | null {
  if (link) return link
  const id = (ticketId ?? '').trim()
  if (system === 'Jira' && jiraSite && id) return `${jiraSite.replace(/\/+$/, '')}/browse/${id}`
  return null
}

/** The Done option of a status property: "Done" (Task), "Completed" (Project), else null. */
export function doneOption(statusDef: StatusDefLike | null | undefined): string | null {
  const set = statusDef?.options.set ?? []
  const byText = set.find((o) => ['done', 'completed'].includes(fold(o.text)))
  if (byText) return byText.text
  return set.find((o) => o.statusCategory === 'done')?.text ?? null
}

/** What `role` may do on step `index` now, in the actions' order. */
export function allowedActions(steps: readonly RuleStep[], index: number, role: WorkRole): StepAction[] {
  if (index < 0 || index >= steps.length) return []
  return ACTIONS.filter((a) => refusal(steps, index, a, role) === null)
}

// -- writes (optimistic UI; the server decides) -------------------------------------------

export interface ActionOptions {
  now: Date
  text?: string | null
  notBefore?: string | null
  ask?: string | null
  newId?: (taken: Set<string>) => string
}

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789'
function randomId(taken: Set<string>): string {
  for (;;) {
    let id = ''
    const bytes = new Uint8Array(6)
    crypto.getRandomValues(bytes)
    for (const b of bytes) id += ID_CHARS[b % ID_CHARS.length]
    if (!taken.has(id)) return id
  }
}

/** The steps after `action` on step `index`; throws `IllegalMoveError` with the server's message. */
export function applyAction(
  steps: readonly RuleStep[],
  index: number,
  action: StepAction,
  role: WorkRole,
  { now, text, notBefore, ask, newId = randomId }: ActionOptions,
): RuleStep[] {
  if (index < 0 || index >= steps.length) throw new IllegalMoveError(MSG_NOT_CURRENT)
  const reason = refusal(steps, index, action, role)
  if (reason !== null) throw new IllegalMoveError(reason)
  const said = (text ?? '').trim()
  if (action === 'answer' && !said) throw new IllegalMoveError(MSG_ANSWER_TEXT)
  if ((action === 'complete' || action === 'fail') && !said) throw new IllegalMoveError(MSG_SAY_WHAT)
  const step = steps[index]
  if (notBefore && step.kind !== 'approve') throw new IllegalMoveError(MSG_NOT_BEFORE)

  const at = now.toISOString()
  const next: RuleStep = { ...step }
  const out = steps.map((s) => ({ ...s }))
  switch (action) {
    case 'answer':
      Object.assign(next, { state: 'done', answer: said, doneAt: at })
      break
    case 'done':
      Object.assign(next, { state: 'done', doneAt: at })
      if (step.kind === 'agent' && said) next.result = said
      break
    case 'approve':
      Object.assign(next, { state: 'approved', approvedAt: at, notBefore: notBefore || null })
      break
    case 'decline':
      Object.assign(next, { state: 'declined', declinedAt: at })
      break
    case 'run':
      Object.assign(next, { state: 'approved', approvedAt: at })
      break
    case 'reopen':
      Object.assign(next, { state: 'open', approvedAt: null, doneAt: null, declinedAt: null, notBefore: null })
      break
    case 'complete':
      Object.assign(next, { state: 'done', result: said, doneAt: at })
      break
    case 'fail':
      Object.assign(next, { state: 'open', result: said, approvedAt: null, notBefore: null })
      break
  }
  out[index] = next
  const question = (ask ?? '').trim()
  if (action === 'fail' && question) {
    const taken = new Set(steps.map((s) => s.id).filter((id): id is string => typeof id === 'string'))
    out.splice(index, 0, { id: newId(taken), kind: 'question', state: 'open', text: question, addedAt: at })
  }
  return out
}
