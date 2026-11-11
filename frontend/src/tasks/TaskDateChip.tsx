// M32: a task row's date chip. It shows the task's date (an overdue one in the theme's danger
// colour) and opens a small picker: Today, Tomorrow, Next week, No date, and "Pick a date" for the
// date picker of the property panel. A task with no date has the chip too (the calendar icon), so
// a date is one click and a pick away. Like the checkbox it owns no row state: it writes the date
// (`taskActions.setDate`) and hands the outcome to the owner, which patches its list.
import { useState, type ReactNode, type SyntheticEvent } from 'react'
import type { DateValue, Row, TypeDef } from '@/api/types'
import { addDays, parseYmd, ymd } from '@/calendar/dates'
import { Icon } from '@/components/Icon'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { fromWallClock, wallClock, zonedToday } from '@/lib/zonedTime'
import { DatePicker } from '@/properties/DatePicker'
import { formatDate } from '@/properties/format'
import { isOpen } from './statusCategory'
import { DEFAULT_TASK_API, setDate, type TaskApi, type TaskOutcome } from './taskActions'
import { coveredDays } from './taskSections'

export const TASK_DATE_TEXT = {
  /** The chip's name ("Date: Nov 13, 2026"); the Task type's own word for the property. */
  label: 'Date',
  today: 'Today',
  tomorrow: 'Tomorrow',
  nextWeek: 'Next week',
  noDate: 'No date',
  /** As the Calendar's "Move all open tasks to" (our string). */
  pickDate: 'Pick a date',
}

const asDate = (v: unknown): DateValue | null =>
  v && typeof v === 'object' && typeof (v as DateValue).start === 'string' && (v as DateValue).start ? (v as DateValue) : null

const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 86_400_000

/** Whole days from day `a` to day `b`. */
function daysBetween(a: string, b: string): number {
  const from = parseYmd(a)
  const to = parseYmd(b)
  return from && to ? Math.round((to.getTime() - from.getTime()) / DAY_MS) : 0
}

/**
 * `current` moved to `day` (`YYYY-MM-DD`): a day date becomes that day, a time keeps its time of
 * day (in the Time zone setting), and a range keeps its length. Nothing to move is the day itself.
 */
export function dateOnDay(current: DateValue | null | undefined, day: string): DateValue {
  if (!current?.start) return { start: day, resolution: 'day' }
  if (current.resolution === 'day' || DAY_ONLY.test(current.start)) {
    const from = current.start.slice(0, 10)
    const end = current.end ? addDays(current.end.slice(0, 10), daysBetween(from, day)) : null
    return end ? { start: day, end, resolution: 'day' } : { start: day, resolution: 'day' }
  }
  const target = parseYmd(day)
  const start = wallClock(current.start)
  if (!target || Number.isNaN(start.getTime())) return { start: day, resolution: 'day' }
  const delta = daysBetween(ymd(start), day)
  const shift = (point: string): string => {
    const w = wallClock(point)
    return fromWallClock(new Date(w.getFullYear(), w.getMonth(), w.getDate() + delta, w.getHours(), w.getMinutes(), w.getSeconds())).toISOString()
  }
  const end = current.end && !Number.isNaN(new Date(current.end).getTime()) ? shift(current.end) : null
  return end ? { start: shift(current.start), end, resolution: 'time' } : { start: shift(current.start), resolution: 'time' }
}

/** An open task whose date ended before `today` (`YYYY-MM-DD`; default: today in the Time zone setting). */
export function isOverdue(row: Row, type: TypeDef | undefined, today: string = zonedToday()): boolean {
  const date = asDate(row.values.date)
  const span = date ? coveredDays(date) : null
  return !!span && span.last < today && isOpen(row, type)
}

/** Clicks and drags on the chip never reach the row or card around it (open, peek, drag). */
const stop = (e: SyntheticEvent) => e.stopPropagation()

const ITEM = 'flex h-8 items-center gap-2 rounded-md px-2 text-left text-[14px] text-fg hover:bg-hover'

export function TaskDateChip({
  row,
  type,
  onResult,
  taskApi = DEFAULT_TASK_API,
  today: todayProp,
  children,
}: {
  row: Row
  type: TypeDef | undefined
  /** The date was written and the row reloaded: the owner patches its list and shows the toast. */
  onResult?(outcome: TaskOutcome): void
  /** Injected in tests; the real `api` otherwise. */
  taskApi?: TaskApi
  /** The day "today" is (tests); today in the Time zone setting otherwise. */
  today?: Date
  /** Drawn after the date, inside the chip (the repeat and reminder icons). */
  children?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const date = asDate(row.values.date)
  const today = todayProp ? ymd(todayProp) : zonedToday()
  const overdue = isOverdue(row, type, today)
  const text = formatDate(date)

  if (row.summary.readOnly) {
    if (!date) return null
    return (
      <span data-testid="task-date" className="inline-flex items-center gap-1 text-[13px] text-fg-muted">
        {text}
        {children}
      </span>
    )
  }

  const write = async (next: DateValue | null) => {
    if (busy) return
    setBusy(true)
    try {
      const outcome = await setDate(taskApi, row, next)
      onResult?.(outcome)
    } finally {
      setBusy(false)
    }
  }

  /** A quick choice: write it and close. */
  const pick = (next: DateValue | null) => {
    setOpen(false)
    void write(next)
  }

  const choices: [string, DateValue | null][] = [
    [TASK_DATE_TEXT.today, dateOnDay(date, today)],
    [TASK_DATE_TEXT.tomorrow, dateOnDay(date, addDays(today, 1))],
    [TASK_DATE_TEXT.nextWeek, dateOnDay(date, addDays(today, 7))],
    [TASK_DATE_TEXT.noDate, null],
  ]

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setPicking(false)
      }}
    >
      <span className="inline-flex shrink-0 items-center" onPointerDown={stop} onMouseDown={stop} onKeyDown={stop} onClick={stop}>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-testid="task-date"
            data-overdue={overdue || undefined}
            aria-label={`${TASK_DATE_TEXT.label}: ${text || TASK_DATE_TEXT.noDate}`}
            className={cn(
              'inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[13px] hover:bg-hover',
              overdue ? 'text-[var(--danger)]' : 'text-fg-muted',
            )}
          >
            <Icon name="ph-calendar" size={13} />
            {text}
            {children}
          </button>
        </PopoverTrigger>
      </span>
      <PopoverContent align="end" className="w-auto border-line bg-raised p-0 text-fg" onClick={stop} onPointerDown={stop} onKeyDown={stop}>
        {picking ? (
          <DatePicker
            value={date}
            constraints={type?.propertyDefinitions.find((d) => d.key === 'date')?.options.constraints}
            now={todayProp}
            onChange={(next) => {
              void write(next)
              if (next === null) setOpen(false)
            }}
            // M32: Enter in the date field, once the date is set, closes the chip's picker.
            onClose={() => setOpen(false)}
          />
        ) : (
          <div role="menu" aria-label={TASK_DATE_TEXT.label} className="flex w-44 flex-col p-1.5">
            {choices.map(([label, value]) => (
              <button key={label} type="button" role="menuitem" disabled={busy} onClick={() => pick(value)} className={ITEM}>
                {label}
              </button>
            ))}
            <div className="my-1 border-t border-line" />
            <button type="button" role="menuitem" onClick={() => setPicking(true)} className={ITEM}>
              <Icon name="ph-calendar" size={14} className="text-fg-muted" />
              {TASK_DATE_TEXT.pickDate}
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
