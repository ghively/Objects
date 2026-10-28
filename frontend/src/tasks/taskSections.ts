// The Tasks page sections (Capacities' `DatabaseDashboard.sections.tasks.*`): titles and
// descriptions verbatim, which tasks each section holds, and the view each one starts from.
//
// A section's membership (`match`) is fixed, like Capacities' built-in task sections; its
// `preset` is only the starting view (layout, sorts, grouping) that the user can change and that
// is saved per section in `ui.tasks.views`. Icons are ours: the reference names none.
import type { DateValue, Row, TaskSectionKey, TypeDef, ViewState } from '@/api/types'
import { zonedDayDate } from '@/lib/zonedShell'
import { emptyFilterGroup } from '@/views/model'
import { isOpen, statusText } from './statusCategory'
import { parseRemind } from './remind'
import { localDayOf, parseRepeat } from './repeat'

export interface TaskSection {
  title: string
  description: string
  icon: string
  /** The section's starting view. */
  preset(now: Date): ViewState
  /** Whether a Task row belongs to the section (`type`: the Task type, for status categories). */
  match(row: Row, type: TypeDef | undefined, now: Date): boolean
}

/** Tab order; `status` is the default tab. */
export const TASK_SECTION_KEYS: readonly TaskSectionKey[] = [
  'status',
  'today',
  'inbox',
  'open',
  'deadline',
  'scheduled',
  'recurring',
  'reminders',
  'tags',
  'source',
  'completed',
]

export const DEFAULT_TASK_SECTION: TaskSectionKey = 'status'

export const isTaskSectionKey = (k: unknown): k is TaskSectionKey =>
  typeof k === 'string' && (TASK_SECTION_KEYS as readonly string[]).includes(k)

const asDate = (v: unknown): DateValue | null =>
  v && typeof v === 'object' && typeof (v as DateValue).start === 'string' && (v as DateValue).start ? (v as DateValue) : null


/** The local day the row's `date` starts on, or null. */
function dateDay(row: Row): Date | null {
  const d = asDate(row.values.date)
  return d ? localDayOf(d.start) : null
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
    description: 'All tasks grouped by their status',
    icon: 'ph-kanban',
    preset: () => view('kanban', { groupBy: { groups: [{ propertyId: 'status', option: 'statusCategory' }] } }),
    match: () => true,
  },
  today: {
    title: 'Today',
    description: 'All tasks relevant today',
    icon: 'ph-sun',
    preset: () => view('list', { sorts: [{ propertyId: 'date', option: 'ascending' }] }),
    match: (row, type, now) => {
      const d = dateDay(row)
      return isOpen(row, type) && !!d && d.getTime() <= zonedDayDate(now).getTime()
    },
  },
  inbox: {
    title: 'Inbox',
    description: 'All tasks that have no status or have not been scheduled',
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
    description: 'All open tasks with a deadline, sorted by the nearest deadline first',
    icon: 'ph-hourglass-medium',
    preset: () => view('list', { sorts: [{ propertyId: 'deadline', option: 'ascending' }] }),
    match: (row, type) => isOpen(row, type) && !!asDate(row.values.deadline),
  },
  scheduled: {
    title: 'Scheduled',
    description: 'All upcoming tasks based on their date',
    icon: 'ph-calendar',
    preset: scheduledPreset,
    match: (row, type) => isOpen(row, type) && !!asDate(row.values.date),
  },
  recurring: {
    title: 'Recurring',
    description: 'All open tasks that repeat on a schedule, grouped by date',
    icon: 'ph-repeat',
    preset: scheduledPreset,
    match: (row, type) => isOpen(row, type) && hasRepeat(row),
  },
  reminders: {
    title: 'Reminders',
    description: 'All open tasks with an active reminder, grouped by date',
    icon: 'ph-bell',
    preset: scheduledPreset,
    match: (row, type) => isOpen(row, type) && hasReminder(row),
  },
  tags: {
    title: 'Tags',
    description: 'All tasks grouped by their tags',
    icon: 'ph-hash',
    preset: () => view('list', { groupBy: { groups: [{ propertyId: 'tags', option: 'default' }] } }),
    match: () => true,
  },
  source: {
    title: 'Context',
    description: 'Tasks organized by the objects they are mentioned in.',
    icon: 'ph-line-segment',
    // Grouped by the live backlinks: one group per object linking to the task, "Other" for none.
    preset: () => view('list', { groupBy: { groups: [{ propertyId: 'backlinks', option: 'default' }] } }),
    match: (row, type) => isOpen(row, type),
  },
  completed: {
    title: 'Completed',
    description: 'All tasks marked as done',
    icon: 'ph-check-circle',
    preset: () => view('list', { sorts: [{ propertyId: 'completed', option: 'descending' }] }),
    match: (row, type) => !isOpen(row, type),
  },
}

/** The rows of a section, in their given order (the view sorts them). */
export function sectionRows(key: TaskSectionKey, rows: Row[], type: TypeDef | undefined, now: Date): Row[] {
  const s = TASK_SECTIONS[key]
  return rows.filter((r) => s.match(r, type, now))
}
