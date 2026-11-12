// M32: the plain Tasks page's list. Groups of task rows, each row the shared task row: the tick,
// the title (a click opens the task; a done task's is struck through), then the date chip, the
// deadline label and the priority (`taskRowExtras`, which the Calendar's day list draws too). A
// group's header shows its label and its count once ("Overdue (1)"). M33: a row its group lists by
// its deadline (`TaskGroup.deadlinePaths`) shows the deadline as its chip.
import { memo, useState, type MouseEvent } from 'react'
import type { Row, TypeDef } from '@/api/types'
import { openObject } from '@/create/createAndOpen'
import { cn } from '@/lib/utils'
import { displayTitle } from '@/views/filter'
import { LOAD_PAGE, MIN_ROW_HEIGHT } from '@/views/model'
import { isOpen } from './statusCategory'
import type { TaskOutcome } from './taskActions'
import { taskRowExtras } from './taskRowExtras'
import { TASK_TABS_TEXT, type TaskGroup } from './taskTabs'

const TaskRow = memo(function TaskRow({
  row,
  type,
  onResult,
  chip,
}: {
  row: Row
  type: TypeDef | undefined
  onResult?(outcome: TaskOutcome): void
  /** M33: `deadline` where the row is listed by its deadline. */
  chip?: 'date' | 'deadline'
}) {
  const extras = taskRowExtras(row, type, { onResult, chip })
  const done = !isOpen(row, type)
  const open = (e: MouseEvent) =>
    openObject(row.summary.path, { ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey }, row.summary.type)
  return (
    <li data-path={row.summary.path} data-done={done || undefined} className="flex items-center" style={{ minHeight: MIN_ROW_HEIGHT }}>
      <span data-slot="leading" className="flex shrink-0 items-center pl-2">
        {extras.leading}
      </span>
      <button
        type="button"
        onClick={open}
        className="flex min-w-0 flex-1 items-center rounded-md px-2 text-left hover:bg-hover"
        style={{ minHeight: MIN_ROW_HEIGHT }}
      >
        <span data-task-title="" className={cn('truncate text-[15px]', done ? 'text-fg-muted line-through' : 'text-fg')}>
          {displayTitle(row)}
        </span>
      </button>
      <span data-slot="trailing" className="flex shrink-0 items-center gap-2 pr-2">
        {extras.trailing}
      </span>
    </li>
  )
})

export interface TaskListProps {
  groups: TaskGroup[]
  /** The Task type (the rows' statuses). */
  type: TypeDef | undefined
  /** A row's tick or date chip wrote and reloaded: the owner patches its rows and shows the toast. */
  onResult?(outcome: TaskOutcome): void
  /** What an empty list says. */
  empty: string
}

/** The groups' rows, `LOAD_PAGE` at a time ("Load more"). */
export function TaskList({ groups, type, onResult, empty }: TaskListProps) {
  const [limit, setLimit] = useState(LOAD_PAGE)
  const total = groups.reduce((n, g) => n + g.rows.length, 0)
  if (total === 0) return <p className="py-10 text-center text-[15px] text-fg-muted">{empty}</p>
  return (
    <div data-testid="task-list" className="flex flex-col gap-4">
      {groups.map((g, i) => {
        // The page's rows, in group order: this group gets what the groups before it left.
        const before = groups.slice(0, i).reduce((n, x) => n + x.rows.length, 0)
        const shown = g.rows.slice(0, Math.max(limit - before, 0))
        if (shown.length === 0) return null
        return (
          <section key={g.id} data-task-group={g.id} className="flex flex-col">
            {g.label !== null && (
              <h2 className="flex h-8 items-center px-2 text-[14px] font-medium text-fg">{TASK_TABS_TEXT.groupHeader(g.label, g.rows.length)}</h2>
            )}
            <ul role="list" className="flex flex-col">
              {shown.map((row) => (
                <TaskRow
                  key={row.summary.path}
                  row={row}
                  type={type}
                  onResult={onResult}
                  chip={g.deadlinePaths?.has(row.summary.path) ? 'deadline' : undefined}
                />
              ))}
            </ul>
          </section>
        )
      })}
      {total > limit && (
        <button
          type="button"
          onClick={() => setLimit((n) => n + LOAD_PAGE)}
          className="mx-auto mt-1 rounded-lg px-3 py-1 text-[14px] text-fg-muted hover:bg-hover"
        >
          Load more
        </button>
      )}
    </div>
  )
}
