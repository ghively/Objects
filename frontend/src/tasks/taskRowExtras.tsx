// What a task row shows besides its title: the checkbox before it; after it the date (with its
// repeat and reminder icons), the deadline label, the priority pill and one badge per calendar
// entry kind. Owners pass `rowExtras={(row) => taskRowExtras(row, typesById[row.summary.type], …)}`.
import type { DateValue, LabelOption, PropertyDef, Row, TypeDef } from '@/api/types'
import { Icon } from '@/components/Icon'
import { formatDate } from '@/properties/format'
import { LabelPill } from '@/properties/LabelMenu'
import type { RowExtras } from '@/views/DataView'
import { DeadlineLabel } from './DeadlineLabel'
import { describeRepeat, parseRepeat } from './repeat'
import { parseRemind } from './remind'
import { TaskCheckbox } from './TaskCheckbox'
import type { TaskOutcome } from './taskActions'

export type TaskBadge = 'date' | 'deadline' | 'occurrence' | 'overdue'

export interface TaskRowExtrasOptions {
  /**
   * Calendar entry kinds this row stands for (Task 13's day sections): `deadline` shows a
   * "Deadline" badge, `occurrence` a repeat icon; `date` and `overdue` need none (the section says it).
   */
  badges?: TaskBadge[]
  /** The checkbox wrote and reloaded: the owner patches its list and shows the toast. */
  onResult?(outcome: TaskOutcome): void
  /** The day "N days left" counts from (tests); now otherwise. */
  today?: Date
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
      {date && (
        <span data-testid="task-date" className="inline-flex items-center gap-1 text-[13px] text-fg-muted">
          {formatDate(date)}
          {repeat && (
            <span data-testid="task-repeat" title={describeRepeat(repeat, date.start)} className="inline-flex">
              <Icon name="ph-repeat" size={13} />
            </span>
          )}
          {remind && (
            <span data-testid="task-reminder" title={String(row.values.remind)} className="inline-flex">
              <Icon name="ph-bell" size={13} />
            </span>
          )}
        </span>
      )}
      <DeadlineLabel deadline={deadline} date={date} today={opts.today} />
      {priority && <LabelPill option={priority} />}
    </>
  )

  return {
    leading: <TaskCheckbox row={row} type={type} onResult={opts.onResult} />,
    trailing,
  }
}
