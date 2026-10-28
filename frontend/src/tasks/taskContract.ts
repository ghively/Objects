// The M8 task contract (the plan's "API contract (M8)") as the task UI uses it. The shapes match
// `api/types.ts` (assignable both ways); the calls go through `api/client.ts`.
import { api } from '@/api/client'
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

/** The task calls, through `api` (read on each call, so test mocks apply). */
export const taskClient: TaskClient = {
  overdue: (path) => api.overdue(path),
  occurrence: (path, action, opts) => api.occurrence(path, action, opts),
  taskStats: (path) => api.taskStats(path),
  setReminder: (path, key, remind, opts) => api.setReminder(path, key, remind, opts),
}
