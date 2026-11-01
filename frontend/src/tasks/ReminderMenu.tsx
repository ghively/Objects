// The "Reminder" row of the Task date picker (`DatePicker.reminder.*`): "No reminder" and the
// presets for the date's resolution, in an inline list (no portal). Day dates add the "Time" field
// and its suggestions. Writes the canonical `remind` text (remind.ts).
import { useState } from 'react'
import type { ReminderRule, Resolution } from '@/api/types'
import { Icon } from '@/components/Icon'
import { formatRemind, parseRemind } from './remind'

export interface ReminderMenuProps {
  /** The raw `remind` text (null: no reminder). */
  value: string | null
  /** The task date's resolution: which presets apply. */
  resolution: Resolution
  onChange(next: string | null): void
  /** A hint under the row ("Doesn't fit this date."). */
  hint?: string | null
}

/** Our string: a reminder that does not fit the date's resolution (kept, or dropped on a switch). */
export const REMINDER_MISFIT_HINT = "Doesn't fit this date."
/** Our string, after `NotificationsSettings.deliveryLimits.desktop.body`; shown once per machine. */
export const REMINDER_NOTICE = 'Reminders show as system notifications while Object is running.'
const NOTICE_KEY = 'object.reminderNoticeShown'

/** The time a day reminder gets when none is set (our default: "Morning"). */
export const DEFAULT_REMINDER_TIME = '09:00'

/**
 * `DatePicker.reminder.timeSuggestions.*`. The times are ours: the trimmed reference has the
 * labels, not their values.
 */
const TIME_SUGGESTIONS: { label: string; time: string }[] = [
  { label: 'Morning', time: '09:00' },
  { label: 'Noon', time: '12:00' },
  { label: 'Afternoon', time: '15:00' },
  { label: 'Evening', time: '18:00' },
  { label: 'Night', time: '21:00' },
]

/** Preset offsets (the counts are ours; the labels are `DatePicker.reminder.presets.*`). */
const TIME_PRESETS = [0, 5, 15, 30, 60]
const DAY_PRESETS = [0, 1, 2, 7]

function timeLabel(minutes: number): string {
  if (minutes === 0) return 'At time of event'
  if (minutes === 60) return '1 hour before'
  return `${minutes} minutes before`
}

function dayLabel(days: number): string {
  if (days === 0) return 'On the day'
  if (days === 1) return '1 day before'
  return `${days} days before`
}

function labelOf(rule: ReminderRule, resolution: Resolution): string {
  return resolution === 'time' ? timeLabel(rule.minutesBefore) : dayLabel(rule.daysBefore)
}

/** Whether the one-time notice was already shown on this machine (marks it shown). */
function firstReminderEver(): boolean {
  try {
    if (localStorage.getItem(NOTICE_KEY)) return false
    localStorage.setItem(NOTICE_KEY, '1')
    return true
  } catch {
    return false
  }
}

export function ReminderMenu({ value, resolution, onChange, hint }: ReminderMenuProps) {
  const [open, setOpen] = useState(false)
  const [notice, setNotice] = useState(false)
  const rule = parseRemind(value, resolution)
  const [time, setTime] = useState(rule?.timeOfDay ?? DEFAULT_REMINDER_TIME)
  // The saved time can change from elsewhere (another window, an undo): follow it, except while
  // the field has focus, where it waits for the blur.
  const propTime = rule?.timeOfDay
  const [synced, setSynced] = useState(propTime)
  const [editing, setEditing] = useState(false)
  if (propTime !== synced && !editing) {
    setSynced(propTime)
    if (propTime) setTime(propTime)
  }
  const current = rule ? labelOf(rule, resolution) : value && value.trim() ? value : 'No reminder'

  const pick = (next: ReminderRule | null) => {
    setOpen(false)
    if (next && firstReminderEver()) setNotice(true)
    onChange(next ? formatRemind(next, resolution) : null)
  }

  const items: { label: string; rule: ReminderRule }[] =
    resolution === 'time'
      ? TIME_PRESETS.map((m) => ({ label: timeLabel(m), rule: { minutesBefore: m, daysBefore: 0 } }))
      : DAY_PRESETS.map((d) => ({ label: dayLabel(d), rule: { minutesBefore: 0, daysBefore: d, timeOfDay: time } }))
  if (rule && !items.some((i) => i.label === current)) items.push({ label: current, rule })

  const setTimeOfDay = (t: string) => {
    if (!/^\d{2}:\d{2}$/.test(t)) return
    setTime(t)
    if (rule && resolution === 'day') onChange(formatRemind({ ...rule, timeOfDay: t }, 'day'))
  }

  return (
    <div className="px-2 py-1" data-testid="reminder-row">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[14px] text-fg">
          <Icon name="ph-bell" size={14} />
          Reminder
        </span>
        <button
          type="button"
          aria-label={`Reminder: ${current}`}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="max-w-[60%] truncate rounded-md px-2 py-0.5 text-right text-[14px] text-fg-muted hover:bg-hover"
        >
          {current}
        </button>
      </div>
      {hint && <div className="pt-0.5 text-right text-[12px] text-[var(--danger)]">{hint}</div>}
      {open && (
        <div role="menu" aria-label="Reminder" className="mt-1 flex flex-col">
          {[{ label: 'No reminder', rule: null as ReminderRule | null }, ...items].map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitemradio"
              aria-checked={current === it.label}
              onClick={() => pick(it.rule)}
              className="flex items-center justify-between rounded-md px-2 py-1 text-left text-[14px] text-fg hover:bg-hover"
            >
              {it.label}
              {current === it.label && <Icon name="ph-check" size={13} />}
            </button>
          ))}
        </div>
      )}
      {resolution === 'day' && (open || rule) && (
        <div className="mt-1">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="reminder-time" className="text-[13px] text-fg-muted">
              Time
            </label>
            <input
              id="reminder-time"
              type="time"
              value={time}
              onChange={(e) => setTimeOfDay(e.target.value)}
              onFocus={() => setEditing(true)}
              onBlur={() => setEditing(false)}
              className="h-7 w-28 rounded-md border border-line bg-raised px-2 text-[13px] text-fg outline-none"
            />
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {TIME_SUGGESTIONS.map((s) => (
              <button
                key={s.label}
                type="button"
                title={s.time}
                onClick={() => setTimeOfDay(s.time)}
                className="rounded-md border border-line px-1.5 py-0.5 text-[12px] text-fg-muted hover:bg-hover"
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {notice && (
        <div role="status" className="mt-1 rounded-md bg-hover px-2 py-1 text-[12px] text-fg-muted">
          {REMINDER_NOTICE}
        </div>
      )}
    </div>
  )
}
