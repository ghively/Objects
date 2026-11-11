// M32: what the plain Tasks page's five tabs list, and in which groups and order.
//
//   Today     "Overdue" (open tasks whose date ended before today), then "Today" (the date covers
//             today, or the deadline is today; done ones stay). Together the Calendar Day view's
//             list for today (decision T1, `taskSections.isTaskOfDay`).
//   Upcoming  open tasks dated after today: one group per day for the next 14 days, then "Later".
//   Inbox     open tasks with no date.
//   All       every task, the open ones first.
//   Done      finished tasks, the latest first.
//
// Pure: rows in, groups out. A group with a null label is drawn without a header.
import type { DateValue, Row, TaskSectionKey, TypeDef } from '@/api/types'
import { addDays, weekdayName } from '@/calendar/dates'
import { formatDate } from '@/properties/format'
import { displayTitle } from '@/views/filter'
import { isOpen } from './statusCategory'
import { coveredDays, isTaskOfDay } from './taskSections'

export type TasksTabKey = 'today' | 'upcoming' | 'inbox' | 'all' | 'done'

/** The tabs in order, each with the task section it stands for (`section` names it wherever a section key is kept). */
export const TASKS_PAGE_TABS: readonly { key: TasksTabKey; label: string; section: TaskSectionKey }[] = [
  { key: 'today', label: 'Today', section: 'today' },
  { key: 'upcoming', label: 'Upcoming', section: 'scheduled' },
  { key: 'inbox', label: 'Inbox', section: 'inbox' },
  { key: 'all', label: 'All', section: 'all' },
  { key: 'done', label: 'Done', section: 'completed' },
]

/** The other plain lists, in the "More" menu's order (their titles are `TASK_SECTIONS[key].title`). */
export const TASKS_MORE_LISTS: readonly TaskSectionKey[] = ['status', 'deadline', 'recurring', 'reminders', 'tags', 'source']

/** How many days after today Upcoming lists day by day. */
export const UPCOMING_DAYS = 14

export const TASK_TABS_TEXT = {
  overdue: 'Overdue',
  today: 'Today',
  tomorrow: 'Tomorrow',
  later: 'Later',
  /** A group's header: its label and its count, once ("Overdue (1)"). */
  groupHeader: (label: string, count: number) => `${label} (${count})`,
  /** The empty lists (our strings; Today's is the Calendar's). */
  empty: {
    today: 'No tasks today',
    upcoming: 'No tasks coming up',
    inbox: 'No tasks without a date',
    all: 'No tasks yet',
    done: 'No finished tasks yet',
  } satisfies Record<TasksTabKey, string>,
  noMatch: 'No tasks match your search',
}

export interface TaskGroup {
  id: string
  /** Null: no header (a list that is one group). */
  label: string | null
  rows: Row[]
}

const asDate = (v: unknown): DateValue | null =>
  v && typeof v === 'object' && typeof (v as DateValue).start === 'string' && (v as DateValue).start ? (v as DateValue) : null

const spanOf = (row: Row) => {
  const d = asDate(row.values.date)
  return d ? coveredDays(d) : null
}

const byTitle = (a: Row, b: Row) => displayTitle(a).localeCompare(displayTitle(b))

/** Earliest day first (then the time of day), undated last, then by title. */
function byDate(a: Row, b: Row): number {
  const x = spanOf(a)?.first ?? ''
  const y = spanOf(b)?.first ?? ''
  if (x !== y) return !x ? 1 : !y ? -1 : x < y ? -1 : 1
  const s = asDate(a.values.date)?.start ?? ''
  const t = asDate(b.values.date)?.start ?? ''
  if (s !== t) return s < t ? -1 : 1
  return byTitle(a, b)
}

/** Newest first by `stamp`, rows without one last, then by title. */
const newestFirst = (stamp: (r: Row) => string) => (a: Row, b: Row) => {
  const x = stamp(a)
  const y = stamp(b)
  if (x !== y) return x > y ? -1 : 1
  return byTitle(a, b)
}

const createdAt = (r: Row) => r.summary.createdAt ?? ''
const finishedAt = (r: Row) => asDate(r.values.completed)?.start ?? r.summary.lastUpdated ?? ''

/** A day's header in Upcoming: "Tomorrow", else the weekday and the date. */
export function dayLabel(day: string, today: string): string {
  if (day === addDays(today, 1)) return TASK_TABS_TEXT.tomorrow
  return `${weekdayName(day)}, ${formatDate({ start: day, resolution: 'day' })}`
}

/** The rows whose title holds `query` (case does not matter); every row for an empty query. */
export function searchTasks(rows: Row[], query: string): Row[] {
  const q = query.trim().toLowerCase()
  return q ? rows.filter((r) => displayTitle(r).toLowerCase().includes(q)) : rows
}

/** Tab `key`'s groups over the Task rows, seen from `today` (`YYYY-MM-DD`); empty groups are left out. */
export function tabGroups(key: TasksTabKey, rows: Row[], type: TypeDef | undefined, today: string): TaskGroup[] {
  const open = (r: Row) => isOpen(r, type)
  let groups: TaskGroup[]
  switch (key) {
    case 'today': {
      const mine = rows.filter((r) => isTaskOfDay(r, type, today))
      const isLate = (r: Row) => open(r) && (spanOf(r)?.last ?? today) < today
      groups = [
        { id: 'overdue', label: TASK_TABS_TEXT.overdue, rows: mine.filter(isLate).sort(byDate) },
        // Open ones first, done ones under them.
        { id: 'today', label: TASK_TABS_TEXT.today, rows: mine.filter((r) => !isLate(r)).sort((a, b) => Number(!open(a)) - Number(!open(b)) || byDate(a, b)) },
      ]
      break
    }
    case 'upcoming': {
      const last = addDays(today, UPCOMING_DAYS)
      const coming = rows.filter((r) => open(r) && (spanOf(r)?.first ?? '') > today).sort(byDate)
      const days = new Map<string, Row[]>()
      const later: Row[] = []
      for (const r of coming) {
        const day = spanOf(r)!.first
        if (day > last) later.push(r)
        else days.set(day, [...(days.get(day) ?? []), r])
      }
      groups = [
        ...[...days].map(([day, rs]) => ({ id: day, label: dayLabel(day, today), rows: rs })),
        { id: 'later', label: TASK_TABS_TEXT.later, rows: later },
      ]
      break
    }
    case 'inbox':
      groups = [{ id: 'inbox', label: null, rows: rows.filter((r) => open(r) && !spanOf(r)).sort(newestFirst(createdAt)) }]
      break
    case 'all':
      groups = [{ id: 'all', label: null, rows: [...rows.filter(open).sort(byDate), ...rows.filter((r) => !open(r)).sort(newestFirst(finishedAt))] }]
      break
    case 'done':
      groups = [{ id: 'done', label: null, rows: rows.filter((r) => !open(r)).sort(newestFirst(finishedAt)) }]
      break
  }
  return groups.filter((g) => g.rows.length > 0)
}
