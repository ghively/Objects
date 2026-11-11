// The query editor: Types, Tags or backlinks, Search and Limit. Every change is an edit of the
// query's `definition`; nothing here touches the view (layout, table, cards).
import { typeLabel } from '@/lib/typeLabel'
import { useMemo, useState, type ReactNode } from 'react'
import { api } from '@/api/client'
import type { Collection, EntityRef, PropertyDef, Query, QueryDefinition, TypeDef } from '@/api/types'
import { Icon } from '@/components/Icon'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useLinkIndex } from '@/links/linkIndex'
import { cn } from '@/lib/utils'
import { RelationPicker } from '@/properties/RelationPicker'
import { TypeChip } from '@/shell/Sidebar'
import { MAX_TERMS, MIN_TERM, PAUSED_HINT, isSearching, searchTermsOf } from './runQuery'

export const BUILDER_TEXT = {
  types: 'Types',
  allTypes: 'All',
  allTypesTooltip: 'Include every type',
  addType: 'Add type',
  moreTypes: (n: number) => `+${n} more`,
  excludeTypes: 'Exclude types',
  excludeTypesHint: 'Excluding types needs a search term or a tag first.',
  excludeTypesInactive: 'Ignored while particular types are picked.',
  clear: 'Clear',
  collectionAll: 'All',
  inAnyCollection: 'In any collection',
  inNoCollection: 'In no collection',
  collectionsSelected: (n: number) => `${n} collections selected`,
  tags: 'Tags or backlinks',
  anyOf: 'Any of',
  allOf: 'All of',
  allOfHint: 'Each note has just one type, so All of does not apply here.',
  addTag: 'Add tag or backlink',
  excludeTags: 'Leave out tags or backlinks',
  excludeTagsDisabled: 'To exclude tags, first add a search term or include a tag.',
  search: 'Search',
  searchPlaceholder: 'Search terms…',
  searchHint: 'Enter adds the term',
  termCount: 'Type 2 or more characters',
  addTerm: 'With more than one term, a result needs to match only one.',
  mode: 'Mode',
  limit: 'Limit',
  noLimit: 'No limit',
  paused: PAUSED_HINT,
  releaseConstraintTooltip:
    'Makes this a regular saved search that can cover any type. It opens as its own page and leaves the dashboard of this type.',
  /** Our string: the release button's accessible name (the tooltip is the visible hint). */
  releaseConstraint: 'Release type constraint',
}

/**
 * A query shown as a tab on a type's dashboard whose only type is that type (computed,
 * never stored) is constrained to it: the type can't be
 * changed there until it is released.
 */
export function isSingleTypeQuery(def: QueryDefinition, typeId: string): boolean {
  return def.types.length === 1 && def.types[0].id === typeId
}

/** The lock of a constrained query: its type, and what "release" does (the type page's). */
export interface QueryConstraint {
  type: TypeDef
  onRelease(): void
}

type SearchMode = NonNullable<QueryDefinition['search']>['searchMode']

/**
 * The modes offered. Exact (`fullText`) and Semantic (`semantic`) are hidden until real full-text
 * search exists (decision Q-1): they matched exactly like Auto. A saved query that has one still
 * runs as Auto (the server accepts both) and shows Auto here.
 */
export const SEARCH_MODES: { key: SearchMode; label: string; tooltip: string }[] = [
  { key: 'auto', label: 'Auto', tooltip: 'Looks for the words in titles, aliases, descriptions and text.' },
  { key: 'title', label: 'Title', tooltip: 'Looks for the exact words in titles only.' },
]

export const LIMIT_SIZES = [1, 3, 5, 10, 25, 50] as const
const VISIBLE_TYPES = 4

const BTN =
  'flex h-7 items-center gap-1.5 rounded-md border border-line bg-raised px-2 text-[13px] hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50'

type Edit = (d: QueryDefinition) => QueryDefinition

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-1.5">
      <h3 title={hint} className="text-[13px] font-semibold text-fg-muted">
        {title}
      </h3>
      {children}
    </section>
  )
}

function Check({ checked, onClick, children }: { checked: boolean; onClick(): void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={onClick}
      className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[14px] hover:bg-hover"
    >
      <span className="flex size-4 items-center justify-center">{checked && <Icon name="ph-check" size={14} />}</span>
      {children}
    </button>
  )
}

function Chip({ children, onRemove, label }: { children: ReactNode; onRemove?(): void; label?: string }) {
  return (
    <span className="flex h-7 items-center gap-1.5 rounded-md border border-line bg-raised px-2 text-[13px]">
      {children}
      {onRemove && (
        <button type="button" aria-label={`Remove ${label ?? ''}`.trim()} onClick={onRemove} className="text-fg-muted hover:text-fg">
          <Icon name="ph-x" size={11} />
        </button>
      )}
    </span>
  )
}

// ---- Types ----

type TypeEntry = QueryDefinition['types'][number]

/** The collection filter of one type entry, as the label the chip shows. */
export function collectionFilterLabel(s: TypeEntry): string {
  if (s.inNoCollection) return BUILDER_TEXT.inNoCollection
  if (s.inAnyCollection) return BUILDER_TEXT.inAnyCollection
  if (s.collectionIds?.length) return BUILDER_TEXT.collectionsSelected(s.collectionIds.length)
  return BUILDER_TEXT.collectionAll
}

function CollectionFilter({ s, type, collections, edit }: { s: TypeEntry; type: TypeDef; collections: Collection[]; edit(next: TypeEntry): void }) {
  const mine = collections.filter((c) => c.typeIds.includes(type.id))
  const clean: TypeEntry = { id: s.id }
  const mode = s.inNoCollection ? 'none' : s.inAnyCollection ? 'any' : s.collectionIds?.length ? 'some' : 'all'
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`${typeLabel(type)} collections`} className="text-[12px] text-fg-muted hover:text-fg">
          {collectionFilterLabel(s)}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 border-line bg-raised p-1">
        <Check checked={mode === 'all'} onClick={() => edit(clean)}>
          {BUILDER_TEXT.collectionAll}
        </Check>
        <Check checked={mode === 'any'} onClick={() => edit({ ...clean, inAnyCollection: true })}>
          {BUILDER_TEXT.inAnyCollection}
        </Check>
        <Check checked={mode === 'none'} onClick={() => edit({ ...clean, inNoCollection: true })}>
          {BUILDER_TEXT.inNoCollection}
        </Check>
        {mine.map((c) => {
          const on = s.collectionIds?.includes(c.id) ?? false
          return (
            <Check
              key={c.id}
              checked={on}
              onClick={() => {
                const ids = on ? (s.collectionIds ?? []).filter((i) => i !== c.id) : [...(s.collectionIds ?? []), c.id]
                edit(ids.length > 0 ? { ...clean, collectionIds: ids } : clean)
              }}
            >
              {c.name}
            </Check>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}

function ConstrainedTypes({ def, constraint, collections, onChange }: { def: QueryDefinition; constraint: QueryConstraint; collections: Collection[]; onChange(e: Edit): void }) {
  const s = def.types[0] ?? { id: constraint.type.id }
  return (
    <Section title={BUILDER_TEXT.types}>
      <div data-testid="query-type-lock" className="flex flex-wrap items-center gap-1.5">
        <Chip>
          <Icon name="ph-lock-simple" size={12} />
          <TypeChip type={constraint.type} size={18} />
          <span>{typeLabel(constraint.type)}</span>
          <CollectionFilter
            s={s}
            type={constraint.type}
            collections={collections}
            edit={(next) => onChange((d) => ({ ...d, types: [next] }))}
          />
        </Chip>
        <button
          type="button"
          aria-label={BUILDER_TEXT.releaseConstraint}
          title={BUILDER_TEXT.releaseConstraintTooltip}
          onClick={constraint.onRelease}
          className={BTN}
        >
          <Icon name="ph-lock-simple-open" size={13} />
        </button>
      </div>
    </Section>
  )
}

function TypesSection({ def, types, collections, onChange }: { def: QueryDefinition; types: TypeDef[]; collections: Collection[]; onChange(e: Edit): void }) {
  const selected = def.types
  const excluded = def.excludeTypeIds ?? []
  const [showAll, setShowAll] = useState(false)
  const canExclude = isSearching(def) || (def.tags?.ids.length ?? 0) > 0
  const shown = showAll ? selected : selected.slice(0, VISIBLE_TYPES)
  const inactive = selected.length > 0
  const setExcluded = (ids: string[]) => onChange((d) => ({ ...d, excludeTypeIds: ids.length > 0 ? ids : undefined }))

  return (
    <Section title={BUILDER_TEXT.types} hint={BUILDER_TEXT.allOfHint}>
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          title={BUILDER_TEXT.allTypesTooltip}
          aria-pressed={selected.length === 0}
          onClick={() => onChange((d) => ({ ...d, types: [] }))}
          className={cn(BTN, selected.length === 0 && 'bg-hover')}
        >
          {BUILDER_TEXT.allTypes}
        </button>
        {shown.map((s) => {
          const t = types.find((x) => x.id === s.id)
          return (
            <Chip
              key={s.id}
              label={typeLabel(t, s.id)}
              onRemove={() => onChange((d) => ({ ...d, types: d.types.filter((x) => x.id !== s.id) }))}
            >
              {t ? <TypeChip type={t} size={18} /> : <Icon name="ph-warning" size={14} />}
              <span>{typeLabel(t, 'Invalid')}</span>
              {t && (
                <CollectionFilter
                  s={s}
                  type={t}
                  collections={collections}
                  edit={(next) => onChange((d) => ({ ...d, types: d.types.map((x) => (x.id === s.id ? next : x)) }))}
                />
              )}
            </Chip>
          )
        })}
        {!showAll && selected.length > VISIBLE_TYPES && (
          <button type="button" onClick={() => setShowAll(true)} className="text-[13px] text-fg-muted hover:text-fg">
            {BUILDER_TEXT.moreTypes(selected.length - VISIBLE_TYPES)}
          </button>
        )}
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" aria-label={BUILDER_TEXT.addType} className={BTN}>
              <Icon name="ph-plus" size={13} />
              {BUILDER_TEXT.addType}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="max-h-72 w-56 overflow-auto border-line bg-raised p-1">
            {types
              .filter((t) => !selected.some((s) => s.id === t.id))
              .map((t) => (
                <Check key={t.id} checked={false} onClick={() => onChange((d) => ({ ...d, types: [...d.types, { id: t.id }] }))}>
                  <TypeChip type={t} size={18} />
                  {typeLabel(t)}
                </Check>
              ))}
          </PopoverContent>
        </Popover>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={!canExclude}
              title={canExclude ? undefined : BUILDER_TEXT.excludeTypesHint}
              className={BTN}
            >
              <Icon name="ph-prohibit" size={13} />
              {BUILDER_TEXT.excludeTypes}
              {excluded.length > 0 && <span className="text-fg-muted">{excluded.length}</span>}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="max-h-72 w-56 overflow-auto border-line bg-raised p-1">
            {types.map((t) => {
              const on = excluded.includes(t.id)
              return (
                <Check key={t.id} checked={on} onClick={() => setExcluded(on ? excluded.filter((i) => i !== t.id) : [...excluded, t.id])}>
                  {typeLabel(t)}
                </Check>
              )
            })}
          </PopoverContent>
        </Popover>
        {excluded.length > 0 && (
          <button type="button" onClick={() => setExcluded([])} className="text-[13px] text-fg-muted hover:text-fg">
            {BUILDER_TEXT.clear}
          </button>
        )}
        {!canExclude && <span className="text-[12px] text-fg-muted">{BUILDER_TEXT.excludeTypesHint}</span>}
        {canExclude && inactive && <span className="text-[12px] text-fg-muted">{BUILDER_TEXT.excludeTypesInactive}</span>}
      </div>
    </Section>
  )
}

// ---- Tags or backlinks ----

const TAG_DEF = {
  id: 'tags',
  key: 'tags',
  name: 'Tags',
  type: 'entity_tags',
  description: '',
  icon: null,
  visibility: 'alwaysShow',
  options: { allowedTypes: ['tag'], isArray: true },
} as unknown as PropertyDef

function TagPicker({ ids, onChange, label, disabled, title }: { ids: string[]; onChange(ids: string[]): void; label: string; disabled?: boolean; title?: string }) {
  const objects = useLinkIndex((s) => s.objects)
  const picked: EntityRef[] = ids.flatMap((id) => {
    const o = objects.find((x) => x.id === id)
    return o ? [{ target: o.title, path: o.path }] : []
  })
  const apply = async (refs: EntityRef[]) => {
    const out: string[] = []
    for (const r of refs) {
      if (!r.path) continue
      let id = objects.find((x) => x.path === r.path)?.id ?? null
      if (!id) {
        try {
          id = (await api.ensureId(r.path)).id
        } catch {
          id = null
        }
      }
      if (id) out.push(id)
    }
    onChange(out)
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" disabled={disabled} title={title} className={BTN}>
          <Icon name="ph-plus" size={13} />
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto border-line bg-raised p-0">
        <RelationPicker def={TAG_DEF} value={picked} onChange={(refs) => void apply(refs)} />
      </PopoverContent>
    </Popover>
  )
}

function TagChips({ ids, onChange }: { ids: string[]; onChange(ids: string[]): void }) {
  const objects = useLinkIndex((s) => s.objects)
  return (
    <>
      {ids.map((id) => {
        const title = objects.find((o) => o.id === id)?.title
        return (
          <Chip key={id} label={title ?? id} onRemove={() => onChange(ids.filter((i) => i !== id))}>
            <Icon name="ph-tag" size={13} />
            {title ?? 'Invalid'}
          </Chip>
        )
      })}
    </>
  )
}

function TagsSection({ def, onChange }: { def: QueryDefinition; onChange(e: Edit): void }) {
  const tags = def.tags ?? { ids: [], operator: 'or' as const }
  const excluded = def.excludeTags?.ids ?? []
  const canExclude = isSearching(def) || tags.ids.length > 0
  const setTags = (ids: string[]) => onChange((d) => ({ ...d, tags: ids.length > 0 ? { ids, operator: d.tags?.operator ?? 'or' } : undefined }))
  const setExcluded = (ids: string[]) => onChange((d) => ({ ...d, excludeTags: ids.length > 0 ? { ids } : undefined }))
  return (
    <Section title={BUILDER_TEXT.tags}>
      <div className="flex flex-wrap items-center gap-1.5">
        <TagChips ids={tags.ids} onChange={setTags} />
        <TagPicker ids={tags.ids} onChange={setTags} label={BUILDER_TEXT.addTag} />
        {tags.ids.length > 1 && (
          <div role="radiogroup" aria-label="Match" className="flex items-center rounded-md border border-line">
            {(['or', 'and'] as const).map((op) => (
              <button
                key={op}
                type="button"
                role="radio"
                aria-checked={tags.operator === op}
                onClick={() => onChange((d) => ({ ...d, tags: { ids: d.tags?.ids ?? [], operator: op } }))}
                className={cn('h-7 px-2 text-[13px] hover:bg-hover', tags.operator === op && 'bg-hover font-medium')}
              >
                {op === 'or' ? BUILDER_TEXT.anyOf : BUILDER_TEXT.allOf}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <TagChips ids={excluded} onChange={setExcluded} />
        <TagPicker
          ids={excluded}
          onChange={setExcluded}
          label={BUILDER_TEXT.excludeTags}
          disabled={!canExclude}
          title={canExclude ? undefined : BUILDER_TEXT.excludeTagsDisabled}
        />
        {!canExclude && <span className="text-[12px] text-fg-muted">{BUILDER_TEXT.excludeTagsDisabled}</span>}
      </div>
    </Section>
  )
}

// ---- Search ----

function SearchSection({ def, onChange }: { def: QueryDefinition; onChange(e: Edit): void }) {
  const terms = def.search?.searchTerms ?? []
  // Exact and Semantic are hidden (Q-1) and match like Auto: show them as Auto.
  const mode: SearchMode = def.search?.searchMode === 'title' ? 'title' : 'auto'
  const [draft, setDraft] = useState('')
  const short = draft.trim().length > 0 && draft.trim().length < MIN_TERM
  const setSearch = (searchTerms: { text: string }[], searchMode: SearchMode = mode) =>
    onChange((d) => ({ ...d, search: searchTerms.length > 0 ? { searchTerms, searchMode } : undefined }))
  const add = () => {
    const text = draft.trim()
    if (text.length < MIN_TERM || terms.length >= MAX_TERMS || terms.some((t) => t.text.toLowerCase() === text.toLowerCase())) return
    setSearch([...terms, { text }])
    setDraft('')
  }
  return (
    <Section title={BUILDER_TEXT.search}>
      <div className="flex flex-wrap items-center gap-1.5">
        {terms.map((t, i) => (
          <Chip key={`${t.text}-${i}`} label={t.text} onRemove={() => setSearch(terms.filter((_, n) => n !== i))}>
            {t.text}
          </Chip>
        ))}
        {terms.length < MAX_TERMS && (
          <input
            aria-label={BUILDER_TEXT.search}
            placeholder={BUILDER_TEXT.searchPlaceholder}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                add()
              }
            }}
            className="h-7 w-44 rounded-md border border-line bg-transparent px-2 text-[13px] outline-none focus:border-fg-muted"
          />
        )}
      </div>
      <p className="text-[12px] text-fg-muted">
        {short ? BUILDER_TEXT.termCount : draft.trim() ? BUILDER_TEXT.searchHint : terms.length > 0 && terms.length < MAX_TERMS ? BUILDER_TEXT.addTerm : ''}
      </p>
      {searchTermsOf(def).length > 0 && (
        <>
          <div role="radiogroup" aria-label={BUILDER_TEXT.mode} className="flex flex-wrap gap-1.5">
            {SEARCH_MODES.map((m) => (
              <button
                key={m.key}
                type="button"
                role="radio"
                aria-checked={mode === m.key}
                title={m.tooltip}
                onClick={() => setSearch(terms, m.key)}
                className={cn(BTN, mode === m.key && 'bg-hover font-medium')}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="text-[12px] text-fg-muted">{SEARCH_MODES.find((m) => m.key === mode)?.tooltip}</p>
          <p className="text-[12px] text-fg-muted">{BUILDER_TEXT.paused}</p>
        </>
      )}
    </Section>
  )
}

// ---- Limit ----

export function limitLabel(limit: QueryDefinition['limit']): string {
  if (!limit) return BUILDER_TEXT.noLimit
  return `${limit.random ? 'random' : 'first'} ${limit.size}`
}

function LimitSection({ def, onChange }: { def: QueryDefinition; onChange(e: Edit): void }) {
  const [open, setOpen] = useState(false)
  const set = (limit: QueryDefinition['limit']) => {
    setOpen(false)
    onChange((d) => ({ ...d, limit }))
  }
  const same = (size: number, random: boolean) => def.limit?.size === size && !!def.limit.random === random
  return (
    <Section title={BUILDER_TEXT.limit}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" aria-label={BUILDER_TEXT.limit} className={cn(BTN, 'w-fit')}>
            <Icon name={def.limit ? (def.limit.random ? 'ph-shuffle' : 'ph-list-bullets') : 'ph-infinity'} size={13} />
            {limitLabel(def.limit)}
            <Icon name="ph-caret-down" size={11} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-48 border-line bg-raised p-1">
          <Check checked={!def.limit} onClick={() => set(undefined)}>
            {BUILDER_TEXT.noLimit}
          </Check>
          {LIMIT_SIZES.map((n) => (
            <Check key={`first-${n}`} checked={same(n, false)} onClick={() => set({ size: n })}>
              <Icon name="ph-list-bullets" size={14} />
              {`first ${n}`}
            </Check>
          ))}
          {LIMIT_SIZES.map((n) => (
            <Check key={`random-${n}`} checked={same(n, true)} onClick={() => set({ size: n, random: true })}>
              <Icon name="ph-shuffle" size={14} />
              {`random ${n}`}
            </Check>
          ))}
        </PopoverContent>
      </Popover>
    </Section>
  )
}

export interface QueryBuilderProps {
  query: Query
  types: TypeDef[]
  collections: Collection[]
  onChange(edit: Edit): void
  /** Shown as a single-type tab on that type's dashboard: the type is locked (see `isSingleTypeQuery`). */
  constraint?: QueryConstraint
}

export function QueryBuilder({ query, types, collections, onChange, constraint }: QueryBuilderProps) {
  const def = query.definition
  const sorted = useMemo(() => [...types].sort((a, b) => a.name.localeCompare(b.name)), [types])
  return (
    <div data-testid="query-builder" className="flex flex-col gap-4 rounded-xl border border-line bg-raised/40 p-3">
      {constraint && isSingleTypeQuery(def, constraint.type.id) ? (
        <ConstrainedTypes def={def} constraint={constraint} collections={collections} onChange={onChange} />
      ) : (
        <TypesSection def={def} types={sorted} collections={collections} onChange={onChange} />
      )}
      <TagsSection def={def} onChange={onChange} />
      <SearchSection def={def} onChange={onChange} />
      <LimitSection def={def} onChange={onChange} />
    </div>
  )
}
