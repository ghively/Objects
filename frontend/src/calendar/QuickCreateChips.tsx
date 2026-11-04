// The quick-create chips under the Day header: one per type with a date property, except types
// with `createInCalendarOption: 'disabled'` and `createOnce` types that already have an object on
// the day. A chip creates an object with its first date property set to the day and opens it as
// `createAndOpen` does (Tasks in the peek). The row can be hidden (`ui.calendar.daily.hideCreateObjects`).
import { useEffect, useState, type MouseEvent } from 'react'
import type { CalendarDay, ObjectSummary, PropertyDef, TypeDef } from '@/api/types'
import { Icon } from '@/components/Icon'
import { createAndOpen } from '@/create/createAndOpen'
import { ensureLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { TypeChip } from '@/shell/Sidebar'
import { saveCalendarDaily, useCalendarDaily } from './calendarUi'
import type { Day } from './dates'

export const CHIPS_TEXT = {
  create: (object: string) => `Create ${object} linked to this day.`,
  createObjects:
    'Create an object with the date property set to this day. You can remove an object type from this list in the settings of that object type.',
  hide: 'Click to hide these buttons.',
  show: 'Click to show options to create objects for this day.',
}

const DATE_KINDS = new Set(['datetime', 'datetimeSimple'])

/** The type's first date property (the one a chip sets), or undefined. */
export function firstDateProperty(type: TypeDef): PropertyDef | undefined {
  return type.propertyDefinitions.find((d) => DATE_KINDS.has(d.type))
}

/** The types that get a chip on `day` (the rule in the M4 plan's Global Constraints). */
export function chipTypes(
  types: TypeDef[],
  calendarDay: CalendarDay | null,
  summaries: Record<string, ObjectSummary>,
  createdOnce: ReadonlySet<string> = new Set(),
): { type: TypeDef; key: string }[] {
  const out: { type: TypeDef; key: string }[] = []
  for (const type of types) {
    if (type.id === 'dailynote') continue // the daily note has its own slot
    const def = firstDateProperty(type)
    if (!def || type.createInCalendarOption === 'disabled') continue
    if (type.createInCalendarOption === 'createOnce') {
      if (createdOnce.has(type.id)) continue
      const onDay =
        (calendarDay?.dated ?? []).some((e) => e.key === def.key && summaries[e.path]?.type === type.id) ||
        (calendarDay?.tasks ?? []).some((e) => e.kind === 'date' && def.key === 'date' && summaries[e.path]?.type === type.id)
      if (onDay) continue
    }
    out.push({ type, key: def.key })
  }
  return out
}

export function QuickCreateChips({
  day,
  calendarDay,
  summaries,
  onCreated,
}: {
  day: Day
  calendarDay: CalendarDay | null
  summaries: Record<string, ObjectSummary>
  /** An object was created: the owner reloads its range. */
  onCreated?(): void
}) {
  const types = useLinkIndex((s) => s.types)
  const hidden = !!useCalendarDaily().hideCreateObjects
  /** `createOnce` types created here, hidden before the range reload shows the object. */
  const [createdOnce, setCreatedOnce] = useState<{ day: Day; ids: Set<string> }>({ day, ids: new Set() })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void ensureLinkIndex()
  }, [])

  const once = createdOnce.day === day ? createdOnce.ids : new Set<string>()
  const chips = chipTypes(types, calendarDay, summaries, once)

  const create = async (type: TypeDef, key: string, e: MouseEvent) => {
    setError(null)
    const mods = { ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey }
    try {
      await createAndOpen(type.id, { values: { [key]: { start: day, resolution: 'day' } } }, mods)
      if (type.createInCalendarOption === 'createOnce') {
        setCreatedOnce((cur) => ({ day, ids: new Set([...(cur.day === day ? cur.ids : []), type.id]) }))
      }
      onCreated?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const toggle = (
    <button
      type="button"
      aria-label={hidden ? CHIPS_TEXT.show : CHIPS_TEXT.hide}
      title={hidden ? CHIPS_TEXT.show : CHIPS_TEXT.hide}
      aria-pressed={!hidden}
      onClick={() => void saveCalendarDaily({ hideCreateObjects: !hidden })}
      className="flex size-8 items-center justify-center rounded-lg text-fg-muted hover:bg-hover hover:text-fg"
    >
      <Icon name={hidden ? 'ph-plus-circle' : 'ph-eye-slash'} size={15} />
    </button>
  )

  if (chips.length === 0 && !hidden) return null

  return (
    <div data-testid="quick-create" className="flex flex-col gap-1">
      <div role="group" aria-label={CHIPS_TEXT.createObjects} title={CHIPS_TEXT.createObjects} className="group/chips flex flex-wrap items-center gap-2">
        {!hidden &&
          chips.map(({ type, key }) => (
            <button
              key={type.id}
              type="button"
              data-type-id={type.id}
              title={CHIPS_TEXT.create(type.name)}
              onClick={(e) => void create(type, key, e)}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[14px] text-fg hover:bg-hover"
            >
              <TypeChip type={type} size={18} />
              {type.name}
            </button>
          ))}
        {toggle}
      </div>
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
