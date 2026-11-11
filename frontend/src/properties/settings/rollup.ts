// M12: what a rollup's pickers offer: the relations of the type, the properties of the related
// objects, and the calculations that fit the chosen property's kind.
import { typeLabel } from '@/lib/typeLabel'
import { ROLLUP_CALCS, type PropertyDef, type PropertyType, type RollupCalc, type TypeDef } from '@/api/types'
import { CALC_LABELS } from '@/views/calc'

/** The calculation labels: the column calculations' names, and our "Show original"/"Show unique". */
export const ROLLUP_CALC_LABELS: Readonly<Record<RollupCalc, string>> = Object.fromEntries(
  ROLLUP_CALCS.map((c) => [
    c,
    c === 'showOriginal' ? 'Show original' : c === 'showUnique' ? 'Show unique' : (CALC_LABELS.full[c] ?? c),
  ]),
) as Record<RollupCalc, string>

const NUMBER_CALCS = new Set<RollupCalc>(['sum', 'average', 'median', 'min', 'max', 'range'])
const DATE_CALCS = new Set<RollupCalc>(['earliestDate', 'latestDate', 'dateRange'])
const DATE_KINDS = new Set<PropertyType>(['datetime', 'datetimeSimple', 'entity_createdAt', 'entity_lastUpdated'])

/** The calculations that give a number shown with the rollup's number format. */
export const NUMBER_RESULT_CALCS: ReadonlySet<RollupCalc> = NUMBER_CALCS

/**
 * The calculations for a target of `kind`, in `ROLLUP_CALCS` order: every kind gets the show,
 * count and percent ones; numbers add sum to range; dates add earliest, latest and date range.
 * A formula's result kind isn't known here, so it gets all of them; with no target, only the
 * common ones.
 */
export function rollupCalcsFor(kind: PropertyType | null): RollupCalc[] {
  return ROLLUP_CALCS.filter((c) => {
    if (NUMBER_CALCS.has(c)) return kind === 'number' || kind === 'formula'
    if (DATE_CALCS.has(c)) return (kind !== null && DATE_KINDS.has(kind)) || kind === 'formula'
    return true
  })
}

/** The type's relations (`entity` properties) a rollup can roll up. */
export function rollupRelations(type: TypeDef): PropertyDef[] {
  return type.propertyDefinitions.filter((d) => d.type === 'entity')
}

export interface RollupTarget {
  id: string
  name: string
  kind: PropertyType
}

/**
 * The properties of the related objects: Title first, then the properties of the relation's
 * linked types (every type when it allows any), without rollups (a rollup can't target one) and
 * content properties. A property shared by several types (same id) is listed once; names that
 * repeat get their type's name.
 */
export function rollupTargets(relation: PropertyDef | undefined, types: readonly TypeDef[]): RollupTarget[] {
  if (!relation) return []
  const allowed = relation.options.allowedTypes ?? []
  const linked = allowed.length ? types.filter((t) => allowed.includes(t.id)) : types
  const out: (RollupTarget & { typeName: string })[] = [{ id: 'title', name: 'Title', kind: 'entity_title', typeName: '' }]
  const seen = new Set(['title'])
  for (const t of linked) {
    for (const d of t.propertyDefinitions) {
      if (seen.has(d.id) || d.type === 'rollup' || d.type === 'blocks') continue
      seen.add(d.id)
      out.push({ id: d.id, name: d.name, kind: d.type, typeName: typeLabel(t) })
    }
  }
  const count = new Map<string, number>()
  for (const o of out) count.set(o.name.toLowerCase(), (count.get(o.name.toLowerCase()) ?? 0) + 1)
  return out.map(({ typeName, ...o }) =>
    (count.get(o.name.toLowerCase()) ?? 0) > 1 && typeName ? { ...o, name: `${o.name} (${typeName})` } : o,
  )
}
