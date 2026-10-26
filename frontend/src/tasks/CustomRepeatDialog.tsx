// "Custom repeat" (`DatePicker.recurrenceCustom.*`): Every N and a unit, "Based on" (Scheduled
// date / Completed date, with their tooltips), "Ends" (Never / On date (inclusive)), Cancel, Save.
// It renders in place inside the date picker (a portaled dialog would dismiss the picker's popover).
import { useState } from 'react'
import type { RepeatRule } from '@/api/types'
import { validDay } from './repeat'

type Unit = 'day' | 'week' | 'month' | 'year'

const UNITS: { unit: Unit; one: string; many: string }[] = [
  { unit: 'day', one: 'Day', many: 'Days' },
  { unit: 'week', one: 'Week', many: 'Weeks' },
  { unit: 'month', one: 'Month', many: 'Months' },
  { unit: 'year', one: 'Year', many: 'Years' },
]

const SCHEDULED_TOOLTIP =
  'Repeats on a fixed schedule relative to the due date, regardless of when you complete the task.'
const COMPLETED_TOOLTIP = 'The next occurrence is scheduled relative to when you actually complete the task.'

export interface CustomRepeatDialogProps {
  /** The current rule, if any (a weekday rule starts the panel at every 1 day). */
  initial: RepeatRule | null
  /** The task's day (`YYYY-MM-DD`): the default end date. */
  day: string
  onSave(rule: RepeatRule): void
  onCancel(): void
}

const FIELD =
  'h-8 rounded-md border border-line bg-raised px-2 text-[14px] text-fg outline-none focus:border-fg-muted [color-scheme:dark]'

export function CustomRepeatDialog({ initial, day, onSave, onCancel }: CustomRepeatDialogProps) {
  const fromWeekday = initial?.unit === 'weekday'
  const [every, setEvery] = useState(String(initial && !fromWeekday ? initial.every : 1))
  const [unit, setUnit] = useState<Unit>(initial && !fromWeekday ? (initial.unit as Unit) : 'day')
  const [mode, setMode] = useState<RepeatRule['mode']>(initial && !fromWeekday ? initial.mode : 'dueDate')
  const [ends, setEnds] = useState<'never' | 'on'>(initial?.until ? 'on' : 'never')
  const [until, setUntil] = useState(initial?.until ?? day)

  const n = /^\d+$/.test(every.trim()) ? parseInt(every, 10) : NaN
  const valid = Number.isInteger(n) && n >= 1 && (ends === 'never' || validDay(until))

  const save = () => {
    if (!valid) return
    const rule: RepeatRule = { every: n, unit, mode }
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
          onChange={(e) => setUnit(e.target.value as Unit)}
          className={`${FIELD} flex-1`}
        >
          {UNITS.map((u) => (
            <option key={u.unit} value={u.unit}>
              {n === 1 ? u.one : u.many}
            </option>
          ))}
        </select>
      </div>

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
