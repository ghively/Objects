// Create-matches-filter (Capacities): the values a new object gets so that it shows up in the
// filtered view it was created from.
import type { Collection, DateValue, EntityRef, Filter, FilterGroup, TypeDef } from '@/api/types'
import { useLinkIndex } from '@/links/linkIndex'
import { parseDay } from './dates'

const keyOf = (f: Filter) => f.propertyId

/** The top-level filters that must all hold: under `and`, or the one element of a single-element `or`. */
function required(group: FilterGroup): Filter[] {
  const els = group.operator === 'or' ? (group.elements.length === 1 ? group.elements : []) : group.elements
  return els.filter((e): e is Filter => e.type === 'filter')
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function dayValue(f: Filter): DateValue | null {
  const ref = f.referenceValue as { relative?: string; exactDate?: string } | undefined
  if (!ref || typeof ref !== 'object' || Array.isArray(ref)) return null
  let day = ref.exactDate ?? null
  if (!day && ref.relative && ['today', 'yesterday', 'tomorrow'].includes(ref.relative)) {
    const d = new Date()
    d.setDate(d.getDate() + (ref.relative === 'yesterday' ? -1 : ref.relative === 'tomorrow' ? 1 : 0))
    day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }
  return day && parseDay(day) ? { start: day, resolution: 'day' } : null
}

/**
 * The property values implied by `filterGroup` for a new object of `typeId`. It reads only
 * top-level filters under `and` (or a single-element `or`); text `is`/`contains`/`startsWith` sets
 * the text, boolean `isChecked` sets true, label and entity `contains` add the first reference,
 * `collections` contains adds the names, number `equal` sets it and date `is` sets the day.
 * Any other filter contributes nothing.
 */
export function matchingValues(
  filterGroup: FilterGroup | null | undefined,
  types: TypeDef[],
  typeId: string,
  collections: Collection[] = [],
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!filterGroup) return out
  const type = types.find((t) => t.id === typeId)
  if (!type) return out
  for (const f of required(filterGroup)) {
    if (f.structureId && f.structureId !== typeId) continue
    const key = keyOf(f)
    const def = type.propertyDefinitions.find((d) => d.key === key)
    const kind = def?.type ?? (key === 'collections' ? 'entity_collections' : null)
    if (!kind) continue
    const ref = f.referenceValue
    switch (kind) {
      case 'text':
      case 'textBlock':
      case 'url':
        if (['is', 'contains', 'startsWith'].includes(f.option) && typeof ref === 'string' && ref !== '') out[key] = ref
        break
      case 'boolean':
        if (f.option === 'isChecked') out[key] = true
        break
      case 'number':
        if (f.option === 'equal' && typeof ref === 'number') out[key] = ref
        break
      case 'label': {
        if (f.option !== 'contains' || !Array.isArray(ref) || typeof ref[0] !== 'string') break
        const text = (def?.options.set ?? []).find((o) => o.id === ref[0])?.text
        if (text) out[key] = [text]
        break
      }
      case 'entity': {
        if (f.option !== 'contains' || !Array.isArray(ref) || typeof ref[0] !== 'string') break
        const o = useLinkIndex.getState().objects.find((x) => x.id === ref[0])
        if (o) out[key] = [{ target: o.title, path: o.path } satisfies EntityRef]
        break
      }
      case 'entity_collections': {
        if (f.option !== 'contains' || !Array.isArray(ref)) break
        const names = ref
          .map((id) => collections.find((c) => c.id === id)?.name)
          .filter((n): n is string => !!n)
        if (names.length) out[key] = names
        break
      }
      case 'datetime':
      case 'datetimeSimple': {
        if (f.option !== 'is') break
        const v = dayValue(f)
        if (v) out[key] = v
        break
      }
    }
  }
  return out
}
