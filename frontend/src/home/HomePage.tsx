// M32: Home, what an empty tab shows (and a first open with nothing to restore) in place of
// "Pick an object type". Home is a tab state, not a page with its own data: it lists what the app
// already holds and opening it writes no file. Top to bottom: the two ways to start writing ("New
// note", "Today's note"), "Recent" (the last 12 notes edited, newest first, daily notes included,
// tasks and tags left out; from the link index, no request of its own) and "Tasks" (overdue and
// today, each with the task checkbox; the Task rows are read, never written, until a tick; left out
// while the space hides task management). An empty space shows one friendly line and the two
// buttons.
import { useCallback, useMemo, type MouseEvent } from 'react'
import type { ObjectSummary, Row, TypeDef } from '@/api/types'
import { isListedNote, recentNotes, editedAt, editedLabel } from '@/allnotes/notes'
import { openTodaysNote } from '@/calendar/openTodaysNote'
import { Icon } from '@/components/Icon'
import { openObject } from '@/create/createAndOpen'
import { newNote, noteTypeId } from '@/create/newNote'
import { showToast } from '@/editor/media/upload'
import { typeLabel } from '@/lib/typeLabel'
import { HOME, NEW_NOTE, TASKS, TODAYS_NOTE } from '@/lib/words'
import { useZonedToday } from '@/lib/zonedShell'
import { useLinkIndex } from '@/links/linkIndex'
import { ObjectIcon } from '@/object/ObjectHeader'
import { useSpaceInfo } from '@/settings/useSpaceInfo'
import { TypeChip } from '@/shell/Sidebar'
import { isOpen } from '@/tasks/statusCategory'
import { completionToast, type TaskOutcome } from '@/tasks/taskActions'
import { taskRowExtras } from '@/tasks/taskRowExtras'
import { coveredDays, isTodayTask } from '@/tasks/taskSections'
import { deadlineDayOf } from '@/tasks/taskTabs'
import { findTaskType } from '@/tasks/useTaskRows'
import { useRows } from '@/views/useRows'

export const HOME_TEXT = {
  heading: HOME,
  newNote: NEW_NOTE,
  todaysNote: TODAYS_NOTE,
  recent: 'Recent', // our string
  tasks: TASKS,
  /** An empty space (our string). */
  empty: 'Nothing here yet. Start a note, or open today.',
  /** No task is overdue or due today, or the space has no tasks (our string). */
  noTasks: 'Nothing due today.',
  overdue: 'Overdue', // the Tasks page's word
  untitled: 'Untitled',
} as const

const BUTTON =
  'flex h-10 items-center gap-2 rounded-lg border border-line bg-raised px-4 text-[15px] font-medium hover:bg-hover'
const SECTION_HEADING = 'pb-1.5 text-[13px] font-semibold tracking-wide text-fg-muted uppercase'
const ROW = 'flex min-h-10 min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 text-left hover:bg-hover'

export { noteTypeId }

const modsOf = (e: MouseEvent) => ({ ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey })

/** The last day a task's date covers (`YYYY-MM-DD`), or null without a date. */
function lastDayOf(row: Row): string | null {
  const v = row.values.date as { start?: unknown } | null | undefined
  if (!v || typeof v !== 'object' || typeof v.start !== 'string' || !v.start) return null
  return coveredDays(v as Parameters<typeof coveredDays>[0])?.last ?? null
}

/** Home's tasks: the open ones whose date ended before today (oldest first), then today's. */
export function homeTasks(rows: readonly Row[], type: TypeDef | undefined, today: string): { row: Row; overdue: boolean }[] {
  const now = new Date()
  const out: { row: Row; overdue: boolean; day: string }[] = []
  for (const row of rows) {
    // M33: a task with only a deadline that has passed is overdue here too, as on Tasks > Today.
    const due = isOpen(row, type) ? deadlineDayOf(row) : null
    const lateByDeadline = due !== null && due < today
    if (row.summary.template != null || !(isTodayTask(row, type, now) || lateByDeadline)) continue
    const last = lastDayOf(row)
    const overdue = (last !== null && last < today && isOpen(row, type)) || lateByDeadline
    out.push({ row, overdue, day: last ?? due ?? today })
  }
  return out.sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.day.localeCompare(b.day) || a.row.summary.title.localeCompare(b.row.summary.title))
}

function RecentRow({ note, type, today }: { note: ObjectSummary; type: TypeDef | undefined; today: string }) {
  return (
    <li className="flex">
      <button type="button" className={ROW} onClick={(e) => openObject(note.path, modsOf(e), note.type)}>
        <span className="inline-flex shrink-0">
          {note.icon ? <ObjectIcon icon={note.icon} size={18} /> : type ? <TypeChip type={type} size={20} /> : <Icon name="ph-note" size={18} />}
        </span>
        <span className="min-w-0 flex-1 truncate text-[15px]">{note.title || HOME_TEXT.untitled}</span>
        <span className="shrink-0 text-[13px] text-fg-muted">{typeLabel(type, note.type)}</span>
        <time dateTime={editedAt(note)} className="w-24 shrink-0 text-right text-[13px] text-fg-muted tabular-nums">
          {editedLabel(editedAt(note), today)}
        </time>
      </button>
    </li>
  )
}

/** The Task rows that are overdue or due today; mounted only while the space has a Task type. */
function TaskList({ taskType, today }: { taskType: TypeDef; today: string }) {
  const scope = useMemo(() => ({ typeIds: [taskType.id] }), [taskType.id])
  const { rows, loading, patchRow } = useRows(scope)
  const list = useMemo(() => homeTasks(rows, taskType, today), [rows, taskType, today])
  const onResult = useCallback(
    (outcome: TaskOutcome) => {
      if (outcome.row) patchRow(outcome.row.summary.path, outcome.row)
      const said = completionToast(outcome)
      if (said) showToast(said)
    },
    [patchRow],
  )
  if (loading && rows.length === 0) return null
  if (list.length === 0) return <p className="px-2 text-[14px] text-fg-muted">{HOME_TEXT.noTasks}</p>
  return (
    <ul className="flex flex-col">
      {list.map(({ row, overdue }) => {
        const extras = taskRowExtras(row, taskType, { onResult, chip: deadlineDayOf(row) ? 'deadline' : undefined })
        const done = !isOpen(row, taskType)
        return (
          <li key={row.summary.path} data-path={row.summary.path} data-overdue={overdue ? '' : undefined} className="flex items-center">
            <span className="flex shrink-0 items-center pl-2">{extras.leading}</span>
            <button type="button" className={ROW} onClick={(e) => openObject(row.summary.path, modsOf(e), row.summary.type)}>
              <span className={`min-w-0 flex-1 truncate text-[15px] ${done ? 'text-fg-muted line-through' : ''}`}>
                {row.summary.title || HOME_TEXT.untitled}
              </span>
            </button>
            <span className={`flex shrink-0 items-center gap-2 pr-2 ${overdue ? '[&_[data-testid=task-date]]:text-[var(--danger)]' : ''}`}>
              {overdue && <span className="text-[12px] text-[var(--danger)]">{HOME_TEXT.overdue}</span>}
              {extras.trailing}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/** `types`: the space's types (the shell's), to find the type a new note is made of. */
export function HomePage({ types }: { types: readonly TypeDef[] }) {
  const objects = useLinkIndex((s) => s.objects)
  const loaded = useLinkIndex((s) => s.loaded)
  const today = useZonedToday()
  const typesById = useMemo(() => new Map(types.map((t) => [t.id, t])), [types])
  const recent = useMemo(() => recentNotes(objects, [...types]), [objects, types])
  const taskType = useMemo(() => findTaskType([...types]), [types])
  // "Hide Task Management" (the space's setting) leaves the task lists out everywhere, here too.
  const hideTasks = useSpaceInfo((s) => s.space?.hideTaskManagement ?? false)
  // An empty space: no note and no task yet (templates and tags don't count).
  const empty = loaded && !objects.some((o) => o.template == null && (isListedNote(o, typesById) || o.type === taskType?.id))

  return (
    <div data-home-page="" className="h-full overflow-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 pt-10 pb-16">
        <section aria-label={HOME_TEXT.heading} className="flex flex-col gap-4">
          <h1 className="text-[22px] font-bold">{HOME_TEXT.heading}</h1>
          {empty && <p className="text-[15px] text-fg-muted">{HOME_TEXT.empty}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={BUTTON}
              onClick={(e) => void newNote(modsOf(e), noteTypeId(types))}
            >
              <Icon name="ph-plus" size={16} />
              {HOME_TEXT.newNote}
            </button>
            <button type="button" className={BUTTON} onClick={() => void openTodaysNote()}>
              <Icon name="ph-notebook" size={16} />
              {HOME_TEXT.todaysNote}
            </button>
          </div>
        </section>

        {loaded && !empty && (
          <>
            {recent.length > 0 && (
              <section aria-label={HOME_TEXT.recent}>
                <h2 className={SECTION_HEADING}>{HOME_TEXT.recent}</h2>
                <ul className="flex flex-col">
                  {recent.map((o) => (
                    <RecentRow key={o.path} note={o} type={typesById.get(o.type)} today={today} />
                  ))}
                </ul>
              </section>
            )}
            {!hideTasks && (
              <section aria-label={HOME_TEXT.tasks}>
                <h2 className={SECTION_HEADING}>{HOME_TEXT.tasks}</h2>
                {taskType ? <TaskList taskType={taskType} today={today} /> : <p className="px-2 text-[14px] text-fg-muted">{HOME_TEXT.noTasks}</p>}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}
