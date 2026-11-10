/**
 * M29: the context of a create row's suggested type: the active tab's types (a collection's, a
 * query's, a type page's) and the space's last type, around `typeSuggest.suggestType`.
 */
import type { TypeDef } from '@/api/types'
import { currentTarget, useTabs } from '@/nav/tabs'
import { useDefs } from '@/types/useDefinitions'
import { useLastType } from './lastType'
import { suggestType } from './typeSuggest'

/** Collection: its typeIds; query: its definition's type ids; type page: [id]; else []. */
export function scopeTypesOfActiveTab(): string[] {
  const target = currentTarget(useTabs.getState())
  if (!target) return []
  if (target.kind === 'type') return [target.typeId]
  if (target.kind === 'collection') {
    const c = useDefs.getState().collections.find((x) => x.id === target.id)
    return c ? [...c.typeIds] : []
  }
  if (target.kind === 'query') {
    const q = useDefs.getState().queries.find((x) => x.id === target.id)
    return q ? (q.definition.types ?? []).map((t) => t.id) : []
  }
  return []
}

/** The suggested type ids for `name` among `types`, best first (empty: no suggestion). */
export function suggestFor(
  name: string,
  types: readonly TypeDef[],
  extra?: { allowed?: readonly string[]; scope?: readonly string[] },
): string[] {
  return suggestType(name, {
    types,
    allowed: extra?.allowed,
    scope: extra?.scope ?? scopeTypesOfActiveTab(),
    last: useLastType.getState().typeId,
  })
}
