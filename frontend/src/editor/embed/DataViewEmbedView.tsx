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
 * Other view changes made in the embed (layout, filters, sorts) last while the
 * note is open and are not saved to the collection or query (our choice).
 *
 * An unknown id shows "Collection not found." / "Query not found." (our strings).
 */
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { useCallback, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react'
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

interface EmbedBodyProps {
  details: boolean
  onDetails(on: boolean): void
  heading: ReactNode
  types: TypeDef[]
  collections: Collection[]
}

/** A view state kept locally from `base`, with "Show details" coming from the block. */
function useEmbedState(base: ViewState, baseKey: unknown, details: boolean, onDetails: (on: boolean) => void) {
  const [local, setLocal] = useState<ViewState>(base)
  useEffect(() => {
    setLocal(base)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when the saved view changes
  }, [baseKey])
  const state = useMemo(() => ({ ...local, showDataViewDetails: details }), [local, details])
  const onState = useCallback(
    (next: ViewState) => {
      if (!!next.showDataViewDetails !== details) onDetails(!!next.showDataViewDetails)
      setLocal(next)
    },
    [details, onDetails],
  )
  return { state, onState }
}

function CollectionEmbed({ collection: c, details, onDetails, heading, types, collections }: EmbedBodyProps & { collection: Collection }) {
  const scope = useMemo(() => ({ collectionIds: [c.id] }), [c.id])
  const { rows, loading, patchRow } = useRows(scope)
  const { state, onState } = useEmbedState(c.views.all, c.views.all, details, onDetails)
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
      heading={heading}
      embedded
      patchRow={patchRow}
    />
  )
}

function QueryEmbed({ query: q, details, onDetails, heading, types, collections }: EmbedBodyProps & { query: Query }) {
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
  const { state, onState } = useEmbedState(base, base, details, onDetails)
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
  const shared = { details, onDetails, heading, types, collections: defs.collections }
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
