import { useCallback, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { useCollections } from '@/collections/useCollections'
import { Icon, IconOrEmoji, iconName } from '@/components/Icon'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { TypeDef } from '@/api/types'
import type { Target } from '@/nav/tabs'
import { cn } from '@/lib/utils'
import { WorkspaceSections } from './SidebarSections'
import { chipStyle } from './typeColor'
import { COLLECTION_ICON, QUERY_ICON } from '@/lib/defIcons'
import { usePalette } from '@/palette/usePalette'
import { useSettings } from '@/settings/useSettings'
import { toggleDarkMode } from '@/theme/shortcuts'
import { useSettingsModal } from '@/settings/useSettingsModal'
import { useSpaceInfo } from '@/settings/useSpaceInfo'

export interface SidebarProps {
  types: TypeDef[]
  activeTypeId?: string | null
  onOpenType?: (type: TypeDef) => void
  /** Optional object counts per type id, shown muted at the row's end. */
  counts?: Record<string, number>
  /** "+ New": create an object. */
  onNew?: () => void
  /** The `+` beside "Object Types": create a type. */
  onCreateType?: () => void
  /** A type row's context menu › "Object Type Settings". */
  onOpenTypeSettings?: (type: TypeDef) => void
  /** A type row's context menu › "Delete object type" (non-basic types only). */
  onDeleteType?: (type: TypeDef) => void
  /** "Trash": the app's own trash. */
  onOpenTrash?: () => void
  /** Highlights the Trash item. */
  trashActive?: boolean
  /** Opens any navigation target (the "Queries" entry; pins reuse it). */
  onOpenTarget?: (target: Target, opts: { newTab?: boolean }) => void
  /** Highlights the "Queries" entry. */
  queriesActive?: boolean
  /** Highlights the "All notes" entry. */
  allNotesActive?: boolean
  /** Highlights the "Calendar" entry. */
  calendarActive?: boolean
  /** Highlights the "Tasks" entry. */
  tasksActive?: boolean
  /** Highlights the "Graph" entry. */
  graphActive?: boolean
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

/** The footer theme button's tooltips: the mode it switches to (`SpaceOverview.setDarkMode`, `.setLightMode`). */
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

/** The footer gear's tooltip (`SpaceOverview.settings.tooltip`). */
export const SETTINGS_TOOLTIP = 'Settings'

/** The square search button's tooltip (`shortcuts.openSearchPalette.name`). */
export const SEARCH_THIS_SPACE = 'Search this space'

/** The sidebar entry for the All notes view. */
export const ALL_NOTES_LABEL = 'All notes'

/** The sidebar entry for the query list (the reference's `RootQuery.pluralName`). */
export const QUERIES_LABEL = 'Queries'

export function byPluralName(a: TypeDef, b: TypeDef): number {
  return a.pluralName.localeCompare(b.pluralName, undefined, { sensitivity: 'base' })
}

/** The sidebar "Queries" entry's tile: RootQuery's icon in a type-chip tile (green, as in the reference). */
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

function SectionHeader({
  id,
  icon,
  children,
  action,
}: {
  id: string
  icon?: string
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="group/sh flex items-center pr-1">
      <h2
        id={id}
        className="flex flex-1 items-center gap-1.5 px-2 pt-5 pb-2 text-[14px] font-semibold text-[var(--text-section)]"
      >
        {icon && <Icon name={icon} size={14} />}
        {children}
      </h2>
      {action && <div className="pt-3">{action}</div>}
    </div>
  )
}

/** A live entry of the main nav (All notes, Calendar, Tasks, Graph); Ctrl+click opens a new tab. */
function MainNavButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: string
  label: string
  active?: boolean
  onClick: (e: MouseEvent<HTMLButtonElement>) => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-[38px] w-full items-center gap-2 rounded-lg px-2 text-left text-[15px] font-medium text-fg hover:bg-hover',
        active && 'bg-hover',
      )}
    >
      <Icon name={icon} size={16} />
      <span>{label}</span>
    </button>
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
  allNotesActive,
  calendarActive,
  tasksActive,
  graphActive,
  activeCollectionId,
}: SidebarProps) {
  // "Tasks" is hidden while the space hides task management (`space.json` `hideTaskManagement`).
  const hideTasks = useSpaceInfo((s) => s.space?.hideTaskManagement ?? false)
  useEffect(() => {
    void useSpaceInfo.getState().ensure()
  }, [])
  // A type's collections sit under its row, as in Capacities' `objects` sidebar block.
  const { collections } = useCollections()
  const [collapsed, toggleCollapsed] = useCollapsedTypes()
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
  // "Queries" sits among the types where a type of that name would be, in the by-name order.
  type Entry = { kind: 'type'; type: TypeDef } | { kind: 'queries' }
  const entries: Entry[] = [
    ...types.map((type): Entry => ({ kind: 'type', type })),
    { kind: 'queries' as const },
  ].sort((a, b) => {
    const name = (e: Entry) => (e.kind === 'type' ? e.type.pluralName : QUERIES_LABEL)
    return name(a).localeCompare(name(b), undefined, { sensitivity: 'base' })
  })
  // The object types and the Queries entry: the `objects` block of `workspaceOrder`.
  const objectTypes = (
    <section aria-labelledby="sb-types">
      <SectionHeader
        id="sb-types"
        action={
          <button
            type="button"
            aria-label="Create object type"
            title="Create object type"
            onClick={() => onCreateType?.()}
            className="flex size-6 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
          >
            <Icon name="ph-plus" size={14} />
          </button>
        }
      >
        Object Types
      </SectionHeader>
      <ul className="flex flex-col gap-0.5 pb-2">
        {entries.map((entry) => {
          if (entry.kind === 'queries') {
            return (
              <li key="queries">
                <button
                  type="button"
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
              </li>
            )
          }
          const t = entry.type
          const own = byType.get(t.id) ?? []
          const folded = collapsed.has(t.id)
          return (
          <li key={t.id}>
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <div className="group/type relative">
                  <button
                    type="button"
                    onClick={() => onOpenType?.(t)}
                    aria-current={activeTypeId === t.id ? 'page' : undefined}
                    className={cn(
                      'flex h-[36px] w-full items-center gap-2 rounded-lg px-1.5 text-left text-[15px] font-medium hover:bg-hover',
                      own.length > 0 && 'pr-8',
                      activeTypeId === t.id && 'bg-hover',
                    )}
                  >
                    <TypeChip type={t} />
                    <span className="min-w-0 flex-1 truncate">{t.pluralName}</span>
                    {counts && counts[t.id] !== undefined && (
                      <span className="text-[13px] text-fg-muted tabular-nums">{counts[t.id]}</span>
                    )}
                  </button>
                  {own.length > 0 && (
                    <button
                      type="button"
                      aria-label={folded ? 'Show collections' : 'Hide collections'}
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
              <ContextMenuContent className="border-line bg-raised text-fg">
                <ContextMenuItem onSelect={() => onOpenTypeSettings?.(t)}>
                  <Icon name="ph-gear" size={14} />
                  Object Type Settings
                </ContextMenuItem>
                {!t.basic && (
                  <ContextMenuItem variant="destructive" onSelect={() => onDeleteType?.(t)}>
                    <Icon name="ph-trash" size={14} />
                    Delete object type
                  </ContextMenuItem>
                )}
              </ContextMenuContent>
            </ContextMenu>
            {own.length > 0 && !folded && (
              <ul aria-label={`${t.pluralName} collections`} className="mt-0.5 mb-1 flex flex-col gap-px">
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
          </li>
          )
        })}
      </ul>
    </section>
  )
  return (
    <aside className="flex h-full w-[358px] shrink-0 flex-col bg-app pr-3.5 pl-2.5 text-fg" aria-label="Sidebar">
      <div className="flex items-center gap-2 pt-3 pb-3">
        <button
          type="button"
          onClick={() => onNew?.()}
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

      <nav aria-label="Main" className="flex flex-col gap-0.5">
        <MainNavButton
          icon="ph-note"
          label={ALL_NOTES_LABEL}
          active={allNotesActive}
          onClick={(e) => onOpenTarget?.({ kind: 'allNotes' }, { newTab: e.ctrlKey || e.metaKey })}
        />
        <MainNavButton
          icon="ph-calendar-blank"
          label="Calendar"
          active={calendarActive}
          onClick={(e) => onOpenTarget?.({ kind: 'calendar' }, { newTab: e.ctrlKey || e.metaKey })}
        />
        {!hideTasks && (
          <MainNavButton
            icon="ph-check-circle"
            label="Tasks"
            active={tasksActive}
            onClick={(e) => onOpenTarget?.({ kind: 'tasks' }, { newTab: e.ctrlKey || e.metaKey })}
          />
        )}
        <MainNavButton
          icon="ph-graph"
          label="Graph"
          active={graphActive}
          onClick={(e) => onOpenTarget?.({ kind: 'graph' }, { newTab: e.ctrlKey || e.metaKey })}
        />
      </nav>

      <ScrollArea className="min-h-0 flex-1">
        {/* The custom sections, Pinned and the object types, in `ui.workspaceOrder` (M9). */}
        <WorkspaceSections onOpenTarget={onOpenTarget} objects={objectTypes} />

        <div className="pb-3">
          <button
            type="button"
            onClick={() => onOpenTrash?.()}
            aria-current={trashActive ? 'page' : undefined}
            className={cn(
              'flex h-[36px] w-full items-center gap-2 rounded-lg px-2 text-left text-[15px] font-medium text-fg-muted hover:bg-hover hover:text-fg',
              trashActive && 'bg-hover text-fg',
            )}
          >
            <Icon name="ph-trash" size={16} />
            Trash
          </button>
        </div>
      </ScrollArea>

      <footer className="flex items-center gap-1 py-2 text-fg-muted">
        <button type="button" disabled aria-label="Profile" className="flex size-8 items-center justify-center rounded-md disabled:opacity-60">
          <Icon name="ph-user" size={17} />
        </button>
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
        <button type="button" disabled aria-label="Share" className="ml-auto flex size-8 items-center justify-center rounded-md disabled:opacity-60">
          <Icon name="ph-share-fat" size={17} />
        </button>
      </footer>
    </aside>
  )
}
