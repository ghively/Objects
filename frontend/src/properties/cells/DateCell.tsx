import { useEffect, useRef, useState } from 'react'
import type { DateValue, PropertyDef } from '@/api/types'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { typeOf } from '@/links/linkIndex'
import { MenuSelect } from '@/views/MenuSelect'
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

/** Object's `DATE_TEMPLATE_VARIABLES` and their `DatetimeCell.templateVariable.*` labels. */
const TEMPLATE_VARIABLES = [
  ['day', 'Day of creation'],
  ['week', 'Week of creation'],
  ['month', 'Month of creation'],
  ['year', 'Year of creation'],
] as const
type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number][0]
const VARIABLE_LABEL: Record<string, string> = Object.fromEntries(TEMPLATE_VARIABLES)

/**
 * The variable of a `{creation:<var>}` value, else null. Quoted in YAML it is a string;
 * unquoted, YAML reads it as a one-key mapping `{"creation:<var>": null}`.
 */
export function creationVariable(raw: unknown): TemplateVariable | null {
  let name: string | null = null
  if (typeof raw === 'string') name = /^\{creation:([A-Za-z]+)\}$/.exec(raw.trim())?.[1] ?? null
  else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const entries = Object.entries(raw)
    if (entries.length === 1 && entries[0][1] === null && entries[0][0].startsWith('creation:'))
      name = entries[0][0].slice('creation:'.length).trim()
  }
  return name && name in VARIABLE_LABEL ? (name as TemplateVariable) : null
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
 *
 * M9: on a template (its frontmatter has `template:`), a `datetime` property also offers a
 * creation-date variable ("Select variable", "Day of creation" …), written as `{creation:<var>}`
 * in place of the date and resolved when the template is applied. "Select variable" removes it.
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
  onSetReminder,
}: CellProps<DateValue | null> & CellExtras) {
  const [open, setOpen] = useState(false)
  const task = !!onChangeMany && isTaskDate(def, typeId)
  const offersVariable = frontmatter?.template != null && def.type === 'datetime'
  const variable = offersVariable ? creationVariable(frontmatter?.[def.key]) : null
  const repeat = textOf(frontmatter?.repeat)
  const remind = textOf(frontmatter?.remind)
  const [draft, setDraft] = useState<TaskDateChange | null>(null)
  // M8: any other date property with `supportsReminders` keeps its reminder in the `reminders` map.
  const reminders = frontmatter?.reminders
  const ownReminder =
    reminders && typeof reminders === 'object' && !Array.isArray(reminders)
      ? textOf((reminders as Record<string, unknown>)[def.key])
      : null
  const reminder =
    !task && onSetReminder && def.options.constraints?.supportsReminders
      ? { value: ownReminder, onChange: (remind: string | null) => remind !== ownReminder && onSetReminder(def.key, remind) }
      : undefined

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

  const text = variable ? VARIABLE_LABEL[variable] : formatDate(value)
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
        {offersVariable && (
          <div className="border-b border-line p-2">
            <MenuSelect
              label="Template variable"
              value={variable ?? ''}
              options={[{ value: '', label: 'Select variable' }, ...TEMPLATE_VARIABLES.map(([v, l]) => ({ value: v, label: l }))]}
              onChange={(v) => {
                // The variable replaces the date, written alone; a Task draft is dropped with it.
                ;(onChange as (next: string | null) => void)(v ? `{creation:${v}}` : null)
                setDraft(null)
                setOpen(false)
              }}
              className="w-full"
            />
          </div>
        )}
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
            reminder={reminder}
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
