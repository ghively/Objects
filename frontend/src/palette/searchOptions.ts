/**
 * The search palette's strings and its option rows ("Create new … with title …", the type and tag
 * filters). Pure: no React, no stores.
 */
import type { TypeDef } from '@/api/types'
import { typeLabel, typePlural } from '@/lib/typeLabel'

/** The palette's strings. */
export const PALETTE_TEXT = {
  /** The palette's one input (content and actions). */
  placeholder: 'Find notes and commands, or paste',
  /** The extended search page's input. */
  placeholderSearch: 'Search content',
  /** The recent notes' groups. */
  today: 'Today',
  earlier: 'Earlier',
  /** Shown at the right of an action row, where content shows its type. */
  actionLabel: 'Action',
  /** Our string: the info icon's tooltip beside the input. */
  info: 'Type to search your content and actions. Type a type or tag name to filter; Ctrl+Shift+Enter opens extended search.',
  emptyRecentsTitle: 'Nothing here yet',
  emptyRecentsDescription: 'Recently opened notes appear here.',
  emptyTitle: (query: string) => `No results for "${query}"`,
  emptyDescription: 'Try other words, or clear a filter to see more.',
  onlyPartialResults: 'Indexing is still running, so some matches may be missing.',
  clearFilter: 'Clear filter',
  inNewTab: 'in new tab',
  inSidePanel: 'in side panel',
  createNewWithTitle: (typeTitle: string, title: string) => `Create new ${typeTitle} with title "${title}"`,
  typeFilter: (typeName: string) => `Only search for type "${typeName}"`,
  typeFilterExclude: (typeName: string) => `Exclude type "${typeName}"`,
  tagFilter: (tagName: string) => `Limit results to the tag "${tagName}"`,
  /** The dialog's accessible title. */
  searchTitle: 'Search this space',
} as const

/** The palette's active filters: type ids to include and exclude, and a tag name. */
export interface SearchFilters {
  types: string[]
  excludeTypes: string[]
  tag: string | null
}

export const NO_FILTERS: SearchFilters = { types: [], excludeTypes: [], tag: null }

export function hasFilters(f: SearchFilters): boolean {
  return f.types.length > 0 || f.excludeTypes.length > 0 || f.tag !== null
}

export type SearchOption =
  | { kind: 'create'; typeId: string; title: string; label: string }
  /** `rest`: the query once the words that named the type are removed. */
  | { kind: 'includeType'; typeId: string; rest: string; label: string }
  | { kind: 'excludeType'; typeId: string; rest: string; label: string }
  | { kind: 'tag'; tag: string; rest: string; label: string }

/** Tag options shown at most (a space can hold hundreds of tags). */
export const MAX_TAG_OPTIONS = 5

function words(s: string): string[] {
  return s.toLowerCase().split(/[\s\-_/.]+/).filter(Boolean)
}

/**
 * Our fuzzy name match: case-insensitive,
 * the query is a prefix of the name, or every query word is a prefix of a word of the name, or
 * (3+ characters) a substring of it.
 */
export function nameMatches(query: string, name: string): boolean {
  const q = query.trim().toLowerCase()
  const n = name.trim().toLowerCase()
  if (!q || !n) return false
  if (n.startsWith(q)) return true
  const nw = words(n)
  const qw = words(q)
  if (qw.length > 0 && qw.every((w) => nw.some((x) => x.startsWith(w)))) return true
  return q.length >= 3 && n.includes(q)
}

/** The query phrases a filter option may match: the whole query, then its last word (`rest` is what stays). */
function phrases(query: string): { phrase: string; rest: string }[] {
  const q = query.trim()
  if (!q) return []
  const out = [{ phrase: q, rest: '' }]
  const m = /^(.*\S)\s+(\S+)$/.exec(q)
  if (m) out.push({ phrase: m[2], rest: m[1] })
  return out
}

function typeMatch(query: string, t: TypeDef): string | null {
  for (const { phrase, rest } of phrases(query)) {
    // By the name the screen shows ("note") and by the stored one ("page").
    if ([typeLabel(t), typePlural(t), t.name, t.pluralName].some((n) => nameMatches(phrase, n))) return rest
  }
  return null
}

function tagMatch(query: string, tag: string): string | null {
  for (const { phrase, rest } of phrases(query)) {
    if (nameMatches(phrase, tag)) return rest
  }
  return null
}

/** The Page type: id `page`, else the type named Page. */
export function pageType(types: readonly TypeDef[]): TypeDef | undefined {
  return types.find((t) => t.id === 'page') ?? types.find((t) => t.name.toLowerCase() === 'page')
}

/**
 * M29: the types a suggestion may name for a create row that makes plain objects (the palette,
 * Turn into object): not read-only, not DailyNote (made by its date), not Whiteboard (its own
 * route and its own "Turn into whiteboard").
 */
export function suggestableTypes(types: readonly TypeDef[]): TypeDef[] {
  return types.filter((t) => {
    const name = t.name.toLowerCase()
    return !t.readOnlyReason && t.id !== 'dailynote' && name !== 'dailynote' && !(t.basic && name === 'whiteboard')
  })
}

/**
 * The option rows below the results, in order: create, then the type include/exclude pairs, then
 * the tag filters. Nothing for an empty query. The create row's type is the type filter's, else
 * `suggested` (M29: the suggested type of the query), else Page (shown as "Note", M32).
 */
export function buildSearchOptions(
  query: string,
  types: readonly TypeDef[],
  tags: readonly string[],
  filters: SearchFilters,
  suggested?: string | null,
): SearchOption[] {
  const title = query.trim()
  if (!title) return []
  const out: SearchOption[] = []
  const createType =
    (filters.types.length > 0 ? types.find((t) => t.id === filters.types[0]) : undefined) ??
    (suggested ? types.find((t) => t.id === suggested) : undefined) ??
    pageType(types)
  if (createType) {
    out.push({ kind: 'create', typeId: createType.id, title, label: PALETTE_TEXT.createNewWithTitle(typeLabel(createType), title) })
  }
  const taken = new Set([...filters.types, ...filters.excludeTypes])
  const sorted = [...types].sort((a, b) => typeLabel(a).localeCompare(typeLabel(b), undefined, { sensitivity: 'base' }))
  for (const t of sorted) {
    if (taken.has(t.id)) continue
    const rest = typeMatch(title, t)
    if (rest === null) continue
    out.push({ kind: 'includeType', typeId: t.id, rest, label: PALETTE_TEXT.typeFilter(typeLabel(t)) })
    out.push({ kind: 'excludeType', typeId: t.id, rest, label: PALETTE_TEXT.typeFilterExclude(typeLabel(t)) })
  }
  if (filters.tag === null) {
    const seen = new Set<string>()
    let n = 0
    for (const tag of [...tags].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))) {
      const key = tag.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      const rest = tagMatch(title, tag)
      if (rest === null) continue
      out.push({ kind: 'tag', tag, rest, label: PALETTE_TEXT.tagFilter(tag) })
      if (++n >= MAX_TAG_OPTIONS) break
    }
  }
  return out
}

/** The filters after picking `option` (create has none). */
export function applyOption(filters: SearchFilters, option: SearchOption): SearchFilters {
  if (option.kind === 'includeType') return { ...filters, types: [...filters.types, option.typeId] }
  if (option.kind === 'excludeType') return { ...filters, excludeTypes: [...filters.excludeTypes, option.typeId] }
  if (option.kind === 'tag') return { ...filters, tag: option.tag }
  return filters
}
