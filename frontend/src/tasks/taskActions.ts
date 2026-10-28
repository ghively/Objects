// What the task UI does to a task: one `updateProperties` call for the status (the server's status
// hook completes, reopens or advances it), then one `api.rows` reload, because the returned
// frontmatter is raw and can't patch a decoded `Row`. A 409 reloads only, never retries.
import { api as realApi, ConflictError, type Api } from '@/api/client'
import type { DateValue, Row, TaskResult, TypeDef } from '@/api/types'
import { zonedParts, zonedToday } from '@/lib/zonedTime'
import { parseRepeat } from './repeat'
import { firstOptionOf, isOpen, statusDef } from './statusCategory'
import { taskClient, type CatchUp, type OccurrenceAction, type TaskClient } from './taskContract'

export type TaskApi = Pick<Api, 'updateProperties' | 'rows'> & Partial<Pick<TaskClient, 'overdue' | 'occurrence'>>

/** The real calls (read at call time, so a mocked `api` module is used in tests). */
export const DEFAULT_TASK_API: TaskApi = {
  updateProperties: (...a) => realApi.updateProperties(...a),
  rows: (...a) => realApi.rows(...a),
  overdue: (path) => taskClient.overdue(path),
  occurrence: (path, action, opts) => taskClient.occurrence(path, action, opts),
}

export interface TaskOutcome {
  /** The status hook's answer; undefined when nothing was written or the hook didn't run. */
  result: TaskResult | undefined
  /** The reloaded row (the owner patches its list with it); undefined if the reload failed. */
  row: Row | undefined
  /** The write hit a 409: nothing was written and the row was reloaded. */
  conflict: boolean
  /** The write failed for another reason (the message to show). */
  error?: string
}

async function reload(api: TaskApi, path: string): Promise<Row | undefined> {
  try {
    const [fresh] = await api.rows({ paths: [path] })
    return fresh
  } catch (err) {
    console.warn('Could not reload row:', err)
    return undefined
  }
}

/** Set the task's status to the option `optionText`: one write with the row's version, one reload. */
export async function setStatus(api: TaskApi, row: Row, type: TypeDef | undefined, optionText: string): Promise<TaskOutcome> {
  const path = row.summary.path
  const key = statusDef(type)?.key ?? 'status'
  try {
    const res = await api.updateProperties(path, { [key]: [optionText] }, row.version)
    return { result: res.task ?? undefined, row: await reload(api, path), conflict: false }
  } catch (err) {
    if (err instanceof ConflictError) return { result: undefined, row: await reload(api, path), conflict: true }
    return { result: undefined, row: undefined, conflict: false, error: err instanceof Error ? err.message : 'Could not save.' }
  }
}

/** The checkbox: an open task goes to the first done option, a done one to the first not-started option. */
export async function toggleDone(api: TaskApi, row: Row, type: TypeDef | undefined): Promise<TaskOutcome> {
  const target = firstOptionOf(type, isOpen(row, type) ? 'done' : 'not-started')
  if (!target) return { result: undefined, row: undefined, conflict: false, error: 'This type has no status for that.' }
  return setStatus(api, row, type, target.text)
}

/**
 * Skip, Excuse, or a catch-up choice (M8): one `POST /api/tasks/occurrence` with the row's
 * version (the server logs the line and moves the date), then one reload. A 409 reloads only.
 */
export async function occurrenceAction(
  api: TaskApi,
  row: Row,
  action: OccurrenceAction,
  catchUp?: CatchUp,
): Promise<TaskOutcome> {
  const path = row.summary.path
  if (!api.occurrence) return { result: undefined, row: undefined, conflict: false, error: 'Not available yet' }
  try {
    const res = await api.occurrence(path, action, catchUp ? { catchUp, baseVersion: row.version } : { baseVersion: row.version })
    return { result: res.task ?? undefined, row: await reload(api, path), conflict: false }
  } catch (err) {
    if (err instanceof ConflictError) return { result: undefined, row: await reload(api, path), conflict: true }
    return { result: undefined, row: undefined, conflict: false, error: err instanceof Error ? err.message : 'Could not save.' }
  }
}

/** The task's recurrence rule (`repeat`), or null. */
export const repeatOf = (row: Row) => parseRepeat(row.values.repeat)

/**
 * A recurring task by due date whose date is before today (it may have missed occurrences). Both
 * days are in the Time zone setting (`lib/zonedTime`), as the server's overdue count is: a day
 * date is its own day, a time date is its instant's day in that zone. `now` is for tests.
 */
export function maybeOverdue(row: Row, now?: Date): boolean {
  const rule = repeatOf(row)
  const date = row.values.date as DateValue | null | undefined
  if (!rule || rule.mode !== 'dueDate' || !date?.start) return false
  const day = zonedDayOf(date.start)
  const today = now ? zonedParts(now).date : zonedToday()
  return !!day && day < today
}

/** A date start's day in the Time zone setting: `YYYY-MM-DD` as is, an instant's zoned day; else null. */
function zonedDayOf(start: string): string | null {
  if (DAY_ONLY.test(start)) return start
  const d = new Date(start)
  return Number.isNaN(d.getTime()) ? null : zonedParts(d).date
}

const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/

/** A date value as a short day (`2026-10-28`; a time date adds its local `HH:mm`). */
export function shortDate(v: DateValue | null | undefined): string {
  if (!v?.start) return ''
  if (v.resolution === 'day' || /^\d{4}-\d{2}-\d{2}$/.test(v.start)) return v.start.slice(0, 10)
  const d = new Date(v.start)
  if (Number.isNaN(d.getTime())) return v.start
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * The message an owner shows after a status write, or null: "Moved to {date}" (our string) after a
 * recurring advance, "Changed elsewhere. Reloaded." (our string, as M3) after a 409, or the error.
 */
export function completionToast(outcome: TaskOutcome): string | null {
  if (outcome.conflict) return 'Changed elsewhere. Reloaded.'
  if (outcome.error) return outcome.error
  if (outcome.result?.advanced) return `Moved to ${shortDate(outcome.result.date)}`.trim()
  return null
}
