// "Custom repeat": Every N and a unit, "Based on" (Scheduled
// date / Completed date, with their tooltips), "Ends" (Never / On date (inclusive)), Cancel, Save.
// It renders in place inside the date picker (a portaled dialog would dismiss the picker's popover).
// M8: the "On" row (by scheduled date only): weekday chips for weeks; "The {day}", "{pos} {day}",
// "Last day", "Last {day}" for months; "{month} {day}", "{weekday} of {month}" for years. The
// choices are the task day's own (our choice: the picker derives them from the date).
import { useState } from 'react'
import type { RepeatRule } from './taskContract'
import {
  formatOn,
  localDayOf,
  monthName,
  ordinal,
  presetOn,
  validDay,
  WEEKDAY_KEYS,
  weekdayName,
  weekdayOf,
  type RepeatOn,
  type Weekday,
} from './repeat'

type Unit = 'day' | 'week' | 'month' | 'year'

const UNITS: { unit: Unit; one: string; many: string }[] = [
  { unit: 'day', one: 'Day', many: 'Days' },
  { unit: 'week', one: 'Week', many: 'Weeks' },
  { unit: 'month', one: 'Month', many: 'Months' },
  { unit: 'year', one: 'Year', many: 'Years' },
]

const SCHEDULED_TOOLTIP =
  'Each repeat is counted from the due date, no matter when you finish the task.'
const COMPLETED_TOOLTIP = 'Each repeat is counted from the day you actually finish the task.'

export interface CustomRepeatDialogProps {
  /** The current rule, if any (a weekday rule starts the panel at every 1 day). */
  initial: RepeatRule | null
  /** The task's day (`YYYY-MM-DD`): the default end date. */
  day: string
  onSave(rule: RepeatRule): void
  onCancel(): void
  /** M14 (an automation's schedule): repeats by date only, so "Based on" isn't offered. */
  dueDateOnly?: boolean
}

/** The "On" label of an anchored month or year rule. */
export function onLabel(on: RepeatOn): string {
  const month = 'month' in on && on.month ? monthName(on.month) : null
  let base: string
  if ('weekdayPos' in on) {
    base = on.weekdayPos === 'last' ? `Last ${weekdayName(on.weekday)}` : `${ordinal(on.weekdayPos)} ${weekdayName(on.weekday)}`
  } else if ('monthDay' in on && on.monthDay === 'last') {
    base = 'Last day'
  } else if ('monthDay' in on && typeof on.monthDay === 'number') {
    if (month) return `${month} ${on.monthDay}`
    base = `The ${ordinal(on.monthDay)}`
  } else return ''
  return month ? `${base} of ${month}` : base
}

/** The "On" choices for a month or year rule from the task's day `d`. */
export function onChoices(unit: 'month' | 'year', d: Date): RepeatOn[] {
  const wd = weekdayOf(d)
  const pos = Math.floor((d.getDate() - 1) / 7) + 1
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  const lastWeek = d.getDate() + 7 > lastDay
  const month = unit === 'year' ? { month: d.getMonth() + 1 } : {}
  const out: RepeatOn[] = []
  out.push(unit === 'year' ? { month: d.getMonth() + 1, monthDay: d.getDate() } : { monthDay: d.getDate() })
  if (pos <= 4) out.push({ ...month, weekdayPos: pos as 1 | 2 | 3 | 4, weekday: wd })
  if (unit === 'month' && d.getDate() === lastDay) out.push({ monthDay: 'last' })
  if (lastWeek) out.push({ ...month, weekdayPos: 'last', weekday: wd })
  return out
}

const FIELD =
  'h-8 rounded-md border border-line bg-raised px-2 text-[14px] text-fg outline-none focus:border-fg-muted'

export function CustomRepeatDialog({ initial, day, onSave, onCancel, dueDateOnly = false }: CustomRepeatDialogProps) {
  const fromWeekday = initial?.unit === 'weekday'
  const [every, setEvery] = useState(String(initial && !fromWeekday ? initial.every : 1))
  const [unit, setUnit] = useState<Unit>(initial && !fromWeekday ? (initial.unit as Unit) : 'day')
  const [mode, setMode] = useState<RepeatRule['mode']>(initial && !fromWeekday && !dueDateOnly ? initial.mode : 'dueDate')
  const [ends, setEnds] = useState<'never' | 'on'>(initial?.until ? 'on' : 'never')
  const [until, setUntil] = useState(initial?.until ?? day)
  const taskDay = localDayOf(day) ?? new Date()
  const initialOn = initial?.on && initial.unit === unit ? initial.on : null
  const [weekdays, setWeekdays] = useState<Weekday[]>(
    initialOn && 'weekdays' in initialOn && initialOn.weekdays ? initialOn.weekdays : [],
  )
  const defaultOn = (u: Unit): RepeatOn | null =>
    u === 'month' || u === 'year' ? (initial?.on && initial.unit === u ? initial.on : presetOn(u, taskDay)) : null
  const [on, setOn] = useState<RepeatOn | null>(defaultOn(unit))

  const n = /^\d+$/.test(every.trim()) ? parseInt(every, 10) : NaN
  const valid = Number.isInteger(n) && n >= 1 && (ends === 'never' || validDay(until))

  const changeUnit = (u: Unit) => {
    setUnit(u)
    setOn(defaultOn(u))
  }

  const choices = unit === 'month' || unit === 'year' ? onChoices(unit, taskDay) : []
  if (on && !choices.some((c) => formatOn(c) === formatOn(on))) choices.unshift(on)

  const save = () => {
    if (!valid) return
    const rule: RepeatRule = { every: n, unit, mode }
    if (mode === 'dueDate') {
      if (unit === 'week' && weekdays.length > 0) rule.on = { weekdays: WEEKDAY_KEYS.filter((w) => weekdays.includes(w)) }
      if ((unit === 'month' || unit === 'year') && on) rule.on = on
    }
    if (ends === 'on') rule.until = until
    onSave(rule)
  }

  return (
    <div role="dialog" aria-label="Custom repeat" className="flex flex-col gap-3 p-1 text-fg">
      <h2 className="px-1 text-[15px] font-semibold">Custom repeat</h2>

      <div className="flex items-center gap-2 px-1">
        <label htmlFor="custom-repeat-every" className="w-16 text-[14px]">
          Every
        </label>
        <input
          id="custom-repeat-every"
          type="number"
          min={1}
          value={every}
          onChange={(e) => setEvery(e.target.value)}
          className={`${FIELD} w-16`}
        />
        <select
          aria-label="Unit"
          value={unit}
          onChange={(e) => changeUnit(e.target.value as Unit)}
          className={`${FIELD} flex-1`}
        >
          {UNITS.map((u) => (
            <option key={u.unit} value={u.unit}>
              {n === 1 ? u.one : u.many}
            </option>
          ))}
        </select>
      </div>

      {mode === 'dueDate' && unit === 'week' && (
        <div role="group" aria-label="On" className="flex items-center gap-2 px-1">
          <span className="w-16 text-[14px]">On</span>
          <div className="flex flex-wrap gap-1">
            {WEEKDAY_KEYS.map((w) => {
              const pressed = weekdays.includes(w)
              return (
                <button
                  key={w}
                  type="button"
                  aria-label={weekdayName(w)}
                  aria-pressed={pressed}
                  onClick={() => setWeekdays((cur) => (pressed ? cur.filter((x) => x !== w) : [...cur, w]))}
                  className={`h-7 w-7 rounded-full text-[12px] ${pressed ? 'bg-primary-btn text-app' : 'bg-hover text-fg hover:opacity-90'}`}
                >
                  {weekdayName(w).slice(0, 2)}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {mode === 'dueDate' && (unit === 'month' || unit === 'year') && on && (
        <div className="flex items-center gap-2 px-1">
          <label htmlFor="custom-repeat-on" className="w-16 text-[14px]">
            On
          </label>
          <select
            id="custom-repeat-on"
            value={formatOn(on)}
            onChange={(e) => setOn(choices.find((c) => formatOn(c) === e.target.value) ?? on)}
            className={`${FIELD} flex-1`}
          >
            {choices.map((c) => (
              <option key={formatOn(c)} value={formatOn(c)}>
                {onLabel(c)}
              </option>
            ))}
          </select>
        </div>
      )}

      {!dueDateOnly && (
        <fieldset className="px-1">
          <legend className="pb-1 text-[13px] font-medium text-fg-muted">Based on</legend>
          <label className="flex items-center gap-2 py-0.5 text-[14px]" title={SCHEDULED_TOOLTIP}>
            <input type="radio" name="custom-repeat-mode" checked={mode === 'dueDate'} onChange={() => setMode('dueDate')} />
            Scheduled date
          </label>
          <label className="flex items-center gap-2 py-0.5 text-[14px]" title={COMPLETED_TOOLTIP}>
            <input
              type="radio"
              name="custom-repeat-mode"
              checked={mode === 'completionDate'}
              onChange={() => setMode('completionDate')}
            />
            Completed date
          </label>
        </fieldset>
      )}

      <fieldset className="px-1">
        <legend className="pb-1 text-[13px] font-medium text-fg-muted">Ends</legend>
        <label className="flex items-center gap-2 py-0.5 text-[14px]">
          <input type="radio" name="custom-repeat-ends" checked={ends === 'never'} onChange={() => setEnds('never')} />
          Never
        </label>
        <label className="flex items-center gap-2 py-0.5 text-[14px]">
          <input type="radio" name="custom-repeat-ends" checked={ends === 'on'} onChange={() => setEnds('on')} />
          On date (inclusive)
        </label>
        {ends === 'on' && (
          <input
            type="date"
            aria-label="End date"
            value={until}
            onChange={(e) => setUntil(e.target.value)}
            className={`${FIELD} mt-1 w-full`}
          />
        )}
      </fieldset>

      <div className="flex justify-end gap-2 px-1">
        <button type="button" onClick={onCancel} className="rounded-md px-3 py-1 text-[14px] hover:bg-hover">
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!valid}
          className="rounded-md bg-primary-btn px-3 py-1 text-[14px] font-medium text-app hover:opacity-90 disabled:opacity-50"
        >
          Save
        </button>
      </div>
    </div>
  )
}
