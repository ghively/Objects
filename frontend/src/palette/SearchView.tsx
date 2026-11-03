/**
 * The search palette's one list, content and actions together (Capacities' "Search for content and
 * actions, or paste from clipboard"; polish audit backlog 2):
 *
 * - empty query: the clipboard's offers (`paste.ts`), then the recently opened objects grouped
 *   "Today" / "Earlier" by when they were last opened (an entry stored before open times existed
 *   counts as Earlier), each with its type at the right;
 * - a query: the server's results (debounced 100 ms, the previous request aborted, stale answers
 *   dropped), then the actions whose label matches, each with "Action" at the right, then the option
 *   rows (create with title, type and tag filters), then "Open in extended search".
 *
 * Our choices: actions are listed only for a query (none on an empty one), after the content, and
 * not while a type or tag filter is set (the query is then about content); the clipboard's offers
 * show on an empty query only.
 *
 * Keys on an object row (our bindings): Enter the current tab, Ctrl/Cmd+Enter a new tab, Shift+Enter
 * the side panel, all through `openObject`, so a Task opens in the peek on plain Enter as elsewhere.
 * On an action row any Enter runs the action.
 *
 * M8: with a query, a last row "Open in extended search" opens the extended search page with the
 * query (and its filters' words dropped); Ctrl/Cmd+Shift+Enter does the same from any row (our key).
 *
 * A result (or recent) row can be dragged onto a whiteboard (M6): it carries the object's path;
 * the palette closes as the drag starts so the board under it takes the drop.
 */
import { Command as CommandPrimitive } from 'cmdk'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import type { ObjectSummary, SearchResponse, SearchResult } from '@/api/types'
import { api } from '@/api/client'
import { Icon, IconOrEmoji } from '@/components/Icon'
import { Command, CommandGroup, CommandItem, CommandList } from '@/components/ui/command'
import { createAndOpen, openObject, type OpenMods } from '@/create/createAndOpen'
import { ensureLinkIndex, typeOf, typesByIdOf, useLinkIndex } from '@/links/linkIndex'
import { useRecent } from '@/nav/recent'
import { isTagType } from '@/object/ObjectHeader'
import { setObjectDragData } from '@/shell/objectDrag'
import { TypeChip } from '@/shell/Sidebar'
import { buildActions, matchActions, type Action, type ActionContext } from './actions'
import { Highlight, MatchedTitle } from './Highlight'
import { PASTE_TEXT, pasteActions, readClipboard, type ClipboardContent, type PasteAction } from './paste'
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
  /** The footer: the keyboard hints. */
  footer?: React.ReactNode
  /** M8: open the extended search page with `q` (the palette closes itself). */
  onOpenExtendedSearch?(q: string): void
  /** What the actions act on; without it no actions are listed. */
  actions?: ActionContext
  /** Reads the clipboard when the view opens (tests replace it). */
  readClip?: () => Promise<ClipboardContent>
}

/** `CommandPalette.options.LocalSpaceQuery`, verbatim. */
export const OPEN_IN_EXTENDED_SEARCH = 'Open in extended search'
const EXTENDED_VALUE = 'extended-search'

interface Row {
  value: string
  kind: 'paste' | 'recent' | 'result' | 'action' | 'option' | 'extended'
  path?: string
  typeId?: string
  option?: SearchOption
  action?: Action
  paste?: PasteAction
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

/** Whether `ms` falls on today's local date. */
export function openedToday(ms: number | undefined, now: Date = new Date()): boolean {
  if (ms === undefined) return false
  const d = new Date(ms)
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
}

const rowClass = 'menu-row gap-2 rounded-lg text-[15px]'
const rightLabelClass = 'shrink-0 text-[13px] text-fg-muted'

export function SearchView({ onDone, footer, onOpenExtendedSearch, actions: actionContext, readClip = readClipboard }: SearchViewProps) {
  const types = useLinkIndex((s) => s.types)
  const objects = useLinkIndex((s) => s.objects)
  const recentPaths = useRecent((s) => s.paths)
  const openedAt = useRecent((s) => s.openedAt)
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<SearchFilters>(NO_FILTERS)
  // An answer belongs to its query and filters: a change to either hides it until the next answer.
  const [response, setResponse] = useState<{ q: string; filters: SearchFilters; res: SearchResponse } | null>(null)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [clip, setClip] = useState<ClipboardContent>({ kind: 'empty' })
  const mods = useRef<OpenMods>({})
  const seq = useRef(0)
  const busy = useRef(false)

  useEffect(() => {
    void ensureLinkIndex()
  }, [])

  // The clipboard, read once as the palette opens (M8's paste offers).
  const readRef = useRef(readClip)
  useEffect(() => {
    let live = true
    readRef.current().then(
      (c) => live && setClip(c),
      () => live && setClip({ kind: 'denied' }),
    )
    return () => {
      live = false
    }
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
          if (mine === seq.current) setResponse({ q, filters, res })
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
    const byId = typesByIdOf(types)
    const names = new Map<string, string>()
    for (const o of objects) {
      if (o.template) continue
      if (isTagType(o.type ? byId.get(o.type) : undefined, o.type) && o.title) names.set(o.title.toLowerCase(), o.title)
      for (const t of o.tags) if (!names.has(t.toLowerCase())) names.set(t.toLowerCase(), t)
    }
    return [...names.values()]
  }, [objects, types])

  const options = useMemo(() => buildSearchOptions(q, types, tagNames, filters), [q, types, tagNames, filters])

  const allActions = useMemo(() => (actionContext ? buildActions(actionContext) : []), [actionContext])
  const actions = useMemo(() => (hasFilters(filters) ? [] : matchActions(allActions, q)), [allActions, q, filters])

  const pastes = useMemo(() => (q ? [] : pasteActions(clip, types)), [q, clip, types])

  const recents = useMemo(() => {
    const today: ObjectSummary[] = []
    const earlier: ObjectSummary[] = []
    if (q) return { today, earlier }
    const byPath = new Map(objects.map((o) => [o.path, o]))
    const now = new Date()
    let n = 0
    for (const p of recentPaths) {
      const o = byPath.get(p)
      if (!o || o.template) continue
      if (filters.types.length > 0 && !filters.types.includes(o.type)) continue
      if (filters.excludeTypes.includes(o.type)) continue
      if (filters.tag !== null && !o.tags.some((t) => t.toLowerCase() === filters.tag!.toLowerCase())) continue
      ;(openedToday(openedAt[p], now) ? today : earlier).push(o)
      if (++n >= RECENT_SHOWN) break
    }
    return { today, earlier }
  }, [q, recentPaths, openedAt, objects, filters])
  const recentCount = recents.today.length + recents.earlier.length

  const current = response && response.q === q && response.filters === filters ? response : null
  const results = current ? current.res.results : null
  const partial = !!current?.res.partial

  const rows: Row[] = useMemo(() => {
    const out: Row[] = []
    for (const a of pastes) out.push({ value: a.id, kind: 'paste', paste: a })
    for (const o of [...recents.today, ...recents.earlier]) out.push({ value: `recent:${o.path}`, kind: 'recent', path: o.path, typeId: o.type })
    for (const r of results ?? []) out.push({ value: `result:${r.path}`, kind: 'result', path: r.path, typeId: r.type })
    for (const a of actions) out.push({ value: `action:${a.id}`, kind: 'action', action: a })
    options.forEach((o, i) => out.push({ value: `option:${i}:${o.label}`, kind: 'option', option: o }))
    if (q && onOpenExtendedSearch) out.push({ value: EXTENDED_VALUE, kind: 'extended' })
    return out
  }, [pastes, recents, results, actions, options, q, onOpenExtendedSearch])

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
    if (row.kind === 'extended') {
      if (q) onOpenExtendedSearch?.(q)
      return
    }
    if (row.kind === 'action' && row.action) {
      onDone()
      row.action.run()
      return
    }
    if (row.kind === 'paste' && row.paste) {
      onDone()
      row.paste.run().catch((err: unknown) => console.warn('Could not use the clipboard content:', err))
      return
    }
    if (row.kind === 'option' && row.option) {
      void pickOption(row.option, m)
      return
    }
    if (row.path) {
      onDone()
      openObject(row.path, m, row.typeId)
    }
  }

  /** Drag an object out (onto a whiteboard): carry its path, then close the palette so the
   *  board under it gets the drop (after the drag has started, so the drag survives). */
  const startDrag = (e: React.DragEvent, path: string, title: string) => {
    setObjectDragData(e.dataTransfer, path, title)
    setTimeout(onDone, 0)
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
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.shiftKey && q && onOpenExtendedSearch) {
      e.preventDefault()
      e.stopPropagation()
      mods.current = {}
      onOpenExtendedSearch(q)
      return
    }
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

  const recentRow = (o: ObjectSummary) => {
    const t = typeOf(o.type)
    return (
      <CommandItem
        key={o.path}
        value={`recent:${o.path}`}
        draggable
        onDragStart={(e) => startDrag(e, o.path, o.title)}
        onSelect={() => pick({ value: `recent:${o.path}`, kind: 'recent', path: o.path, typeId: o.type })}
        className={rowClass}
      >
        {o.icon ? <IconOrEmoji icon={o.icon} size={18} /> : t && <TypeChip type={t} size={20} />}
        <span className="min-w-0 flex-1 truncate">{o.title}</span>
        {t && <span className={rightLabelClass}>{t.name}</span>}
      </CommandItem>
    )
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
          placeholder={PALETTE_TEXT.placeholder}
          aria-label={PALETTE_TEXT.placeholder}
          className="h-9 min-w-[8rem] flex-1 bg-transparent text-[15px] outline-none placeholder:text-fg-muted"
        />
        <span
          data-palette-info=""
          role="img"
          aria-label={PALETTE_TEXT.info}
          title={PALETTE_TEXT.info}
          className="inline-flex shrink-0 text-fg-muted"
        >
          <Icon name="ph-info" size={16} />
        </span>
      </div>
      <CommandList className="command-palette-list max-h-[420px] p-1.5">
        {partial && <div className="px-2 py-1.5 text-[13px] text-fg-muted">{PALETTE_TEXT.onlyPartialResults}</div>}
        {error && <div className="px-2 py-1.5 text-[13px] text-destructive">{error}</div>}
        {!q && clip.kind === 'denied' && (
          <div data-clipboard-denied="" className="px-3 py-1.5 text-[13px] text-fg-muted">
            {PASTE_TEXT.denied}
          </div>
        )}
        {pastes.length > 0 && (
          <CommandGroup data-paste-group="">
            {pastes.map((a) => (
              <CommandItem
                key={a.id}
                value={a.id}
                data-action={a.id}
                onSelect={() => pick({ value: a.id, kind: 'paste', paste: a })}
                className={rowClass}
              >
                <span className="inline-flex size-5 items-center justify-center text-fg-muted">
                  <Icon name={a.icon} size={16} />
                </span>
                <span className="min-w-0 flex-1 truncate">{a.label}</span>
                {a.preview ? <span className={rightLabelClass}>{a.preview}</span> : null}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {!q && recentCount === 0 && (
          <div className="px-3 py-6 text-center">
            <div className="text-[15px]">{PALETTE_TEXT.emptyRecentsTitle}</div>
            <div className="mt-1 text-[13px] text-fg-muted">{PALETTE_TEXT.emptyRecentsDescription}</div>
          </div>
        )}
        {recents.today.length > 0 && <CommandGroup heading={PALETTE_TEXT.today}>{recents.today.map(recentRow)}</CommandGroup>}
        {recents.earlier.length > 0 && <CommandGroup heading={PALETTE_TEXT.earlier}>{recents.earlier.map(recentRow)}</CommandGroup>}
        {q && results !== null && results.length === 0 && actions.length === 0 && (
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
                  draggable
                  onDragStart={(e) => startDrag(e, r.path, r.title)}
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
                      <span className={rightLabelClass}>{t?.name ?? r.type}</span>
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
        {actions.length > 0 && (
          <CommandGroup>
            {actions.map((a) => {
              const t = a.typeId ? typeOf(a.typeId) : undefined
              return (
                <CommandItem
                  key={a.id}
                  value={`action:${a.id}`}
                  data-action={a.id}
                  onSelect={() => pick({ value: `action:${a.id}`, kind: 'action', action: a })}
                  className={rowClass}
                >
                  {t ? (
                    <TypeChip type={t} size={20} />
                  ) : (
                    <span className="inline-flex size-5 items-center justify-center text-fg-muted">
                      <IconOrEmoji icon={a.icon} fallback="ph-lightning" size={16} />
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate" data-action-label="">
                    {a.label}
                  </span>
                  <span className={rightLabelClass}>{PALETTE_TEXT.actionLabel}</span>
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
                className={rowClass}
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
        {q && onOpenExtendedSearch && (
          <CommandGroup>
            <CommandItem
              value={EXTENDED_VALUE}
              data-open-extended-search=""
              onSelect={() => pick({ value: EXTENDED_VALUE, kind: 'extended' })}
              className={rowClass}
            >
              <Icon name="ph-magnifying-glass-plus" size={16} className="shrink-0 text-fg-muted" />
              <span className="min-w-0 flex-1 truncate">{OPEN_IN_EXTENDED_SEARCH}</span>
            </CommandItem>
          </CommandGroup>
        )}
      </CommandList>
      {footer}
    </Command>
  )
}
