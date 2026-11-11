// M31 item 9: a readable summary of one kept version of a type, collection or saved query
// definition, and what has changed since (compared with the definition as it is now). The
// summary and its wording are our call; the dialog also shows the file itself, pretty-printed.
import type { DefinitionKind } from '@/api/d2Api'

export interface SummaryRow {
  label: string
  value: string
}

export interface DefinitionSummary {
  /** What the version holds. */
  rows: SummaryRow[]
  /** What is different now (restoring the version undoes these). */
  changes: string[]
}

export const SUMMARY_TEXT = {
  name: 'Name',
  pluralName: 'Plural name',
  description: 'Description',
  properties: 'Properties',
  objectTypes: 'Types',
  excludedTypes: 'Excluded types',
  search: 'Search',
  filters: 'Filters',
  sorts: 'Sorts',
  limit: 'Result limit',
  none: 'None',
  renamed: (from: string, to: string) => `Renamed from “${from}” to “${to}”`,
  propertiesAdded: (names: string) => `Properties added since: ${names}`,
  propertiesRemoved: (names: string) => `Properties removed since: ${names}`,
  propertyRenamed: (from: string, to: string) => `Property “${from}” renamed to “${to}”`,
  typesAdded: (names: string) => `Types added since: ${names}`,
  typesRemoved: (names: string) => `Types removed since: ${names}`,
  changed: (label: string) => `${label} changed`,
} as const

const S = SUMMARY_TEXT

type Json = Record<string, unknown>

const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {})
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const list = (names: string[]): string => (names.length ? names.join(', ') : S.none)

/** A type's own properties (the built-in `entity_*` ones every type has are left out). */
function ownProperties(t: Json): { id: string; name: string }[] {
  return arr(t.propertyDefinitions)
    .map(obj)
    .filter((p) => !str(p.type).startsWith('entity_'))
    .map((p) => ({ id: str(p.id) || str(p.key), name: str(p.name) || str(p.key) || str(p.id) }))
}

function queryTypeIds(q: Json): string[] {
  return arr(obj(q.definition).types)
    .map((t) => str(obj(t).id))
    .filter(Boolean)
}

function searchText(q: Json): string {
  return arr(obj(obj(q.definition).search).searchTerms)
    .map((t) => str(obj(t).text).trim())
    .filter(Boolean)
    .join(', ')
}

/** Every filter in a filter group, nested groups included. */
function countFilters(group: unknown): number {
  let n = 0
  for (const el of arr(obj(group).elements)) {
    const e = obj(el)
    n += e.type === 'filterGroup' || Array.isArray(e.elements) ? countFilters(e) : 1
  }
  return n
}

function nameChange(version: Json, current: Json | null, changes: string[]): void {
  const was = str(version.name)
  const now = current ? str(current.name) : ''
  if (current && was && now && was !== now) changes.push(S.renamed(was, now))
}

function typeListChange(was: string[], now: string[], typeName: (id: string) => string, changes: string[]): void {
  const added = now.filter((id) => !was.includes(id))
  const removed = was.filter((id) => !now.includes(id))
  if (added.length) changes.push(S.typesAdded(added.map(typeName).join(', ')))
  if (removed.length) changes.push(S.typesRemoved(removed.map(typeName).join(', ')))
}

/**
 * The summary of `version` (a definition file's JSON) for a definition of `kind`, with what is
 * different in `current` (the definition now; null leaves the changes out). `typeName` turns a
 * type id into the name shown.
 */
export function summarizeDefinition(
  kind: DefinitionKind,
  version: unknown,
  current: unknown | null,
  typeName: (id: string) => string = (id) => id,
): DefinitionSummary {
  const v = obj(version)
  const c = current == null ? null : obj(current)
  const rows: SummaryRow[] = [{ label: S.name, value: str(v.name) || S.none }]
  const changes: string[] = []
  nameChange(v, c, changes)

  if (kind === 'types') {
    rows.push({ label: S.pluralName, value: str(v.pluralName) || S.none })
    if (str(v.description)) rows.push({ label: S.description, value: str(v.description) })
    const was = ownProperties(v)
    rows.push({ label: S.properties, value: list(was.map((p) => p.name)) })
    if (c) {
      const now = ownProperties(c)
      const wasIds = new Map(was.map((p) => [p.id, p.name]))
      const nowIds = new Map(now.map((p) => [p.id, p.name]))
      const added = now.filter((p) => !wasIds.has(p.id)).map((p) => p.name)
      const removed = was.filter((p) => !nowIds.has(p.id)).map((p) => p.name)
      if (added.length) changes.push(S.propertiesAdded(added.join(', ')))
      if (removed.length) changes.push(S.propertiesRemoved(removed.join(', ')))
      for (const p of was) {
        const to = nowIds.get(p.id)
        if (to !== undefined && to !== p.name) changes.push(S.propertyRenamed(p.name, to))
      }
      if (str(v.pluralName) !== str(c.pluralName)) changes.push(S.changed(S.pluralName))
      if (str(v.description) !== str(c.description)) changes.push(S.changed(S.description))
    }
    return { rows, changes }
  }

  if (kind === 'collections') {
    if (str(v.description)) rows.push({ label: S.description, value: str(v.description) })
    const was = arr(v.typeIds).map(str).filter(Boolean)
    rows.push({ label: S.objectTypes, value: list(was.map(typeName)) })
    if (c) {
      typeListChange(was, arr(c.typeIds).map(str).filter(Boolean), typeName, changes)
      if (str(v.description) !== str(c.description)) changes.push(S.changed(S.description))
    }
    return { rows, changes }
  }

  // A saved query.
  if (str(v.description)) rows.push({ label: S.description, value: str(v.description) })
  const def = obj(v.definition)
  const was = queryTypeIds(v)
  rows.push({ label: S.objectTypes, value: list(was.map(typeName)) })
  const excluded = arr(def.excludeTypeIds).map(str).filter(Boolean)
  if (excluded.length) rows.push({ label: S.excludedTypes, value: list(excluded.map(typeName)) })
  if (searchText(v)) rows.push({ label: S.search, value: searchText(v) })
  rows.push({ label: S.filters, value: String(countFilters(def.filterGroup)) })
  rows.push({ label: S.sorts, value: String(arr(def.sorts).length) })
  const limit = obj(def.limit).size
  if (typeof limit === 'number') rows.push({ label: S.limit, value: String(limit) })
  if (c) {
    const cdef = obj(c.definition)
    typeListChange(was, queryTypeIds(c), typeName, changes)
    if (searchText(v) !== searchText(c)) changes.push(S.changed(S.search))
    if (JSON.stringify(def.filterGroup ?? null) !== JSON.stringify(cdef.filterGroup ?? null)) changes.push(S.changed(S.filters))
    if (JSON.stringify(def.sorts ?? []) !== JSON.stringify(cdef.sorts ?? [])) changes.push(S.changed(S.sorts))
    if (str(v.description) !== str(c.description)) changes.push(S.changed(S.description))
  }
  return { rows, changes }
}

/** The version's file, pretty-printed (as stored when it isn't JSON). */
export function prettyDefinition(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}
