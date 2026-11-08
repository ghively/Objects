/**
 * The extended search page: heading "Search", a query box, the
 * "Text matches only" toggle (`mode=fullText`: body matches only), M5's type and tag filters, and
 * the results in M3's data view (list by default; the other layouts on offer). "Save as Query"
 * turns the search into a saved query and opens it.
 *
 * Results come from `api.search` (debounced, the older request aborted, stale answers dropped) and
 * keep the server's rank order; their rows come from `api.rows({paths})`. Each list row shows its
 * first full-text snippet.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/api/client'
import type { Layout, QueryDefinition, Row, SearchResponse, SearchResult, ViewState } from '@/api/types'
import { Icon } from '@/components/Icon'
import { Switch } from '@/components/ui/switch'
import { ensureLinkIndex, typeOf, typesByIdOf, useLinkIndex } from '@/links/linkIndex'
import { useTabs } from '@/nav/tabs'
import { isTagType } from '@/object/ObjectHeader'
import { Highlight } from '@/palette/Highlight'
import {
  applyOption,
  buildSearchOptions,
  NO_FILTERS,
  PALETTE_TEXT,
  type SearchFilters,
  type SearchOption,
} from '@/palette/searchOptions'
import { TypeChip } from '@/shell/Sidebar'
import { useDefinitions } from '@/types/useDefinitions'
import { DataView, type RowExtras } from '@/views/DataView'
import { STANDARD_LAYOUTS } from '@/views/model'
import { useRows } from '@/views/useRows'
import './searchPage.css'

/** The search page's strings. */
export const SEARCH_PAGE_TEXT = {
  heading: 'Search',
  emptyState: 'Type a word to find content in this space.',
  fullTextSearchOnly: 'Text matches only',
  openSearch: 'Open extended search',
  saveAsQuery: 'Save as Query',
  saving: 'Saving...',
} as const

export const SEARCH_PAGE_DEBOUNCE_MS = 150
/** Results fetched (the server's maximum). */
export const SEARCH_PAGE_LIMIT = 200

const initialState = (): ViewState => ({
  viewDefinition: { dataViewLayout: 'list' },
  filterGroup: { type: 'filterGroup', operator: 'and', elements: [] },
  sorts: [],
  groupBy: null,
})

function snippetOf(r: SearchResult): string | null {
  for (const h of r.highlights) {
    if (h.field === 'title') continue
    if (h.snippets[0]) return h.snippets[0]
  }
  return null
}

/** The query definition a search is saved as (`definition.search`, types, tags). */
export function searchDefinition(
  q: string,
  textOnly: boolean,
  filters: SearchFilters,
  tagIdOf: (name: string) => string | null,
): Partial<QueryDefinition> & Pick<QueryDefinition, 'types'> {
  const def: Partial<QueryDefinition> & Pick<QueryDefinition, 'types'> = {
    types: filters.types.map((id) => ({ id })),
    search: { searchTerms: [{ text: q.trim() }], searchMode: textOnly ? 'fullText' : 'auto' },
  }
  if (filters.excludeTypes.length > 0) def.excludeTypeIds = [...filters.excludeTypes]
  const tagId = filters.tag !== null ? tagIdOf(filters.tag) : null
  if (tagId) def.tags = { ids: [tagId], operator: 'or' }
  return def
}

export interface SearchPageProps {
  q?: string
  textOnly?: boolean
}

export function SearchPage({ q: initialQ = '', textOnly: initialTextOnly = false }: SearchPageProps) {
  const types = useLinkIndex((s) => s.types)
  const objects = useLinkIndex((s) => s.objects)
  const { collections } = useDefinitions()
  const [query, setQuery] = useState(initialQ)
  const [textOnly, setTextOnly] = useState(initialTextOnly)
  const [filters, setFilters] = useState<SearchFilters>(NO_FILTERS)
  const [response, setResponse] = useState<{ key: string; res: SearchResponse } | null>(null)
  const [state, setState] = useState<ViewState>(initialState)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)

  useEffect(() => {
    void ensureLinkIndex()
  }, [])

  // A new target (the palette opened the page again with other terms) replaces the inputs.
  useEffect(() => {
    setQuery(initialQ)
    setTextOnly(initialTextOnly)
  }, [initialQ, initialTextOnly])

  const q = query.trim()
  const key = JSON.stringify([q, textOnly, filters])

  useEffect(() => {
    const mine = ++seq.current
    if (!q) return
    const ctrl = new AbortController()
    const timer = setTimeout(() => {
      // `fullText` is M8's mode; Task 3 widens `SearchOptions['mode']` to carry it.
      const mode = textOnly ? ('fullText' as const) : ('auto' as const)
      api
        .search(q, {
          types: filters.types,
          excludeTypes: filters.excludeTypes,
          ...(filters.tag !== null ? { tag: filters.tag } : {}),
          limit: SEARCH_PAGE_LIMIT,
          mode,
          signal: ctrl.signal,
        })
        .then((res) => {
          if (mine === seq.current) {
            setError(null)
            setResponse({ key, res })
          }
        })
        .catch((err: unknown) => {
          if (ctrl.signal.aborted) return
          if (mine === seq.current) setError(err instanceof Error ? err.message : String(err))
        })
    }, SEARCH_PAGE_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is q, textOnly and filters
  }, [key])

  const results = q && response && response.key === key ? response.res.results : null
  const partial = !!(q && response && response.key === key && response.res.partial)
  const paths = useMemo(() => (results ?? []).map((r) => r.path), [results])
  const { rows, loading, patchRow } = useRows(paths.length > 0 ? { paths } : { paths: [] })

  // Keep the server's rank order (a sort chosen in the view still applies after).
  const ordered = useMemo(() => {
    if (paths.length === 0) return [] as Row[]
    const rank = new Map(paths.map((p, i) => [p, i]))
    return rows.filter((r) => rank.has(r.summary.path)).sort((a, b) => rank.get(a.summary.path)! - rank.get(b.summary.path)!)
  }, [rows, paths])

  const byPath = useMemo(() => new Map((results ?? []).map((r) => [r.path, r])), [results])
  const rowExtras = (row: Row): RowExtras => {
    const r = byPath.get(row.summary.path)
    const s = r ? snippetOf(r) : null
    return s ? { trailing: <Highlight text={s} className="search-page-snippet text-fg-muted" /> } : {}
  }

  const tagNames = useMemo(() => {
    const byId = typesByIdOf(types)
    const names = new Map<string, string>()
    for (const o of objects) {
      if (o.template) continue
      if (isTagType(o.type ? byId.get(o.type) : undefined, o.type) && o.title) names.set(o.title.toLowerCase(), o.title)
      for (const t of o.tags) if (!names.has(t.toLowerCase())) names.set(t.toLowerCase(), t)
    }
    return [...names.values()]
  }, [objects, types])

  const tagIdOf = (name: string): string | null => {
    const n = name.toLowerCase()
    const tag = objects.find((o) => !o.template && isTagType(typeOf(o.type), o.type) && o.title.toLowerCase() === n)
    return tag?.id ?? null
  }

  const options = useMemo(
    () => buildSearchOptions(q, types, tagNames, filters).filter((o) => o.kind !== 'create'),
    [q, types, tagNames, filters],
  )

  const pickOption = (o: SearchOption) => {
    if (o.kind === 'create') return
    setFilters((f) => applyOption(f, o))
    setQuery(o.rest)
  }

  const saveAsQuery = async () => {
    if (!q || saving) return
    setSaving(true)
    setError(null)
    try {
      const definition = searchDefinition(q, textOnly, filters, tagIdOf) as QueryDefinition
      const layout: Layout = state.viewDefinition.dataViewLayout
      const created = await api.createQuery({ definition, view: { viewDefinition: { dataViewLayout: layout } } })
      useTabs.getState().open({ kind: 'query', id: created.id })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const chips: { key: string; label: string; icon: React.ReactNode; strike?: boolean; clear(): void }[] = []
  for (const id of filters.types) {
    const t = typeOf(id)
    chips.push({
      key: `t:${id}`,
      label: t?.name ?? id,
      icon: t ? <TypeChip type={t} size={16} /> : null,
      clear: () => setFilters((f) => ({ ...f, types: f.types.filter((x) => x !== id) })),
    })
  }
  for (const id of filters.excludeTypes) {
    const t = typeOf(id)
    chips.push({
      key: `x:${id}`,
      label: t?.name ?? id,
      icon: <Icon name="ph-minus-circle" size={14} />,
      strike: true,
      clear: () => setFilters((f) => ({ ...f, excludeTypes: f.excludeTypes.filter((x) => x !== id) })),
    })
  }
  if (filters.tag !== null) {
    chips.push({
      key: 'tag',
      label: filters.tag,
      icon: <Icon name="ph-tag" size={14} />,
      clear: () => setFilters((f) => ({ ...f, tag: null })),
    })
  }

  return (
    <div className="search-page mx-auto w-full max-w-5xl px-6 pt-5 pb-16" data-search-page="">
      <header className="flex flex-wrap items-center gap-2.5 pb-3">
        <Icon name="ph-magnifying-glass" size={20} />
        <h1 className="dataview-heading min-w-0 flex-1 text-[20px] font-bold md:text-[22px]">{SEARCH_PAGE_TEXT.heading}</h1>
        <button
          type="button"
          disabled={!q || saving}
          onClick={() => void saveAsQuery()}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-line bg-raised px-2.5 text-[14px] font-medium hover:bg-hover disabled:opacity-50"
        >
          <Icon name="ph-floppy-disk" size={14} />
          {saving ? SEARCH_PAGE_TEXT.saving : SEARCH_PAGE_TEXT.saveAsQuery}
        </button>
      </header>
      <div className="search-page-box flex min-h-11 flex-wrap items-center gap-1.5 rounded-lg border border-line bg-raised px-3 py-1.5">
        <Icon name="ph-magnifying-glass" size={16} className="shrink-0 text-fg-muted" />
        {chips.map((c) => (
          <span
            key={c.key}
            data-filter-chip=""
            className="inline-flex h-6 items-center gap-1 rounded-md bg-hover-2 pr-0.5 pl-1.5 text-[13px]"
          >
            {c.icon}
            <span className={c.strike ? 'line-through' : undefined}>{c.label}</span>
            <button
              type="button"
              aria-label={PALETTE_TEXT.clearFilter}
              title={PALETTE_TEXT.clearFilter}
              onClick={c.clear}
              className="inline-flex size-5 items-center justify-center rounded text-fg-muted hover:bg-hover"
            >
              <Icon name="ph-x" size={12} />
            </button>
          </span>
        ))}
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={PALETTE_TEXT.placeholderSearch}
          aria-label={PALETTE_TEXT.placeholderSearch}
          className="h-8 min-w-[8rem] flex-1 bg-transparent text-[15px] outline-none placeholder:text-fg-muted"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 py-2">
        <label className="inline-flex items-center gap-2 text-[14px] text-fg-muted">
          <Switch checked={textOnly} onCheckedChange={setTextOnly} aria-label={SEARCH_PAGE_TEXT.fullTextSearchOnly} />
          {SEARCH_PAGE_TEXT.fullTextSearchOnly}
        </label>
        {options.map((o) => (
          <button
            key={`${o.kind}:${o.label}`}
            type="button"
            data-search-option=""
            onClick={() => pickOption(o)}
            className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] text-fg-muted hover:bg-hover"
          >
            <Icon name={o.kind === 'excludeType' ? 'ph-minus-circle' : o.kind === 'tag' ? 'ph-tag' : 'ph-funnel'} size={14} />
            {o.label}
          </button>
        ))}
      </div>
      {partial && <p className="py-1 text-[13px] text-fg-muted">{PALETTE_TEXT.onlyPartialResults}</p>}
      {error && <p className="py-1 text-[13px] text-destructive">{error}</p>}
      {!q ? (
        <p className="search-page-empty py-10 text-center text-[14px] text-fg-muted">{SEARCH_PAGE_TEXT.emptyState}</p>
      ) : results !== null && results.length === 0 ? (
        <div className="flex flex-col items-center gap-1 py-10 text-center">
          <p className="text-[15px] text-fg">{PALETTE_TEXT.emptyTitle(q)}</p>
          <p className="text-[14px] text-fg-muted">{PALETTE_TEXT.emptyDescription}</p>
        </div>
      ) : (
        <DataView
          rows={ordered}
          types={types}
          collections={collections}
          scope={{ paths }}
          loading={results === null || (paths.length > 0 && loading)}
          state={state}
          onState={setState}
          layouts={STANDARD_LAYOUTS}
          patchRow={patchRow}
          rowExtras={rowExtras}
        />
      )}
    </div>
  )
}
