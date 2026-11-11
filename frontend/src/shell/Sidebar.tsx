import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useCollections } from '@/collections/useCollections'
import { Icon, IconOrEmoji, iconName } from '@/components/Icon'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { CreateCollectionDialog } from '@/collections/CollectionDialogs'
import { ImportCsvDialog } from '@/types/ImportCsvDialog'
import { TypeContextMenu } from './TypeContextMenu'
import type { TypeDef } from '@/api/types'
import type { Target } from '@/nav/tabs'
import { cn } from '@/lib/utils'
import { WorkspaceSections } from './SidebarSections'
import { HelpSection } from '@/help/HelpSection'
import { AgentsSection } from '@/agents/AgentsSection'
import { AssistantNavButton } from '@/agents/AssistantNavButton'
import { MainNavButton } from './MainNavButton'
import { SectionHeader } from './SectionHeader'
import { chipStyle } from './typeColor'
import { COLLECTION_ICON, QUERY_ICON } from '@/lib/defIcons'
import { typePlural } from '@/lib/typeLabel'
import { NEW_TYPE, NOTES, SAVED_SEARCHES, TYPES, WORK } from '@/lib/words'
import { useWorkOn } from '@/work/useWorkOn'
import { usePalette } from '@/palette/usePalette'
import { useSettings } from '@/settings/useSettings'
import { toggleDarkMode } from '@/theme/shortcuts'
import { useSettingsModal } from '@/settings/useSettingsModal'
import { useSpaceInfo } from '@/settings/useSpaceInfo'
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useUiStore } from './usePinned'
import { VcsStatusIndicator } from '@/vcs/VcsStatusIndicator'
import {
  orderTypeEntries,
  saveTypeOrder,
  SORT_ALPHABETICALLY,
  SORT_MANUALLY,
  sortTypesAlphabetically,
  sortTypesManually,
  typeSortOf,
  TYPES_MENU_LABEL,
  type TypeSort,
} from './typeOrder'

export interface SidebarProps {
  types: TypeDef[]
  activeTypeId?: string | null
  onOpenType?: (type: TypeDef) => void
  /** Optional object counts per type id, shown muted at the row's end. */
  counts?: Record<string, number>
  /** "+ New": create an object. */
  onNew?: () => void
  /** The `+` beside "Types": create a type. */
  onCreateType?: () => void
  /** A type row's context menu › "Type settings". */
  onOpenTypeSettings?: (type: TypeDef) => void
  /** A type row's context menu › "Delete type" (non-basic types only). */
  onDeleteType?: (type: TypeDef) => void
  /** "Trash": the app's own trash. */
  onOpenTrash?: () => void
  /** Highlights the Trash item. */
  trashActive?: boolean
  /** Opens any navigation target (the "Saved searches" entry; pins reuse it). */
  onOpenTarget?: (target: Target, opts: { newTab?: boolean }) => void
  /** Highlights the "Saved searches" entry. */
  queriesActive?: boolean
  /** M32: highlights the "Notes" entry (the all-notes view). */
  notesActive?: boolean
  /** Highlights the "Calendar" entry. */
  calendarActive?: boolean
  /** Highlights the "Tasks" entry. */
  tasksActive?: boolean
  /** Highlights the "Graph" entry. */
  graphActive?: boolean
  /** Highlights the "Work" entry (M32: shown under Tasks only while Work is on for the space). */
  workActive?: boolean
  /** Highlights the collection row of the open collection's page. */
  activeCollectionId?: string | null
}

const COLLAPSED_KEY = 'object.sidebar.collapsedTypes'

/** Which types have their collections folded away: kept per browser, never required. */
function useCollapsedTypes(): [Set<string>, (typeId: string) => void] {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(COLLAPSED_KEY)
      return new Set(raw ? (JSON.parse(raw) as string[]) : [])
    } catch {
      return new Set()
    }
  })
  const toggle = useCallback((typeId: string) => {
    setCollapsed((cur) => {
      const next = new Set(cur)
      if (!next.delete(typeId)) next.add(typeId)
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]))
      } catch {
        // storage can be blocked; the fold then lasts until reload
      }
      return next
    })
  }, [])
  return [collapsed, toggle]
}

/** The footer theme button's tooltips: the mode it switches to. */
export const SET_DARK_MODE = 'Dark mode'
export const SET_LIGHT_MODE = 'Light mode'

/** The footer's sun button: switches between the light and the dark theme. */
function ThemeButton() {
  const light = useSettings((s) => s.settings.themeMode === 'light')
  const label = light ? SET_DARK_MODE : SET_LIGHT_MODE
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-theme-toggle=""
      onClick={() => {
        toggleDarkMode().catch(() => undefined)
      }}
      className="flex size-8 items-center justify-center rounded-md hover:bg-hover hover:text-fg"
    >
      <Icon name="ph-sun" size={17} />
    </button>
  )
}

/** The footer gear's tooltip. */
export const SETTINGS_TOOLTIP = 'Settings'
/** The footer's Shortcuts icon: opens the shortcuts sheet (catalog §4: settings gear, theme toggle, Shortcuts icon). */
export const SHORTCUTS_TOOLTIP = 'Shortcuts'

/** The square search button's tooltip. */
export const SEARCH_THIS_SPACE = 'Search this space'

/** The sidebar entry for the Work page (M32: only while Work is on for the space). */
export const WORK_LABEL = WORK

/** M32: the sidebar's first entry, every note by last edited (the all-notes view). */
export const NOTES_LABEL = NOTES

/** The sidebar entry for the saved-search list (M32: was "Queries"). */
export const QUERIES_LABEL = SAVED_SEARCHES

/** M32: the type list's heading (was "Object Types") and its `+` (was "Create object type"). */
export const TYPES_HEADING = TYPES
export const NEW_TYPE_LABEL = NEW_TYPE

/** By the plural the screen shows (M32: the built-in Page sorts as "Notes", DailyNote as "Daily notes"). */
export function byPluralName(a: TypeDef, b: TypeDef): number {
  return typePlural(a).localeCompare(typePlural(b), undefined, { sensitivity: 'base' })
}

/** The sidebar "Saved searches" entry's tile: the query icon in a type-chip tile (green). */
const QUERIES_CHIP: Pick<TypeDef, 'icon' | 'color'> = { icon: { type: 'iconify', val: QUERY_ICON }, color: 'green' }

export function TypeChip({ type, size = 22 }: { type: Pick<TypeDef, 'icon' | 'color'>; size?: number }) {
  return (
    <span
      data-type-chip=""
      data-color={type.color}
      data-icon={iconName(type.icon, 'ph-cube')}
      style={{ ...chipStyle(type.color), width: size, height: size }}
      className="inline-flex shrink-0 items-center justify-center rounded-md border border-[color-mix(in_srgb,var(--chip-bg)_85%,white)] bg-[var(--chip-bg)] text-[var(--chip-fg)]"
    >
      <IconOrEmoji icon={type.icon} fallback="ph-cube" size={Math.round(size * 0.68)} />
    </span>
  )
}

/** The Saved searches entry's id in the manual type order. */
const QUERIES_ENTRY = 'queries'

type DragProps = Record<string, unknown>

/** One row of the type list; in manual sort it drags (its button carries the drag listeners). */
function TypeEntryItem({ id, sortable, children }: { id: string; sortable: boolean; children: (drag: DragProps) => ReactNode }) {
  if (!sortable) return <li data-type-entry={id}>{children({})}</li>
  return <SortableTypeEntry id={id}>{children}</SortableTypeEntry>
}

function SortableTypeEntry({ id, children }: { id: string; children: (drag: DragProps) => ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <li
      ref={setNodeRef}
      data-type-entry={id}
      style={{ transform: transform ? `translate3d(0, ${Math.round(transform.y)}px, 0)` : undefined, transition }}
      className={cn(isDragging && 'relative z-10 opacity-70')}
    >
      {children({ ...attributes, ...listeners })}
    </li>
  )
}

/** The Types header `...`: Sort manually | Sort alphabetically, the current one checked. */
function ObjectTypesMenu({ sort, onManual, onAlphabetical }: { sort: TypeSort; onManual(): void; onAlphabetical(): void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={TYPES_MENU_LABEL}
          title={TYPES_MENU_LABEL}
          className="flex size-6 items-center justify-center rounded-md text-fg-muted opacity-0 group-hover/sh:opacity-100 hover:bg-hover hover:text-fg focus-visible:opacity-100 data-[state=open]:opacity-100"
        >
          <Icon name="ph-dots-three" size={14} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="border-line bg-raised text-fg">
        <DropdownMenuCheckboxItem checked={sort === 'manual'} onCheckedChange={() => sort !== 'manual' && onManual()}>
          {SORT_MANUALLY}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={sort === 'alphabetical'} onCheckedChange={() => sort !== 'alphabetical' && onAlphabetical()}>
          {SORT_ALPHABETICALLY}
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function Sidebar({
  types,
  activeTypeId,
  onOpenType,
  counts,
  onNew,
  onCreateType,
  onOpenTypeSettings,
  onDeleteType,
  onOpenTrash,
  trashActive,
  onOpenTarget,
  queriesActive,
  notesActive,
  calendarActive,
  tasksActive,
  graphActive,
  workActive,
  activeCollectionId,
}: SidebarProps) {
  // `useSpaceInfo` also tells the Tasks dashboard whether the space hides task management.
  useEffect(() => {
    void useSpaceInfo.getState().ensure()
  }, [])
  // M32: the Work entry exists only while the Work page is on for this space.
  const workOn = useWorkOn()
  // A type's collections sit under its row in the object types block.
  const { collections } = useCollections()
  const [collapsed, toggleCollapsed] = useCollapsedTypes()
  // The type menu's "New collection" and "Import" open their dialogs here.
  const [collectionFor, setCollectionFor] = useState<TypeDef | null>(null)
  const [importFor, setImportFor] = useState<TypeDef | null>(null)
  const byType = useMemo(() => {
    const map = new Map<string, typeof collections>()
    for (const c of collections) {
      for (const id of c.typeIds) map.set(id, [...(map.get(id) ?? []), c])
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }))
    }
    return map
  }, [collections])
  // The order: by name ("Saved searches" among the types where a type of that name would be), or the
  // manual order (`ui.objectsSectionSortOption`, `ui.workspace.objects.ids`).
  const ui = useUiStore((st) => st.ui)
  const sort = typeSortOf(ui)
  const names: Record<string, string> = { [QUERIES_ENTRY]: QUERIES_LABEL }
  for (const t of types) names[t.id] = typePlural(t)
  const order = orderTypeEntries(Object.keys(names), names, sort, ui.workspace?.objects?.ids)
  const manual = sort === 'manual'
  const typeSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const onTypeDragEnd = (e: DragEndEvent) => {
    const from = order.indexOf(String(e.active.id))
    const to = e.over ? order.indexOf(String(e.over.id)) : -1
    if (from < 0 || to < 0 || from === to) return
    void saveTypeOrder(arrayMove(order, from, to))
  }
  const typeById = new Map(types.map((t) => [t.id, t]))
  const list = (
    <ul className="flex flex-col gap-0.5 pb-2">
      {order.map((id) => {
        if (id === QUERIES_ENTRY) {
          return (
            <TypeEntryItem key={id} id={id} sortable={manual}>
              {(drag) => (
                <button
                  type="button"
                  {...drag}
                  onClick={(e) => onOpenTarget?.({ kind: 'queries' }, { newTab: e.ctrlKey || e.metaKey })}
                  aria-current={queriesActive ? 'page' : undefined}
                  className={cn(
                    'flex h-[36px] w-full items-center gap-2 rounded-lg px-1.5 text-left text-[15px] font-medium hover:bg-hover',
                    queriesActive && 'bg-hover',
                  )}
                >
                  <TypeChip type={QUERIES_CHIP} size={22} />
                  <span className="min-w-0 flex-1 truncate">{QUERIES_LABEL}</span>
                </button>
              )}
            </TypeEntryItem>
          )
        }
        const t = typeById.get(id)
        if (!t) return null
        const own = byType.get(t.id) ?? []
        const folded = collapsed.has(t.id)
        const plural = typePlural(t)
        return (
          <TypeEntryItem key={t.id} id={t.id} sortable={manual}>
            {(drag) => (
            <>
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <div className="group/type relative">
                  <button
                    type="button"
                    {...drag}
                    onClick={() => onOpenType?.(t)}
                    aria-current={activeTypeId === t.id ? 'page' : undefined}
                    className={cn(
                      'flex h-[36px] w-full items-center gap-2 rounded-lg px-1.5 text-left text-[15px] font-medium hover:bg-hover',
                      own.length > 0 && 'pr-8',
                      activeTypeId === t.id && 'bg-hover',
                    )}
                  >
                    <TypeChip type={t} />
                    <span className="min-w-0 flex-1 truncate">{plural}</span>
                    {counts && counts[t.id] !== undefined && (
                      <span className="text-[13px] text-fg-muted tabular-nums">{counts[t.id]}</span>
                    )}
                  </button>
                  {own.length > 0 && (
                    <button
                      type="button"
                      aria-label={folded ? `Show ${plural} collections` : `Hide ${plural} collections`}
                      aria-expanded={!folded}
                      title={folded ? `Show ${own.length} collections` : 'Hide collections'}
                      onClick={() => toggleCollapsed(t.id)}
                      className={cn(
                        'absolute top-1/2 right-1 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg',
                        !folded && 'opacity-0 group-hover/type:opacity-100 focus-visible:opacity-100',
                      )}
                    >
                      <Icon name={folded ? 'ph-caret-right' : 'ph-caret-down'} size={12} />
                    </button>
                  )}
                </div>
              </ContextMenuTrigger>
              <TypeContextMenu
                type={t}
                onOpenTarget={onOpenTarget}
                onOpenTypeSettings={onOpenTypeSettings}
                onDeleteType={onDeleteType}
                onNewCollection={setCollectionFor}
                onImport={setImportFor}
              />
            </ContextMenu>
            {own.length > 0 && !folded && (
              <ul aria-label={`${plural} collections`} className="mt-0.5 mb-1 flex flex-col gap-px">
                {own.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={(e) => onOpenTarget?.({ kind: 'collection', id: c.id }, { newTab: e.ctrlKey || e.metaKey })}
                      aria-current={activeCollectionId === c.id ? 'page' : undefined}
                      title={c.description || c.name}
                      className={cn(
                        'flex h-[30px] w-full items-center gap-2 rounded-lg pr-2 pl-[38px] text-left text-[14px] text-fg-muted hover:bg-hover hover:text-fg',
                        activeCollectionId === c.id && 'bg-hover text-fg',
                      )}
                    >
                      <Icon name={COLLECTION_ICON} size={14} />
                      <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            </>
            )}
          </TypeEntryItem>
        )
      })}
    </ul>
  )
  // The types and the Saved searches entry: the `objects` block of `workspaceOrder`.
  const objectTypes = (
    <section aria-labelledby="sb-types">
      <SectionHeader
        id="sb-types"
        action={
          <div className="flex items-center gap-0.5">
            <ObjectTypesMenu sort={sort} onManual={() => void sortTypesManually(order)} onAlphabetical={() => void sortTypesAlphabetically()} />
            <button
              type="button"
              aria-label={NEW_TYPE_LABEL}
              title={NEW_TYPE_LABEL}
              onClick={() => onCreateType?.()}
              className="flex size-6 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
            >
              <Icon name="ph-plus" size={14} />
            </button>
          </div>
        }
      >
        {TYPES_HEADING}
      </SectionHeader>
      {manual ? (
        <DndContext id="object-types-order" sensors={typeSensors} collisionDetection={closestCenter} onDragEnd={onTypeDragEnd}>
          <SortableContext items={order} strategy={verticalListSortingStrategy}>
            {list}
          </SortableContext>
        </DndContext>
      ) : (
        list
      )}
    </section>
  )
  return (
    <aside className="flex h-full w-[358px] shrink-0 flex-col bg-app pr-3.5 pl-2.5 text-fg" aria-label="Sidebar">
      <div className="flex items-center gap-2 pt-3 pb-3">
        <button
          type="button"
          onClick={() => onNew?.()}
          data-new-button=""
          className="flex h-[42px] flex-1 items-center gap-2 rounded-xl border border-[var(--chrome-btn-border)] bg-raised px-3 text-[15px] font-medium hover:bg-hover"
        >
          <Icon name="ph-plus" size={16} />
          New
        </button>
        <button
          type="button"
          aria-label={SEARCH_THIS_SPACE}
          title={SEARCH_THIS_SPACE}
          onClick={() => usePalette.getState().show('search')}
          className="flex size-[42px] items-center justify-center rounded-xl border border-[var(--chrome-btn-border)] bg-raised hover:bg-hover"
        >
          <Icon name="ph-magnifying-glass" size={18} />
        </button>
      </div>

      {/* The main navigation, always visible at the top. M32: Notes first (every note by last
          edited), then Calendar, Tasks (the plain Tasks page, target `tasks`), Work directly under
          it while the Work page is on for the space, Graph, Assistant. */}
      <nav aria-label="Main" className="flex flex-col gap-0.5">
        <MainNavButton
          icon="ph-note"
          label={NOTES_LABEL}
          active={notesActive}
          onClick={(e) => onOpenTarget?.({ kind: 'allNotes' }, { newTab: e.ctrlKey || e.metaKey })}
        />
        <MainNavButton
          icon="ph-calendar-blank"
          label="Calendar"
          active={calendarActive}
          onClick={(e) => onOpenTarget?.({ kind: 'calendar' }, { newTab: e.ctrlKey || e.metaKey })}
        />
        {/* Always shown; active for the `tasks` target only. */}
        <MainNavButton
          icon="ph-check-circle"
          label="Tasks"
          active={tasksActive}
          onClick={(e) => onOpenTarget?.({ kind: 'tasks' }, { newTab: e.ctrlKey || e.metaKey })}
        />
        {workOn && (
          <MainNavButton
            icon="ph-briefcase"
            label={WORK_LABEL}
            active={workActive}
            onClick={(e) => onOpenTarget?.({ kind: 'work' }, { newTab: e.ctrlKey || e.metaKey })}
          />
        )}
        <MainNavButton
          icon="ph-graph"
          label="Graph"
          active={graphActive}
          onClick={(e) => onOpenTarget?.({ kind: 'graph' }, { newTab: e.ctrlKey || e.metaKey })}
        />
        {/* The built-in Assistant, not an agent: directly under Graph. */}
        <AssistantNavButton onOpenTarget={onOpenTarget} />
      </nav>

      {/* M17: the agents, a section of their own, below the main navigation. */}
      <AgentsSection onOpenTarget={onOpenTarget} />

      <ScrollArea className="min-h-0 flex-1">
        {/* The custom sections, Pinned and the types, in `ui.workspaceOrder` (M9). */}
        <WorkspaceSections onOpenTarget={onOpenTarget} objects={objectTypes} />

        <HelpSection />
      </ScrollArea>

      {/* Trash, on its own at the very bottom. */}
      <nav aria-label="Space" className="flex flex-col gap-0.5 pb-1">
        <MainNavButton icon="ph-trash" label="Trash" active={trashActive} onClick={() => onOpenTrash?.()} />
      </nav>

      {collectionFor && (
        <CreateCollectionDialog
          open
          onOpenChange={(o) => !o && setCollectionFor(null)}
          typeId={collectionFor.id}
          onCreated={(c) => onOpenTarget?.({ kind: 'collection', id: c.id }, {})}
        />
      )}
      {importFor && <ImportCsvDialog type={importFor} open onOpenChange={(o) => !o && setImportFor(null)} />}

      <footer className="flex items-center gap-1 py-2 text-fg-muted">
        <button
          type="button"
          aria-label={SETTINGS_TOOLTIP}
          title={SETTINGS_TOOLTIP}
          onClick={() => useSettingsModal.getState().open()}
          className="flex size-8 items-center justify-center rounded-md hover:bg-hover hover:text-fg"
        >
          <Icon name="ph-gear" size={17} />
        </button>
        <ThemeButton />
        <button
          type="button"
          aria-label={SHORTCUTS_TOOLTIP}
          title={SHORTCUTS_TOOLTIP}
          onClick={() => useSettingsModal.getState().openShortcuts()}
          className="flex size-8 items-center justify-center rounded-md hover:bg-hover hover:text-fg"
        >
          <Icon name="ph-keyboard" size={17} />
        </button>
        {/* 2026-11-08: the backup line, shown only while version control is on. */}
        <VcsStatusIndicator />
      </footer>
    </aside>
  )
}
