// The date picker of datetime properties: a natural-language input per point, Object's
// suggestion lists, "Include Time" and "Range" toggles that honour the property's constraints,
// and "Remove date". The Task `date` (M4) adds the schedule suggestions, a "Repeat" row and a
// "Reminder" row; there every change carries `{date, repeat, remind}` together. Any other date
// property with `supportsReminders` (M8) shows the same "Reminder" row, written on its own through
// `PUT /api/tasks/reminder` (the owner's `reminder.onChange`).
import { useEffect, useId, useMemo, useState } from 'react'
import type { DateConstraints, DateValue, Resolution } from '@/api/types'
import { Switch } from '@/components/ui/switch'
import { CustomRepeatDialog } from '@/tasks/CustomRepeatDialog'
import { REMINDER_MISFIT_HINT, ReminderMenu } from '@/tasks/ReminderMenu'
import { RepeatMenu } from '@/tasks/RepeatMenu'
import { formatRepeat, parseRepeat } from '@/tasks/repeat'
import { parseRemind } from '@/tasks/remind'
import { formatDate } from './format'

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
/** The time a day gets when it gains a time and has none to keep. */
const DEFAULT_HOUR = 9

const pad = (n: number) => String(n).padStart(2, '0')

/** A local calendar date as `YYYY-MM-DD`. */
function dayString(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes())
}

function validDate(y: number, m: number, d: number): Date | null {
  const date = new Date(y, m, d)
  return date.getFullYear() === y && date.getMonth() === m && date.getDate() === d ? date : null
}

/** A point of a DateValue as a local Date (a day is local midnight). */
function pointDate(point: string, resolution: Resolution): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(point)
  if (resolution === 'day' || m) {
    const mm = m ?? /^(\d{4})-(\d{2})-(\d{2})/.exec(point)
    if (mm) return new Date(+mm[1], +mm[2] - 1, +mm[3])
  }
  return new Date(point)
}

/** `base`'s calendar day at `resolution`; a time keeps the time of day of `keep` (else 09:00). */
function atDay(base: Date, resolution: Resolution, keep?: Date | null): string {
  if (resolution === 'day') return dayString(base)
  const h = keep ? keep.getHours() : DEFAULT_HOUR
  const min = keep ? keep.getMinutes() : 0
  return new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, min).toISOString()
}

function convertPoint(point: string, from: Resolution, to: Resolution): string {
  if (from === to) return point
  return atDay(pointDate(point, from), to)
}

function parseDayPart(t: string, now: Date): Date | null {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (t === '' || t === 'today' || t === 'now') return today
  if (t === 'yesterday') return addDays(today, -1)
  if (t === 'tomorrow') return addDays(today, 1)
  if (t === 'next week') return addDays(today, 7)
  let m = /^in (\d+|a|an|one) (day|days|week|weeks)$/.exec(t)
  if (m) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : 1
    return addDays(today, m[2].startsWith('week') ? n * 7 : n)
  }
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t)
  if (m) return validDate(+m[1], +m[2] - 1, +m[3])
  m = /^([a-z]+)\.? (\d{1,2})(?:st|nd|rd|th)?(?:,? (\d{4}))?$/.exec(t)
  if (m) {
    const month = MONTHS.indexOf(m[1].slice(0, 3))
    if (month < 0 || (m[1].length > 3 && !MONTH_NAMES[month].startsWith(m[1]))) return null
    return validDate(m[3] ? Number(m[3]) : now.getFullYear(), month, Number(m[2]))
  }
  return null
}

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]

function parseTimePart(t: string): { h: number; min: number } | null {
  const m = /^(\d{1,2})(?::(\d{2}))? ?(am|pm|a\.m\.|p\.m\.)?$/.exec(t)
  if (!m) return null
  let h = Number(m[1])
  const min = m[2] ? Number(m[2]) : 0
  const ampm = m[3]?.replace(/\./g, '')
  if (min > 59) return null
  if (ampm) {
    if (h < 1 || h > 12) return null
    if (ampm === 'pm' && h < 12) h += 12
    if (ampm === 'am' && h === 12) h = 0
  } else if (h > 23 || !m[2]) {
    // Without am/pm a time needs minutes ("at 9" alone is not read) and a 24-hour hour.
    return null
  }
  return { h, min }
}

/**
 * What the user typed into a date field, read the way Object's natural-language field reads
 * it: ISO dates and timestamps; Yesterday, Today, Tomorrow, "next week"; "in N days" and
 * "in N weeks"; "March 14th" (optionally with a year); and any of these followed by
 * "at 1:59 PM". A day without a time is a day value; with a time it is a local time. `null` when
 * nothing could be read.
 */
export function parseDateInput(s: string, now: Date = new Date()): DateValue | null {
  const raw = s.trim()
  if (!raw) return null
  if (/^\d{4}-\d{2}-\d{2}T/i.test(raw)) {
    const d = new Date(raw)
    return Number.isNaN(d.getTime()) ? null : { start: d.toISOString(), resolution: 'time' }
  }
  const t = raw.toLowerCase().replace(/\s+/g, ' ')
  const at = t.lastIndexOf(' at ')
  let dayPart = t
  let timePart: string | null = null
  if (at >= 0) {
    dayPart = t.slice(0, at).trim()
    timePart = t.slice(at + 4).trim()
  } else if (t.startsWith('at ')) {
    dayPart = ''
    timePart = t.slice(3).trim()
  } else if (/^\d{1,2}(:\d{2})? ?(am|pm)$|^\d{1,2}:\d{2}$/.test(t)) {
    dayPart = ''
    timePart = t
  }
  if (dayPart === '' && timePart === null) return null
  const day = parseDayPart(dayPart, now)
  if (!day) return null
  if (timePart === null) return { start: dayString(day), resolution: 'day' }
  const time = parseTimePart(timePart)
  if (!time) return null
  const d = new Date(day.getFullYear(), day.getMonth(), day.getDate(), time.h, time.min)
  return { start: d.toISOString(), resolution: 'time' }
}

const START_SUGGESTIONS: { label: string; days: number }[] = [
  { label: 'Yesterday', days: -1 },
  { label: 'Today', days: 0 },
  { label: 'Tomorrow', days: 1 },
  { label: 'In 1 week', days: 7 },
  { label: 'In 2 weeks', days: 14 },
]

/** The Task date's quick suggestions (`DatePicker.suggestions.schedule.*`). */
const SCHEDULE_SUGGESTIONS: { label: string; tooltip: string; pick(today: Date): Date }[] = [
  { label: 'Today', tooltip: 'Schedule task for today', pick: (t) => t },
  { label: 'Tomorrow', tooltip: 'Schedule task for tomorrow', pick: (t) => addDays(t, 1) },
  { label: 'Next week', tooltip: 'Schedule task for the next week', pick: (t) => addDays(t, 7) },
  { label: 'Next month', tooltip: 'Schedule task for the next month', pick: addMonth },
]

/** The same day next month, clamped to the month's last day. */
function addMonth(d: Date): Date {
  const last = new Date(d.getFullYear(), d.getMonth() + 2, 0).getDate()
  return new Date(d.getFullYear(), d.getMonth() + 1, Math.min(d.getDate(), last))
}

const END_SUGGESTIONS: { label: string; days: number }[] = [
  { label: 'Same day', days: 0 },
  { label: '1 day', days: 1 },
  { label: '2 days', days: 2 },
  { label: '1 week', days: 7 },
  { label: '2 weeks', days: 14 },
]

/** The Task date picker's one change: the date with its `repeat` and `remind` texts (null: none). */
export interface TaskDateChange {
  date: DateValue | null
  repeat: string | null
  remind: string | null
}

export interface DatePickerProps {
  value: DateValue | null
  constraints?: DateConstraints | null
  onChange(next: DateValue | null): void
  /** The current time (tests). */
  now?: Date
  /**
   * The Task `date` (M4): its current `repeat` and `remind` texts. Given with `onTaskChange`, the
   * picker shows the schedule suggestions and the Repeat row (and the Reminder row when
   * `constraints.supportsReminders`), and every change goes to `onTaskChange` instead of `onChange`.
   * A non-empty `occurrenceLog` (M8) makes "Remove recurrence" ask first; the owner removes the log
   * with `repeat`.
   */
  task?: { repeat: string | null; remind: string | null; occurrenceLog?: string | null }
  onTaskChange?(next: TaskDateChange): void
  /**
   * M8: the reminder of a date property other than the Task `date` (its `reminders` entry). Shown
   * when `constraints.supportsReminders`; a pick on an empty date first sets the shown date.
   */
  reminder?: { value: string | null; onChange(remind: string | null): void }
}

/** The value the picker shows when the property is empty: the defaults when set, else now. */
function initialValue(c: DateConstraints, now: Date): DateValue {
  const resolution: Resolution =
    c.resolutionConstraint ?? c.resolutionPreference ?? (c.startTimeDefault ? 'time' : 'day')
  const start = c.startTimeDefault ? new Date(c.startTimeDefault) : now
  const v: DateValue = {
    start: resolution === 'day' ? dayString(start) : start.toISOString(),
    resolution,
  }
  const wantsEnd =
    c.endTimeSettings !== 'notAllowed' && (c.endTimeSettings === 'required' || c.endTimePreference === true)
  if (wantsEnd) {
    const end = c.endTimeDefault ? new Date(c.endTimeDefault) : start
    v.end = resolution === 'day' ? dayString(end) : end.toISOString()
  }
  return v
}

function PointInput({
  label,
  point,
  resolution,
  placeholder,
  onCommit,
}: {
  label: string
  point: string
  resolution: Resolution
  placeholder: string
  onCommit(text: string): boolean
}) {
  const shown = formatDate({ start: point, resolution })
  const [text, setText] = useState(shown)
  useEffect(() => setText(shown), [shown])
  const commit = () => {
    if (text.trim() === shown) return
    if (!onCommit(text)) setText(shown)
  }
  return (
    <input
      aria-label={label}
      value={text}
      placeholder={placeholder}
      title='This field supports natural language like "next week at 3 pm"'
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
        }
      }}
      className="h-8 w-full rounded-md border border-line bg-raised px-2 text-[14px] text-fg outline-none placeholder:text-fg-muted focus:border-fg-muted"
    />
  )
}

function TimeInput({ label, point, onChange }: { label: string; point: string; onChange(iso: string): void }) {
  const d = new Date(point)
  const value = Number.isNaN(d.getTime()) ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}`
  return (
    <input
      type="time"
      aria-label={label}
      value={value}
      onChange={(e) => {
        const m = /^(\d{2}):(\d{2})$/.exec(e.target.value)
        if (!m || Number.isNaN(d.getTime())) return
        onChange(new Date(d.getFullYear(), d.getMonth(), d.getDate(), +m[1], +m[2]).toISOString())
      }}
      className="h-8 w-28 shrink-0 rounded-md border border-line bg-raised px-2 text-[14px] text-fg outline-none [color-scheme:dark]"
    />
  )
}

function Suggestions({
  items,
  onPick,
}: {
  items: { label: string; days: number }[]
  onPick(days: number): void
}) {
  return (
    <div className="mt-1 flex flex-col">
      {items.map((s) => (
        <button
          key={s.label}
          type="button"
          onClick={() => onPick(s.days)}
          className="rounded-md px-2 py-1 text-left text-[14px] text-fg hover:bg-hover"
        >
          {s.label}
        </button>
      ))}
    </div>
  )
}

function Toggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string
  checked: boolean
  disabled?: boolean
  onChange(next: boolean): void
}) {
  const id = useId()
  return (
    <div className="flex items-center justify-between px-2 py-1">
      <label htmlFor={id} className="text-[14px] text-fg">
        {label}
      </label>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  )
}

/**
 * Edits a datetime value. On an empty value it starts from the property's `startTimeDefault` /
 * `endTimeDefault` (else now) and writes only once the user picks something.
 * - `resolutionConstraint` fixes "Include Time" (on for `time`, off for `day`).
 * - `endTimeSettings: 'notAllowed'` hides "Range"; `'required'` keeps it on.
 * - `hideDeleteOption` hides "Remove date".
 */
export function DatePicker({ value, constraints, onChange, now: nowProp, task, onTaskChange, reminder }: DatePickerProps) {
  const c = useMemo(() => constraints ?? {}, [constraints])
  const now = useMemo(() => nowProp ?? new Date(), [nowProp])
  const current = useMemo(() => value ?? initialValue(c, now), [value, c, now])
  const forced = c.resolutionConstraint ?? null
  const resolution: Resolution = forced ?? current.resolution
  const start = convertPoint(current.start, current.resolution, resolution)
  const end = current.end ? convertPoint(current.end, current.resolution, resolution) : null
  const rangeAllowed = c.endTimeSettings !== 'notAllowed'
  const rangeRequired = c.endTimeSettings === 'required'
  const isRange = rangeAllowed && (!!end || rangeRequired)
  const taskMode = !!task && !!onTaskChange
  const reminders = taskMode && !!c.supportsReminders
  /** M8: a non-Task date property's own Reminder row. */
  const propReminder = !taskMode && !!reminder && !!c.supportsReminders
  const [customOpen, setCustomOpen] = useState(false)
  const [dropped, setDropped] = useState(false)

  /** The Task change for `date` with these texts; a reminder that fit and no longer does is dropped. */
  const emitTask = (date: DateValue | null, repeat: string | null, remind: string | null) => {
    let r = remind
    if (date && r && parseRemind(r, resolution) && !parseRemind(r, date.resolution)) {
      r = null
      setDropped(true)
    }
    onTaskChange?.({ date, repeat, remind: r })
  }

  const emit = (next: { start: string; end?: string | null; resolution: Resolution }) => {
    const res = forced ?? next.resolution
    const s = convertPoint(next.start, next.resolution, res)
    let e = next.end ? convertPoint(next.end, next.resolution, res) : null
    if (!rangeAllowed) e = null
    else if (rangeRequired && !e) e = s
    if (e && pointDate(e, res) < pointDate(s, res)) e = s
    const v: DateValue = e ? { start: s, end: e, resolution: res } : { start: s, resolution: res }
    if (taskMode) emitTask(v, task!.repeat, task!.remind)
    else onChange(v)
  }

  /** The date the picker shows, as a value (what a Repeat or Reminder pick on an empty date sets). */
  const shownDate = (): DateValue => (end ? { start, end, resolution } : { start, resolution })

  const setResolution = (toTime: boolean) => {
    const to: Resolution = toTime ? 'time' : 'day'
    emit({
      start: convertPoint(start, resolution, to),
      end: end ? convertPoint(end, resolution, to) : null,
      resolution: to,
    })
  }

  const commitText = (which: 'start' | 'end') => (text: string) => {
    const parsed = parseDateInput(text, now)
    if (!parsed) return false
    let res: Resolution = resolution
    let point: string
    if (parsed.resolution === 'time' && forced !== 'day') {
      res = 'time'
      point = parsed.start
    } else {
      const keep = resolution === 'time' ? new Date(which === 'start' ? start : (end ?? start)) : null
      point = atDay(pointDate(parsed.start, parsed.resolution), res, keep)
    }
    const s = which === 'start' ? point : convertPoint(start, resolution, res)
    const e = which === 'end' ? point : end ? convertPoint(end, resolution, res) : null
    emit({ start: s, end: e, resolution: res })
    return true
  }

  const pickStart = (days: number) => {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const keep = resolution === 'time' ? new Date(start) : null
    emit({ start: atDay(addDays(today, days), resolution, keep), end, resolution })
  }

  const pickSchedule = (pick: (today: Date) => Date) => {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const keep = resolution === 'time' ? new Date(start) : null
    emit({ start: atDay(pick(today), resolution, keep), end, resolution })
  }

  const pickEnd = (days: number) => {
    const base = pointDate(start, resolution)
    const keep = resolution === 'time' ? new Date(end ?? start) : null
    emit({ start, end: atDay(addDays(base, days), resolution, keep), resolution })
  }

  if (taskMode && customOpen) {
    return (
      <div className="flex w-72 flex-col gap-2 p-2 text-fg" data-testid="date-picker">
        <CustomRepeatDialog
          initial={parseRepeat(task!.repeat)}
          day={dayString(pointDate(start, resolution))}
          onCancel={() => setCustomOpen(false)}
          onSave={(rule) => {
            setCustomOpen(false)
            emitTask(shownDate(), formatRepeat(rule), task!.remind)
          }}
        />
      </div>
    )
  }

  const remindHint =
    taskMode && (dropped || (task!.remind && parseRemind(task!.remind) && !parseRemind(task!.remind, resolution)))
      ? REMINDER_MISFIT_HINT
      : null
  // A property reminder is kept when the date's resolution changes; the row says it no longer fits.
  const propRemindHint =
    propReminder && reminder!.value && parseRemind(reminder!.value) && !parseRemind(reminder!.value, resolution)
      ? REMINDER_MISFIT_HINT
      : null

  return (
    <div className="flex w-72 flex-col gap-2 p-2 text-fg" data-testid="date-picker">
      <div>
        {isRange && <div className="px-1 pb-1 text-[12px] font-medium text-fg-muted">Starts</div>}
        <div className="flex items-center gap-2">
          <PointInput
            label="Starts"
            point={start}
            resolution={resolution}
            placeholder="March 14th at 1:59 PM"
            onCommit={commitText('start')}
          />
          {resolution === 'time' && (
            <TimeInput label="Start time" point={start} onChange={(iso) => emit({ start: iso, end, resolution })} />
          )}
        </div>
        {resolution === 'day' && <div className="px-1 pt-1 text-[12px] text-fg-muted">All-day</div>}
        {taskMode ? (
          <div className="mt-1 flex flex-col">
            {SCHEDULE_SUGGESTIONS.map((s) => (
              <button
                key={s.label}
                type="button"
                title={s.tooltip}
                onClick={() => pickSchedule(s.pick)}
                className="rounded-md px-2 py-1 text-left text-[14px] text-fg hover:bg-hover"
              >
                {s.label}
              </button>
            ))}
          </div>
        ) : (
          <Suggestions items={START_SUGGESTIONS} onPick={pickStart} />
        )}
      </div>

      {isRange && end && (
        <div>
          <div className="px-1 pb-1 text-[12px] font-medium text-fg-muted">Ends</div>
          <div className="flex items-center gap-2">
            <PointInput
              label="Ends"
              point={end}
              resolution={resolution}
              placeholder="End Date"
              onCommit={commitText('end')}
            />
            {resolution === 'time' && (
              <TimeInput label="End time" point={end} onChange={(iso) => emit({ start, end: iso, resolution })} />
            )}
          </div>
          <Suggestions items={END_SUGGESTIONS} onPick={pickEnd} />
        </div>
      )}

      <div className="border-t border-line pt-1">
        <Toggle
          label="Include Time"
          checked={resolution === 'time'}
          disabled={forced !== null}
          onChange={setResolution}
        />
        {rangeAllowed && (
          <Toggle
            label="Range"
            checked={isRange}
            disabled={rangeRequired}
            onChange={(on) => emit({ start, end: on ? start : null, resolution })}
          />
        )}
      </div>

      {taskMode && (
        <div className="border-t border-line pt-1">
          <RepeatMenu
            value={task!.repeat}
            date={start}
            onChange={(repeat) => emitTask(shownDate(), repeat, task!.remind)}
            onCustom={() => setCustomOpen(true)}
            hasHistory={!!task!.occurrenceLog?.trim()}
          />
          {reminders && (
            <ReminderMenu
              value={task!.remind}
              resolution={resolution}
              hint={remindHint}
              onChange={(remind) => {
                setDropped(false)
                emitTask(shownDate(), task!.repeat, remind)
              }}
            />
          )}
        </div>
      )}

      {propReminder && (
        <div className="border-t border-line pt-1">
          <ReminderMenu
            value={reminder!.value}
            resolution={resolution}
            hint={propRemindHint}
            onChange={(remind) => {
              if (!value && remind !== null) onChange(shownDate())
              reminder!.onChange(remind)
            }}
          />
        </div>
      )}

      {!c.hideDeleteOption && (
        <button
          type="button"
          onClick={() => {
            if (taskMode) return onTaskChange!({ date: null, repeat: null, remind: null })
            onChange(null)
            // Our choice: a reminder on a removed date goes with it.
            if (propReminder && reminder!.value) reminder!.onChange(null)
          }}
          className="rounded-md px-2 py-1 text-left text-[14px] text-[var(--danger)] hover:bg-hover"
        >
          Remove date
        </button>
      )}
    </div>
  )
}
