// M14 automation rules on the client: defaults, the one-line summaries Settings > Automations
// shows ("When a Task is created", "Ran 5 minutes ago"), the scope's properties, and the checks
// the rule editor makes before it saves (the server checks again and names any problem in a 422).
// Every string here is ours (contract "Settings > Automations" and "Rule editor").
import { typeLabel } from '@/lib/typeLabel'
import type {
  AutomationAction,
  AutomationActionKind,
  AutomationRule,
  AutomationRuleInput,
  AutomationRun,
  AutomationScope,
  AutomationTrigger,
  AutomationTriggerKind,
  Collection,
  Filter,
  FilterGroup,
  PropertyDef,
  PropertyType,
  ScheduleTrigger,
  TypeDef,
} from '@/api/types'
import { OBJECT_ACTION_KINDS } from '@/api/types'
import { isSynced } from '@/properties/synced'
import { onLabel } from '@/tasks/CustomRepeatDialog'
import { localDayOf, parseRepeat, stepAfter, weekdayName, weekdayOf, type RepeatRule } from '@/tasks/repeat'
import { filterOptionsFor } from '@/views/filter'
import { propertyChoices, type PropChoice } from '@/views/properties'

/** A rule's editable fields (what `POST /api/automations` takes), plus any unknown keys it had. */
export type RuleFields = AutomationRuleInput

export const RULE_TEXT = {
  triggers: {
    objectCreated: 'A note is created',
    propertyChanged: 'A property changes',
    schedule: 'On a schedule',
    button: 'A button is pressed',
  } satisfies Record<AutomationTriggerKind, string>,
  actions: {
    setProperty: 'Set a property',
    clearProperty: 'Clear a property',
    addTag: 'Add a tag',
    removeTag: 'Remove a tag',
    addToCollection: 'Add to a collection',
    removeFromCollection: 'Remove from a collection',
    createFromTemplate: 'Create a note',
    appendToDailyNote: 'Add to the daily note',
    notify: 'Send a notification',
    // M21: an agent schedule's one action; only here so the record stays exhaustive (never offered).
    runAgent: 'Run an agent',
  } satisfies Record<AutomationActionKind, string>,
  whenPressed: 'When pressed',
  never: 'Never ran',
  needName: 'Give the automation a name.',
  needAction: 'Add at least one action.',
  needScope: 'Choose a type or collection.',
  needProperty: 'Choose a property.',
  needRepeat: 'Choose how often it repeats.',
  needTime: 'Enter a time.',
  needStart: 'Choose a start date.',
  needActionField: (n: number) => `Action ${n} isn't finished.`,
  needDate: 'Pick a date or tick Now.',
  repeatsTemplate: (name: string) => `Repeats template “${name}”`,
  repeatName: (name: string) => `Repeat “${name}”`,
  // M21 (our strings)
  runsAgent: (name: string) => `Runs “${name}”`,
  runsMissingAgent: "Runs an agent that isn't listed",
} as const

/** The nine action kinds in the "+ Add action" menu's order (the object ones first). M21's
 * `runAgent` is never here: agent schedules are made on the agent page. */
export const ACTION_KINDS: readonly AutomationActionKind[] = [
  'setProperty',
  'clearProperty',
  'addTag',
  'removeTag',
  'addToCollection',
  'removeFromCollection',
  'createFromTemplate',
  'appendToDailyNote',
  'notify',
]

export const isObjectAction = (kind: AutomationActionKind): boolean => OBJECT_ACTION_KINDS.includes(kind)

/** The action kinds a trigger offers: no object edits on a schedule. */
export function actionKindsFor(trigger: AutomationTriggerKind): AutomationActionKind[] {
  return ACTION_KINDS.filter((k) => trigger !== 'schedule' || !isObjectAction(k))
}

export const emptyConditions = (): FilterGroup => ({ type: 'filterGroup', operator: 'and', elements: [] })

/** Keys a trigger can't watch (contract "Triggers"). */
const UNWATCHABLE = new Set(['type', 'createdAt', 'lastUpdated', 'backlinks'])
const UNWATCHABLE_KINDS = new Set<PropertyType>(['entity_type', 'entity_createdAt', 'entity_lastUpdated', 'entity_backlinks', 'button'])
/** Kinds `setProperty`/`clearProperty` refuse (title changes are a rename). */
const READ_ONLY_KINDS = new Set<PropertyType>([
  'entity_title',
  'entity_type',
  'entity_createdAt',
  'entity_lastUpdated',
  'entity_backlinks',
  'button',
])

/** The types a scope covers: one type, a collection's types, or (null) every type. */
export function scopeTypes(scope: AutomationScope | null, types: readonly TypeDef[], collections: readonly Collection[]): TypeDef[] {
  if (!scope) return [...types]
  if (scope.kind === 'type') return types.filter((t) => t.id === scope.id)
  const col = collections.find((c) => c.id === scope.id)
  return col ? types.filter((t) => col.typeIds.includes(t.id)) : []
}

/** The name of a scope ("Task", "Reading list"), or its id when it no longer exists. */
export function scopeName(scope: AutomationScope, types: readonly TypeDef[], collections: readonly Collection[]): string {
  if (scope.kind === 'type') return typeLabel(types.find((t) => t.id === scope.id), scope.id)
  return collections.find((c) => c.id === scope.id)?.name ?? scope.id
}

/**
 * The properties a scope's objects have (the union over its types, then the system ones). M28: not
 * the computed other sides (`options.counterpartOf`): the server's automation filter has none, so a
 * condition on one would be dropped and a trigger on one would never fire.
 */
export function scopeChoices(scope: AutomationScope | null, types: readonly TypeDef[], collections: readonly Collection[]): PropChoice[] {
  return propertyChoices(scopeTypes(scope, types, collections).map((t) => ({ ...t, counterparts: [] }))).filter(
    (c) => !c.def.options?.counterpartOf,
  )
}

/** The properties a "property changes" trigger can watch. M29: not a synced one (a sync fires no trigger). */
export function watchableChoices(choices: readonly PropChoice[]): PropChoice[] {
  return choices.filter((c) => !UNWATCHABLE.has(c.key) && !UNWATCHABLE_KINDS.has(c.kind) && !isSynced(c.def))
}

/** The properties "Set a property" and "Clear a property" can write. M29: not a synced one (only its source fills it). */
export function writableDefs(scopeTypeList: readonly TypeDef[]): PropertyDef[] {
  const seen = new Set<string>()
  const out: PropertyDef[] = []
  for (const t of scopeTypeList)
    for (const d of t.propertyDefinitions) {
      if (seen.has(d.key) || READ_ONLY_KINDS.has(d.type) || isSynced(d)) continue
      seen.add(d.key)
      out.push(d)
    }
  return out
}

/** Date kinds, which offer "Now". */
export const isDateKind = (kind: PropertyType | undefined): boolean => kind === 'datetime' || kind === 'datetimeSimple'

/**
 * A "Set a property" on a date with "Now" unticked and no date: it would write the date empty
 * (`completed: null`), so the editor refuses to save it. A saved rule like this keeps running as it is.
 */
export function missingDate(action: AutomationAction, defs: readonly PropertyDef[]): boolean {
  if (action.kind !== 'setProperty' || action.now) return false
  if (action.value !== null && action.value !== undefined && action.value !== '') return false
  return isDateKind(defs.find((d) => d.key === action.key)?.type)
}

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/**
 * A schedule's default start: the first day on or after `today` that `repeat` reaches (an `on`
 * pattern or "every weekday"), else `today` itself.
 */
export function defaultStart(repeat: string, today: string): string {
  const rule = parseRepeat(repeat)
  const t = localDayOf(today)
  if (!rule || !t) return today
  if (!rule.on && rule.unit !== 'weekday') return today
  const yesterday = ymd(new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1))
  return stepAfter({ ...rule, until: undefined }, yesterday) ?? today
}

/** A new rule's fields; `partial` overrides. */
export function newRuleInput(partial: Partial<RuleFields> = {}): RuleFields {
  return {
    name: '',
    description: '',
    enabled: true,
    trigger: { kind: 'button', scope: null },
    conditions: emptyConditions(),
    actions: [],
    templateRepeat: null,
    ...partial,
  }
}

/** The rule's editable fields (API-only keys dropped; unknown keys kept). */
export function ruleInputOf(rule: AutomationRule): RuleFields {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { schemaVersion, id, createdAt, revision, readOnlyReason, lastRun, ...rest } = rule
  return rest
}

/** A fresh trigger of `kind`, keeping the scope where the new kind has one. */
export function triggerOfKind(kind: AutomationTriggerKind, from: AutomationTrigger, fallbackScope: AutomationScope | null, today: string): AutomationTrigger {
  const scope = 'scope' in from && from.scope ? from.scope : fallbackScope
  switch (kind) {
    case 'objectCreated':
      return { kind, scope: scope ?? { kind: 'type', id: '' } }
    case 'propertyChanged':
      return { kind, scope: scope ?? { kind: 'type', id: '' }, propertyKey: '', to: null }
    case 'schedule': {
      const repeat = 'every week on mon'
      return { kind, repeat, time: '09:00', start: defaultStart(repeat, today) }
    }
    case 'button':
      return { kind, scope: 'scope' in from ? from.scope : null }
  }
}

/** A fresh action of `kind`. */
export function newAction(kind: AutomationActionKind): AutomationAction {
  switch (kind) {
    case 'setProperty':
      return { kind, key: '', value: null }
    case 'clearProperty':
      return { kind, key: '' }
    case 'addTag':
    case 'removeTag':
      return { kind, tagId: '' }
    case 'addToCollection':
    case 'removeFromCollection':
      return { kind, collectionId: '' }
    case 'createFromTemplate':
      return { kind, typeId: '', templateId: null, title: '', relateVia: null }
    case 'appendToDailyNote':
      return { kind, text: '' }
    case 'notify':
      return { kind, title: '', body: '' }
    case 'runAgent':
      // M21: never offered; only keeps the switch exhaustive.
      return { kind, agentId: 'assistant', prompt: '', model: null }
  }
}

// ---- M21: agent schedules (a schedule rule whose one action is runAgent) ----

/** Whether the rule is an agent schedule: its one action is `runAgent`. */
export const isAgentSchedule = (r: Pick<AutomationRule, 'actions'>): boolean =>
  r.actions.length === 1 && r.actions[0].kind === 'runAgent'

/** A new agent schedule's fields: one `runAgent` action, no conditions, no template repeat. */
export function agentScheduleInput(
  agentId: string,
  name: string,
  prompt: string,
  trigger: ScheduleTrigger,
  model: string | null,
  enabled = true,
): RuleFields {
  return newRuleInput({ name, enabled, trigger, actions: [{ kind: 'runAgent', agentId, prompt, model }] })
}

/** The agent's schedules among `rules`, by name (ignoring case), then id. */
export function schedulesOf(rules: readonly AutomationRule[], agentId: string): AutomationRule[] {
  const key = (r: AutomationRule) => r.name.toLowerCase()
  return rules
    .filter((r) => isAgentSchedule(r) && r.actions[0].kind === 'runAgent' && r.actions[0].agentId === agentId)
    .sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

// ---- Summaries ----

/** "a Task" / "an Idea". */
function article(name: string): string {
  return /^[aeiou]/i.test(name) ? `an ${name}` : `a ${name}`
}

/** `HH:mm` as the device shows times: unchanged in 24-hour, `9:00 AM` in 12-hour. */
export function showTime(time: string, twentyFourHour: boolean): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time)
  if (!m || twentyFourHour) return time
  const h = Number(m[1])
  return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`
}

function joinNames(names: string[], word = 'and'): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} ${word} ${names[names.length - 1]}`
}

const UNIT: Record<RepeatRule['unit'], [string, string]> = {
  day: ['day', 'days'],
  week: ['week', 'weeks'],
  month: ['month', 'months'],
  year: ['year', 'years'],
  weekday: ['weekday', 'weekdays'],
}

/** "Every week on Monday", "Every 2 months on the 15th", "Every weekday" (no time). */
export function repeatText(repeat: string, start: string): string {
  const rule = parseRepeat(repeat)
  if (!rule) return repeat
  if (rule.unit === 'weekday') return 'Every weekday'
  const [one, many] = UNIT[rule.unit]
  let out = rule.every === 1 ? `Every ${one}` : `Every ${rule.every} ${many}`
  const day = localDayOf(start)
  if (rule.on && 'weekdays' in rule.on && rule.on.weekdays?.length) out += ` on ${joinNames(rule.on.weekdays.map(weekdayName))}`
  else if (rule.on && rule.unit !== 'week' && rule.unit !== 'day') {
    const label = onLabel(rule.on)
    out += ` on ${/^The /.test(label) ? label.replace(/^The /, 'the ') : /^Last /.test(label) ? `the ${label.toLowerCase()}` : label}`
  } else if (rule.unit === 'week' && day) out += ` on ${weekdayName(weekdayOf(day))}`
  if (rule.until) out += ` until ${rule.until}`
  return out
}

/** The value a "changes to" filter names, in words ("Done", "Done or Doing", "3"). */
function filterValueText(filter: Filter, choice: PropChoice | undefined, types: readonly TypeDef[], collections: readonly Collection[]): string {
  const ref = filter.referenceValue
  if (Array.isArray(ref)) {
    const names = (ref as string[]).map((id) => {
      if (choice?.kind === 'label') return choice.def.options?.set?.find((o) => o.id === id)?.text ?? id
      if (choice?.kind === 'entity_type') return typeLabel(types.find((t) => t.id === id), id)
      if (choice?.kind === 'entity_collections') return collections.find((c) => c.id === id)?.name ?? id
      return id
    })
    return joinNames(names, 'or')
  }
  if (ref && typeof ref === 'object') {
    const r = ref as { relative?: string; exactDate?: string }
    return r.exactDate ?? r.relative ?? ''
  }
  return ref === undefined || ref === null ? '' : String(ref)
}

/** "to Done", "to ≥ 3", "to selected": the words after "changes". */
function toText(filter: Filter, choice: PropChoice | undefined, types: readonly TypeDef[], collections: readonly Collection[]): string {
  const op = choice ? filterOptionsFor(choice.def).find((o) => o.key === filter.option) : undefined
  const value = filterValueText(filter, choice, types, collections)
  const plain = ['contains', 'is', 'equal'].includes(filter.option)
  const words = plain ? value : [op?.label.replace(/^is /, '') ?? filter.option, value].filter(Boolean).join(' ')
  return words ? `to ${words}` : ''
}

export interface SummaryContext {
  types: readonly TypeDef[]
  collections: readonly Collection[]
  twentyFourHour: boolean
}

/** One line for a rule's trigger, as Settings > Automations lists it. */
export function triggerSummary(trigger: AutomationTrigger, ctx: SummaryContext): string {
  switch (trigger.kind) {
    case 'objectCreated': {
      if (trigger.scope.kind === 'collection')
        return `When a note is added to ${scopeName(trigger.scope, ctx.types, ctx.collections)}`
      return `When ${article(scopeName(trigger.scope, ctx.types, ctx.collections))} is created`
    }
    case 'propertyChanged': {
      const choices = scopeChoices(trigger.scope, ctx.types, ctx.collections)
      const choice = choices.find((c) => c.key === trigger.propertyKey)
      const name = choice?.name ?? trigger.propertyKey
      const to = trigger.to ? toText(trigger.to, choice, ctx.types, ctx.collections) : ''
      return to ? `When ${name} changes ${to}` : `When ${name} changes`
    }
    case 'schedule':
      return `${repeatText(trigger.repeat, trigger.start)} at ${showTime(trigger.time, ctx.twentyFourHour)}`
    case 'button':
      return RULE_TEXT.whenPressed
  }
}

/** "5 minutes ago", "just now", "3 days ago". */
export function ago(at: string, now: Date): string {
  const t = new Date(at).getTime()
  if (Number.isNaN(t)) return at
  const s = Math.max(0, Math.round((now.getTime() - t) / 1000))
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'} ago`
  if (s < 60) return 'just now'
  if (s < 3600) return unit(Math.floor(s / 60), 'minute')
  if (s < 86400) return unit(Math.floor(s / 3600), 'hour')
  if (s < 86400 * 30) return unit(Math.floor(s / 86400), 'day')
  if (s < 86400 * 365) return unit(Math.floor(s / (86400 * 30)), 'month')
  return unit(Math.floor(s / (86400 * 365)), 'year')
}

/** The first failure a run reports (its own error, else an action's detail). */
export function runFailure(run: AutomationRun): string | null {
  if (run.error) return run.error
  return run.actions.find((a) => a.status === 'failed' && a.detail)?.detail ?? null
}

/** "Ran 5 minutes ago", "Failed 2 hours ago: <error>", "Skipped …", "Never ran". */
export function lastRunText(run: AutomationRun | null, now: Date): string {
  if (!run) return RULE_TEXT.never
  const when = ago(run.at, now)
  if (run.status === 'failed') {
    const why = runFailure(run)
    return why ? `Failed ${when}: ${why}` : `Failed ${when}`
  }
  if (run.status === 'skipped') return `Skipped ${when}`
  return `Ran ${when}`
}

// ---- Checks before saving ----

/** The first thing the editor must ask for before saving, or null when the rule can be sent. */
export function ruleProblem(rule: RuleFields): string | null {
  if (!rule.name.trim()) return RULE_TEXT.needName
  const t = rule.trigger
  if ((t.kind === 'objectCreated' || t.kind === 'propertyChanged') && !t.scope.id) return RULE_TEXT.needScope
  if (t.kind === 'button' && t.scope && !t.scope.id) return RULE_TEXT.needScope
  if (t.kind === 'propertyChanged' && !t.propertyKey) return RULE_TEXT.needProperty
  if (t.kind === 'schedule') {
    if (!parseRepeat(t.repeat)) return RULE_TEXT.needRepeat
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t.time)) return RULE_TEXT.needTime
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t.start)) return RULE_TEXT.needStart
  }
  if (rule.actions.length === 0) return RULE_TEXT.needAction
  for (let i = 0; i < rule.actions.length; i++) if (!actionComplete(rule.actions[i])) return RULE_TEXT.needActionField(i + 1)
  return null
}

function actionComplete(a: AutomationAction): boolean {
  switch (a.kind) {
    case 'setProperty':
    case 'clearProperty':
      return !!a.key
    case 'addTag':
    case 'removeTag':
      return !!a.tagId
    case 'addToCollection':
    case 'removeFromCollection':
      return !!a.collectionId
    case 'createFromTemplate':
      return !!a.typeId
    case 'appendToDailyNote':
      return a.text.trim() !== ''
    case 'notify':
      return true
    case 'runAgent':
      return a.prompt.trim() !== ''
  }
}

/** The rule as it is sent: a schedule has no conditions and no object actions; a name is collapsed. */
export function cleanRule(rule: RuleFields): RuleFields {
  const out: RuleFields = { ...rule, name: rule.name.replace(/\s+/g, ' ').trim() }
  if (rule.trigger.kind === 'schedule') {
    out.conditions = emptyConditions()
    out.actions = rule.actions.filter((a) => !isObjectAction(a.kind))
  }
  out.actions = out.actions.map((a) => (a.kind === 'setProperty' && a.now ? { ...a, value: null } : a))
  return out
}

/** A 24-hour `HH:mm` from what a time field holds (`9:30`, `9:30 pm`, `21:30`), or null. */
export function parseTime(text: string): string | null {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?\s*$/i.exec(text)
  if (!m) return null
  let h = Number(m[1])
  const min = Number(m[2] ?? '0')
  const ap = m[3]?.toLowerCase()
  if (min > 59) return null
  if (ap) {
    if (h < 1 || h > 12) return null
    if (ap.startsWith('p') && h < 12) h += 12
    if (ap.startsWith('a') && h === 12) h = 0
  } else if (h > 23) return null
  return `${pad(h)}:${pad(min)}`
}
