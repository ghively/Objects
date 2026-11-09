// A collection: header (icon, name, menu, New), the Overview / All / query tabs, and "Add existing".
// The collection's own definition (name, types, views, pins, templates) is saved through
// `saveCollectionEdit`; membership is the `collections:` key of each object.
import { useMemo, useState, type MouseEvent } from 'react'
import { api, ConflictError } from '@/api/client'
import type { Collection, DashboardSectionKey, Layout, ObjectSummary, Query, Row, TypeDef, ViewState, Views } from '@/api/types'
import { Icon, IconOrEmoji } from '@/components/Icon'
import { IconPicker } from '@/components/IconPicker'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { createAndOpen, type OpenMods } from '@/create/createAndOpen'
import { fuzzyMatch } from '@/links/LinkPicker'
import { invalidateLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { useTabs } from '@/nav/tabs'
import { PinMenuItems } from '@/shell/PinToMenu'
import { TypeChip } from '@/shell/Sidebar'
import { SECTION_TEXT, patchSection, removeSection, visibleSections, type RenderedSection } from '@/types/dashboardSections'
import { NewSplitButton, SectionTab, TabPill } from '@/types/TypePage'
import { CustomizeOverview } from '@/types/TypeOverview'
import { SectionView, searchRows } from '@/types/SectionView'
import { templateKey } from '@/types/TemplateManager'
import { useDefinitions, useDefs } from '@/types/useDefinitions'
import { DataView, type RowMenuItem } from '@/views/DataView'
import { matchingValues } from '@/views/matching'
import { FULL_VIEW_LAYOUTS, defaultViewState } from '@/views/model'
import { useRows } from '@/views/useRows'
import { templateName } from '@/object/UseTemplateMenu'
import {
  COLLECTION_DIALOG_TEXT,
  DeleteCollectionDialog,
  RemoveFromCollectionDialog,
  skippedMessage,
} from './CollectionDialogs'
import { editCollectionViews, flushCollectionViews, saveCollectionEdit } from './useCollections'
import { COLLECTION_ICON, QUERY_ICON } from '@/lib/defIcons'
import { queryTitle, type TitleCtx } from '@/queries/autoTitle'
import { useTitleCtx } from '@/queries/QueryPage'

export const COLLECTION_PAGE_TEXT = {
  empty: 'Nothing in this collection yet. Add a new object or an existing one.',
  addExisting: 'Add existing',
  createEntry: 'New object',
  pinned: 'Pinned',
  pinnedEmptyTitle: 'Nothing pinned',
  pinnedEmptyBody: "Use a row's menu to pin it to this collection.",
  pin: 'Pin to collection',
  unpin: 'Unpin',
  remove: 'Remove from collection',
}

function mods(e: MouseEvent): OpenMods {
  return { ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey }
}

/** Whether `name` names collection `c` (its name or a former name, case-insensitively). */
export function namesCollection(c: Pick<Collection, 'name' | 'formerNames'>, name: string): boolean {
  const n = name.trim().toLowerCase()
  return c.name.toLowerCase() === n || c.formerNames.some((f) => f.toLowerCase() === n)
}

/** A query section's label: the query's title as its own page shows it. */
function sectionQueryTitle(q: Pick<Query, 'name'> & Partial<Pick<Query, 'titleIsCustom' | 'definition'>>, ctx: TitleCtx): string {
  const title = q.definition ? queryTitle({ name: q.name, titleIsCustom: q.titleIsCustom ?? q.name.trim() !== '', definition: q.definition }, ctx) : q.name
  return title || 'Query'
}

/** The sections of a collection's Overview: `pinned`, then its query sections, then the removed ones. */
export function collectionSections(
  c: Collection,
  queries: (Pick<Query, 'id' | 'name' | 'icon'> & Partial<Pick<Query, 'titleIsCustom' | 'definition'>>)[],
  titleCtx: TitleCtx = { types: [], tagIdsToTitles: {} },
): RenderedSection[] {
  const removed = new Set(c.views.dashboard.removedSections)
  const out: RenderedSection[] = []
  const seen = new Set<string>()
  const push = (key: string, collapsed: boolean, hidden: boolean, extra: { viewDefinition?: RenderedSection['viewDefinition']; title?: string } = {}) => {
    if (seen.has(key)) return
    let base: Omit<RenderedSection, 'collapsed' | 'hidden' | 'label' | 'viewDefinition' | 'title'> | null = null
    if (key === 'pinned') {
      base = { key: 'pinned', defaultLabel: COLLECTION_PAGE_TEXT.pinned, icon: 'ph-push-pin', ownIcon: null, inFullView: false }
    } else if (key.startsWith('query:')) {
      const q = queries.find((x) => x.id === key.slice('query:'.length))
      if (q) {
        base = { key: key as DashboardSectionKey, defaultLabel: sectionQueryTitle(q, titleCtx), icon: QUERY_ICON, ownIcon: q.icon, inFullView: true, refId: q.id }
      }
    }
    if (!base) return
    seen.add(key)
    out.push({ ...base, label: extra.title?.trim() ? extra.title : base.defaultLabel, collapsed, hidden, ...extra })
  }
  for (const s of c.views.dashboard.sections) if (!removed.has(s.key)) push(s.key, s.collapsed, false, { viewDefinition: s.viewDefinition, title: s.title })
  if (!removed.has('pinned')) push('pinned', false, false)
  for (const key of c.views.dashboard.removedSections) push(key, false, true)
  return out
}

// ---------------------------------------------------------------------------------------------

/** The pinned items: a gallery strip of the collection's rows whose `id` is in `pinned.ids`. */
function PinnedSection({
  rows,
  loading,
  types,
  collection,
  section,
  search,
  rowMenu,
  patchRow,
  onViewDefinition,
}: {
  rows: Row[]
  loading: boolean
  types: TypeDef[]
  collection: Collection
  section: RenderedSection
  search: string
  rowMenu(row: Row): RowMenuItem[]
  patchRow(path: string, row: Row): void
  onViewDefinition(def: NonNullable<RenderedSection['viewDefinition']>): void
}) {
  const [state, setState] = useState<ViewState>({
    ...defaultViewState(types[0]),
    viewDefinition: section.viewDefinition ?? { dataViewLayout: 'gallery' },
  })
  const pinned = useMemo(() => {
    const ids = new Set(collection.pinned.ids)
    return searchRows(
      rows.filter((r) => !!r.summary.id && ids.has(r.summary.id)),
      search,
    )
  }, [rows, collection.pinned.ids, search])

  if (!loading && pinned.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1 py-8 text-center">
        <p className="text-[15px] text-fg">{COLLECTION_PAGE_TEXT.pinnedEmptyTitle}</p>
        <p className="text-[14px] text-fg-muted">{COLLECTION_PAGE_TEXT.pinnedEmptyBody}</p>
      </div>
    )
  }
  return (
    <DataView
      rows={pinned}
      types={types}
      collections={[collection]}
      scope={{ typeIds: collection.typeIds }}
      loading={loading}
      state={state}
      onState={(s) => {
        setState(s)
        if (s.viewDefinition !== state.viewDefinition) onViewDefinition(s.viewDefinition)
      }}
      layouts={['gallery']}
      rowMenu={rowMenu}
      rowActions
      patchRow={patchRow}
    />
  )
}

/** "Add existing": a fuzzy picker over the objects of the collection's types. */
function AddExistingDialog({
  collection,
  open,
  onOpenChange,
  onPicked,
}: {
  collection: Collection
  open: boolean
  onOpenChange(open: boolean): void
  onPicked(path: string): void
}) {
  const objects = useLinkIndex((s) => s.objects)
  const types = useLinkIndex((s) => s.types)
  const [query, setQuery] = useState('')
  const candidates = useMemo(
    () =>
      objects.filter(
        (o) =>
          collection.typeIds.includes(o.type) &&
          !o.template &&
          !(o.collections ?? []).some((n) => namesCollection(collection, n)),
      ),
    [objects, collection],
  )
  const shown: ObjectSummary[] = useMemo(
    () => (query.trim() ? fuzzyMatch(query, candidates, 20) : [...candidates].sort((a, b) => a.title.localeCompare(b.title)).slice(0, 20)),
    [candidates, query],
  )
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-line bg-raised-2 text-fg sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="text-[18px]">{COLLECTION_PAGE_TEXT.addExisting}</DialogTitle>
          <DialogDescription className="sr-only">Pick an object to add to {collection.name}.</DialogDescription>
        </DialogHeader>
        <input
          autoFocus
          aria-label="Search objects"
          placeholder="Search..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-9 rounded-md border border-line bg-transparent px-2 text-[15px] outline-none focus:border-fg-muted"
        />
        <div role="listbox" aria-label="Objects" className="max-h-72 overflow-y-auto">
          {shown.map((o) => {
            const t = types.find((x) => x.id === o.type)
            return (
              <div
                key={o.path}
                role="option"
                aria-selected={false}
                tabIndex={-1}
                onClick={() => onPicked(o.path)}
                onKeyDown={(e) => e.key === 'Enter' && onPicked(o.path)}
                className="flex h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-[14px] hover:bg-hover"
              >
                {t && <TypeChip type={t} size={20} />}
                <span className="min-w-0 flex-1 truncate">{o.title}</span>
              </div>
            )
          })}
          {shown.length === 0 && <p className="px-2 py-2 text-[13px] text-fg-muted">No objects to add.</p>}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** "Templates": every template of the collection's types, "Mark as Default" for this collection. */
function TemplatesMenu({ collection, types }: { collection: Collection; types: TypeDef[] }) {
  const [templates, setTemplates] = useState<ObjectSummary[] | null>(null)
  const load = (open: boolean) => {
    if (!open) return
    void Promise.all(types.map((t) => api.templates(t.id).catch(() => [] as ObjectSummary[])))
      .then((all) => setTemplates(all.flat()))
      .catch(() => setTemplates([]))
  }
  const def = collection.templates.defaultTemplateId
  const setDefault = (key: string | null) =>
    void saveCollectionEdit(collection.id, (c) => ({ ...c, templates: { ...c.templates, defaultTemplateId: key } })).catch((e: unknown) =>
      console.warn('Could not save the collection:', e),
    )
  return (
    <DropdownMenuSub onOpenChange={load}>
      <DropdownMenuSubTrigger>
        <Icon name="ph-file-dashed" size={14} />
        Templates
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="border-line bg-raised">
        {templates?.length === 0 && <div className="px-2 py-1.5 text-[13px] text-fg-muted">No templates yet</div>}
        {(templates ?? []).map((t) => {
          const key = templateKey(t)
          return (
            <DropdownMenuCheckboxItem key={key} checked={def === key} onCheckedChange={(on) => setDefault(on ? key : null)}>
              {templateName(t)}
              {def === key ? ' (Default)' : ''}
            </DropdownMenuCheckboxItem>
          )
        })}
        {templates === null && <div className="px-2 py-1.5 text-[13px] text-fg-muted">Loading…</div>}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

// ---------------------------------------------------------------------------------------------

export function CollectionPage({ id }: { id: string }) {
  const defs = useDefinitions()
  const allTypes = useLinkIndex((s) => s.types)
  const c = defs.collections.find((x) => x.id === id)
  const scope = useMemo(() => ({ collectionIds: [id] }), [id])
  const { rows, loading, reload, patchRow } = useRows(scope)
  const [search, setSearch] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const [iconOpen, setIconOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [removing, setRemoving] = useState<Row | null>(null)

  const types = useMemo(() => (c ? c.typeIds.map((t) => allTypes.find((x) => x.id === t)).filter((t): t is TypeDef => !!t) : []), [c, allTypes])
  const titleCtx = useTitleCtx(allTypes)
  const sections = useMemo(() => (c ? collectionSections(c, defs.queries, titleCtx) : []), [c, defs.queries, titleCtx])
  const tabs = sections.filter((s) => !s.hidden && s.inFullView)

  if (!c) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        {defs.loaded ? (
          <div>
            <p className="font-semibold">Unknown collection</p>
            <p className="mt-1 text-fg-muted">{id}</p>
          </div>
        ) : (
          <p className="text-[14px] text-fg-muted">Loading results…</p>
        )}
      </div>
    )
  }

  const readOnly = !!c.readOnlyReason
  const views = c.views
  const update = (edit: (v: Views) => Views) => editCollectionViews(c.id, edit)
  const saved = views.activeTab
  const tab = saved === 'overview' || saved === 'all' || tabs.some((t) => t.key === saved) ? saved : 'overview'
  const activeSection = tabs.find((t) => t.key === tab)
  const multiType = c.typeIds.length > 1
  const layouts: readonly Layout[] = multiType ? FULL_VIEW_LAYOUTS.filter((l) => l !== 'table') : FULL_VIEW_LAYOUTS
  const sectionCtx = { collections: defs.collections, queries: defs.queries }

  const select = (key: string) => {
    setSearch('')
    update((v) => ({ ...v, activeTab: key }))
  }

  const save = async (edit: (x: Collection) => Collection) => {
    try {
      const res = await saveCollectionEdit(c.id, edit)
      if (res.skipped.length > 0) setNotice(skippedMessage(res.skipped.length))
      return res
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e))
      return null
    }
  }

  const commitName = () => {
    const next = (draft ?? '').trim()
    setDraft(null)
    if (next && next !== c.name) void save((x) => ({ ...x, name: next }))
  }

  const createValues = (extra: Record<string, unknown> = {}): Record<string, unknown> => {
    const names = Array.isArray(extra.collections) ? (extra.collections as string[]) : []
    return { ...extra, collections: [c.name, ...names.filter((n) => !namesCollection(c, n))] }
  }

  const create = (typeId: string, m: OpenMods = {}, extra: Record<string, unknown> = {}) => {
    const dt = c.templates.defaultTemplateId
    void createAndOpen(typeId, { values: createValues(extra), ...(dt && !multiType ? { templateId: dt } : {}) }, m).catch((e: unknown) =>
      console.warn('Could not create an object:', e),
    )
  }

  // ---- membership ----
  const writeCollections = async (row: Row, next: string[]) => {
    try {
      await api.updateProperties(row.summary.path, { collections: next }, row.version)
    } catch (e) {
      if (e instanceof ConflictError) {
        // Never retried blindly: show what is on disk now.
        setNotice(`${row.summary.title} changed on disk. It was reloaded; try again.`)
        void reload()
      } else setNotice(e instanceof Error ? e.message : String(e))
    }
  }
  const removeRow = (row: Row) =>
    writeCollections(
      row,
      (row.summary.collections ?? []).filter((n) => !namesCollection(c, n)),
    )

  const addExisting = async (path: string) => {
    setAddOpen(false)
    try {
      const [fresh] = await api.rows({ paths: [path] })
      if (!fresh) return
      const names = fresh.summary.collections ?? []
      if (names.some((n) => namesCollection(c, n))) return
      await writeCollections(fresh, [...names, c.name])
      void invalidateLinkIndex()
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e))
    }
  }

  const pin = async (row: Row) => {
    try {
      const oid = row.summary.id ?? (await api.ensureId(row.summary.path)).id
      await save((x) => (x.pinned.ids.includes(oid) ? x : { ...x, pinned: { ...x.pinned, ids: [...x.pinned.ids, oid] } }))
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e))
    }
  }
  const unpin = (row: Row) => {
    const oid = row.summary.id
    if (oid) void save((x) => ({ ...x, pinned: { ...x.pinned, ids: x.pinned.ids.filter((i) => i !== oid) } }))
  }
  const isPinned = (row: Row) => !!row.summary.id && c.pinned.ids.includes(row.summary.id)

  const rowMenu = (row: Row): RowMenuItem[] => [
    isPinned(row)
      ? { key: 'unpin', label: COLLECTION_PAGE_TEXT.unpin, icon: 'ph-push-pin-slash', onSelect: () => unpin(row) }
      : { key: 'pin', label: COLLECTION_PAGE_TEXT.pin, icon: 'ph-push-pin', onSelect: () => void pin(row) },
    { key: 'remove', label: COLLECTION_PAGE_TEXT.remove, icon: 'ph-minus-circle', destructive: true, onSelect: () => setRemoving(row) },
  ]

  const toggleType = (t: TypeDef, on: boolean) =>
    void save((x) => ({ ...x, typeIds: on ? [...x.typeIds, t.id] : x.typeIds.filter((i) => i !== t.id) }))

  const newValues = matchingValues(views.all.filterGroup, allTypes, c.typeIds[0] ?? '', defs.collections)

  const all = (
    <>
      {!loading && rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <p className="text-[15px]">{COLLECTION_PAGE_TEXT.empty}</p>
          <div className="flex gap-2">
            {types[0] && (
              <button
                type="button"
                onClick={(e) => create(types[0].id, mods(e))}
                className="flex h-8 items-center gap-1.5 rounded-lg border border-line bg-raised px-3 text-[14px] hover:bg-hover"
              >
                <Icon name="ph-plus" size={14} />
                {COLLECTION_PAGE_TEXT.createEntry}
              </button>
            )}
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="flex h-8 items-center rounded-lg border border-line bg-raised px-3 text-[14px] hover:bg-hover"
            >
              {COLLECTION_PAGE_TEXT.addExisting}
            </button>
          </div>
        </div>
      ) : (
        <DataView
          rows={searchRows(rows, search)}
          types={allTypes.length > 0 ? allTypes : types}
          collections={defs.collections}
          scope={{ typeIds: c.typeIds }}
          loading={loading}
          state={multiType && views.all.viewDefinition.dataViewLayout === 'table' ? { ...views.all, viewDefinition: { ...views.all.viewDefinition, dataViewLayout: 'list' } } : views.all}
          onState={(s) => update((v) => ({ ...v, all: s }))}
          layouts={layouts}
          viewName={c.name}
          allowCreate
          onCreate={(values, typeId) => create(typeId, {}, values)}
          rowMenu={rowMenu}
          rowActions
          patchRow={patchRow}
        />
      )}
    </>
  )

  return (
    <div className="w-full" data-collection={c.id}>
      <header className="flex flex-wrap items-center gap-2.5 px-4 pt-5 pb-3">
        <Popover open={iconOpen} onOpenChange={setIconOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Collection icon"
              disabled={readOnly}
              className="flex size-8 items-center justify-center rounded-lg border border-line hover:bg-hover"
            >
              <IconOrEmoji icon={c.icon} fallback={COLLECTION_ICON} size={18} />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto border-line bg-raised p-2 text-fg">
            <IconPicker
              value={c.icon}
              onChange={(next) => {
                setIconOpen(false)
                void save((x) => ({ ...x, icon: next }))
              }}
            />
          </PopoverContent>
        </Popover>
        <input
          id="collection-name"
          aria-label="Collection name"
          value={draft ?? c.name}
          readOnly={readOnly}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') {
              setDraft(null)
              e.currentTarget.blur()
            }
          }}
          className="dataview-heading min-w-0 flex-1 bg-transparent text-[20px] font-bold outline-none md:text-[22px]"
        />
        <input
          type="search"
          aria-label="Search title..."
          placeholder="Search title..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 w-48 rounded-lg border border-line bg-transparent px-2.5 text-[14px] outline-none focus:border-fg-muted"
        />
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          disabled={readOnly || types.length === 0}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-line bg-raised px-2.5 text-[14px] font-medium hover:bg-hover disabled:opacity-50"
        >
          <Icon name="ph-link-simple" size={14} />
          {COLLECTION_PAGE_TEXT.addExisting}
        </button>
        <DropdownMenu>
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
            <DropdownMenuItem
              disabled={readOnly}
              onSelect={() => setTimeout(() => document.getElementById('collection-name')?.focus(), 0)}
            >
              <Icon name="ph-pencil-simple" size={14} />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem disabled={readOnly} onSelect={() => setIconOpen(true)}>
              <Icon name="ph-smiley" size={14} />
              Icon
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={readOnly}>
                <Icon name="ph-cube" size={14} />
                Types
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-[360px] overflow-auto border-line bg-raised">
                {allTypes.map((t) => (
                  <DropdownMenuCheckboxItem
                    key={t.id}
                    checked={c.typeIds.includes(t.id)}
                    onSelect={(e) => e.preventDefault()}
                    onCheckedChange={(on) => toggleType(t, on)}
                  >
                    {t.name}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <TemplatesMenu collection={c} types={types} />
            <PinMenuItems pin={{ kind: 'collection', id: c.id }} />
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" disabled={readOnly} onSelect={() => setDeleteOpen(true)}>
              <Icon name="ph-trash" size={14} />
              {COLLECTION_DIALOG_TEXT.deleteAction}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {types.length === 1 ? (
          <NewSplitButton
            type={types[0]}
            values={tab === 'all' ? createValues(newValues) : createValues()}
            defaultTemplateId={c.templates.defaultTemplateId}
          />
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                disabled={types.length === 0}
                className="flex h-8 items-center gap-1.5 rounded-lg border border-line bg-raised px-2.5 text-[14px] font-medium hover:bg-hover disabled:opacity-50"
              >
                <Icon name="ph-plus" size={14} />
                New
                <Icon name="ph-caret-down" size={12} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="border-line bg-raised">
              {types.map((t) => (
                <DropdownMenuItem key={t.id} onClick={(e) => create(t.id, mods(e))}>
                  <TypeChip type={t} size={18} />
                  {`New ${t.name}`}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>
      {readOnly && (
        <p role="status" className="px-4 pb-2 text-[13px] text-fg-muted">
          {`This collection's file couldn't be read, so it opens read-only. Fix the file to edit it.`}
        </p>
      )}
      {notice && (
        <div role="status" data-testid="collection-notice" className="mx-4 mb-2 flex items-start gap-2 rounded-md bg-raised px-3 py-1.5 text-[13px]">
          <span className="min-w-0 flex-1">{notice}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)} className="text-fg-muted hover:text-fg">
            <Icon name="ph-x" size={12} />
          </button>
        </div>
      )}
      <nav role="tablist" aria-label="Views" className="flex flex-wrap items-center gap-1 border-b border-line px-4 pb-3">
        <TabPill active={tab === 'overview'} onClick={() => select('overview')} icon="ph-layout">
          {SECTION_TEXT.overview}
        </TabPill>
        <TabPill active={tab === 'all'} onClick={() => select('all')} icon="ph-list-bullets">
          {SECTION_TEXT.all}
        </TabPill>
        {tabs.map((t) => (
          <SectionTab
            key={t.key}
            section={t}
            active={tab === t.key}
            onSelect={() => select(t.key)}
            onRename={(title) => update((v) => patchSection(v, sections, t.key, { title: title || undefined }))}
            onRemove={() =>
              update((v) => ({ ...removeSection(v, sections, t.key), activeTab: v.activeTab === t.key ? 'overview' : v.activeTab }))
            }
          />
        ))}
      </nav>
      <div className="mx-auto w-full px-6 pt-4 pb-16">
        {tab === 'overview' && (
          <div className="flex flex-col gap-8 pt-2">
            <div className="flex justify-end">
              <CustomizeOverview
                sections={sections}
                ctx={sectionCtx}
                update={update}
                addable={defs.queries
                  .filter((q) => !sections.some((s) => !s.hidden && s.key === `query:${q.id}`))
                  .map((q) => ({
                    key: `query:${q.id}` as const,
                    label: sectionQueryTitle(q, titleCtx),
                    defaultLabel: sectionQueryTitle(q, titleCtx),
                    icon: QUERY_ICON,
                    ownIcon: q.icon,
                    collapsed: false,
                    inFullView: true,
                    hidden: false,
                    refId: q.id,
                  }))}
              />
            </div>
            {visibleSections(sections).map((s) => {
              const heading = (
                <div className="flex min-w-0 items-center gap-1.5">
                  <button
                    type="button"
                    aria-expanded={!s.collapsed}
                    aria-label={`${s.collapsed ? 'Expand' : 'Collapse'} ${s.label}`}
                    onClick={() => update((v) => patchSection(v, sections, s.key, { collapsed: !s.collapsed }))}
                    className="flex h-7 min-w-0 items-center gap-1.5 rounded-md px-1 text-[16px] font-semibold hover:bg-hover"
                  >
                    <Icon name={s.collapsed ? 'ph-caret-right' : 'ph-caret-down'} size={13} />
                    <IconOrEmoji icon={s.ownIcon} fallback={s.icon} size={16} />
                    <span className="truncate">{s.label}</span>
                  </button>
                  {s.inFullView && (
                    <button
                      type="button"
                      onClick={() => select(s.key)}
                      className="rounded-md px-1.5 py-0.5 text-[13px] text-fg-muted hover:bg-hover hover:text-fg"
                    >
                      {SECTION_TEXT.openAll}
                    </button>
                  )}
                </div>
              )
              const onViewDefinition = (def: NonNullable<RenderedSection['viewDefinition']>) =>
                update((v) => patchSection(v, sections, s.key, { viewDefinition: def }))
              return (
                <section key={s.key} aria-label={s.label} data-testid="overview-section" data-section={s.key}>
                  {s.collapsed ? (
                    heading
                  ) : s.key === 'pinned' ? (
                    <div className="flex flex-col gap-2">
                      {heading}
                      <PinnedSection
                        rows={rows}
                        loading={loading}
                        types={allTypes.length > 0 ? allTypes : types}
                        collection={c}
                        section={s}
                        search={search}
                        rowMenu={rowMenu}
                        patchRow={patchRow}
                        onViewDefinition={onViewDefinition}
                      />
                    </div>
                  ) : (
                    <QuerySection
                      collection={c}
                      types={allTypes.length > 0 ? allTypes : types}
                      section={s}
                      heading={heading}
                      search={search}
                      onViewDefinition={onViewDefinition}
                    />
                  )}
                </section>
              )
            })}
          </div>
        )}
        {tab === 'all' && all}
        {activeSection && (
          <QuerySection
            key={activeSection.key}
            collection={c}
            types={allTypes.length > 0 ? allTypes : types}
            section={activeSection}
            search={search}
            onViewDefinition={(def) => update((v) => patchSection(v, sections, activeSection.key, { viewDefinition: def }))}
          />
        )}
      </div>
      <DeleteCollectionDialog
        collection={c}
        open={deleteOpen}
        onOpenChange={(o) => {
          setDeleteOpen(o)
          // Closed after the delete: leave the page of the collection that is gone.
          if (!o && !useDefs.getState().collections.some((x) => x.id === c.id)) {
            const t = c.typeIds[0]
            if (t) useTabs.getState().open({ kind: 'type', typeId: t })
          }
        }}
        onDeleted={() => {
          void flushCollectionViews(c.id)
        }}
      />
      <AddExistingDialog collection={c} open={addOpen} onOpenChange={setAddOpen} onPicked={(p) => void addExisting(p)} />
      <RemoveFromCollectionDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        count={1}
        onRemove={() => (removing ? removeRow(removing) : undefined)}
        onDelete={async () => {
          if (!removing) return
          try {
            await api.deleteObject(removing.summary.path, { baseVersion: removing.version })
          } catch (e) {
            if (e instanceof ConflictError) {
              setNotice(`${removing.summary.title} changed on disk. It was reloaded; try again.`)
              void reload()
            } else setNotice(e instanceof Error ? e.message : String(e))
          }
        }}
      />
    </div>
  )
}

/** A `query:<id>` section of the collection: the shared section view over the query's rows. */
function QuerySection({
  collection,
  types,
  section,
  heading,
  search,
  onViewDefinition,
}: {
  collection: Collection
  types: TypeDef[]
  section: RenderedSection
  heading?: React.ReactNode
  search: string
  onViewDefinition(def: NonNullable<RenderedSection['viewDefinition']>): void
}) {
  const { queries } = useDefinitions()
  const q = queries.find((x) => `query:${x.id}` === section.key)
  const type = (q && types.find((t) => q.definition.types.some((s) => s.id === t.id))) ?? types.find((t) => collection.typeIds.includes(t.id)) ?? types[0]
  if (!type) return <p className="py-4 text-[14px] text-fg-muted">{SECTION_TEXT.sectionEmpty}</p>
  return <SectionView type={type} section={section} search={search} heading={heading} onViewDefinition={onViewDefinition} />
}
