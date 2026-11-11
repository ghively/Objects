// M16: tool steps (spec section 10). Pure helpers: the chat's parts in stream order (texts and
// tool steps, merged by the `tool` events' id) and each step's one-line summary (our strings).
import type { AiEvent } from '@/api/types'

export interface ToolStepState {
  id: string
  name: string
  input: Record<string, unknown> | null
  result: string | null
  isError: boolean
  done: boolean
  stopped?: boolean
}

export type ChatPart = { kind: 'text'; text: string } | { kind: 'tool'; step: ToolStepState }

/** Our strings. `failed` and `stopped` are the suffixes the line gets. */
export const TOOL_STEP_TEXT = {
  input: 'Input',
  result: 'Result',
  running: 'Running…',
  failed: ' (failed)',
  stopped: ' (stopped)',
  // A refused call says so and why (fix pass H), instead of a past-tense line with "(failed)".
  refused: (action: string, reason: string) => `Not allowed to ${action} (${reason})`,
  refusedLine: (line: string, reason: string) => `${line} (refused: ${reason})`,
  toolOff: 'this agent has the tool switched off',
  pathDenied: 'the file is outside what this agent may read',
  noResult: 'No result',
} as const

/**
 * Folds one stream event into the parts: a text is appended to a trailing text part (else a new
 * one); a tool call (no result) is a new step; a tool result fills the step with that id (an
 * unknown id leaves the parts unchanged). Other events change nothing. Never mutates `parts`.
 */
export function applyEvent(parts: ChatPart[], e: AiEvent): ChatPart[] {
  if (e.type === 'text') {
    if (!e.text) return parts
    const last = parts[parts.length - 1]
    if (last?.kind === 'text') return [...parts.slice(0, -1), { kind: 'text', text: last.text + e.text }]
    return [...parts, { kind: 'text', text: e.text }]
  }
  if (e.type !== 'tool') return parts
  const at = parts.findIndex((p) => p.kind === 'tool' && p.step.id === e.id)
  if (e.result === undefined) {
    if (at !== -1) return parts // the call was announced already
    const step: ToolStepState = { id: e.id, name: e.name, input: e.input, result: null, isError: false, done: false }
    return [...parts, { kind: 'tool', step }]
  }
  if (at === -1) return parts
  const old = parts[at] as { kind: 'tool'; step: ToolStepState }
  const next = parts.slice()
  next[at] = { kind: 'tool', step: { ...old.step, result: e.result, isError: !!e.isError, done: true } }
  return next
}

/** Pending steps get `stopped: true` (the run was stopped before their result came). */
export function stopSteps(parts: ChatPart[]): ChatPart[] {
  return parts.map((p) => (p.kind === 'tool' && !p.step.done ? { kind: 'tool', step: { ...p.step, stopped: true } } : p))
}

const VALUE_CAP = 60
const ELLIPSIS = '…'

/** A line template: fixed text, and clauses that drop out when their input value is missing. */
type Clause = { key: string; pre: string; post: string; firstLine?: boolean }
type Piece = string | Clause

const c = (pre: string, key: string, post = '', firstLine = false): Clause => ({ key, pre, post, firstLine })

const EDITED: Piece[] = ['Edited', c(' ', 'path')]
const CREATED_NAME: Piece[] = ['Created', c(" '", 'name', "'")]
const EDITED_DEFINITION: Piece[] = ['Edited a definition']
const TRASHED_DEFINITION: Piece[] = ['Moved a definition to the Trash']
const HISTORY_OF: Piece[] = ['Looked at the history of', c(' ', 'path')]

const LINES: Record<string, Piece[]> = {
  // Object's tools (short names)
  search: ['Searched notes', c(" for '", 'query', "'")],
  query: ['Queried notes'],
  run_saved_query: ['Ran a saved search'],
  peek: ['Looked at', c(' ', 'path')],
  read: ['Read', c(' ', 'path')],
  backlinks: ['Found links to', c(' ', 'path')],
  daily_note: ['Opened the daily note', c(' for ', 'date')],
  changes_since: ['Checked recent changes'],
  schema: ["Read the space's types"],
  create_object: ['Created', c(" '", 'title', "'")],
  create_task: ['Created', c(" '", 'title', "'")],
  set_properties: EDITED,
  add_tags: EDITED,
  add_to_collection: EDITED,
  append_to_section: EDITED,
  replace_section: EDITED,
  rename: ['Renamed', c(' ', 'path'), c(" to '", 'title', "'")],
  move_to_trash: ['Moved', c(' ', 'path'), ' to the Trash'],
  // M17: the expanded Object tools and the agent tools (our strings, the M17 plan's table)
  write_body: EDITED,
  remove_tags: EDITED,
  remove_from_collection: EDITED,
  link_mention: EDITED,
  open_daily_note: ['Opened the daily note', c(' for ', 'date')],
  duplicate: ['Duplicated', c(' ', 'path')],
  change_type: ['Changed the type of', c(' ', 'path')],
  merge: ['Merged', c(' ', 'source'), c(' into ', 'target')],
  create_tag: CREATED_NAME,
  create_type: CREATED_NAME,
  create_collection: CREATED_NAME,
  create_query: CREATED_NAME,
  create_whiteboard: ['Created', c(" '", 'title', "'")],
  create_automation: CREATED_NAME,
  edit_type: EDITED_DEFINITION,
  edit_collection: EDITED_DEFINITION,
  edit_query: EDITED_DEFINITION,
  edit_whiteboard: EDITED_DEFINITION,
  change_property_kind: EDITED_DEFINITION,
  delete_type: TRASHED_DEFINITION,
  delete_collection: TRASHED_DEFINITION,
  delete_query: TRASHED_DEFINITION,
  type_definition: ["Read the space's types"],
  collection: ["Read the space's types"],
  saved_query: ["Read the space's types"],
  read_whiteboard: ['Read', c(' ', 'path')],
  version_history: HISTORY_OF,
  read_version: HISTORY_OF,
  restore_version: ['Restored a version of', c(' ', 'path')],
  unlinked_mentions: ['Found mentions of', c(' ', 'path')],
  trash: ['Looked in the Trash'],
  restore_from_trash: ['Restored from the Trash'],
  automations: ['Listed automations'],
  run_automation: ['Ran an automation'],
  import_preview: ['Previewed an import'],
  start_import: ['Started an import'],
  import_status: ['Checked an import'],
  agent_info: ['Looked up this agent'],
  // M20: the A2A and delegation tools (our strings, the M20 plan's table)
  remote_agents_list: ['Listed remote agents'],
  remote_agent_call: ['Asked', c(' ', 'agent')],
  delegate: ['Handed a task to', c(' ', 'agent')],
  // Claude Code's built-ins
  Read: ['Read', c(' ', 'file_path')],
  Write: ['Wrote', c(' ', 'file_path')],
  Edit: ['Edited', c(' ', 'file_path')],
  NotebookEdit: ['Edited', c(' ', 'notebook_path')],
  Glob: ['Listed files matching', c(" '", 'pattern', "'")],
  Grep: ['Searched files for', c(" '", 'pattern', "'")],
  WebSearch: ['Searched the web for', c(" '", 'query', "'")],
  WebFetch: ['Fetched', c(' ', 'url')],
  Bash: ['Ran', c(' ', 'command', '', true)],
  PowerShell: ['Ran', c(' ', 'command', '', true)],
  Task: ['Ran a subagent'],
  Agent: ['Ran a subagent'],
}

function cut(s: string): string {
  return s.length > VALUE_CAP ? s.slice(0, VALUE_CAP) + ELLIPSIS : s
}

function valueOf(input: Record<string, unknown> | null, clause: Clause): string | null {
  const v = input?.[clause.key]
  if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') return null
  let s = String(v)
  if (clause.firstLine) s = s.split(/\r?\n/, 1)[0].trim()
  return s ? cut(s) : null
}

const str = (input: Record<string, unknown> | null, key: string): string | null => {
  const v = input?.[key]
  return typeof v === 'string' && v ? cut(v) : null
}
const quoted = (head: string, v: string | null): string => (v ? `${head} '${v}'` : head)

/** M18: the learning tools' lines (our strings, the M18 plan's table), and M21's `schedule_manage`: they depend on the action. */
const LEARNING_LINES: Record<string, (input: Record<string, unknown> | null) => string> = {
  memory: (input) => {
    const action = input?.action
    const verb = action === 'replace' ? 'Changed a memory' : action === 'remove' ? 'Removed a memory' : 'Saved a memory'
    return input?.target === 'user' ? `${verb} about you` : verb
  },
  skills_list: () => 'Listed skills',
  skill_view: (input) => quoted('Read the skill', str(input, 'name')),
  skill_manage: (input) => {
    const action = input?.action
    const head = action === 'create' ? 'Created the skill' : action === 'archive' ? 'Archived the skill' : 'Updated the skill'
    return quoted(head, str(input, 'name'))
  },
  session_search: (input) => {
    const query = str(input, 'query')
    if (query) return `Searched past chats for '${query}'`
    return input?.chat_id ? 'Read a past chat' : 'Searched past chats'
  },
  // The CLI's own Skill tool
  Skill: (input) => quoted('Used the skill', str(input, 'skill')),
  // M21: the agent's schedules tool (our strings, the M21 plan's table), beside M20's `delegate`
  schedule_manage: (input) => {
    const action = input?.action
    if (action === 'create') return quoted('Created the schedule', str(input, 'name'))
    if (action === 'update') return 'Changed a schedule'
    if (action === 'delete') return 'Moved a schedule to the Trash'
    return 'Listed schedules'
  },
}

function baseLine(step: ToolStepState): string {
  const learning = LEARNING_LINES[step.name.replace(/^mcp__object-agent__/, '')]
  if (learning) return learning(step.input)
  const pieces = LINES[step.name]
  if (pieces) {
    return pieces
      .map((p) => {
        if (typeof p === 'string') return p
        const v = valueOf(step.input, p)
        return v === null ? '' : p.pre + v + p.post
      })
      .join('')
  }
  const mcp = /^mcp__(.+?)__(.+)$/.exec(step.name)
  if (mcp) return `Used ${mcp[2]} (${mcp[1]})`
  return `Used ${step.name}`
}

// The leading past-tense verbs of the lines, as the action a refusal names ("Created 'X'" -> "create 'X'").
const INFINITIVE: Record<string, string> = {
  Created: 'create', Edited: 'edit', Moved: 'move', Renamed: 'rename', Deleted: 'delete', Added: 'add', Updated: 'update',
  Handed: 'hand', Used: 'use', Read: 'read', Searched: 'search', Looked: 'look', Ran: 'run', Queried: 'query', Found: 'find',
  Wrote: 'write', Saved: 'save', Changed: 'change', Marked: 'mark', Completed: 'complete', Scheduled: 'schedule',
  Called: 'call', Listed: 'list', Opened: 'open', Restored: 'restore', Removed: 'remove', Appended: 'append',
  Replaced: 'replace', Set: 'set', Made: 'make', Sent: 'send', Asked: 'ask', Turned: 'turn', Linked: 'link', Filed: 'file',
}

/** Why a failed call was refused (the CLI's permission answers), or null when it is an ordinary error. */
export function refusalReason(result: string | null): string | null {
  if (!result) return null
  if (/permission to use .+ (?:has been )?denied|haven't granted/i.test(result)) return TOOL_STEP_TEXT.toolOff
  if (/denied by your permission settings|directory that is denied/i.test(result)) return TOOL_STEP_TEXT.pathDenied
  if (/\b(?:refused|not allowed|blocked)\b/i.test(result)) {
    const first = result.trim().split('\n')[0].replace(/\.$/, '')
    return first.length > VALUE_CAP ? first.slice(0, VALUE_CAP - 1) + ELLIPSIS : first
  }
  return null
}

/** The step's one line (the table in the M16 plan): failed and stopped steps get a suffix; a refused one says why. */
export function toolStepLine(step: ToolStepState): string {
  const line = baseLine(step)
  const reason = step.done && step.isError ? refusalReason(step.result) : null
  if (reason) {
    const [verb, ...rest] = line.split(' ')
    const inf = INFINITIVE[verb]
    return inf ? TOOL_STEP_TEXT.refused([inf, ...rest].join(' '), reason) : TOOL_STEP_TEXT.refusedLine(line, reason)
  }
  if (step.done && step.isError) return line + TOOL_STEP_TEXT.failed
  if (!step.done && step.stopped) return line + TOOL_STEP_TEXT.stopped
  return line
}
