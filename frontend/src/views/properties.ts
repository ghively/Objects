// The properties a view can filter, sort, group and calculate on: the definitions of the types
// the view spans, plus the system ones every type has.
import type { PropertyDef, PropertyType, TypeDef } from '@/api/types'

export interface PropChoice {
  /** The property key (what filters, sorts and columns store). */
  key: string
  name: string
  kind: PropertyType
  def: Pick<PropertyDef, 'type' | 'options'> & Partial<PropertyDef>
  /** A type id when only one of several types in the view defines the key. */
  structureId?: string
}

const SYSTEM: { key: string; name: string; kind: PropertyType }[] = [
  { key: 'title', name: 'Title', kind: 'entity_title' },
  { key: 'type', name: 'Type', kind: 'entity_type' },
  { key: 'tags', name: 'Tags', kind: 'entity_tags' },
  { key: 'collections', name: 'Collections', kind: 'entity_collections' },
  { key: 'createdAt', name: 'Created at', kind: 'entity_createdAt' },
  { key: 'lastUpdated', name: 'Last updated', kind: 'entity_lastUpdated' },
]

/** One choice per key across `viewTypes`; a key found in only one of several types carries its `structureId`. */
export function propertyChoices(viewTypes: TypeDef[]): PropChoice[] {
  const out: PropChoice[] = []
  const seen = new Map<string, { choice: PropChoice; count: number; typeId: string }>()
  for (const t of viewTypes) {
    for (const d of t.propertyDefinitions) {
      const have = seen.get(d.key)
      if (have) {
        have.count += 1
        continue
      }
      const choice: PropChoice = { key: d.key, name: d.name, kind: d.type, def: d }
      seen.set(d.key, { choice, count: 1, typeId: t.id })
      out.push(choice)
    }
  }
  for (const s of SYSTEM) {
    if (seen.has(s.key)) continue
    if (s.key === 'type' && viewTypes.length < 2) continue
    out.push({ key: s.key, name: s.name, kind: s.kind, def: { type: s.kind, options: {} } })
  }
  if (viewTypes.length > 1) {
    for (const { choice, count, typeId } of seen.values()) {
      if (count === 1) choice.structureId = typeId
    }
  }
  return out
}

export const choiceFor = (choices: PropChoice[], key: string): PropChoice | undefined =>
  choices.find((c) => c.key === key)
