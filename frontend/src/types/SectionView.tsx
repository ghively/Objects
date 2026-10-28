// One section's content: a DataView over the section's rows (recently opened, not in any
// collection, not tagged, no backlinks, a pinned query, a collection) or a grid of cards (collections, queries).
// Used for Overview sections and, full width, for the section header tabs. Filters, sorts and
// grouping are session-only; only the view definition (layout, table and card settings) is saved
// with the section, through `onViewDefinition`.
import { useMemo, useState, type ReactNode } from 'react'
import { api } from '@/api/client'
import type { Collection, DataViewDefinition, Layout, Query, Row, TypeDef, ViewState } from '@/api/types'
import { IconOrEmoji } from '@/components/Icon'
import { useLinkIndex } from '@/links/linkIndex'
import { useRecent } from '@/nav/recent'
import { useTabs } from '@/nav/tabs'
import { DataView, type Pipeline } from '@/views/DataView'
import { applyFilters } from '@/views/filter'
import { FULL_VIEW_LAYOUTS, defaultViewState, emptyFilterGroup } from '@/views/model'
import { useRows } from '@/views/useRows'
import { createAndOpen } from '@/create/createAndOpen'
import { SECTION_TEXT, keyId, noBacklinksRows, type RenderedSection } from './dashboardSections'
import { useDefinitions } from './useDefinitions'
import { COLLECTION_ICON, QUERY_ICON } from '@/lib/defIcons'
import { queryTitle } from '@/queries/autoTitle'
import { useTitleCtx } from '@/queries/QueryPage'

/** How many recent objects the "Recently Opened" strip shows. */
export const RECENT_SHOWN = 10

/** "Search title...": a case-insensitive substring match on the title and aliases. */
export function searchRows(rows: Row[], text: string): Row[] {
  const q = text.trim().toLowerCase()
  if (!q) return rows
  return rows.filter(
    (r) => r.summary.title.toLowerCase().includes(q) || (r.summary.aliases ?? []).some((a) => a.toLowerCase().includes(q)),
  )
}

/** Whether none of the row's `collections:` names resolves to a collection (by name or former name). */
export function inNoCollection(row: Row, collections: Collection[]): boolean {
  const names = (row.summary.collections ?? []).map((n) => n.toLowerCase())
  return !names.some((n) => collections.some((c) => c.name.toLowerCase() === n || c.formerNames.some((f) => f.toLowerCase() === n)))
}

type RowFilter = 'none' | 'noCollection' | 'notTagged' | 'noBacklinks'

function EmptyBlock({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1 py-8 text-center">
      <p className="text-[15px] text-fg">{title}</p>
      <p className="text-[14px] text-fg-muted">{body}</p>
      {action}
    </div>
  )
}

/** The pipeline of "Recently Opened": the view's filters, then most recent first (no sort fallback). */
function recentPipeline(order: string[]): Pipeline {
  return (rows, state, ctx) => {
    const kept = applyFilters(rows, state.filterGroup, ctx)
    const sorted = [...kept].sort((a, b) => order.indexOf(a.summary.path) - order.indexOf(b.summary.path))
    return { rows: sorted, groups: [{ id: 'other', label: 'Objects', rows: sorted }] }
  }
}

interface RowsSectionProps {
  type: TypeDef
  scope: Parameters<typeof useRows>[0]
  base: ViewState
  rowFilter?: RowFilter
  pipeline?: Pipeline
  layouts: readonly Layout[]
  heading?: ReactNode
  search: string
  /** Values a new object gets in this section (a collection tab: its name). */
  createValues?: Record<string, unknown>
  onViewDefinition(def: DataViewDefinition): void
}

function RowsSection(p: RowsSectionProps) {
  const indexTypes = useLinkIndex((s) => s.types)
  const { collections } = useDefinitions()
  const { rows, loading, patchRow } = useRows(p.scope)
  const [state, setState] = useState<ViewState>(p.base)

  const kept = useMemo(() => {
    if (p.rowFilter === 'noCollection') return rows.filter((r) => inNoCollection(r, collections))
    if (p.rowFilter === 'notTagged') return rows.filter((r) => (r.summary.tags ?? []).length === 0)
    if (p.rowFilter === 'noBacklinks') return noBacklinksRows(rows)
    return rows
  }, [rows, p.rowFilter, collections])
  const shown = useMemo(() => searchRows(kept, p.search), [kept, p.search])
  const types = indexTypes.length > 0 ? indexTypes : [p.type]

  return (
    <DataView
      rows={shown}
      types={types}
      collections={collections}
      scope={p.scope}
      loading={loading}
      state={state}
      onState={(s) => {
        setState(s)
        if (s.viewDefinition !== state.viewDefinition) p.onViewDefinition(s.viewDefinition)
      }}
      layouts={p.layouts}
      allowCreate
      onCreate={(values, typeId) =>
        void createAndOpen(typeId, { values: { ...p.createValues, ...values } }).catch((e: unknown) =>
          console.warn('Could not create an object:', e),
        )
      }
      heading={p.heading}
      pipeline={p.pipeline}
      patchRow={patchRow}
      rowActions
    />
  )
}

function CardGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-3">{children}</div>
}

function DefinitionCard({
  icon,
  fallback,
  name,
  description,
  onClick,
}: {
  icon: Collection['icon']
  fallback: string
  name: string
  description?: string
  onClick(): void
}) {
  return (
    <button
      type="button"
      data-testid="definition-card"
      onClick={onClick}
      className="flex min-w-0 flex-col gap-1 rounded-xl border border-line bg-raised p-3 text-left hover:bg-hover"
    >
      <span className="flex min-w-0 items-center gap-2 text-[15px] font-medium">
        <IconOrEmoji icon={icon} fallback={fallback} size={16} />
        <span className="truncate">{name}</span>
      </span>
      {description && <span className="line-clamp-2 text-[13px] text-fg-muted">{description}</span>}
    </button>
  )
}

/** "Create query": a query on this type, opened at once. */
export async function createQueryFor(type: TypeDef): Promise<void> {
  const q = await api.createQuery({
    definition: { structures: [{ id: type.id }], filterGroup: emptyFilterGroup(), sorts: [], groupBy: null },
    view: { viewDefinition: { dataViewLayout: 'list' } },
  })
  useTabs.getState().open({ kind: 'query', id: q.id })
}

export interface SectionViewProps {
  type: TypeDef
  section: RenderedSection
  search: string
  /** Rendered at the left of the toolbar row (the Overview's section header). */
  heading?: ReactNode
  /** "Create collection" (wired in Task 13); omitted while it is not available. */
  onCreateCollection?(): void
  onViewDefinition(def: DataViewDefinition): void
}

export function SectionView({ type, section, search, heading, onCreateCollection, onViewDefinition }: SectionViewProps) {
  const { collections, queries } = useDefinitions()
  const recent = useRecent((s) => s.paths)
  const objects = useLinkIndex((s) => s.objects)
  const titleCtx = useTitleCtx(useLinkIndex((s) => s.types))
  const open = (target: Parameters<ReturnType<typeof useTabs.getState>['open']>[0]) => useTabs.getState().open(target)

  const recentPaths = useMemo(() => {
    const typeOf = new Map(objects.map((o) => [o.path, o.type]))
    return recent.filter((p) => typeOf.get(p) === type.id).slice(0, RECENT_SHOWN)
  }, [recent, objects, type.id])
  const pipeline = useMemo(() => recentPipeline(recentPaths), [recentPaths])

  const typeScope = useMemo(() => ({ typeIds: [type.id] }), [type.id])
  const recentScope = useMemo(() => ({ paths: recentPaths }), [recentPaths])
  const baseDef = section.viewDefinition
  const stateWith = (def: DataViewDefinition, rest?: Partial<ViewState>): ViewState => ({
    ...defaultViewState(type),
    ...rest,
    viewDefinition: baseDef ?? def,
  })

  const head = heading ? <div className="min-w-0">{heading}</div> : undefined
  const queryOf = (): Query | undefined => queries.find((q) => q.id === keyId(section.key))
  const collectionOf = (): Collection | undefined => collections.find((c) => c.id === keyId(section.key))

  switch (section.key) {
    case 'recentlyAccessed':
      if (recentPaths.length === 0) {
        return (
          <div>
            {heading}
            <EmptyBlock title={SECTION_TEXT.recentlyEmptyTitle} body={SECTION_TEXT.recentlyEmptyBody} />
          </div>
        )
      }
      return (
        <RowsSection
          key={recentPaths.join('|')}
          type={type}
          scope={recentScope}
          base={stateWith({ dataViewLayout: 'gallery' })}
          layouts={['gallery']}
          pipeline={pipeline}
          heading={head}
          search={search}
          onViewDefinition={onViewDefinition}
        />
      )
    case 'collections': {
      const mine = collections.filter((c) => c.typeIds.includes(type.id))
      return (
        <div className="flex flex-col gap-2">
          {heading}
          {mine.length === 0 ? (
            <EmptyBlock
              title={SECTION_TEXT.collectionsEmptyTitle}
              body={SECTION_TEXT.collectionsEmptyBody}
              action={
                <button
                  type="button"
                  disabled={!onCreateCollection}
                  onClick={onCreateCollection}
                  className="mt-2 flex h-8 items-center rounded-lg border border-line bg-raised px-3 text-[14px] hover:bg-hover disabled:opacity-50"
                >
                  {SECTION_TEXT.createCollection}
                </button>
              }
            />
          ) : (
            <CardGrid>
              {mine.map((c) => (
                <DefinitionCard
                  key={c.id}
                  icon={c.icon}
                  fallback={COLLECTION_ICON}
                  name={c.name}
                  description={c.description}
                  onClick={() => open({ kind: 'collection', id: c.id })}
                />
              ))}
            </CardGrid>
          )}
        </div>
      )
    }
    case 'queries': {
      const mine = queries.filter((q) => q.definition.structures.some((s) => s.id === type.id))
      return (
        <div className="flex flex-col gap-2">
          {heading}
          {mine.length === 0 ? (
            <EmptyBlock
              title={SECTION_TEXT.queriesEmptyTitle}
              body={SECTION_TEXT.queriesEmptyBody}
              action={
                <button
                  type="button"
                  onClick={() => void createQueryFor(type).catch((e: unknown) => console.warn('Could not create a query:', e))}
                  className="mt-2 flex h-8 items-center rounded-lg border border-line bg-raised px-3 text-[14px] hover:bg-hover"
                >
                  {SECTION_TEXT.createQuery}
                </button>
              }
            />
          ) : (
            <CardGrid>
              {mine.map((q) => (
                <DefinitionCard
                  key={q.id}
                  icon={q.icon}
                  fallback={QUERY_ICON}
                  name={queryTitle(q, titleCtx) || 'Query'}
                  description={q.description}
                  onClick={() => open({ kind: 'query', id: q.id })}
                />
              ))}
            </CardGrid>
          )}
        </div>
      )
    }
    case 'inNoCollection':
    case 'notTagged':
    case 'noBacklinks':
      return (
        <RowsSection
          type={type}
          scope={typeScope}
          base={stateWith(section.key === 'noBacklinks' ? { dataViewLayout: 'list' } : defaultViewState(type).viewDefinition)}
          rowFilter={section.key === 'inNoCollection' ? 'noCollection' : section.key === 'notTagged' ? 'notTagged' : 'noBacklinks'}
          layouts={FULL_VIEW_LAYOUTS}
          heading={head}
          search={search}
          onViewDefinition={onViewDefinition}
        />
      )
    default: {
      if (section.key.startsWith('query:')) {
        const q = queryOf()
        if (!q) return <p className="py-4 text-[14px] text-fg-muted">{SECTION_TEXT.sectionEmpty}</p>
        const ids = q.definition.structures.map((s) => s.id)
        return (
          <RowsSection
            key={q.id}
            type={type}
            scope={{ typeIds: ids }}
            base={stateWith(q.view.viewDefinition, {
              filterGroup: q.definition.filterGroup,
              sorts: q.definition.sorts,
              groupBy: q.definition.groupBy,
            })}
            layouts={FULL_VIEW_LAYOUTS}
            heading={head}
            search={search}
            onViewDefinition={onViewDefinition}
          />
        )
      }
      if (section.key.startsWith('collection:')) {
        const c = collectionOf()
        if (!c) return <p className="py-4 text-[14px] text-fg-muted">{SECTION_TEXT.sectionEmpty}</p>
        return (
          <RowsSection
            key={c.id}
            type={type}
            scope={{ collectionIds: [c.id], typeIds: [type.id] }}
            base={{ ...c.views.all, viewDefinition: baseDef ?? c.views.all.viewDefinition }}
            layouts={FULL_VIEW_LAYOUTS}
            heading={head}
            search={search}
            createValues={{ collections: [c.name] }}
            onViewDefinition={onViewDefinition}
          />
        )
      }
      return null
    }
  }
}
