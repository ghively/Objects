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

const LINES: Record<string, Piece[]> = {
  // Object's tools (short names)
  search: ['Searched notes', c(" for '", 'query', "'")],
  query: ['Queried notes'],
  run_saved_query: ['Ran a saved query'],
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

function baseLine(step: ToolStepState): string {
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

/** The step's one line (the table in the M16 plan): failed and stopped steps get a suffix. */
export function toolStepLine(step: ToolStepState): string {
  const line = baseLine(step)
  if (step.done && step.isError) return line + TOOL_STEP_TEXT.failed
  if (!step.done && step.stopped) return line + TOOL_STEP_TEXT.stopped
  return line
}
