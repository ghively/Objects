// The Tasks page sections: titles and
// descriptions, which tasks each section holds, and the view each one starts from.
//
// A section's membership (`match`) is fixed, as built-in task sections are; its
// `preset` is only the starting view (layout, sorts, grouping) that the user can change and that
// is saved per section in `ui.tasks.views`. Icons are ours.
import type { DateValue, Row, TaskSectionKey, TypeDef, ViewState } from '@/api/types'
import { addDays } from '@/calendar/dates'
import { zonedParts } from '@/lib/zonedTime'
import { daySpan } from '@/views/dates'
import { emptyFilterGroup } from '@/views/model'
import { isOpen, statusText } from './statusCategory'
import { parseRemind } from './remind'
import { parseRepeat } from './repeat'

export interface TaskSection {
  title: string
  description: string
  icon: string
  /** The section's starting view. */
  preset(now: Date): ViewState
  /** Whether a Task row belongs to the section (`type`: the Task type, for status categories). */
  match(row: Row, type: TypeDef | undefined, now: Date): boolean
}

/**
 * Tab order and default tab: the task
 * sections in this order, then "All" (`allContent`, sorted last for tasks); `inbox` is the
 * default (`defaultSection: 'tasksInbox'`).
 */
export const TASK_SECTION_KEYS: readonly TaskSectionKey[] = [
  'inbox',
  'today',
  'scheduled',
  'status',
  'source',
  'tags',
  'open',
  'deadline',
  'recurring',
  'reminders',
  'completed',
  'all',
]

export const DEFAULT_TASK_SECTION: TaskSectionKey = 'inbox'

export const isTaskSectionKey = (k: unknown): k is TaskSectionKey =>
  typeof k === 'string' && (TASK_SECTION_KEYS as readonly string[]).includes(k)

const asDate = (v: unknown): DateValue | null =>
  v && typeof v === 'object' && typeof (v as DateValue).start === 'string' && (v as DateValue).start ? (v as DateValue) : null


/**
 * The first and last local day (`YYYY-MM-DD`, in the Time zone setting) a date value covers, by the
 * Calendar's rule (`calendarquery.py` `span`): a timed end at exactly 00:00 leaves that day out, and
 * an end before the start counts as no end.
 */
export function coveredDays(v: DateValue): { first: string; last: string } | null {
  const span = daySpan(v)
  if (!span) return null
  let last = span.end && span.end > span.start ? span.end : span.start
  if (span.resolution === 'time' && v.end && span.end) {
    const start = Date.parse(v.start)
    const end = Date.parse(v.end)
    if (!(end >= start)) last = span.start
    else if (end > start) {
      const p = zonedParts(end)
      if (p.hour === 0 && p.minute === 0 && p.second === 0 && end % 1000 === 0) last = addDays(span.end, -1)
    }
    if (last < span.start) last = span.start
  }
  return { first: span.start, last }
}

/**
 * Decision T1: a task is on today's list when the Calendar Day view lists it on today: its `date`
 * covers today, its `deadline` is today (done or not), or it is open and its `date` ended before
 * today (Overdue). M33 (choice 6): an open task with no date whose `deadline` was before today is
 * Overdue too (the Day view lists it on today only). Recurring occurrences are only ever future
 * days, so never today.
 */
export function isTodayTask(row: Row, type: TypeDef | undefined, now: Date): boolean {
  return isTaskOfDay(row, type, zonedParts(now).date)
}

/** `isTodayTask` for the day `today` (`YYYY-MM-DD`). */
export function isTaskOfDay(row: Row, type: TypeDef | undefined, today: string): boolean {
  const date = asDate(row.values.date)
  const span = date ? coveredDays(date) : null
  if (span && span.first <= today && today <= span.last) return true
  if (span && span.last < today && isOpen(row, type)) return true
  const deadline = asDate(row.values.deadline)
  const due = deadline ? (coveredDays(deadline)?.first ?? null) : null
  if (due === today) return true
  // M33 (choice 6): no date and a passed deadline: Overdue (a dated task is placed by its date).
  return !span && due !== null && due < today && isOpen(row, type)
}

const hasRepeat = (row: Row) => !!asDate(row.values.date) && parseRepeat(row.values.repeat) !== null
const hasReminder = (row: Row) => {
  const d = asDate(row.values.date)
  return !!d && parseRemind(row.values.remind, d.resolution) !== null
}

function view(layout: ViewState['viewDefinition']['dataViewLayout'], patch: Partial<ViewState> = {}): ViewState {
  return { viewDefinition: { dataViewLayout: layout }, filterGroup: emptyFilterGroup(), sorts: [], groupBy: null, ...patch }
}

/** Grouped by the Scheduled buckets, earliest date first inside each. */
const scheduledPreset = () =>
  view('list', {
    sorts: [{ propertyId: 'date', option: 'ascending' }],
    groupBy: { groups: [{ propertyId: 'date', option: 'scheduled' }] },
  })

export const TASK_SECTIONS: Record<TaskSectionKey, TaskSection> = {
  status: {
    title: 'Status',
    description: 'Every task, grouped by status',
    icon: 'ph-kanban',
    preset: () => view('kanban', { groupBy: { groups: [{ propertyId: 'status', option: 'statusCategory' }] } }),
    match: () => true,
  },
  today: {
    title: 'Today',
    description: 'Tasks that matter today',
    icon: 'ph-sun',
    preset: () => view('list', { sorts: [{ propertyId: 'date', option: 'ascending' }] }),
    // Decision T1: the Calendar Day view's list for today (done tasks stay, struck), (M33) open
    // tasks with no date whose deadline has passed included.
    match: isTodayTask,
  },
  inbox: {
    title: 'Inbox',
    description: 'Tasks with no status or no date yet',
    icon: 'ph-tray',
    preset: () => view('list'),
    match: (row, type) => statusText(row, type) === null || !asDate(row.values.date),
  },
  open: {
    title: 'Open',
    description: 'All tasks not done yet',
    icon: 'ph-circle-dashed',
    preset: () => view('list'),
    match: (row, type) => isOpen(row, type),
  },
  deadline: {
    title: 'Deadline',
    description: 'Open tasks that have a deadline, soonest first',
    icon: 'ph-hourglass-medium',
    preset: () => view('list', { sorts: [{ propertyId: 'deadline', option: 'ascending' }] }),
    match: (row, type) => isOpen(row, type) && !!asDate(row.values.deadline),
  },
  scheduled: {
    title: 'Scheduled',
    description: 'Tasks coming up, ordered by date',
    icon: 'ph-calendar',
    preset: scheduledPreset,
    match: (row, type) => isOpen(row, type) && !!asDate(row.values.date),
  },
  recurring: {
    title: 'Recurring',
    description: 'Open repeating tasks, grouped by date',
    icon: 'ph-repeat',
    preset: scheduledPreset,
    match: (row, type) => isOpen(row, type) && hasRepeat(row),
  },
  reminders: {
    title: 'Reminders',
    description: 'Open tasks with a reminder set, grouped by date',
    icon: 'ph-bell',
    preset: scheduledPreset,
    match: (row, type) => isOpen(row, type) && hasReminder(row),
  },
  tags: {
    title: 'Tags',
    description: 'Every task, grouped by tag',
    icon: 'ph-hash',
    preset: () => view('list', { groupBy: { groups: [{ propertyId: 'tags', option: 'default' }] } }),
    match: () => true,
  },
  source: {
    title: 'Context',
    description: 'Tasks grouped by the note that mentions them.',
    icon: 'ph-line-segment',
    // Grouped by the live backlinks: one group per note linking to the task, "Other" for none.
    preset: () => view('list', { groupBy: { groups: [{ propertyId: 'backlinks', option: 'default' }] } }),
    match: (row, type) => isOpen(row, type),
  },
  completed: {
    title: 'Completed',
    description: 'Tasks that are finished',
    icon: 'ph-check-circle',
    preset: () => view('list', { sorts: [{ propertyId: 'completed', option: 'descending' }] }),
    match: (row, type) => !isOpen(row, type),
  },
  all: {
    title: 'All',
    description: 'Every task, ready to filter and sort.',
    icon: 'ph-list-bullets',
    preset: () => view('list'),
    match: () => true,
  },
}

/** The rows of a section, in their given order (the view sorts them). */
export function sectionRows(key: TaskSectionKey, rows: Row[], type: TypeDef | undefined, now: Date): Row[] {
  const s = TASK_SECTIONS[key]
  return rows.filter((r) => s.match(r, type, now))
}

/** Today's open tasks: the Today badge, the "N open" of the list's "N open, M done" (decision T1). */
export function todayOpenCount(rows: Row[], type: TypeDef | undefined, now: Date): number {
  return rows.filter((r) => isTodayTask(r, type, now) && isOpen(r, type)).length
}
