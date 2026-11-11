// "Suggested saved searches" (was "Query Recommendations"): ready-made queries an Overview offers
// while it has no query sections.
// Titles: "Kanban by {property}", "Filter {property} is
// empty", "Filter {property} by" (one item per option), and for booleans "Checked" / "Unchecked".
import type { Filter, Layout, PropertyDef, QueryDefinition, TypeDef } from '@/api/types'
import { typeLabel } from '@/lib/typeLabel'
import { emptyFilterGroup } from '@/views/model'

export interface QueryRecommendation {
  title: string
  definition: QueryDefinition
  layout: Layout
}

function definition(typeId: string, filters: Filter[], groupBy: QueryDefinition['groupBy'] = null): QueryDefinition {
  return {
    types: [{ id: typeId }],
    filterGroup: { ...emptyFilterGroup(), elements: filters },
    sorts: [],
    groupBy,
  }
}

const filter = (def: PropertyDef, typeId: string, option: string, referenceValue?: Filter['referenceValue']): Filter => ({
  type: 'filter',
  propertyId: def.key,
  option,
  ...(referenceValue !== undefined ? { referenceValue } : {}),
  typeId,
})

export function queryRecommendations(type: TypeDef): QueryRecommendation[] {
  const out: QueryRecommendation[] = []
  for (const def of type.propertyDefinitions) {
    if (def.type === 'label') {
      out.push({
        title: `Kanban by ${def.name}`,
        definition: definition(type.id, [], { groups: [{ propertyId: def.key, option: 'default', typeId: type.id }] }),
        layout: 'kanban',
      })
      out.push({
        title: `Filter ${def.name} is empty`,
        definition: definition(type.id, [filter(def, type.id, 'isEmpty')]),
        layout: 'list',
      })
      for (const o of def.options.set ?? []) {
        out.push({
          title: `${typeLabel(type)} · ${def.name} · ${o.text}`,
          definition: definition(type.id, [filter(def, type.id, 'contains', [o.id])]),
          layout: 'list',
        })
      }
    } else if (def.type === 'boolean') {
      out.push({
        title: `${typeLabel(type)} · ${def.name} · Checked`,
        definition: definition(type.id, [filter(def, type.id, 'isChecked')]),
        layout: 'list',
      })
      out.push({
        title: `${typeLabel(type)} · ${def.name} · Unchecked`,
        definition: definition(type.id, [filter(def, type.id, 'isNotChecked')]),
        layout: 'list',
      })
    }
  }
  return out
}
