/**
 * The search palette's search mode: recently opened objects on an empty query, else the server's
 * results (debounced 100 ms, the previous request aborted, stale answers dropped), then the option
 * rows (create with title, type and tag filters).
 *
 * Keys on a result (our bindings): Enter the current tab, Ctrl/Cmd+Enter a new tab, Shift+Enter
 * the peek, all through `openObject`, so a Task opens in the peek on plain Enter as elsewhere.
 */
import { Command as CommandPrimitive } from 'cmdk'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import type { SearchResponse, SearchResult } from '@/api/types'
import { api } from '@/api/client'
import { Icon, IconOrEmoji } from '@/components/Icon'
import { Command, CommandGroup, CommandItem, CommandList } from '@/components/ui/command'
import { createAndOpen, openObject, type OpenMods } from '@/create/createAndOpen'
import { ensureLinkIndex, typeOf, useLinkIndex } from '@/links/linkIndex'
import { useRecent } from '@/nav/recent'
import { isTagType } from '@/object/ObjectHeader'
import { TypeChip } from '@/shell/Sidebar'
import { Highlight, MatchedTitle } from './Highlight'
import {
  applyOption,
  buildSearchOptions,
  hasFilters,
  NO_FILTERS,
  PALETTE_TEXT,
  type SearchFilters,
  type SearchOption,
} from './searchOptions'

export const SEARCH_DEBOUNCE_MS = 100
/** Recently opened objects shown on an empty query. */
export const RECENT_SHOWN = 10
/** Snippets shown per result. */
const SNIPPETS_SHOWN = 2

export interface SearchViewProps {
  /** Close the palette (after opening or creating something). */
  onDone(): void
  /** The footer: the mode switch. */
  footer?: React.ReactNode
}

interface Row {
  value: string
  kind: 'recent' | 'result' | 'option'
  path?: string
  typeId?: string
  option?: SearchOption
}

function modsOf(e: KeyboardEvent | MouseEvent): OpenMods {
  return { ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey }
}

function snippetsOf(r: SearchResult): string[] {
  const out: string[] = []
  for (const h of r.highlights) {
    if (h.field === 'title') continue // the title shows its own matches
    for (const s of h.snippets) {
      out.push(s)
      if (out.length >= SNIPPETS_SHOWN) return out
    }
  }
  return out
}

export function SearchView({ onDone, footer }: SearchViewProps) {
  const types = useLinkIndex((s) => s.types)
  const objects = useLinkIndex((s) => s.objects)
  const recentPaths = useRecent((s) => s.paths)
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<SearchFilters>(NO_FILTERS)
  const [response, setResponse] = useState<{ q: string; res: SearchResponse } | null>(null)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const mods = useRef<OpenMods>({})
  const seq = useRef(0)
  const busy = useRef(false)

  useEffect(() => {
    void ensureLinkIndex()
  }, [])

  const q = query.trim()

  // Debounced search; a newer query aborts the older request and drops its answer.
  useEffect(() => {
    const mine = ++seq.current
    if (!q) return
    const ctrl = new AbortController()
    const timer = setTimeout(() => {
      api
        .search(q, {
          types: filters.types,
          excludeTypes: filters.excludeTypes,
          ...(filters.tag !== null ? { tag: filters.tag } : {}),
          signal: ctrl.signal,
        })
        .then((res) => {
          if (mine === seq.current) setResponse({ q, res })
        })
        .catch(() => {
          // Aborted or failed: keep what is shown.
        })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [q, filters])

  const tagNames = useMemo(() => {
    const names = new Map<string, string>()
    for (const o of objects) {
      if (o.template) continue
      if (isTagType(typeOf(o.type), o.type) && o.title) names.set(o.title.toLowerCase(), o.title)
      for (const t of o.tags) if (!names.has(t.toLowerCase())) names.set(t.toLowerCase(), t)
    }
    return [...names.values()]
  }, [objects])

  const options = useMemo(() => buildSearchOptions(q, types, tagNames, filters), [q, types, tagNames, filters])

  const recents = useMemo(() => {
    if (q) return []
    const byPath = new Map(objects.map((o) => [o.path, o]))
    const out = []
    for (const p of recentPaths) {
      const o = byPath.get(p)
      if (!o || o.template) continue
      if (filters.types.length > 0 && !filters.types.includes(o.type)) continue
      if (filters.excludeTypes.includes(o.type)) continue
      if (filters.tag !== null && !o.tags.some((t) => t.toLowerCase() === filters.tag!.toLowerCase())) continue
      out.push(o)
      if (out.length >= RECENT_SHOWN) break
    }
    return out
  }, [q, recentPaths, objects, filters])

  const results = response && response.q === q ? response.res.results : null
  const partial = !!(response && response.q === q && response.res.partial)

  const rows: Row[] = useMemo(() => {
    const out: Row[] = []
    for (const o of recents) out.push({ value: `recent:${o.path}`, kind: 'recent', path: o.path, typeId: o.type })
    for (const r of results ?? []) out.push({ value: `result:${r.path}`, kind: 'result', path: r.path, typeId: r.type })
    options.forEach((o, i) => out.push({ value: `option:${i}:${o.label}`, kind: 'option', option: o }))
    return out
  }, [recents, results, options])

  // Keep the first row selected whenever the rows change.
  const firstValue = rows[0]?.value ?? ''
  useEffect(() => {
    setValue(firstValue)
  }, [firstValue, rows.length])

  const pickOption = async (o: SearchOption, m: OpenMods) => {
    if (o.kind !== 'create') {
      setFilters((f) => applyOption(f, o))
      setQuery(o.rest)
      return
    }
    if (busy.current) return
    busy.current = true
    try {
      await createAndOpen(o.typeId, { title: o.title }, m)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      busy.current = false
    }
  }

  const pick = (row: Row) => {
    const m = mods.current
    mods.current = {}
    if (row.kind === 'option' && row.option) {
      void pickOption(row.option, m)
      return
    }
    if (row.path) {
      onDone()
      openObject(row.path, m, row.typeId)
    }
  }

  const removeLastFilter = () => {
    setFilters((f) => {
      if (f.tag !== null) return { ...f, tag: null }
      if (f.excludeTypes.length > 0) return { ...f, excludeTypes: f.excludeTypes.slice(0, -1) }
      if (f.types.length > 0) return { ...f, types: f.types.slice(0, -1) }
      return f
    })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter') mods.current = modsOf(e)
    else if (e.key === 'Backspace' && !query && hasFilters(filters)) removeLastFilter()
  }

  const chips: { key: string; label: string; icon: React.ReactNode; clear(): void }[] = []
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
    <Command
      shouldFilter={false}
      loop
      value={value}
      onValueChange={setValue}
      onKeyDown={onKeyDown}
      onClickCapture={(e) => {
        mods.current = modsOf(e)
      }}
      className="rounded-xl bg-transparent text-fg"
    >
      <div className="flex min-h-12 flex-wrap items-center gap-1.5 border-b border-line px-3 py-1.5">
        <Icon name="ph-magnifying-glass" size={16} className="shrink-0 text-fg-muted" />
        {chips.map((c) => (
          <span
            key={c.key}
            data-filter-chip=""
            className="inline-flex h-6 items-center gap-1 rounded-md bg-hover-2 pr-0.5 pl-1.5 text-[13px]"
          >
            {c.icon}
            <span className={c.key.startsWith('x:') ? 'line-through' : undefined}>{c.label}</span>
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
        <CommandPrimitive.Input
          autoFocus
          value={query}
          onValueChange={setQuery}
          placeholder={PALETTE_TEXT.placeholderSearch}
          aria-label={PALETTE_TEXT.placeholderSearch}
          className="h-9 min-w-[8rem] flex-1 bg-transparent text-[15px] outline-none placeholder:text-fg-muted"
        />
      </div>
      <CommandList className="command-palette-list max-h-[420px] p-1.5">
        {partial && <div className="px-2 py-1.5 text-[13px] text-fg-muted">{PALETTE_TEXT.onlyPartialResults}</div>}
        {error && <div className="px-2 py-1.5 text-[13px] text-destructive">{error}</div>}
        {!q && recents.length === 0 && (
          <div className="px-3 py-6 text-center">
            <div className="text-[15px]">{PALETTE_TEXT.emptyRecentsTitle}</div>
            <div className="mt-1 text-[13px] text-fg-muted">{PALETTE_TEXT.emptyRecentsDescription}</div>
          </div>
        )}
        {recents.length > 0 && (
          <CommandGroup heading={PALETTE_TEXT.recentlyOpened}>
            {recents.map((o) => {
              const t = typeOf(o.type)
              return (
                <CommandItem
                  key={o.path}
                  value={`recent:${o.path}`}
                  onSelect={() => pick({ value: `recent:${o.path}`, kind: 'recent', path: o.path, typeId: o.type })}
                  className="menu-row gap-2 rounded-lg text-[15px]"
                >
                  {o.icon ? <IconOrEmoji icon={o.icon} size={18} /> : t && <TypeChip type={t} size={20} />}
                  <span className="min-w-0 flex-1 truncate">{o.title}</span>
                  {t && <span className="text-[13px] text-fg-muted">{t.name}</span>}
                </CommandItem>
              )
            })}
          </CommandGroup>
        )}
        {q && results !== null && results.length === 0 && (
          <div className="px-3 py-6 text-center">
            <div className="text-[15px]">{PALETTE_TEXT.emptyTitle(q)}</div>
            <div className="mt-1 text-[13px] text-fg-muted">{PALETTE_TEXT.emptyDescription}</div>
          </div>
        )}
        {results && results.length > 0 && (
          <CommandGroup>
            {results.map((r) => {
              const t = typeOf(r.type)
              const snippets = snippetsOf(r)
              return (
                <CommandItem
                  key={r.path}
                  value={`result:${r.path}`}
                  data-search-result={r.path}
                  onSelect={() => pick({ value: `result:${r.path}`, kind: 'result', path: r.path, typeId: r.type })}
                  className="menu-row items-start gap-2 rounded-lg text-[15px]"
                >
                  <span className="mt-0.5 inline-flex shrink-0">
                    {r.icon && r.icon.val ? <IconOrEmoji icon={r.icon} size={18} /> : t && <TypeChip type={t} size={20} />}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate" data-result-title="">
                        <MatchedTitle title={r.title} matches={r.titleMatches} />
                      </span>
                      <span className="shrink-0 text-[13px] text-fg-muted">{t?.name ?? r.type}</span>
                    </span>
                    {snippets.map((s, i) => (
                      <Highlight key={i} text={s} className="truncate text-[13px] text-fg-muted" />
                    ))}
                  </span>
                </CommandItem>
              )
            })}
          </CommandGroup>
        )}
        {options.length > 0 && (
          <CommandGroup>
            {options.map((o, i) => (
              <CommandItem
                key={`${o.kind}:${o.label}`}
                value={`option:${i}:${o.label}`}
                onSelect={() => pick({ value: `option:${i}:${o.label}`, kind: 'option', option: o })}
                className="menu-row gap-2 rounded-lg text-[15px]"
              >
                <Icon
                  name={
                    o.kind === 'create'
                      ? 'ph-plus'
                      : o.kind === 'excludeType'
                        ? 'ph-minus-circle'
                        : o.kind === 'tag'
                          ? 'ph-tag'
                          : 'ph-funnel'
                  }
                  size={16}
                  className="shrink-0 text-fg-muted"
                />
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
      {footer}
    </Command>
  )
}
