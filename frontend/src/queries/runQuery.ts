// Query evaluation: the scope the rows are fetched with, and the client-side steps that follow
// (per-type collection constraints, tags, excluded tags, filters and sorts, limit, grouping).
import type { Collection, DataViewDefinition, Filter, FilterGroup, QueryDefinition, Row, RowsScope } from '@/api/types'
import { applyFilters, matchFilter, matchGroup } from '@/views/filter'
import { groupRows, type Group, type GroupCtx } from '@/views/group'
import { applySorts } from '@/views/sort'

export const PAUSED_HINT = 'Sorting and property filters are off during a search.'
export const MIN_TERM = 2
export const MAX_TERMS = 5

/** The usable search terms: trimmed, at least two characters, at most five. */
export function searchTermsOf(def: QueryDefinition): string[] {
  return (def.search?.searchTerms ?? [])
    .map((t) => t.text.trim())
    .filter((t) => t.length >= MIN_TERM)
    .slice(0, MAX_TERMS)
}

export const isSearching = (def: QueryDefinition): boolean => searchTermsOf(def).length > 0
const hasTags = (def: QueryDefinition): boolean => (def.tags?.ids.length ?? 0) > 0

/** A query returns something only with a search term, a tag or a type. */
export const isQueryReady = (def: QueryDefinition): boolean =>
  isSearching(def) || hasTags(def) || def.types.length > 0

/** Whether the "exclude" controls count: only with a search term or an included tag. */
const exclusionApplies = (def: QueryDefinition): boolean => isSearching(def) || hasTags(def)

/**
 * What `POST /api/rows` is asked for: the query type ids when any are set; otherwise every
 * type but the excluded ones (exclusion needs a search term or tag, and `allTypeIds`), else all.
 */
export function queryScope(def: QueryDefinition, allTypeIds: string[] = []): RowsScope {
  const scope: RowsScope = {}
  if (def.types.length > 0) scope.typeIds = def.types.map((s) => s.id)
  else if ((def.excludeTypeIds?.length ?? 0) > 0 && exclusionApplies(def) && allTypeIds.length > 0) {
    const out = new Set(def.excludeTypeIds)
    scope.typeIds = allTypeIds.filter((id) => !out.has(id))
  }
  const terms = searchTermsOf(def)
  if (terms.length > 0) scope.search = { terms, mode: def.search?.searchMode ?? 'auto' }
  return scope
}

const lower = (s: string) => s.toLowerCase()

/** The ids of the collections a row's `collections:` names resolve to (by name, then former name). */
export function rowCollectionIds(row: Row, collections: Collection[]): string[] {
  const out = new Set<string>()
  for (const n of row.summary.collections ?? []) {
    const name = lower(n.trim())
    const c = collections.find((x) => lower(x.name) === name) ?? collections.find((x) => x.formerNames.some((f) => lower(f) === name))
    if (c) out.add(c.id)
  }
  return [...out]
}

type TypeEntry = QueryDefinition['types'][number]

function passesType(row: Row, s: TypeEntry, collections: Collection[]): boolean {
  const have = rowCollectionIds(row, collections)
  if (s.inNoCollection && have.length > 0) return false
  if (s.inAnyCollection && have.length === 0) return false
  if (s.collectionIds?.length && !s.collectionIds.some((id) => have.includes(id))) return false
  if (s.excludeCollectionIds?.length && s.excludeCollectionIds.some((id) => have.includes(id))) return false
  return true
}

const tagFilter = (id: string, option: 'contains' | 'notContains'): Filter => ({
  type: 'filter',
  propertyId: 'tags',
  option,
  referenceValue: [id],
})

export interface QueryResult {
  rows: Row[]
  groups: Group[]
  hidden?: Group[]
  /** The stored property filters and sorts are paused because a search term is set. */
  paused: boolean
}

export function runQuery(
  def: QueryDefinition,
  rows: Row[],
  ctx: GroupCtx,
  rng: () => number = Math.random,
  groupConfig?: DataViewDefinition['groupByConfig'],
): QueryResult {
  const searching = isSearching(def)
  const tagged = hasTags(def)
  let kept = rows

  // 1. Per type entry: its collection constraints. With no type entry, the excluded types go.
  if (def.types.length > 0) {
    const by = new Map(def.types.map((s) => [s.id, s]))
    kept = kept.filter((r) => {
      const s = by.get(r.summary.type)
      return !!s && passesType(r, s, ctx.collections)
    })
  } else if ((def.excludeTypeIds?.length ?? 0) > 0 && exclusionApplies(def)) {
    const out = new Set(def.excludeTypeIds)
    kept = kept.filter((r) => !out.has(r.summary.type))
  }

  // 2. Included tags: any of (OR) or all of (AND).
  if (tagged && def.tags) {
    const group: FilterGroup = {
      type: 'filterGroup',
      operator: def.tags.operator === 'and' ? 'and' : 'or',
      elements: def.tags.ids.map((id) => tagFilter(id, 'contains')),
    }
    kept = kept.filter((r) => matchGroup(r, group, ctx))
  }

  // 3. Excluded tags, only with a search term or an included tag.
  if (def.excludeTags?.ids.length && exclusionApplies(def)) {
    const ids = def.excludeTags.ids
    kept = kept.filter((r) => ids.every((id) => matchFilter(r, tagFilter(id, 'notContains'), ctx)))
  }

  // 4. Property filters and sorts, paused while searching (the stored ones stay unchanged).
  if (searching) kept = applySorts(kept, [], ctx)
  else kept = applySorts(applyFilters(kept, def.filterGroup, ctx), def.sorts, ctx)

  // 5. Limit (not with grouping), the first N or N random ones.
  const grouped = !!def.groupBy?.groups?.length
  if (def.limit && !grouped && def.limit.size > 0) {
    if (def.limit.random) {
      const pool = [...kept]
      const picked: Row[] = []
      while (picked.length < def.limit.size && pool.length > 0) {
        picked.push(pool.splice(Math.floor(rng() * pool.length), 1)[0])
      }
      kept = picked
    } else kept = kept.slice(0, def.limit.size)
  }

  // 6. Grouping.
  const g = groupRows(kept, def.groupBy, groupConfig, ctx)
  return { rows: kept, groups: g.groups, hidden: g.hidden, paused: searching }
}
