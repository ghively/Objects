// What a task row shows besides its title: the checkbox before it; after it the date chip (with
// its repeat and reminder icons; M32: it opens the small date picker, and an overdue date is in the
// danger colour), the deadline label, the priority pill and one badge per calendar entry kind.
// Owners pass `rowExtras={(row) => taskRowExtras(row, typesById[row.summary.type], …)}`: the Tasks
// page's rows (`TaskList`), the task lists and the Calendar's day list all draw these.
//
// M33 (choice 6): with `chip: 'deadline'` (a row the Tasks page lists by its deadline: the task has
// no date) the chip is the deadline's: it shows and edits the deadline, marked as one.
import type { DateValue, LabelOption, PropertyDef, Row, TypeDef } from '@/api/types'
import { Icon } from '@/components/Icon'
import { LabelPill } from '@/properties/LabelMenu'
import type { RowExtras } from '@/views/DataView'
import { DeadlineLabel } from './DeadlineLabel'
import { describeRepeat, parseRepeat } from './repeat'
import { parseRemind } from './remind'
import { TaskCheckbox } from './TaskCheckbox'
import { TaskDateChip } from './TaskDateChip'
import type { TaskOutcome } from './taskActions'

export type TaskBadge = 'date' | 'deadline' | 'occurrence' | 'overdue'

export interface TaskRowExtrasOptions {
  /**
   * Calendar entry kinds this row stands for (Task 13's day sections): `deadline` shows a
   * "Deadline" badge, `occurrence` a repeat icon; `date` and `overdue` need none (the section says it).
   */
  badges?: TaskBadge[]
  /** The checkbox or the date chip wrote and reloaded: the owner patches its list and shows the toast. */
  onResult?(outcome: TaskOutcome): void
  /** The day "N days left" counts from (tests); now otherwise. */
  today?: Date
  /** M33: which date the row's chip shows and edits: the task's date (the default) or its deadline. */
  chip?: 'date' | 'deadline'
}

const asDate = (v: unknown): DateValue | null =>
  v && typeof v === 'object' && typeof (v as DateValue).start === 'string' ? (v as DateValue) : null

function labelOption(type: TypeDef | undefined, key: string, value: unknown): LabelOption | null {
  const text = Array.isArray(value) ? value[0] : value
  if (typeof text !== 'string' || !text) return null
  const def: PropertyDef | undefined = type?.propertyDefinitions.find((d) => d.key === key)
  return def?.options.set?.find((o) => o.text === text) ?? { id: text, text, color: null, icon: null }
}

export function taskRowExtras(row: Row, type: TypeDef | undefined, opts: TaskRowExtrasOptions = {}): RowExtras {
  const date = asDate(row.values.date)
  const deadline = asDate(row.values.deadline)
  const repeat = date ? parseRepeat(row.values.repeat) : null
  const remind = date ? parseRemind(row.values.remind, date.resolution) : null
  const priority = labelOption(type, 'priority', row.values.priority)
  const badges = (opts.badges ?? []).filter((b) => b === 'deadline' || b === 'occurrence')

  const trailing = (
    <>
      {badges.map((b) =>
        b === 'occurrence' ? (
          <span key={b} data-testid="badge-occurrence" title="Repeats" className="inline-flex items-center text-fg-muted">
            <Icon name="ph-repeat" size={13} />
          </span>
        ) : (
          <span key={b} data-testid="badge-deadline" className="rounded-md bg-hover px-1.5 py-[1px] text-[12px] text-fg-muted">
            Deadline
          </span>
        ),
      )}
      {/* The repeat and reminder icons belong to the date: a row shown by its deadline has no date. */}
      <TaskDateChip property={opts.chip === 'deadline' ? 'deadline' : 'date'} row={row} type={type} onResult={opts.onResult} today={opts.today}>
        {date && repeat && (
          <span data-testid="task-repeat" title={describeRepeat(repeat, date.start)} className="inline-flex">
            <Icon name="ph-repeat" size={13} />
          </span>
        )}
        {date && remind && (
          <span data-testid="task-reminder" title={String(row.values.remind)} className="inline-flex">
            <Icon name="ph-bell" size={13} />
          </span>
        )}
      </TaskDateChip>
      <DeadlineLabel deadline={deadline} date={date} today={opts.today} />
      {priority && <LabelPill option={priority} />}
    </>
  )

  return {
    leading: <TaskCheckbox row={row} type={type} onResult={opts.onResult} />,
    trailing,
  }
}
