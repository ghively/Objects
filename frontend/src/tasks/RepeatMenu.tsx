// The "Repeat" row of the Task date picker (`DatePicker.recurrence`): the presets of
// `DatePicker.recurrencePreset.*` in an inline list (no portal, so a pick never dismisses the
// picker's popover), and "Custom" for the Custom repeat panel. Writes the canonical `repeat` text.
import { useState } from 'react'
import { Icon } from '@/components/Icon'
import { describeRepeat, parseRepeat } from './repeat'

export interface RepeatMenuProps {
  /** The raw `repeat` text (null: no repeat). An invalid text is shown as is, with a hint. */
  value: string | null
  /** The task's date start (`YYYY-MM-DD` or ISO); names the weekday, day and month of the presets. */
  date: string
  onChange(next: string | null): void
  /** "Custom" was picked: the picker opens the Custom repeat panel. */
  onCustom(): void
}

/** Our string: a `repeat` text that does not parse is kept and shown with this hint. */
export const INVALID_REPEAT_HINT = 'Not a valid repeat.'

const PRESET_TEXTS = ['every day', 'every weekday', 'every week', 'every month', 'every year'] as const

export function RepeatMenu({ value, date, onChange, onCustom }: RepeatMenuProps) {
  const [open, setOpen] = useState(false)
  const rule = parseRepeat(value)
  const invalid = value !== null && value.trim() !== '' && !rule
  const current = invalid ? (value as string) : describeRepeat(rule, date)
  const items: { label: string; text: string | null }[] = [
    { label: 'No repeat', text: null },
    ...PRESET_TEXTS.map((text) => ({ label: describeRepeat(parseRepeat(text), date), text })),
  ]
  const presetLabel = invalid ? null : rule ? current : 'No repeat'

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
              onClick={() => {
                setOpen(false)
                onChange(it.text)
              }}
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
        </div>
      )}
    </div>
  )
}
