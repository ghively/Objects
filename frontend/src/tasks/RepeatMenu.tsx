// The "Repeat" row of the Task date picker: the presets
// in an inline list (no portal, so a pick never dismisses the
// picker's popover), and "Custom" for the Custom repeat panel. Writes the canonical `repeat` text.
// M8: "Weekly on {day}", "Monthly on day {date}" and "Yearly on {date}" write the anchored `on`
// forms (`every week on fri`); "Remove recurrence" (and "No repeat") ask first when the task has
// an occurrence history (shown in place, as Custom is).
import { useState } from 'react'
import { Icon } from '@/components/Icon'
import { describeRepeat, formatRepeat, localDayOf, parseRepeat, presetOn } from './repeat'

export interface RepeatMenuProps {
  /** The raw `repeat` text (null: no repeat). An invalid text is shown as is, with a hint. */
  value: string | null
  /** The task's date start (`YYYY-MM-DD` or ISO); names the weekday, day and month of the presets. */
  date: string
  onChange(next: string | null): void
  /** "Custom" was picked: the picker opens the Custom repeat panel. */
  onCustom(): void
  /** The task has a non-empty occurrence log: removing the recurrence asks first. */
  hasHistory?: boolean
  /** M14 (an automation's schedule): a repeat is required, so "No repeat" and "Remove recurrence" aren't offered. */
  required?: boolean
}

/** Our string: a `repeat` text that does not parse is kept and shown with this hint. */
export const INVALID_REPEAT_HINT = 'Not a valid repeat.'

const PRESET_TEXTS = ['every day', 'every weekday', 'every week', 'every month', 'every year'] as const

/** A preset's text for the task's day: weeks, months and years are anchored to it (M8). */
function presetText(text: (typeof PRESET_TEXTS)[number], day: Date | null): string {
  const unit = text.slice('every '.length)
  if (!day || (unit !== 'week' && unit !== 'month' && unit !== 'year')) return text
  return formatRepeat({ every: 1, unit, mode: 'dueDate', on: presetOn(unit, day) })
}

export function RepeatMenu({ value, date, onChange, onCustom, hasHistory = false, required = false }: RepeatMenuProps) {
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const rule = parseRepeat(value)
  const invalid = value !== null && value.trim() !== '' && !rule
  const current = invalid ? (value as string) : describeRepeat(rule, date)
  const day = localDayOf(date)
  const items: { label: string; text: string | null }[] = [
    ...(required ? [] : [{ label: 'No repeat', text: null }]),
    ...PRESET_TEXTS.map((text) => ({ label: describeRepeat(parseRepeat(text), date), text: presetText(text, day) })),
  ]
  const presetLabel = invalid ? null : rule ? current : 'No repeat'
  const hasValue = value !== null && value.trim() !== ''

  /** Write `next`; removing a recurrence with history asks first. */
  const pick = (next: string | null) => {
    setOpen(false)
    if (next === null && hasValue && hasHistory) {
      setConfirming(true)
      return
    }
    onChange(next)
  }

  if (confirming) {
    return (
      <div role="alertdialog" aria-label="Remove recurrence?" className="flex flex-col gap-2 px-2 py-1 text-fg" data-testid="repeat-row">
        <h2 className="text-[15px] font-semibold">Remove recurrence?</h2>
        <p className="text-[13px] text-fg-muted">
          This recurring task already has completed or skipped occurrences. Removing the recurrence will discard its history.
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setConfirming(false)} className="rounded-md px-3 py-1 text-[14px] hover:bg-hover">
            Keep recurrence
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirming(false)
              onChange(null)
            }}
            className="rounded-md bg-[var(--danger)] px-3 py-1 text-[14px] font-medium text-white hover:opacity-90"
          >
            Remove recurrence
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="px-2 py-1" data-testid="repeat-row">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[14px] text-fg">
          <Icon name="ph-repeat" size={14} />
          Repeat
        </span>
        <button
          type="button"
          aria-label={`Repeat: ${current}`}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="max-w-[60%] truncate rounded-md px-2 py-0.5 text-right text-[14px] text-fg-muted hover:bg-hover"
        >
          {current}
        </button>
      </div>
      {invalid && <div className="pt-0.5 text-right text-[12px] text-[var(--danger)]">{INVALID_REPEAT_HINT}</div>}
      {open && (
        <div role="menu" aria-label="Repeat" className="mt-1 flex flex-col">
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitemradio"
              aria-checked={presetLabel === it.label}
              onClick={() => pick(it.text)}
              className="flex items-center justify-between rounded-md px-2 py-1 text-left text-[14px] text-fg hover:bg-hover"
            >
              {it.label}
              {presetLabel === it.label && <Icon name="ph-check" size={13} />}
            </button>
          ))}
          <button
            type="button"
            role="menuitemradio"
            aria-checked={presetLabel === 'Custom'}
            onClick={() => {
              setOpen(false)
              onCustom()
            }}
            className="flex items-center justify-between rounded-md px-2 py-1 text-left text-[14px] text-fg hover:bg-hover"
          >
            Custom
            {presetLabel === 'Custom' && <Icon name="ph-check" size={13} />}
          </button>
          {hasValue && !required && (
            <button
              type="button"
              role="menuitem"
              onClick={() => pick(null)}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-left text-[14px] text-[var(--danger)] hover:bg-hover"
            >
              Remove recurrence
            </button>
          )}
        </div>
      )}
    </div>
  )
}
