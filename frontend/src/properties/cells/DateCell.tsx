import { useEffect, useRef, useState } from 'react'
import type { DateValue, PropertyDef } from '@/api/types'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { typeOf } from '@/links/linkIndex'
import type { CellExtras } from '../cellFor'
import { DatePicker, type TaskDateChange } from '../DatePicker'
import { formatDate, placeholderFor } from '../format'
import type { CellProps } from './types'

/**
 * The Task `date`: the `date` key of the basic Task type, with `options.constraints.supportsReminders`
 * (M4 Task 3's top-up). Its picker edits `repeat` and `remind` with it; no other date property does.
 */
export function isTaskDate(def: PropertyDef, typeId: string | null | undefined): boolean {
  if (def.key !== 'date' || !def.options.constraints?.supportsReminders || !typeId) return false
  const t = typeOf(typeId)
  return t ? t.basic && t.name.toLowerCase() === 'task' : typeId.toLowerCase() === 'task'
}

const textOf = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
const present = (fm: Record<string, unknown> | undefined, key: string) => !!fm && fm[key] !== undefined && fm[key] !== null
const sameDate = (a: DateValue | null, b: DateValue | null) => JSON.stringify(a) === JSON.stringify(b)

/**
 * A date, a time or a range (`datetime`, `datetimeSimple`); a click opens the DatePicker.
 *
 * The Task `date` in the property panel (which passes `onChangeMany`) edits `date`, `repeat` and
 * `remind` together: the picker's changes are kept as a draft while it is open and written as
 * **one** `onChangeMany(updates, remove)` when it closes (only the keys that changed; a cleared
 * repeat or reminder goes in `remove`). "Remove date" writes at once and removes both with it.
 * Without `onChangeMany` (a table cell) it writes the date alone, as in M2.
 */
export function DateCell({
  def,
  value,
  readOnly,
  density,
  inTable,
  onChange,
  typeId,
  frontmatter,
  onChangeMany,
}: CellProps<DateValue | null> & CellExtras) {
  const [open, setOpen] = useState(false)
  const task = !!onChangeMany && isTaskDate(def, typeId)
  const repeat = textOf(frontmatter?.repeat)
  const remind = textOf(frontmatter?.remind)
  const [draft, setDraft] = useState<TaskDateChange | null>(null)

  /** Write a Task draft as one call: the changed keys, with cleared texts removed. */
  const commit = (d: TaskDateChange) => {
    const updates: Record<string, unknown> = {}
    const remove: string[] = []
    if (d.date === null) {
      if (value !== null) updates[def.key] = null
      if (present(frontmatter, 'repeat')) remove.push('repeat')
      if (present(frontmatter, 'remind')) remove.push('remind')
      if (present(frontmatter, 'occurrenceLog')) remove.push('occurrenceLog')
    } else {
      if (!sameDate(d.date, value)) updates[def.key] = d.date
      for (const [key, before, after] of [
        ['repeat', repeat, d.repeat],
        ['remind', remind, d.remind],
      ] as const) {
        if (after === before) continue
        if (after === null) {
          if (present(frontmatter, key)) remove.push(key)
        } else updates[key] = after
      }
      // M8: removing the recurrence discards its occurrence log in the same write.
      if (d.repeat === null && repeat !== null && present(frontmatter, 'occurrenceLog')) remove.push('occurrenceLog')
    }
    if (Object.keys(updates).length === 0 && remove.length === 0) return
    onChangeMany?.(updates, remove.length ? remove : undefined)
  }

  // A draft still open when the cell goes away (the object closed) is written, not lost.
  const pending = useRef<{ draft: TaskDateChange | null; commit: (d: TaskDateChange) => void }>({ draft: null, commit })
  pending.current = { draft, commit }
  useEffect(
    () => () => {
      const { draft: d, commit: c } = pending.current
      if (d) c(d)
    },
    [],
  )

  const onOpenChange = (o: boolean) => {
    setOpen(o)
    if (!task) return
    if (o) setDraft({ date: value, repeat, remind })
    else {
      if (draft) commit(draft)
      setDraft(null)
    }
  }

  const text = formatDate(value)
  const shown = text ? (
    <span className="text-fg">{text}</span>
  ) : (
    <span className="text-fg-muted">{placeholderFor(def, inTable ? 'table' : density)}</span>
  )
  if (readOnly) return <p className="text-[15px]">{shown}</p>
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`Edit ${def.name}`} className="w-full text-left text-[15px]">
          {shown}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto border-line bg-raised p-0 text-fg">
        {task && draft ? (
          <DatePicker
            value={draft.date}
            constraints={def.options.constraints}
            onChange={() => {}}
            task={{ repeat: draft.repeat, remind: draft.remind, occurrenceLog: textOf(frontmatter?.occurrenceLog) }}
            onTaskChange={(next) => {
              if (next.date === null) {
                commit(next)
                setDraft(null)
                setOpen(false)
              } else setDraft(next)
            }}
          />
        ) : (
          <DatePicker
            value={value}
            constraints={def.options.constraints}
            onChange={(next) => {
              onChange(next)
              if (next === null) setOpen(false)
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  )
}
