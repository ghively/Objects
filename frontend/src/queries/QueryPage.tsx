// A query: header (icon, title, menu), "Edit query" with the builder, and its results in a data
// view. Filter, sort and group live in `definition`; `view` holds the layout, table and card
// settings and the details toggle.
import { useCallback, useMemo, useState } from 'react'
import type { Query, QueryDefinition, TypeDef, ViewState } from '@/api/types'
import { Icon, IconOrEmoji } from '@/components/Icon'
import { IconPicker } from '@/components/IconPicker'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useLinkIndex } from '@/links/linkIndex'
import { useTabs } from '@/nav/tabs'
import { PinMenuItems } from '@/shell/PinToMenu'
import { useDefinitions } from '@/types/useDefinitions'
import { api } from '@/api/client'
import { DataView, type Pipeline } from '@/views/DataView'
import { FULL_VIEW_LAYOUTS } from '@/views/model'
import { useRows } from '@/views/useRows'
import { autoTitle, queryTitle, titleIsCustom, type TitleCtx } from './autoTitle'
import { QueryBuilder } from './QueryBuilder'
import { PAUSED_HINT, isQueryReady, isSearching, queryScope, runQuery } from './runQuery'
import { collectionHasQuery, editQuery, removeQuery, setQueryOnCollection, setQueryOnType, viewsHaveQuery } from './useQueries'
import { QUERY_ICON } from '@/lib/defIcons'

export const QUERY_TEXT = {
  edit: 'Edit query',
  closeEditor: 'Close editor',
  pinToSidebar: 'Pin to Sidebar',
  pinToType: 'Pin to object type',
  unpinFromType: 'Unpin from object type',
  pinToDashboard: 'Pin to dashboard',
  unpinFromDashboard: 'Unpin from dashboard',
  delete: 'Delete',
  notReadyTitle: 'Query isn’t ready',
  notReadyBody: 'The draft is kept, but it lists nothing until it has a search term, a tag or an object type.',
  empty: 'No content found',
  unknown: 'Unknown query',
}

/**
 * M22: the note on the built-in Tickets view (`builtIn: 'tickets'`, our string). Its structures are
 * every work type, set by the server at each read, so it has no type picker (no query builder) and
 * no Delete (the server refuses it: "The Tickets view is built in.").
 */
export const TICKETS_NOTE = 'Lists every work item with a Ticket ID.'

/** The tag titles and types a title is built from. */
export function useTitleCtx(types: TypeDef[]): TitleCtx {
  const objects = useLinkIndex((s) => s.objects)
  return useMemo(() => {
    const tagIdsToTitles: Record<string, string> = {}
    for (const o of objects) if (o.id) tagIdsToTitles[o.id] = o.title
    return { types, tagIdsToTitles }
  }, [types, objects])
}

/**
 * Change a query's definition; while its title is automatic it follows. The query page and a
 * query tab on a type's dashboard (M9) edit through this.
 */
export function editQueryDefinition(id: string, edit: (d: QueryDefinition) => QueryDefinition, titleCtx: TitleCtx): void {
  editQuery(id, (x) => {
    const next = edit(x.definition)
    return { ...x, definition: next, ...(titleIsCustom(x) ? {} : { name: autoTitle(next, titleCtx) }) }
  })
}

export function QueryPage({ id }: { id: string }) {
  const defs = useDefinitions()
  const allTypes = useLinkIndex((s) => s.types)
  const q = defs.queries.find((x) => x.id === id)
  const titleCtx = useTitleCtx(allTypes)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)
  const [iconOpen, setIconOpen] = useState(false)
  const [typePins, setTypePins] = useState<Record<string, boolean>>({})
  const [notice, setNotice] = useState<string | null>(null)

  const def = q?.definition
  const allTypeIds = useMemo(() => allTypes.map((t) => t.id), [allTypes])
  const ready = def ? isQueryReady(def) : false
  const scope = useMemo(() => (def && ready ? queryScope(def, allTypeIds) : { typeIds: [] as string[] }), [def, ready, allTypeIds])
  const { rows, loading, patchRow } = useRows(scope)

  const pipeline = useCallback<Pipeline>(
    (rs, state, ctx) =>
      runQuery(
        { ...(def as QueryDefinition), filterGroup: state.filterGroup, sorts: state.sorts, groupBy: state.groupBy },
        rs,
        ctx,
        Math.random,
        state.viewDefinition.groupByConfig,
      ),
    [def],
  )

  const state = useMemo<ViewState | null>(
    () =>
      q
        ? {
            viewDefinition: q.view.viewDefinition,
            showDataViewDetails: q.view.showDataViewDetails,
            filterGroup: q.definition.filterGroup,
            sorts: q.definition.sorts,
            groupBy: q.definition.groupBy,
          }
        : null,
    [q],
  )

  if (!q || !def || !state) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        {defs.loaded ? (
          <div>
            <p className="font-semibold">{QUERY_TEXT.unknown}</p>
            <p className="mt-1 text-fg-muted">{id}</p>
          </div>
        ) : (
          <p className="text-[14px] text-fg-muted">Loading results…</p>
        )}
      </div>
    )
  }

  const readOnly = !!q.readOnlyReason
  const tickets = q.builtIn === 'tickets'
  const title = queryTitle(q, titleCtx)
  const structures = def.structures.map((s) => allTypes.find((t) => t.id === s.id)).filter((t): t is TypeDef => !!t)
  const pausedNow = isSearching(def)
  const multiType = def.structures.length !== 1
  const layouts = multiType ? FULL_VIEW_LAYOUTS.filter((l) => l !== 'table') : FULL_VIEW_LAYOUTS
  const shownState =
    multiType && state.viewDefinition.dataViewLayout === 'table'
      ? { ...state, viewDefinition: { ...state.viewDefinition, dataViewLayout: 'list' as const } }
      : state

  const editDefinition = (edit: (d: QueryDefinition) => QueryDefinition) => editQueryDefinition(q.id, edit, titleCtx)

  const commitTitle = () => {
    const next = (draft ?? '').trim()
    setDraft(null)
    if (next === title) return
    if (next === '') editQuery(q.id, (x) => ({ ...x, titleIsCustom: false, name: autoTitle(x.definition, titleCtx) }))
    else editQuery(q.id, (x) => ({ ...x, titleIsCustom: true, name: next }))
  }

  const onState = (s: ViewState) => {
    const viewChanged = s.viewDefinition !== state.viewDefinition || s.showDataViewDetails !== state.showDataViewDetails
    const defChanged = s.filterGroup !== state.filterGroup || s.sorts !== state.sorts || s.groupBy !== state.groupBy
    if (!viewChanged && !defChanged) return
    editQuery(q.id, (x) => ({
      ...x,
      ...(viewChanged ? { view: { ...x.view, viewDefinition: s.viewDefinition, showDataViewDetails: s.showDataViewDetails } } : {}),
      ...(defChanged ? { definition: { ...x.definition, filterGroup: s.filterGroup, sorts: s.sorts, groupBy: s.groupBy } } : {}),
    }))
  }

  const loadTypePins = (open: boolean) => {
    if (!open) return
    for (const t of structures) {
      void api
        .views(t.id)
        .then((v) => setTypePins((cur) => ({ ...cur, [t.id]: viewsHaveQuery(v.views, q.id) })))
        .catch(() => undefined)
    }
  }
  const toggleType = (t: TypeDef) => {
    const on = !typePins[t.id]
    setTypePins((cur) => ({ ...cur, [t.id]: on }))
    void setQueryOnType(t, q.id, on).catch((e: unknown) => {
      setTypePins((cur) => ({ ...cur, [t.id]: !on }))
      setNotice(e instanceof Error ? e.message : String(e))
    })
  }
  const dashboardCollections = defs.collections.filter((c) => def.structures.length === 0 || def.structures.some((s) => c.typeIds.includes(s.id)))

  const doDelete = () => {
    void removeQuery(q.id)
      .then(() => useTabs.getState().open({ kind: 'queries' }))
      .catch((e: unknown) => setNotice(e instanceof Error ? e.message : String(e)))
  }

  return (
    <div className="w-full" data-query={q.id}>
      <header className="flex flex-wrap items-center gap-2.5 px-4 pt-5 pb-3">
        <Popover open={iconOpen} onOpenChange={setIconOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Query icon"
              disabled={readOnly}
              className="flex size-8 items-center justify-center rounded-lg border border-line hover:bg-hover"
            >
              <IconOrEmoji icon={q.icon} fallback={QUERY_ICON} size={18} />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto border-line bg-raised p-2 text-fg">
            <IconPicker
              value={q.icon}
              onChange={(next) => {
                setIconOpen(false)
                editQuery(q.id, (x) => ({ ...x, icon: next }))
              }}
            />
          </PopoverContent>
        </Popover>
        <input
          id="query-name"
          aria-label="Query name"
          value={draft ?? title}
          readOnly={readOnly}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') {
              setDraft(null)
              e.currentTarget.blur()
            }
          }}
          className="dataview-heading min-w-0 flex-1 bg-transparent text-[20px] font-bold outline-none md:text-[22px]"
        />
        {!tickets && (
          <button
            type="button"
            aria-pressed={editing}
            disabled={readOnly}
            onClick={() => setEditing((v) => !v)}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-line bg-raised px-2.5 text-[14px] font-medium hover:bg-hover disabled:opacity-50"
          >
            <Icon name="ph-pencil-simple" size={14} />
            {editing ? QUERY_TEXT.closeEditor : QUERY_TEXT.edit}
          </button>
        )}
        <DropdownMenu onOpenChange={loadTypePins}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="More"
              className="flex size-8 items-center justify-center rounded-lg border border-line bg-raised hover:bg-hover"
            >
              <Icon name="ph-dots-three" size={16} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="border-line bg-raised">
            <PinMenuItems pin={{ kind: 'query', id: q.id }} />
            {structures.map((t) => (
              <DropdownMenuItem key={t.id} onSelect={() => toggleType(t)}>
                <Icon name={typePins[t.id] ? 'ph-push-pin-slash' : 'ph-push-pin'} size={14} />
                {(typePins[t.id] ? QUERY_TEXT.unpinFromType : QUERY_TEXT.pinToType) + (structures.length > 1 ? ` (${t.name})` : '')}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Icon name="ph-stack" size={14} />
                {QUERY_TEXT.pinToDashboard}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-[360px] overflow-auto border-line bg-raised">
                {dashboardCollections.length === 0 && <div className="px-2 py-1.5 text-[13px] text-fg-muted">No collections</div>}
                {dashboardCollections.map((c) => (
                  <DropdownMenuCheckboxItem
                    key={c.id}
                    checked={collectionHasQuery(c, q.id)}
                    onCheckedChange={(on) =>
                      void setQueryOnCollection(c.id, q.id, on).catch((e: unknown) => setNotice(e instanceof Error ? e.message : String(e)))
                    }
                  >
                    {c.name}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {!tickets && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" disabled={readOnly} onSelect={doDelete}>
                  <Icon name="ph-trash" size={14} />
                  {QUERY_TEXT.delete}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      {tickets && <p className="px-4 pb-2 text-[13px] text-fg-muted">{TICKETS_NOTE}</p>}
      {readOnly && (
        <p role="status" className="px-4 pb-2 text-[13px] text-fg-muted">
          {`This query's file couldn't be read, so it opens read-only. Fix the file to edit it.`}
        </p>
      )}
      {notice && (
        <div role="status" className="mx-4 mb-2 flex items-start gap-2 rounded-md bg-raised px-3 py-1.5 text-[13px]">
          <span className="min-w-0 flex-1">{notice}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)} className="text-fg-muted hover:text-fg">
            <Icon name="ph-x" size={12} />
          </button>
        </div>
      )}
      <div className="mx-auto flex w-full flex-col gap-4 px-6 pt-2 pb-16">
        {editing && !tickets && <QueryBuilder query={q as Query} types={allTypes} collections={defs.collections} onChange={editDefinition} />}
        {!ready ? (
          <div className="flex flex-col items-center gap-1 py-10 text-center">
            <p className="text-[15px] text-fg">{QUERY_TEXT.notReadyTitle}</p>
            <p className="max-w-md text-[14px] text-fg-muted">{QUERY_TEXT.notReadyBody}</p>
          </div>
        ) : (
          <DataView
            rows={rows}
            types={allTypes.length > 0 ? allTypes : structures}
            collections={defs.collections}
            scope={scope}
            loading={loading}
            state={shownState}
            onState={onState}
            layouts={layouts}
            viewName={title}
            pipeline={pipeline}
            pausedHint={pausedNow ? PAUSED_HINT : undefined}
            emptyState={
              <div className="flex flex-col items-center gap-1 py-10 text-center">
                <p className="text-[15px] text-fg">{QUERY_TEXT.empty}</p>
              </div>
            }
            patchRow={patchRow}
            rowActions
          />
        )}
      </div>
    </div>
  )
}
