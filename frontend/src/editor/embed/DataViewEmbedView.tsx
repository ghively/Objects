/**
 * The `dataViewEmbed` node view (M8): an embedded collection or query drawn as
 * its live data view, with the collection's or query's own saved view (a
 * collection's "All" view; a query's `view` plus its filters, sorts and
 * grouping), kept fresh by `useRows` and the definitions store.
 *
 * The heading names it with its icon and title; clicking it opens the
 * collection or query (Ctrl/Cmd: in a new tab). "Show details" / "Hide
 * details" (the data view's own customize row, and the block's `…` menu) is the
 * block's `details` option, `<!-- block: details -->` (`showDataViewDetails`).
 *
 * M9: the embed keeps its own view. Until the
 * first view change it shows the source's view and writes nothing; that change
 * copies the view, with the change, into the block's `localDataViewInfo` option
 * (one line of JSON: layout, filters, sorts and group), which the embed uses from
 * then on. Changes are saved after EMBED_VIEW_SAVE_MS (our choice); the collection
 * or query itself is never changed.
 *
 * An unknown id shows "Collection not found." / "Query not found." (our strings).
 */
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import type { Collection, Layout, Query, QueryDefinition, TypeDef, ViewState } from '@/api/types'
import { IconOrEmoji } from '@/components/Icon'
import { COLLECTION_ICON, QUERY_ICON } from '@/lib/defIcons'
import { useLinkIndex } from '@/links/linkIndex'
import { useTabs } from '@/nav/tabs'
import { queryTitle } from '@/queries/autoTitle'
import { QUERY_TEXT, useTitleCtx } from '@/queries/QueryPage'
import { isQueryReady, queryScope, runQuery } from '@/queries/runQuery'
import { useDefinitions } from '@/types/useDefinitions'
import { DataView, ToolbarSlot, type Pipeline } from '@/views/DataView'
import { FULL_VIEW_LAYOUTS } from '@/views/model'
import { useRows } from '@/views/useRows'
import type { DataViewKind, Option } from '../annotations'
import { EmbedMenu } from '../media/ResizableEmbed'

/** Our strings. */
export const DATA_VIEW_EMBED_TEXT = {
  collectionNotFound: 'Collection not found.',
  queryNotFound: 'Query not found.',
  showDetails: 'Show details',
  hideDetails: 'Hide details',
  remove: 'Remove Block',
  loading: 'Loading…',
}

/** Whether the block's options turn "Show details" on. */
export function detailsShown(options: readonly Option[] | null | undefined): boolean {
  return (options ?? []).some((o) => o.key === 'details' && o.value === true)
}

/** Without exactly one type a table cannot show, so the view falls back to a list (as the full pages do). */
function fitLayout(state: ViewState, multiType: boolean): { state: ViewState; layouts: readonly Layout[] } {
  if (!multiType) return { state, layouts: FULL_VIEW_LAYOUTS }
  const layouts = FULL_VIEW_LAYOUTS.filter((l) => l !== 'table')
  const shown =
    state.viewDefinition.dataViewLayout === 'table'
      ? { ...state, viewDefinition: { ...state.viewDefinition, dataViewLayout: 'list' as const } }
      : state
  return { state: shown, layouts }
}

/** How long after a view change in the embed its `localDataViewInfo` is written (our choice). */
export const EMBED_VIEW_SAVE_MS = 300

/** The view parts `localDataViewInfo` holds (`LocalDataViewInfo`). */
type LocalViewInfo = Pick<ViewState, 'viewDefinition' | 'filterGroup' | 'sorts' | 'groupBy'>

/** The block's `localDataViewInfo` text, or null when it has none. */
export function localViewText(options: readonly Option[] | null | undefined): string | null {
  const value = (options ?? []).find((o) => o.key === 'localDataViewInfo')?.value
  return typeof value === 'string' ? value : null
}

/** The saved view, parsed; null when absent or unreadable (the embed then shows the source's view). */
export function parseLocalView(text: string | null): Partial<LocalViewInfo> | null {
  if (!text) return null
  try {
    const v: unknown = JSON.parse(text)
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Partial<LocalViewInfo>) : null
  } catch {
    return null
  }
}

/** The JSON written for `state`: its layout, filters, sorts and group, not "Show details". */
export function localViewJson(state: ViewState): string {
  const info: LocalViewInfo = {
    viewDefinition: state.viewDefinition,
    filterGroup: state.filterGroup,
    sorts: state.sorts,
    groupBy: state.groupBy,
  }
  return JSON.stringify(info)
}

/** `source` with the saved view's parts in place of its own. */
function withLocalView(source: ViewState, info: Partial<LocalViewInfo> | null): ViewState {
  if (!info) return source
  return {
    ...source,
    viewDefinition: info.viewDefinition ?? source.viewDefinition,
    filterGroup: info.filterGroup ?? source.filterGroup,
    sorts: info.sorts ?? source.sorts,
    groupBy: info.groupBy !== undefined ? info.groupBy : source.groupBy,
  }
}

interface EmbedBodyProps {
  details: boolean
  onDetails(on: boolean): void
  /** The block's `localDataViewInfo` text (null until the first view change). */
  savedView: string | null
  onSaveView(json: string): void
  heading: ReactNode
  /** The embedded collection's or query's name (the chart's export file name). */
  viewName: string
  types: TypeDef[]
  collections: Collection[]
}

/**
 * The embed's view: the saved `localDataViewInfo` over the source's view, else the source's
 * view; "Show details" comes from the block. A change to the view itself calls `onSaveView`.
 */
function useEmbedState(
  source: ViewState,
  savedView: string | null,
  details: boolean,
  onDetails: (on: boolean) => void,
  onSaveView: (json: string) => void,
) {
  const base = useMemo(() => withLocalView(source, parseLocalView(savedView)), [source, savedView])
  const [local, setLocal] = useState<ViewState>(base)
  const localRef = useRef(local)
  localRef.current = local
  useEffect(() => {
    // The source's view or the saved one changed (our own write lands here too, unchanged).
    setLocal(base)
  }, [base])
  const state = useMemo(() => ({ ...local, showDataViewDetails: details }), [local, details])
  const onState = useCallback(
    (next: ViewState) => {
      if (!!next.showDataViewDetails !== details) onDetails(!!next.showDataViewDetails)
      const json = localViewJson(next)
      if (json !== localViewJson(localRef.current)) onSaveView(json)
      setLocal(next)
    },
    [details, onDetails, onSaveView],
  )
  return { state, onState }
}

function CollectionEmbed({ collection: c, details, onDetails, savedView, onSaveView, heading, viewName, types, collections }: EmbedBodyProps & { collection: Collection }) {
  const scope = useMemo(() => ({ collectionIds: [c.id] }), [c.id])
  const { rows, loading, patchRow } = useRows(scope)
  const { state, onState } = useEmbedState(c.views.all, savedView, details, onDetails, onSaveView)
  const fit = fitLayout(state, c.typeIds.length !== 1)
  return (
    <DataView
      rows={rows}
      types={types}
      collections={collections}
      scope={{ typeIds: c.typeIds }}
      loading={loading}
      state={fit.state}
      onState={onState}
      layouts={fit.layouts}
      viewName={viewName}
      heading={heading}
      embedded
      patchRow={patchRow}
    />
  )
}

function QueryEmbed({ query: q, details, onDetails, savedView, onSaveView, heading, viewName, types, collections }: EmbedBodyProps & { query: Query }) {
  const def = q.definition
  const allTypeIds = useMemo(() => types.map((t) => t.id), [types])
  const ready = isQueryReady(def)
  const scope = useMemo(() => (ready ? queryScope(def, allTypeIds) : { typeIds: [] as string[] }), [def, ready, allTypeIds])
  const { rows, loading, patchRow } = useRows(scope)
  const base = useMemo<ViewState>(
    () => ({
      viewDefinition: q.view.viewDefinition,
      showDataViewDetails: q.view.showDataViewDetails,
      filterGroup: def.filterGroup,
      sorts: def.sorts,
      groupBy: def.groupBy,
    }),
    [q, def],
  )
  const { state, onState } = useEmbedState(base, savedView, details, onDetails, onSaveView)
  const pipeline = useCallback<Pipeline>(
    (rs, s, ctx) =>
      runQuery(
        { ...(def as QueryDefinition), filterGroup: s.filterGroup, sorts: s.sorts, groupBy: s.groupBy },
        rs,
        ctx,
        Math.random,
        s.viewDefinition.groupByConfig,
      ),
    [def],
  )
  const fit = fitLayout(state, def.structures.length !== 1)
  return (
    <DataView
      rows={ready ? rows : []}
      types={types}
      collections={collections}
      scope={scope}
      loading={ready && loading}
      state={fit.state}
      onState={onState}
      layouts={fit.layouts}
      viewName={viewName}
      heading={heading}
      embedded
      pipeline={pipeline}
      emptyState={<p className="py-4 text-center text-[14px] text-fg-muted">{QUERY_TEXT.empty}</p>}
      patchRow={patchRow}
    />
  )
}

export function DataViewEmbedView({ node, editor, getPos, selected }: NodeViewProps) {
  const kind = (node.attrs.kind === 'query' ? 'query' : 'collection') as DataViewKind
  const id = String(node.attrs.id ?? '')
  const options = node.attrs.blockOptions as Option[] | null
  const details = detailsShown(options)
  const editable = editor.isEditable
  const defs = useDefinitions()
  const types = useLinkIndex((s) => s.types)
  const titleCtx = useTitleCtx(types)

  const collection = kind === 'collection' ? defs.collections.find((c) => c.id === id) : undefined
  const query = kind === 'query' ? defs.queries.find((q) => q.id === id) : undefined

  const pos = () => (typeof getPos === 'function' ? getPos() : undefined)
  const onDetails = useCallback(
    (on: boolean) => {
      if (!editor.isEditable) return
      const at = typeof getPos === 'function' ? getPos() : undefined
      if (at != null) editor.commands.setBlockOption('details', on ? true : null, at)
    },
    [editor, getPos],
  )
  // A view change is written to the block after a short pause; leaving writes a pending one.
  const savedView = localViewText(options)
  const pending = useRef<{ json: string; timer: ReturnType<typeof setTimeout> } | null>(null)
  const writeView = useCallback(() => {
    const p = pending.current
    pending.current = null
    if (!p) return
    clearTimeout(p.timer)
    if (editor.isDestroyed || !editor.isEditable) return
    const at = typeof getPos === 'function' ? getPos() : undefined
    if (at == null) return
    const current = editor.state.doc.nodeAt(at)
    if (!current || current.type.name !== 'dataViewEmbed') return
    if (localViewText(current.attrs.blockOptions as Option[] | null) === p.json) return
    editor.commands.setBlockOption('localDataViewInfo', p.json, at)
  }, [editor, getPos])
  const onSaveView = useCallback(
    (json: string) => {
      if (!editor.isEditable) return // read-only: the change lasts while the note is open
      if (pending.current) clearTimeout(pending.current.timer)
      pending.current = { json, timer: setTimeout(writeView, EMBED_VIEW_SAVE_MS) }
    },
    [editor, writeView],
  )
  useEffect(() => () => writeView(), [writeView])

  const remove = () => {
    const at = pos()
    if (at == null) return
    const current = editor.state.doc.nodeAt(at)
    editor.chain().deleteRange({ from: at, to: at + (current?.nodeSize ?? node.nodeSize) }).run()
  }

  const open = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const newTab = e.ctrlKey || e.metaKey
    if (kind === 'query') useTabs.getState().open({ kind: 'query', id }, { newTab })
    else useTabs.getState().open({ kind: 'collection', id }, { newTab })
  }

  const title = collection ? collection.name : query ? queryTitle(query, titleCtx) || 'Query' : ''
  const icon = collection ? collection.icon : query ? query.icon : null
  const found = !!(collection || query)
  const menu = editable ? (
    <EmbedMenu
      items={[
        ...(found
          ? [{ label: details ? DATA_VIEW_EMBED_TEXT.hideDetails : DATA_VIEW_EMBED_TEXT.showDetails, onSelect: () => onDetails(!details) }]
          : []),
        { label: DATA_VIEW_EMBED_TEXT.remove, onSelect: remove },
      ]}
    />
  ) : null
  const heading = (
    <div className="flex min-w-0 items-center gap-1">
      <button
        type="button"
        onClick={open}
        data-testid="data-view-embed-title"
        className="flex min-w-0 items-center gap-2 rounded-md px-1 text-[16px] font-semibold hover:bg-hover"
      >
        <IconOrEmoji icon={icon} fallback={kind === 'query' ? QUERY_ICON : COLLECTION_ICON} size={18} />
        <span className="truncate">{title}</span>
      </button>
      {menu}
    </div>
  )

  let body: ReactNode
  const shared = { details, onDetails, savedView, onSaveView, heading, viewName: title, types, collections: defs.collections }
  if (collection) body = <CollectionEmbed key={collection.id} collection={collection} {...shared} />
  else if (query) body = <QueryEmbed key={query.id} query={query} {...shared} />
  else if (!defs.loaded) body = <p className="py-2 text-[14px] text-fg-muted" aria-busy="true">{DATA_VIEW_EMBED_TEXT.loading}</p>
  else
    body = (
      <div className="flex items-center gap-1 py-2">
        <p className="text-[14px] text-fg-muted" data-testid="data-view-embed-missing">
          {kind === 'query' ? DATA_VIEW_EMBED_TEXT.queryNotFound : DATA_VIEW_EMBED_TEXT.collectionNotFound}
        </p>
        {menu}
      </div>
    )

  return (
    <NodeViewWrapper
      className={`data-view-embed-block${selected ? ' is-selected' : ''}`}
      data-data-view=""
      data-kind={kind}
      data-view-id={id}
      data-testid="data-view-embed"
    >
      <div className="my-1" contentEditable={false}>
        {/* The view's toolbar stays in the embed, even on a page that hosts a toolbar slot. */}
        <ToolbarSlot.Provider value={null}>{body}</ToolbarSlot.Provider>
      </div>
    </NodeViewWrapper>
  )
}
