// M32: what the plain Tasks page's five tabs list, and in which groups and order.
//
//   Today     "Overdue" (open tasks whose date ended before today), then "Today" (the date covers
//             today, or the deadline is today; done ones stay).
//   Upcoming  open tasks dated after today: one group per day for the next 14 days, then "Later".
//   Inbox     open tasks with no date and no deadline.
//   All       every task, the open ones first.
//   Done      finished tasks, the latest first.
//
// M33 (choice 6): a not-done task with no date and a deadline is listed where its deadline puts it:
// under Today's "Overdue" once the deadline has passed, under "Today" on the day, on its day in
// Upcoming before that ("Later" beyond the 14 days). It is not in Inbox (a task with a deadline is
// planned). A task with a date is placed by its date, whatever its deadline, except that a deadline
// today lists it under Today (as before) and then not in Upcoming too. So every not-done task is
// on exactly one of Today, Upcoming and Inbox (`taskPlace`). A group names the rows their deadline
// placed (`deadlinePaths`): the list draws their chip as the deadline's.
//
// Today is the Calendar Day view's list for today (decision T1, `taskSections.isTaskOfDay`), which
// (M33) includes the open tasks with no date whose deadline has passed.
//
// Pure: rows in, groups out. A group with a null label is drawn without a header.
import type { DateValue, Row, TaskSectionKey, TypeDef } from '@/api/types'
import { addDays, weekdayName } from '@/calendar/dates'
import { formatDate } from '@/properties/format'
import { displayTitle } from '@/views/filter'
import { isOpen } from './statusCategory'
import { coveredDays } from './taskSections'

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
    // M33: a task with a deadline is not in Inbox (was "No tasks without a date").
    inbox: 'No tasks without a date or a deadline',
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
  /**
   * M33: the paths of the rows listed here by their deadline (they have no date): their chip shows
   * and edits the deadline. Only Today's and Upcoming's groups have any.
   */
  deadlinePaths?: ReadonlySet<string>
}

const asDate = (v: unknown): DateValue | null =>
  v && typeof v === 'object' && typeof (v as DateValue).start === 'string' && (v as DateValue).start ? (v as DateValue) : null

const spanOf = (row: Row) => {
  const d = asDate(row.values.date)
  return d ? coveredDays(d) : null
}

/** The day a deadline falls on (`YYYY-MM-DD`), or null without one. */
const dueDayOf = (row: Row): string | null => {
  const d = asDate(row.values.deadline)
  return d ? (coveredDays(d)?.first ?? null) : null
}

/**
 * M33: the day a task's deadline places it on: it has no date and a deadline. Null for a task with
 * a date (its date places it) and for one with no deadline. Whether the task is done is the
 * caller's to ask.
 */
export function deadlineDayOf(row: Row): string | null {
  return spanOf(row) ? null : dueDayOf(row)
}

export interface TaskPlace {
  /** The one list of Today, Upcoming and Inbox the task is on. */
  list: 'today' | 'upcoming' | 'inbox'
  /** On Today, under "Overdue": not done, and its date ended (or, with no date, its deadline was) before today. */
  overdue: boolean
  /** The day that places it: its date's first day, or its deadline's; null in Inbox. */
  day: string | null
  /** It has no date: its deadline placed it (its chip is the deadline's). */
  byDeadline: boolean
}

/**
 * Where a task is listed, seen from `today` (`YYYY-MM-DD`): exactly one of Today, Upcoming and
 * Inbox for a task that is not done; for a done one Today while its date covers today or its
 * deadline is today, else null (it is under Done).
 */
export function taskPlace(row: Row, type: TypeDef | undefined, today: string): TaskPlace | null {
  const open = isOpen(row, type)
  const span = spanOf(row)
  const due = dueDayOf(row)
  if (span) {
    const byDate = (list: TaskPlace['list'], overdue = false): TaskPlace => ({ list, overdue, day: span.first, byDeadline: false })
    if (open && span.last < today) return byDate('today', true)
    if (span.first <= today && today <= span.last) return byDate('today')
    // Its deadline is today: on Today's list (as the Calendar Day view has it), whatever its date.
    if (due === today) return byDate('today')
    return open && span.first > today ? byDate('upcoming') : null
  }
  if (due) {
    const byDeadline = (list: TaskPlace['list'], overdue = false): TaskPlace => ({ list, overdue, day: due, byDeadline: true })
    if (due === today) return byDeadline('today')
    if (!open) return null
    return due < today ? byDeadline('today', true) : byDeadline('upcoming')
  }
  return open ? { list: 'inbox', overdue: false, day: null, byDeadline: false } : null
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
  // Where each row is listed (Today, Upcoming, Inbox), worked out once.
  const places = new Map<Row, TaskPlace | null>()
  const placeOf = (r: Row): TaskPlace | null => {
    if (!places.has(r)) places.set(r, taskPlace(r, type, today))
    return places.get(r) ?? null
  }
  const on = (list: TaskPlace['list']) => rows.filter((r) => placeOf(r)?.list === list)
  /** By the day that places the task; on one day the dated ones as before, then the deadline-only ones. */
  const byPlace = (a: Row, b: Row): number => {
    const x = placeOf(a)
    const y = placeOf(b)
    const dx = x?.day ?? ''
    const dy = y?.day ?? ''
    if (dx !== dy) return dx < dy ? -1 : 1
    if (!!x?.byDeadline !== !!y?.byDeadline) return x?.byDeadline ? 1 : -1
    return byDate(a, b)
  }
  /** A group, naming the rows their deadline placed. */
  const group = (id: string, label: string | null, rs: Row[]): TaskGroup => {
    const paths = rs.filter((r) => placeOf(r)?.byDeadline).map((r) => r.summary.path)
    return paths.length > 0 ? { id, label, rows: rs, deadlinePaths: new Set(paths) } : { id, label, rows: rs }
  }
  let groups: TaskGroup[]
  switch (key) {
    case 'today': {
      const mine = on('today')
      const isLate = (r: Row) => !!placeOf(r)?.overdue
      groups = [
        group('overdue', TASK_TABS_TEXT.overdue, mine.filter(isLate).sort(byPlace)),
        // Open ones first, done ones under them.
        group('today', TASK_TABS_TEXT.today, mine.filter((r) => !isLate(r)).sort((a, b) => Number(!open(a)) - Number(!open(b)) || byDate(a, b))),
      ]
      break
    }
    case 'upcoming': {
      const last = addDays(today, UPCOMING_DAYS)
      const coming = on('upcoming').sort(byPlace)
      const days = new Map<string, Row[]>()
      const later: Row[] = []
      for (const r of coming) {
        const day = placeOf(r)!.day!
        if (day > last) later.push(r)
        else days.set(day, [...(days.get(day) ?? []), r])
      }
      groups = [...[...days].map(([day, rs]) => group(day, dayLabel(day, today), rs)), group('later', TASK_TABS_TEXT.later, later)]
      break
    }
    case 'inbox':
      groups = [{ id: 'inbox', label: null, rows: on('inbox').sort(newestFirst(createdAt)) }]
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
