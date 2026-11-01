// The data view: toolbar, filter -> sort -> group pipeline and a layout, reused by type pages,
// collections, queries and All notes. The caller owns the state (see `useViewState`).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Collection, Layout, Row, RowsScope, TypeDef, UpdateResult, ViewState } from '@/api/types'
import { api } from '@/api/client'
import { Icon } from '@/components/Icon'
import { invalidateLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { usePeek, useTabs } from '@/nav/tabs'
import { cn } from '@/lib/utils'
import { useZonedToday } from '@/lib/zonedShell'
import { ChangeTypeDialog } from '@/object/ChangeTypeDialog'
import { DeleteObjectDialog } from '@/object/DeleteObjectDialog'
import { TypeChip } from '@/shell/Sidebar'
import type { CustomizePage } from './CustomizeMenu'
import { applyFilters } from './filter'
import { groupRows, type Group, type GroupCtx } from './group'
import { cardProperties } from './cards/cardConfig'
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
import { commonRowMenu, type RowMenuCtx, type RowMenuItem } from './rowMenu'
import { SelectionBar } from './SelectionBar'

export type { RowMenuItem } from './rowMenu'

/**
 * Where a full-page view's toolbar goes: a type page puts it in its tab row, right-aligned, as
 * Capacities does. Null (the default): the toolbar sits in the view's own heading row.
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
  /** Per-row slots: list rows and cards render them (M4: a task's checkbox, dates and priority). */
  rowExtras?(row: Row): RowExtras
  /** A layout wrote a row (the kanban drop) and reloaded it; `result` is the server's answer. */
  onWritten?(row: Row, result: UpdateResult): void
  /** M9: whether the row is selected ("Select multiple"); selected rows carry `data-selected`. */
  isSelected?(path: string): boolean
  /**
   * Fetch the previews of rows the layout shows (rows load without them). The view calls it for
   * its paged rows; a layout that pages on its own (the kanban) calls it with the rows on screen.
   */
  loadPreviews(rows: Row[]): void
}

/** What an owner adds to one row: `leading` before its title, `trailing` after it. */
export interface RowExtras {
  leading?: ReactNode
  trailing?: ReactNode
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
  /**
   * M9: the common row menu (`rowMenu.ts`: open, change type, copy reference, duplicate, delete)
   * on right-click, before `rowMenu`'s own items, and multi-select with its bulk actions ("Select
   * multiple", then click or Shift-click; Escape clears). Type pages, their sections, queries and collections.
   */
  rowActions?: boolean
  /** Renders layouts other than the list (table, cards, kanban). */
  renderLayout?(layout: Layout, props: LayoutProps): ReactNode | null
  /** Per-row slots for list rows and cards (see `LayoutProps.rowExtras`); without it rows render as in M3. */
  rowExtras?(row: Row): RowExtras
  /** Called after a layout's own write (the kanban drop) with the row and the update result. */
  onWritten?(row: Row, result: UpdateResult): void
}

/** A small context menu at the pointer: closes on a click elsewhere, Escape or scroll. */
function RowContextMenu({ x, y, items, onClose }: { x: number; y: number; items: RowMenuItem[]; onClose(): void }) {
  const [sub, setSub] = useState<string | null>(null)
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
      {items.map((it) =>
        it.children ? (
          <div key={it.key} className="relative" onMouseEnter={() => setSub(it.key)}>
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={sub === it.key}
              onClick={(e) => {
                e.stopPropagation()
                setSub(it.key)
              }}
              className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-hover"
            >
              <Icon name={it.icon} size={14} />
              <span className="flex-1">{it.label}</span>
              <Icon name="ph-caret-right" size={12} />
            </button>
            {sub === it.key && (
              <div
                role="menu"
                aria-label={it.label}
                className="absolute top-0 left-full z-50 max-h-[360px] min-w-44 overflow-auto rounded-lg border border-line bg-raised p-1 shadow-lg"
              >
                {it.children.map((c) => (
                  <RowMenuButton key={c.key} item={c} onClose={onClose} />
                ))}
              </div>
            )}
          </div>
        ) : (
          <RowMenuButton key={it.key} item={it} onClose={onClose} onHover={() => setSub(null)} />
        ),
      )}
    </div>
  )
}

function RowMenuButton({ item, onClose, onHover }: { item: RowMenuItem; onClose(): void; onHover?(): void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onMouseEnter={onHover}
      onClick={() => {
        onClose()
        item.onSelect()
      }}
      className={cn('flex h-8 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-hover', item.destructive && 'text-red-400')}
    >
      {item.chip ? <TypeChip type={item.chip} size={18} /> : <Icon name={item.icon} size={14} />}
      {item.label}
    </button>
  )
}

/** The tag type's id (tag values are the tag objects' titles). */
const TAG_TYPE = 'tag'

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
  // One change-type dialog per row, in turn (the bulk action runs the one-object dialog per row).
  const [changing, setChanging] = useState<{ rows: Row[]; to: TypeDef } | null>(null)
  const [deleting, setDeleting] = useState<Row | null>(null)
  // The selected paths while selecting ("Select multiple"); null when not selecting.
  const [selected, setSelected] = useState<string[] | null>(null)
  const anchor = useRef<string | null>(null)
  const selecting = selected !== null

  useEffect(() => {
    if (!selecting) return
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setSelected(null)
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [selecting])

  const typesById = useMemo(() => Object.fromEntries(types.map((t) => [t.id, t])), [types])
  // The selection as a set: layouts ask per row.
  const selectedSet = useMemo(() => (selected ? new Set(selected) : null), [selected])

  // The types the view spans: the scope's, else those of its rows, else every type.
  const viewTypes = useMemo(() => {
    const ids = props.scope?.typeIds?.length ? props.scope.typeIds : [...new Set(rows.map((r) => r.summary.type))]
    const found = ids.map((id) => typesById[id]).filter((t): t is TypeDef => !!t)
    return found.length ? found : types
  }, [props.scope?.typeIds, rows, typesById, types])
  const choices = useMemo(() => propertyChoices(viewTypes), [viewTypes])
  const multiType = viewTypes.length > 1

  // `now` matters by day (relative filters and groups): it refreshes when the zone's day changes.
  const today = useZonedToday()
  const ctx = useMemo<GroupCtx>(() => {
    const tagIdsToTitles: Record<string, string> = {}
    const pathsById: Record<string, string> = {}
    const entityTitles: Record<string, string> = {}
    const entityCreated: Record<string, string> = {}
    for (const o of objects) {
      if (o.id) {
        // Only tag objects: a page titled like a tag must not take over the tag's group id.
        if (o.type === TAG_TYPE) tagIdsToTitles[o.id] = o.title
        pathsById[o.id] = o.path
      }
      entityTitles[o.path] = o.title
      if (o.createdAt) entityCreated[o.path] = o.createdAt
    }
    const viewTypeIds = viewTypes.map((t) => t.id)
    return { types, viewTypeIds, collections, tagIdsToTitles, pathsById, entityTitles, entityCreated, now: new Date() }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `now` is fixed per day (`today`)
  }, [types, viewTypes, collections, objects, today])

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

  const select = (paths: string[] | null, last: string | null) => {
    anchor.current = last
    setSelected(paths && paths.length > 0 ? paths : null)
  }
  const open = (row: Row, e: MouseEvent) => {
    const path = row.summary.path
    if (selected) {
      // Shift: the range from the last clicked row, added; else toggle this row.
      // The on-screen order: grouped views show each open group's rows in turn.
      const order = grouped
        ? [...new Set(result.groups.flatMap((g) => (closed(g) ? [] : g.rows)).map((r) => r.summary.path))]
        : flat.map((r) => r.summary.path)
      const from = anchor.current ? order.indexOf(anchor.current) : -1
      const to = order.indexOf(path)
      if (e.shiftKey && from >= 0 && to >= 0) {
        const range = order.slice(Math.min(from, to), Math.max(from, to) + 1)
        select([...new Set([...selected, ...range])], path)
      } else {
        select(selected.includes(path) ? selected.filter((p) => p !== path) : [...selected, path], path)
      }
      return
    }
    // Shift-click starts selecting (our choice; Capacities enters it from "Select multiple").
    if (e.shiftKey && props.rowActions) {
      select([path], path)
      return
    }
    if (e.ctrlKey || e.metaKey) {
      useTabs.getState().open({ kind: 'object', path: row.summary.path }, { newTab: true })
      return
    }
    usePeek.getState().peek(row.summary.path, flat.map((r) => r.summary.path))
  }
  // A stable `onOpen` reading the latest state, so memoized rows don't re-render per view render.
  const openRef = useRef(open)
  openRef.current = open
  const onOpen = useCallback((row: Row, e: MouseEvent) => openRef.current(row, e), [])

  // P2: rows arrive without previews (`useRows`); a card layout fetches its visible page's in one
  // call and patches each row's `preview` in, once per row version. A row that changed meanwhile
  // (another version) is left alone: its new version is fetched on the next pass.
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const patchRowRef = useRef(props.patchRow)
  patchRowRef.current = props.patchRow
  const previewed = useRef(new Set<string>())
  const loadPreviews = useCallback((wanted: Row[]) => {
    if (!patchRowRef.current) return
    const paths: string[] = []
    for (const r of wanted) {
      if (r.preview) continue
      const key = `${r.summary.path}@${r.version}`
      if (previewed.current.has(key)) continue
      previewed.current.add(key)
      paths.push(r.summary.path)
    }
    if (paths.length === 0) return
    void api
      .rows({ paths, preview: true })
      .then((fresh) => {
        const current = new Map(rowsRef.current.map((r) => [r.summary.path, r]))
        for (const f of fresh) {
          const cur = current.get(f.summary.path)
          if (cur && cur.version === f.version && f.preview) patchRowRef.current?.(f.summary.path, { ...cur, preview: f.preview })
        }
      })
      .catch((err: unknown) => console.warn('Could not load previews:', err))
  }, [])

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
    rowExtras: props.rowExtras,
    onWritten: props.onWritten,
    isSelected: selectedSet ? (path) => selectedSet.has(path) : undefined,
    groupCount: (g) => result.groups.find((x) => x.id === g.id)?.rows.length ?? g.rows.length,
    loadPreviews,
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
  // Only a card layout whose cards include the preview needs previews; the list and table never do.
  const showsPreviews =
    cardLayout && viewTypes.some((t) => cardProperties(t, state.viewDefinition).some((p) => p.propertyId === 'computed_preview'))
  useEffect(() => {
    // The kanban pages per column and asks for its own rows.
    if (showsPreviews && layout !== 'kanban') loadPreviews(paged.flatMap((g) => g.rows))
  }, [showsPreviews, layout, paged, loadPreviews])
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

  const menuCtx: RowMenuCtx = {
    types,
    selectMultiple: (row) => select([row.summary.path], row.summary.path),
    changeType: (row, to) => setChanging({ rows: [row], to }),
    requestDelete: (row) => setDeleting(row),
  }
  const itemsFor = (row: Row): RowMenuItem[] => [
    ...(props.rowActions ? commonRowMenu(row, menuCtx) : []),
    ...(props.rowMenu?.(row) ?? []),
  ]
  const selectedRows = selectedSet ? flat.filter((r) => selectedSet.has(r.summary.path)) : []

  return (
    <section
      data-testid="data-view"
      onContextMenu={
        props.rowMenu || props.rowActions
          ? (e) => {
              const path = (e.target as Element).closest('[data-path]')?.getAttribute('data-path')
              const row = path ? flat.find((r) => r.summary.path === path) : undefined
              const items = row ? itemsFor(row) : []
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
      {selectedRows.length > 0 && (
        <SelectionBar
          rows={selectedRows}
          types={types}
          onChangeType={(to) => {
            const rs = selectedRows.filter((r) => !r.summary.readOnly && r.summary.template == null && r.summary.type !== to.id)
            if (rs.length > 0) setChanging({ rows: rs, to })
          }}
          onOpenInSidepanel={() => {
            for (const r of selectedRows) useTabs.getState().openInSidepanel({ kind: 'object', path: r.summary.path })
          }}
          onDelete={async () => {
            for (const r of selectedRows.filter((x) => !x.summary.readOnly)) {
              await api.deleteObject(r.summary.path, { baseVersion: r.version })
            }
            select(null, null)
          }}
          onClear={() => select(null, null)}
        />
      )}
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
                    <ListLayout
                      rows={g.rows}
                      typesById={typesById}
                      multiType={multiType}
                      onOpen={onOpen}
                      rowExtras={props.rowExtras}
                      isSelected={layoutProps.isSelected}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
          {total > visible && layout !== 'kanban' && (
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
      {changing && (
        <ChangeTypeDialog
          key={changing.rows[0].summary.path}
          open
          onOpenChange={(o) => !o && setChanging(null)}
          path={changing.rows[0].summary.path}
          toType={changing.to}
          prepare={async () => changing.rows[0].version}
          onChanged={() => {
            void invalidateLinkIndex()
            // The dialog closes itself first; the next row's dialog follows.
            const rest = changing.rows.slice(1)
            setChanging(rest.length > 0 ? { rows: rest, to: changing.to } : null)
            if (rest.length === 0 && changing.rows.length > 1) select(null, null)
          }}
        />
      )}
      <DeleteObjectDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        onConfirm={async () => {
          if (deleting) await api.deleteObject(deleting.summary.path, { baseVersion: deleting.version })
        }}
      />
    </section>
  )
}
