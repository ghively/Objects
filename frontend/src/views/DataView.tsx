// The data view: toolbar, filter -> sort -> group pipeline and a layout, reused by type pages,
// collections, queries and All notes. The caller owns the state (see `useViewState`).
import { createContext, useContext, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Collection, Layout, Row, RowsScope, TypeDef, ViewState } from '@/api/types'
import { Icon } from '@/components/Icon'
import { useLinkIndex } from '@/links/linkIndex'
import { usePeek, useTabs } from '@/nav/tabs'
import { cn } from '@/lib/utils'
import type { CustomizePage } from './CustomizeMenu'
import { applyFilters } from './filter'
import { groupRows, type Group, type GroupCtx } from './group'
import { CardCustomizePage } from './cards/CardCustomize'
import { EmbedLayout } from './layouts/EmbedLayout'
import { GalleryLayout } from './layouts/GalleryLayout'
import { GridLayout } from './layouts/GridLayout'
import { KanbanLayout } from './layouts/KanbanLayout'
import { ListLayout } from './layouts/ListLayout'
import { WallLayout } from './layouts/WallLayout'
import { TableLayout } from './table/TableLayout'
import { TableCustomizePage } from './table/TableCustomize'
import { LOAD_PAGE } from './model'
import { propertyChoices } from './properties'
import { applySorts } from './sort'
import { Toolbar } from './Toolbar'
import { ViewSummary } from './ViewSummary'
import { matchingValues } from './matching'

/**
 * Where a full-page view's toolbar goes: a type page puts it in its tab row, right-aligned, as
 * Object does. Null (the default): the toolbar sits in the view's own heading row.
 */
export const ToolbarSlot = createContext<HTMLElement | null>(null)

export interface PipelineResult {
  /** Every row that survives, in view order. */
  rows: Row[]
  groups: Group[]
  hidden?: Group[]
}

export type Pipeline = (rows: Row[], state: ViewState, ctx: GroupCtx) => PipelineResult

/** What a layout gets: the paged groups plus the helpers every layout needs. */
export interface LayoutProps {
  groups: Group[]
  /** True when `groups` come from a real grouping (headers shown). */
  grouped: boolean
  state: ViewState
  onState(next: ViewState): void
  types: TypeDef[]
  typesById: Record<string, TypeDef>
  collections: Collection[]
  ctx: GroupCtx
  /** The view spans more than one type. */
  multiType: boolean
  /** The view's types (for a table: exactly one). */
  viewTypes: TypeDef[]
  onOpen(row: Row, e: MouseEvent): void
  /** A collapsible group header; layouts that group call it per group. */
  header(group: Group, count: number): ReactNode
  closed(group: Group): boolean
  /** Every row that survives the view, in order. */
  flat: Row[]
  /** Replace one row after an inline edit. */
  patchRow?(path: string, row: Row): void
  /** A group's size before paging (for its header). */
  groupCount(group: Group): number
}

export interface DataViewProps {
  rows: Row[]
  types: TypeDef[]
  collections?: Collection[]
  scope?: RowsScope
  loading?: boolean
  state: ViewState
  onState(next: ViewState): void
  layouts: readonly Layout[]
  allowCreate?: boolean
  /** `typeId` is the view's type (the first one when it spans several). */
  onCreate?(values: Record<string, unknown>, typeId: string): void
  heading?: ReactNode
  /** Embedded in a page body (50rem wide) rather than a full page. */
  embedded?: boolean
  compact?: boolean
  pipeline?: Pipeline
  pausedHint?: string
  /** Replaces the "nothing here" block when the view has no rows (queries: "No content found"). */
  emptyState?: ReactNode
  customizePages?: CustomizePage[]
  /** Replace one row after an inline edit (from `useRows`). */
  patchRow?(path: string, row: Row): void
  /** Right-click menu of a row (list, card or table row): the items for that row, or none. */
  rowMenu?(row: Row): RowMenuItem[]
  /** Renders layouts other than the list (table, cards, kanban). */
  renderLayout?(layout: Layout, props: LayoutProps): ReactNode | null
}

export interface RowMenuItem {
  key: string
  label: string
  icon: string
  destructive?: boolean
  onSelect(): void
}

/** A small context menu at the pointer: closes on a click elsewhere, Escape or scroll. */
function RowContextMenu({ x, y, items, onClose }: { x: number; y: number; items: RowMenuItem[]; onClose(): void }) {
  useEffect(() => {
    const close = () => onClose()
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('keydown', key)
    }
  }, [onClose])
  return (
    <div
      role="menu"
      data-testid="row-menu"
      style={{ left: x, top: y }}
      className="fixed z-50 min-w-48 rounded-lg border border-line bg-raised p-1 text-[14px] shadow-lg"
    >
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          role="menuitem"
          onClick={() => {
            onClose()
            it.onSelect()
          }}
          className={cn('flex h-8 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-hover', it.destructive && 'text-red-400')}
        >
          <Icon name={it.icon} size={14} />
          {it.label}
        </button>
      ))}
    </div>
  )
}

const defaultPipeline: Pipeline = (rows, state, ctx) => {
  const sorted = applySorts(applyFilters(rows, state.filterGroup, ctx), state.sorts, ctx)
  const g = groupRows(sorted, state.groupBy, state.viewDefinition.groupByConfig, ctx)
  return { rows: sorted, groups: g.groups, hidden: g.hidden }
}

export function DataView(props: DataViewProps) {
  const { rows, types, state, onState, layouts } = props
  const collections = props.collections ?? []
  const objects = useLinkIndex((s) => s.objects)
  const [visible, setVisible] = useState(LOAD_PAGE)
  const [menu, setMenu] = useState<{ x: number; y: number; items: RowMenuItem[] } | null>(null)

  const typesById = useMemo(() => Object.fromEntries(types.map((t) => [t.id, t])), [types])

  // The types the view spans: the scope's, else those of its rows, else every type.
  const viewTypes = useMemo(() => {
    const ids = props.scope?.typeIds?.length ? props.scope.typeIds : [...new Set(rows.map((r) => r.summary.type))]
    const found = ids.map((id) => typesById[id]).filter((t): t is TypeDef => !!t)
    return found.length ? found : types
  }, [props.scope?.typeIds, rows, typesById, types])
  const choices = useMemo(() => propertyChoices(viewTypes), [viewTypes])
  const multiType = viewTypes.length > 1

  const ctx = useMemo<GroupCtx>(() => {
    const tagIdsToTitles: Record<string, string> = {}
    const pathsById: Record<string, string> = {}
    const entityTitles: Record<string, string> = {}
    const entityCreated: Record<string, string> = {}
    for (const o of objects) {
      if (o.id) {
        tagIdsToTitles[o.id] = o.title
        pathsById[o.id] = o.path
      }
      entityTitles[o.path] = o.title
      if (o.createdAt) entityCreated[o.path] = o.createdAt
    }
    return { types, collections, tagIdsToTitles, pathsById, entityTitles, entityCreated, now: new Date() }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `now` is fixed per data change
  }, [types, collections, objects, rows])

  const result = useMemo(() => (props.pipeline ?? defaultPipeline)(rows, state, ctx), [props.pipeline, rows, state, ctx])
  const flat = result.rows
  const grouped =
    result.groups.length > 0 && !(result.groups.length === 1 && result.groups[0].id === 'other' && result.groups[0].label === 'Objects')

  // Page across groups in order.
  const paged = useMemo(() => {
    let left = visible
    const out: Group[] = []
    for (const g of result.groups) {
      if (left <= 0) break
      const take = g.rows.slice(0, left)
      left -= take.length
      out.push(take.length === g.rows.length ? g : { ...g, rows: take })
    }
    return out
  }, [result.groups, visible])
  const total = result.groups.reduce((n, g) => n + g.rows.length, 0)

  const cfgGroups = state.viewDefinition.groupByConfig?.groups ?? []
  const closed = (g: Group) => !!cfgGroups.find((x) => x.id === g.id)?.isClosed
  const toggle = (g: Group) => {
    const have = cfgGroups.find((x) => x.id === g.id)
    const next = have
      ? cfgGroups.map((x) => (x.id === g.id ? { ...x, isClosed: !x.isClosed } : x))
      : [...cfgGroups, { id: g.id, isHidden: false, isClosed: true }]
    onState({ ...state, viewDefinition: { ...state.viewDefinition, groupByConfig: { ...state.viewDefinition.groupByConfig, groups: next } } })
  }

  const onOpen = (row: Row, e: MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      useTabs.getState().open({ kind: 'object', path: row.summary.path }, { newTab: true })
      return
    }
    usePeek.getState().peek(row.summary.path, flat.map((r) => r.summary.path))
  }

  const header = (g: Group, count: number) => (
    <button
      key={`h-${g.id}`}
      type="button"
      data-testid="group-header"
      aria-expanded={!closed(g)}
      onClick={() => toggle(g)}
      className="flex h-8 w-full items-center gap-1.5 rounded-md px-1 text-left text-[14px] font-medium text-fg hover:bg-hover"
    >
      <Icon name={closed(g) ? 'ph-caret-right' : 'ph-caret-down'} size={13} />
      <span className="truncate">{g.label}</span>
      <span className="text-fg-muted">{count}</span>
    </button>
  )

  const layout = state.viewDefinition.dataViewLayout
  const layoutProps: LayoutProps = {
    groups: paged,
    grouped,
    state,
    onState,
    types,
    typesById,
    collections,
    ctx,
    multiType,
    viewTypes,
    onOpen,
    header,
    closed,
    flat,
    patchRow: props.patchRow,
    groupCount: (g) => result.groups.find((x) => x.id === g.id)?.rows.length ?? g.rows.length,
  }
  const builtin = (): ReactNode => {
    switch (layout) {
      case 'table':
        return <TableLayout {...layoutProps} />
      case 'grid':
        return <GridLayout {...layoutProps} />
      case 'wall':
        return <WallLayout {...layoutProps} />
      case 'gallery':
        return <GalleryLayout {...layoutProps} />
      case 'embed':
        return <EmbedLayout {...layoutProps} />
      case 'kanban':
        return <KanbanLayout {...layoutProps} />
      default:
        return null
    }
  }
  const custom = props.renderLayout?.(layout, layoutProps) ?? builtin()
  const tableType = layout === 'table' && viewTypes.length === 1 ? viewTypes[0] : undefined
  const cardLayout = layout === 'grid' || layout === 'wall' || layout === 'gallery' || layout === 'kanban'
  const customizePages = [
    ...(tableType
      ? [{ key: 'table', label: 'Table', icon: 'ph-table', body: <TableCustomizePage type={tableType} state={state} onState={onState} /> }]
      : []),
    ...(cardLayout
      ? [{ key: 'card', label: 'Card view', icon: 'ph-cards', body: <CardCustomizePage types={viewTypes} state={state} onState={onState} /> }]
      : []),
    ...(props.customizePages ?? []),
  ]

  const empty = !props.loading && total === 0
  const createType = viewTypes[0]
  const createName = viewTypes.length === 1 ? viewTypes[0].name : 'object'

  const toolbarSlot = useContext(ToolbarSlot)
  const toolbar = (
    <Toolbar
      count={total}
      state={state}
      onState={(s) => {
        setVisible(LOAD_PAGE)
        onState(s)
      }}
      layouts={layouts}
      choices={choices}
      types={viewTypes}
      collections={collections}
      groups={result.groups}
      hidden={result.hidden ?? []}
      pausedHint={props.pausedHint}
      extraPages={customizePages}
      structureId={viewTypes.length === 1 ? viewTypes[0].id : undefined}
    />
  )

  return (
    <section
      data-testid="data-view"
      onContextMenu={
        props.rowMenu
          ? (e) => {
              const path = (e.target as Element).closest('[data-path]')?.getAttribute('data-path')
              const row = path ? flat.find((r) => r.summary.path === path) : undefined
              const items = row ? props.rowMenu?.(row) ?? [] : []
              if (items.length === 0) return
              e.preventDefault()
              setMenu({ x: e.clientX, y: e.clientY, items })
            }
          : undefined
      }
      className={cn('mx-auto flex w-full flex-col gap-2', props.embedded ? 'max-w-[50rem]' : 'max-w-5xl', props.compact && 'gap-1')}
    >
      {(props.heading || !toolbarSlot) && (
        <div data-toolbar-row="" className="flex items-center justify-between gap-2">
          {props.heading ? <div className="min-w-0 flex-1">{props.heading}</div> : <span className="flex-1" />}
          {!toolbarSlot && toolbar}
        </div>
      )}
      {toolbarSlot && createPortal(toolbar, toolbarSlot)}
      {(state.showDataViewDetails || props.pausedHint) && (
        <ViewSummary state={state} choices={choices} pausedHint={props.pausedHint} />
      )}
      {props.loading && rows.length === 0 ? (
        <p className="py-6 text-center text-[14px] text-fg-muted">Loading results…</p>
      ) : empty && props.emptyState ? (
        props.emptyState
      ) : empty ? (
        <div className="flex flex-col items-center gap-1 py-10 text-center">
          <p className="text-[15px] text-fg">There&apos;s nothing here (yet).</p>
          <p className="text-[14px] text-fg-muted">You can change this by creating a new object.</p>
          {props.allowCreate && props.onCreate && createType && (
            <button
              type="button"
              onClick={() => props.onCreate?.(matchingValues(state.filterGroup, types, createType.id, collections), createType.id)}
              className="mt-2 flex h-8 items-center gap-1.5 rounded-lg border border-line bg-raised px-3 text-[14px] hover:bg-hover"
            >
              <Icon name="ph-plus" size={14} />
              {`Create ${createName}`}
            </button>
          )}
        </div>
      ) : (
        <>
          {custom ?? (
            <div className="flex flex-col gap-1">
              {paged.map((g) => (
                <div key={g.id} className="flex flex-col">
                  {grouped && header(g, result.groups.find((x) => x.id === g.id)?.rows.length ?? g.rows.length)}
                  {!(grouped && closed(g)) && (
                    <ListLayout rows={g.rows} typesById={typesById} multiType={multiType} onOpen={onOpen} />
                  )}
                </div>
              ))}
            </div>
          )}
          {total > visible && (
            <button
              type="button"
              onClick={() => setVisible((v) => v + LOAD_PAGE)}
              className="mx-auto mt-1 rounded-lg px-3 py-1 text-[14px] text-fg-muted hover:bg-hover"
            >
              Load more
            </button>
          )}
        </>
      )}
      {menu && <RowContextMenu {...menu} onClose={() => setMenu(null)} />}
    </section>
  )
}
