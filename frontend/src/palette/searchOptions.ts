/**
 * The search palette's strings and its option rows ("Create new … with title …", the type and tag
 * filters). Pure: no React, no stores.
 */
import type { TypeDef } from '@/api/types'

/** Capacities' `CommandPalette.*` strings, verbatim (the typo in `onlyPartialResults` included). */
export const PALETTE_TEXT = {
  placeholderSearch: 'Search content',
  placeholderActions: 'Search for actions',
  recentlyOpened: 'Recently Opened',
  allActions: 'All actions',
  emptyRecentsTitle: 'Nothing here yet',
  emptyRecentsDescription: 'Objects you open will show up here for quick access.',
  emptyTitle: (query: string) => `No results for "${query}"`,
  emptyDescription: 'Try a different term, or remove filters to widen the search.',
  onlyPartialResults: 'Your content in not fully indexed yet. Search results might not return all matches.',
  clearFilter: 'Clear filter',
  switchToActions: 'Switch to actions',
  switchToSearch: 'Switch to search',
  createNewWithTitle: (structureTitle: string, title: string) => `Create new ${structureTitle} with title "${title}"`,
  structureFilter: (structureName: string) => `Only search for type "${structureName}"`,
  structureFilterExclude: (structureName: string) => `Exclude type "${structureName}"`,
  tagFilter: (tagName: string) => `Only search content tagged with "${tagName}"`,
  /** `shortcuts.openSearchPalette.name`: the dialog's accessible title. */
  searchTitle: 'Search this space',
  /** `shortcuts.CommandPalette.name`. */
  actionsTitle: 'Open action palette',
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
 * Our fuzzy name match (Capacities' matcher is not in the trimmed reference): case-insensitive,
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
    if (nameMatches(phrase, t.name) || nameMatches(phrase, t.pluralName)) return rest
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
 * The option rows below the results, in order: create, then the type include/exclude pairs, then
 * the tag filters. Nothing for an empty query.
 */
export function buildSearchOptions(
  query: string,
  types: readonly TypeDef[],
  tags: readonly string[],
  filters: SearchFilters,
): SearchOption[] {
  const title = query.trim()
  if (!title) return []
  const out: SearchOption[] = []
  const createType = (filters.types.length > 0 ? types.find((t) => t.id === filters.types[0]) : undefined) ?? pageType(types)
  if (createType) {
    out.push({ kind: 'create', typeId: createType.id, title, label: PALETTE_TEXT.createNewWithTitle(createType.name, title) })
  }
  const taken = new Set([...filters.types, ...filters.excludeTypes])
  const sorted = [...types].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  for (const t of sorted) {
    if (taken.has(t.id)) continue
    const rest = typeMatch(title, t)
    if (rest === null) continue
    out.push({ kind: 'includeType', typeId: t.id, rest, label: PALETTE_TEXT.structureFilter(t.name) })
    out.push({ kind: 'excludeType', typeId: t.id, rest, label: PALETTE_TEXT.structureFilterExclude(t.name) })
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
