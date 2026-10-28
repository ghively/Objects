import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import { api } from '@/api/client'
import type { ObjectSummary, TypeDef, Views } from '@/api/types'
import { Icon, IconOrEmoji } from '@/components/Icon'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { createAndOpen, type OpenMods } from '@/create/createAndOpen'
import { useLinkIndex } from '@/links/linkIndex'
import { useTabs } from '@/nav/tabs'
import { templateName } from '@/object/UseTemplateMenu'
import { cn } from '@/lib/utils'
import { PinMenuItems } from '@/shell/PinToMenu'
import { TypeChip } from '@/shell/Sidebar'
import { matchingValues } from '@/views/matching'
import { FULL_VIEW_LAYOUTS } from '@/views/model'
import { useRows } from '@/views/useRows'
import { DataView, ToolbarSlot } from '@/views/DataView'
import { CreateCollectionDialog, DeleteCollectionDialog } from '@/collections/CollectionDialogs'
import { removeQuery } from '@/queries/useQueries'
import { DeleteTypeDialog } from './DeleteTypeDialog'
import { ImportCsvDialog, IMPORT_CSV_TEXT } from './ImportCsvDialog'
import { isDailyNoteType } from '@/object/ObjectHeader'
import { isWhiteboardType } from '@/whiteboard/isWhiteboard'
import {
  SECTION_TEXT,
  buildSections,
  isCollectionKey,
  isQueryKey,
  keyId,
  patchSection,
  removeSection,
  tabSections,
  type RenderedSection,
} from './dashboardSections'
import { SectionView, searchRows } from './SectionView'
import { orderTemplates, templateKey, templatesAllowed } from './TemplateManager'
import { TypeOverview } from './TypeOverview'
import { useDefinitions } from './useDefinitions'
import { useTypeViews, type ViewsEdit } from './useTypeViews'
import { COLLECTION_ICON, QUERY_ICON } from '@/lib/defIcons'
import { useTitleCtx } from '@/queries/QueryPage'

function mods(e: MouseEvent): OpenMods {
  return { ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey }
}

/**
 * The type's "New" split button: "New {TypeName}" creates one (with the default template), and the
 * caret lists "New '{TemplateName}'" per template.
 */
export function NewSplitButton({
  type,
  values,
  defaultTemplateId,
}: {
  type: TypeDef
  values?: Record<string, unknown>
  /** A collection's default template: used by the plain "New" click instead of the type's default. */
  defaultTemplateId?: string | null
}) {
  const [templates, setTemplates] = useState<ObjectSummary[]>([])
  const allowed = templatesAllowed(type)

  useEffect(() => {
    if (!allowed) {
      setTemplates([])
      return
    }
    let alive = true
    api
      .templates(type.id)
      .then((ts) => alive && setTemplates(ts ?? []))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [type.id, allowed])

  const create = (templateId: string | undefined, m: OpenMods) =>
    void createAndOpen(
      type.id,
      { ...((templateId ?? defaultTemplateId ?? undefined) !== undefined ? { templateId: templateId ?? defaultTemplateId ?? undefined } : {}), ...(values ? { values } : {}) },
      m,
    ).catch((e: unknown) =>
      console.warn('Could not create an object:', e),
    )

  const ordered = orderTemplates(type, templates)

  return (
    <div className="flex h-8 items-stretch overflow-hidden rounded-lg border border-line bg-raised text-[14px] font-medium">
      <button
        type="button"
        onClick={(e) => create(undefined, mods(e))}
        className="flex items-center gap-1.5 px-2.5 hover:bg-hover"
      >
        <Icon name="ph-plus" size={14} />
        {`New ${type.name}`}
      </button>
      {ordered.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="New from template"
              className="flex items-center border-l border-line px-1.5 hover:bg-hover"
            >
              <Icon name="ph-caret-down" size={13} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="border-line bg-raised">
            {ordered.map((t) => (
              <DropdownMenuItem key={templateKey(t)} onClick={(e) => create(templateKey(t), mods(e))}>
                <Icon name="ph-file-dashed" size={14} />
                {`New '${templateName(t)}'`}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

type TabKey = 'overview' | 'all' | string

/** The basic Task type (by flag and name, as the server infers it). */
export const isBasicTaskType = (type: TypeDef): boolean => type.basic && type.name.toLowerCase() === 'task'

export function TabPill({
  active,
  onClick,
  icon,
  ownIcon,
  children,
}: {
  active: boolean
  onClick(): void
  icon: string
  ownIcon?: RenderedSection['ownIcon']
  children: string
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'flex h-7 items-center gap-1.5 rounded-full px-3 text-[14px] font-medium',
        active ? 'bg-hover-2 text-fg' : 'text-fg-muted hover:bg-hover',
      )}
    >
      <IconOrEmoji icon={ownIcon} fallback={icon} size={14} />
      <span className="truncate">{children}</span>
    </button>
  )
}

/** A header tab for a full-view section, with its menu (right-click or the caret). */
export function SectionTab({
  section,
  active,
  onSelect,
  onRename,
  onRemove,
  onDelete,
}: {
  section: RenderedSection
  active: boolean
  onSelect(): void
  onRename(title: string): void
  onRemove(): void
  /** "Delete collection" / "Delete" on a collection or query tab. */
  onDelete?(): void
}) {
  const [menu, setMenu] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(section.label)
  const openable = isCollectionKey(section.key) || isQueryKey(section.key)

  if (renaming) {
    const commit = () => {
      setRenaming(false)
      const next = draft.trim()
      if (next !== section.label) onRename(next === section.defaultLabel ? '' : next)
    }
    return (
      <input
        autoFocus
        aria-label={`Rename ${section.label}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setRenaming(false)
        }}
        className="h-7 w-40 rounded-full border border-line bg-transparent px-3 text-[14px] outline-none"
      />
    )
  }

  return (
    <div
      className="flex items-center"
      onContextMenu={(e) => {
        e.preventDefault()
        setMenu(true)
      }}
    >
      <TabPill active={active} onClick={onSelect} icon={section.icon} ownIcon={section.ownIcon}>
        {section.label}
      </TabPill>
      <DropdownMenu open={menu} onOpenChange={setMenu}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`${section.label} menu`}
            className="-ml-1.5 flex size-5 items-center justify-center rounded text-fg-muted hover:bg-hover"
          >
            <Icon name="ph-caret-down" size={11} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="border-line bg-raised">
          {openable && (
            <DropdownMenuItem
              onClick={() =>
                useTabs
                  .getState()
                  .open(
                    isCollectionKey(section.key)
                      ? { kind: 'collection', id: keyId(section.key) }
                      : { kind: 'query', id: keyId(section.key) },
                  )
              }
            >
              <Icon name="ph-arrows-out-simple" size={14} />
              Open
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onSelect={() => {
              setDraft(section.label)
              setRenaming(true)
            }}
          >
            <Icon name="ph-pencil-simple" size={14} />
            Rename
          </DropdownMenuItem>
          {openable && (
            <PinMenuItems
              pin={
                isCollectionKey(section.key)
                  ? { kind: 'collection', id: keyId(section.key) }
                  : { kind: 'query', id: keyId(section.key) }
              }
            />
          )}
          <DropdownMenuItem onClick={onRemove}>
            <Icon name="ph-x" size={14} />
            Remove
          </DropdownMenuItem>
          {onDelete && (
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Icon name="ph-trash" size={14} />
              {isCollectionKey(section.key) ? 'Delete collection' : 'Delete'}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function AllTab({
  type,
  views,
  search,
  update,
}: {
  type: TypeDef
  views: Views
  search: string
  update(edit: ViewsEdit): void
}) {
  const indexTypes = useLinkIndex((s) => s.types)
  const { collections } = useDefinitions()
  const scope = useMemo(() => ({ typeIds: [type.id] }), [type.id])
  const { rows, loading, patchRow } = useRows(scope)
  const shown = useMemo(() => searchRows(rows, search), [rows, search])
  return (
    <DataView
      rows={shown}
      types={indexTypes.length > 0 ? indexTypes : [type]}
      collections={collections}
      scope={scope}
      loading={loading}
      state={views.all}
      onState={(s) => update((v) => ({ ...v, all: s }))}
      layouts={FULL_VIEW_LAYOUTS}
      allowCreate
      onCreate={(values, typeId) =>
        void createAndOpen(typeId, { values }).catch((e: unknown) => console.warn('Could not create an object:', e))
      }
      patchRow={patchRow}
      rowActions
    />
  )
}

/** The type page: header, the Overview / All / section tabs, and the active tab's view. */
export function TypePage({ type }: { type: TypeDef }) {
  const { views, update } = useTypeViews(type.id)
  const defs = useDefinitions()
  const indexTypes = useLinkIndex((s) => s.types)
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [toolbarSlot, setToolbarSlot] = useState<HTMLDivElement | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [createCollectionOpen, setCreateCollectionOpen] = useState(false)
  const [deletingCollection, setDeletingCollection] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  // Daily notes and whiteboards aren't created from a title, so they take no CSV (our choice).
  const canImport = !type.readOnlyReason && !isDailyNoteType(type) && !isWhiteboardType(type)

  const titleCtx = useTitleCtx(indexTypes)
  const ctx = useMemo(
    () => ({ collections: defs.collections, queries: defs.queries, titleCtx }),
    [defs.collections, defs.queries, titleCtx],
  )
  const sections = useMemo(() => (views ? buildSections(type, views, ctx) : []), [type, views, ctx])
  const tabs = tabSections(sections)

  // The basic Task type has no Overview (Capacities' `hideDashboard`): All plus section tabs,
  // All by default, and a saved `overview` falls back to All.
  const noOverview = isBasicTaskType(type)
  const home: TabKey = noOverview ? 'all' : 'overview'
  const saved: TabKey = views?.activeTab ?? 'all'
  const tab: TabKey | null =
    saved === 'all' || (saved === 'overview' && !noOverview)
      ? saved
      : tabs.some((t) => t.key === saved)
        ? saved
        : defs.loaded || noOverview
          ? home
          : null
  const activeSection = tabs.find((t) => t.key === tab)

  const select = (key: TabKey) => {
    setSearch('')
    update((v) => ({ ...v, activeTab: key }))
  }

  const newValues = useMemo(() => {
    if (!views) return undefined
    const all = indexTypes.length > 0 ? indexTypes : [type]
    if (tab === 'all') return matchingValues(views.all.filterGroup, all, type.id, defs.collections)
    if (activeSection && isCollectionKey(activeSection.key)) {
      const c = defs.collections.find((x) => x.id === keyId(activeSection.key))
      return c ? { collections: [c.name] } : undefined
    }
    return undefined
  }, [views, tab, activeSection, indexTypes, type, defs.collections])

  const saveAsQuery = async () => {
    if (!views) return
    const a = views.all
    const q = await api.createQuery({
      definition: {
        structures: [{ id: type.id }],
        filterGroup: a.filterGroup,
        sorts: a.sorts,
        groupBy: a.groupBy,
      },
      view: { viewDefinition: a.viewDefinition },
    })
    useTabs.getState().open({ kind: 'query', id: q.id })
  }

  return (
    <div className="w-full">
      <header className="flex flex-wrap items-center gap-2.5 border-b border-line px-4 pt-5 pb-3">
        <TypeChip type={type} size={32} />
        <h1 className="dataview-heading text-[20px] font-bold md:text-[22px]">{type.pluralName}</h1>
        <div className="flex-1" />
        {searchOpen || search ? (
          <input
            type="search"
            autoFocus
            aria-label="Search title..."
            placeholder="Search title..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onBlur={() => !search && setSearchOpen(false)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setSearch('')
                setSearchOpen(false)
              }
            }}
            className="h-8 w-48 rounded-lg border border-line bg-transparent px-2.5 text-[14px] outline-none focus:border-fg-muted"
          />
        ) : (
          <button
            type="button"
            aria-label="Search"
            title="Search"
            onClick={() => setSearchOpen(true)}
            className="flex size-8 items-center justify-center rounded-lg border border-line bg-raised hover:bg-hover"
          >
            <Icon name="ph-magnifying-glass" size={16} />
          </button>
        )}
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
            <DropdownMenuItem onSelect={() => setCreateCollectionOpen(true)}>
              <Icon name={COLLECTION_ICON} size={14} />
              {SECTION_TEXT.createCollection}
            </DropdownMenuItem>
            {canImport && (
              <DropdownMenuItem onSelect={() => setImportOpen(true)}>
                <Icon name="ph-file-csv" size={14} />
                {IMPORT_CSV_TEXT.menu}
              </DropdownMenuItem>
            )}
            <PinMenuItems pin={{ kind: 'type', id: type.id }} />
            {tab === 'all' && (
              <DropdownMenuItem
                onClick={() => void saveAsQuery().catch((e: unknown) => console.warn('Could not save the query:', e))}
              >
                <Icon name={QUERY_ICON} size={14} />
                Save as query
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => useTabs.getState().open({ kind: 'typeSettings', typeId: type.id })}>
              <Icon name="ph-gear" size={14} />
              Object Type Settings
            </DropdownMenuItem>
            {!type.basic && (
              <DropdownMenuItem onClick={() => setDeleteOpen(true)}>
                <Icon name="ph-trash" size={14} />
                Delete object type
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <NewSplitButton type={type} values={newValues} />
      </header>
      <div data-toolbar-row="" className="flex flex-wrap items-center gap-2 px-4 py-3">
        <nav role="tablist" aria-label="Views" className="flex flex-wrap items-center gap-1">
          {!noOverview && (
            <TabPill active={tab === 'overview'} onClick={() => select('overview')} icon="ph-layout">
              {SECTION_TEXT.overview}
            </TabPill>
          )}
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
              onDelete={
                isCollectionKey(t.key)
                  ? () => setDeletingCollection(keyId(t.key))
                  : isQueryKey(t.key)
                    ? () => void removeQuery(keyId(t.key)).catch((e: unknown) => console.warn('Could not delete the query:', e))
                    : undefined
              }
              onRemove={() =>
                update((v) => ({ ...removeSection(v, sections, t.key), activeTab: v.activeTab === t.key ? home : v.activeTab }))
              }
            />
          ))}
        </nav>
        {/* The All or section tab's toolbar renders here, right-aligned (see `ToolbarSlot`). */}
        <div ref={setToolbarSlot} data-testid="toolbar-slot" className="ml-auto flex min-w-0 flex-1 justify-end" />
      </div>
      <div className="mx-auto w-full px-6 pt-1 pb-16">
        {!views && <p className="py-8 text-center text-[14px] text-fg-muted">Loading results…</p>}
        {views && tab === 'overview' && (
          <TypeOverview
            type={type}
            sections={sections}
            ctx={ctx}
            search={search}
            update={update}
            onCreateCollection={() => setCreateCollectionOpen(true)}
          />
        )}
        <ToolbarSlot.Provider value={toolbarSlot}>
          {views && tab === 'all' && <AllTab type={type} views={views} search={search} update={update} />}
          {views && activeSection && (
            <SectionView
              key={activeSection.key}
              type={type}
              section={activeSection}
              search={search}
              onViewDefinition={(def) => update((v) => patchSection(v, sections, activeSection.key, { viewDefinition: def }))}
            />
          )}
        </ToolbarSlot.Provider>
      </div>
      <CreateCollectionDialog
        open={createCollectionOpen}
        onOpenChange={setCreateCollectionOpen}
        typeId={type.id}
        onCreated={(c) => useTabs.getState().open({ kind: 'collection', id: c.id })}
      />
      {deletingCollection && defs.collections.some((c) => c.id === deletingCollection) && (
        <DeleteCollectionDialog
          collection={defs.collections.find((c) => c.id === deletingCollection)!}
          open
          onOpenChange={(o) => !o && setDeletingCollection(null)}
        />
      )}
      {canImport && <ImportCsvDialog type={type} open={importOpen} onOpenChange={setImportOpen} />}
      {deleteOpen && (
        <DeleteTypeDialog
          type={type}
          open
          onOpenChange={(o) => !o && setDeleteOpen(false)}
          onDeleted={() => {
            setDeleteOpen(false)
            useTabs.getState().open({ kind: 'trash' })
          }}
        />
      )}
    </div>
  )
}
