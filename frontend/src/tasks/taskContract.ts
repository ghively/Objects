// The M8 task contract (the plan's "API contract (M8)") as the task UI uses it, with the client
// calls it needs. Task 3 owns `api/types.ts` and `api/client.ts` and adds the same types and
// `api.overdue`, `api.occurrence`, `api.taskStats`, `api.setReminder`; until it lands they are declared here (the
// shapes are the contract's, so they stay assignable both ways) and the calls prefer `api`'s
// methods when present, else call the contract routes directly.
import { api, CLIENT_ID, ConflictError, ApiError } from '@/api/client'
import type { DateValue, RepeatRule as M4RepeatRule, UpdateResult } from '@/api/types'

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

export type RepeatOn =
  | { weekdays?: Weekday[] }
  | { monthDay: number | 'last'; month?: number }
  | { weekdayPos: 1 | 2 | 3 | 4 | 'last'; weekday: Weekday; month?: number }

/** M4's rule plus M8's `on` (present only for custom rules). */
export type RepeatRule = M4RepeatRule & { on?: RepeatOn }

export type OccurrenceAction = 'complete' | 'skip' | 'excuse'
export type CatchUp = 'advanceOne' | 'catchUpBeforeNow' | 'catchUpThroughNow'

export interface OverdueInfo {
  count: number
  capped: boolean
  /** Scheduled days or instants, oldest first, at most 99. */
  missed: string[]
  current: DateValue | null
  today: string
}

export interface TaskStats {
  unit: 'day' | 'week' | 'month' | 'year'
  currentStreak: number
  bestStreak: number
  completions: number
  completionRate: number | null
  atRisk: boolean
  cells: { scheduled: string; state: 'completed' | 'excused' | 'skipped' | 'missed' | 'future' | 'none' }[]
}

export interface TaskClient {
  overdue(path: string): Promise<OverdueInfo>
  occurrence(path: string, action: OccurrenceAction, opts: { catchUp?: CatchUp; baseVersion: string }): Promise<UpdateResult>
  taskStats(path: string): Promise<TaskStats>
  /** `PUT /api/tasks/reminder` (M8 Task 12): set or clear (`null`) the reminder of date property `key`. */
  setReminder(path: string, key: string, remind: string | null, opts: { baseVersion: string }): Promise<UpdateResult>
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${url}`, { ...init, headers: { Accept: 'application/json', ...(init?.headers ?? {}) } })
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (res.ok) return data as T
  const detail = data && typeof data === 'object' ? (data as Record<string, unknown>).detail : undefined
  const d = detail && typeof detail === 'object' ? (detail as Record<string, unknown>) : ((data ?? {}) as Record<string, unknown>)
  if (res.status === 409) throw new ConflictError(String(d.currentVersion ?? ''))
  throw new ApiError(res.status, typeof detail === 'string' ? detail : res.statusText)
}

const real = api as unknown as Partial<TaskClient>

/** The task calls: `api`'s (Task 3) when present, else the contract routes. */
export const taskClient: TaskClient = {
  overdue: (path) => (real.overdue ? real.overdue(path) : call(`/tasks/overdue?path=${encodeURIComponent(path)}`)),
  occurrence: (path, action, opts) =>
    real.occurrence
      ? real.occurrence(path, action, opts)
      : call('/tasks/occurrence', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path, action, ...(opts.catchUp ? { catchUp: opts.catchUp } : {}), baseVersion: opts.baseVersion, clientId: CLIENT_ID }),
        }),
  taskStats: (path) => (real.taskStats ? real.taskStats(path) : call(`/tasks/stats?path=${encodeURIComponent(path)}`)),
  setReminder: (path, key, remind, opts) =>
    real.setReminder
      ? real.setReminder(path, key, remind, opts)
      : call('/tasks/reminder', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path, key, remind, baseVersion: opts.baseVersion, clientId: CLIENT_ID }),
        }),
}
