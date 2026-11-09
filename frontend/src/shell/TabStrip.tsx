/**
 * The tab strip in the top bar (moved out of `App.tsx` in M7). Non-persistent tabs show their title
 * in italic and navigate in place; a double click makes a tab persistent (and back). Pinned tabs
 * sort first and can't be closed: no close button and no "Close tab" item (a pinned tab is
 * never closed, on every path). A context menu pins, unpins and closes; tabs are 60 to 200 px
 * wide with a 5 px gap; scroll buttons appear when the tabs
 * overflow; the "Tab menu" button opens the searchable tab list.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { SpaceInfo, TypeDef } from '@/api/types'
import { Icon, IconOrEmoji } from '@/components/Icon'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuShortcut, ContextMenuTrigger } from '@/components/ui/context-menu'
import { formatKeys, keysFor } from '@/lib/shortcuts'
import { ImportCsvDialog } from '@/types/ImportCsvDialog'
import { canCreateFromMenu, PinTypeItem, TYPE_MENU_TEXT } from './TypeContextMenu'
import { COLLECTION_ICON, QUERY_ICON } from '@/lib/defIcons'
import { cn } from '@/lib/utils'
import { byPathOf, stemOf, useLinkIndex } from '@/links/linkIndex'
import { tabTarget, useTabs, type Tab, type Target } from '@/nav/tabs'
import { ObjectIcon } from '@/object/ObjectHeader'
import { queryTitle } from '@/queries/autoTitle'
import { useTitleCtx } from '@/queries/QueryPage'
import { TypeChip } from '@/shell/Sidebar'
import { TabMenu } from '@/shell/TabMenu'
import { useAgents } from '@/agents/useAgents'
import { useDefinitions } from '@/types/useDefinitions'

/** The space's types: the link index's (reloaded as files bring new types), else the initial fetch's. */
export function useSpaceTypes(space: SpaceInfo | null): TypeDef[] {
  const indexTypes = useLinkIndex((s) => s.types)
  return indexTypes.length > 0 ? indexTypes : (space?.types ?? [])
}

/** Title of a target as tabs, crumbs and the tab menu show it. */
export function useTargetTitle(space: SpaceInfo | null): (target: Target | null) => string {
  const byPath = useLinkIndex((s) => byPathOf(s.objects))
  const types = useSpaceTypes(space)
  const { collections, queries } = useDefinitions()
  const titleCtx = useTitleCtx(types)
  const agents = useAgents((s) => s.agents)
  return useCallback(
    (target: Target | null): string => {
      if (!target) return 'New tab'
      switch (target.kind) {
        case 'collection':
          return collections.find((x) => x.id === target.id)?.name ?? target.id
        case 'query': {
          const q = queries.find((x) => x.id === target.id)
          return (q && queryTitle(q, titleCtx)) || 'Query'
        }
        case 'queries':
          return 'Queries'
        case 'allNotes':
          return 'All notes'
        case 'calendar':
          return 'Calendar'
        case 'tasks':
          return 'Tasks'
        case 'graph':
          return 'Graph'
        case 'search':
          return 'Search'
        case 'trash':
          return 'Trash'
        case 'type':
        case 'typeSettings': {
          const type = types.find((t) => t.id === target.typeId)
          if (!type) return target.typeId
          return target.kind === 'type' ? type.pluralName : `${type.name} settings`
        }
        case 'object':
          return byPath.get(target.path)?.title ?? stemOf(target.path)
        case 'agent':
          return agents.find((a) => a.id === target.id)?.name ?? 'Agent'
        case 'work':
          return 'Tasks'
        case 'spaceHistory':
          return 'Space history'
      }
    },
    [byPath, types, collections, queries, titleCtx, agents],
  )
}

/** A target's icon and title (tabs, breadcrumbs, the tab menu). */
export function TargetLabel({ target, space }: { target: Target | null; space: SpaceInfo | null }) {
  const byPath = useLinkIndex((s) => byPathOf(s.objects))
  const types = useSpaceTypes(space)
  const { collections, queries } = useDefinitions()
  const title = useTargetTitle(space)(target)
  let icon = null
  if (target?.kind === 'collection') {
    icon = <IconOrEmoji icon={collections.find((x) => x.id === target.id)?.icon} size={15} fallback={COLLECTION_ICON} />
  } else if (target?.kind === 'query') {
    icon = <IconOrEmoji icon={queries.find((x) => x.id === target.id)?.icon} size={15} fallback={QUERY_ICON} />
  } else if (target?.kind === 'queries') {
    icon = <Icon name={QUERY_ICON} size={15} />
  } else if (target?.kind === 'allNotes') {
    icon = <Icon name="ph-note" size={15} />
  } else if (target?.kind === 'calendar') {
    icon = <Icon name="ph-calendar-blank" size={15} />
  } else if (target?.kind === 'tasks') {
    icon = <Icon name="ph-check-circle" size={15} />
  } else if (target?.kind === 'graph') {
    icon = <Icon name="ph-graph" size={15} />
  } else if (target?.kind === 'search') {
    icon = <Icon name="ph-magnifying-glass" size={15} />
  } else if (target?.kind === 'trash') {
    icon = <Icon name="ph-trash" size={15} />
  } else if (target?.kind === 'work') {
    icon = <Icon name="ph-check-circle" size={15} />
  } else if (target?.kind === 'spaceHistory') {
    icon = <Icon name="ph-clock-counter-clockwise" size={15} />
  } else if (target?.kind === 'type' || target?.kind === 'typeSettings') {
    const type = types.find((t) => t.id === target.typeId)
    icon = type ? <TypeChip type={type} size={22} /> : null
  } else if (target?.kind === 'object') {
    const summary = byPath.get(target.path)
    const type = types.find((t) => t.id === summary?.type)
    icon = summary?.icon ? <ObjectIcon icon={summary.icon} size={15} /> : type ? <TypeChip type={type} size={22} /> : null
  }
  return (
    <>
      {icon}
      <span className="truncate">{title}</span>
    </>
  )
}

export function TabLabel({ tab, space }: { tab: Tab; space: SpaceInfo | null }) {
  return <TargetLabel target={tabTarget(tab)} space={space} />
}

const SCROLL_STEP = 200

function ScrollButton({ label, icon, onClick }: { label: string; icon: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-7 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
    >
      <Icon name={icon} size={14} />
    </button>
  )
}

const IMPORT_TEXT = 'Import'

/** "Ctrl I" beside Import, as the object menu draws its keys. */
function ImportKeys() {
  const keys = keysFor('openImportMenu')
  if (!keys.length) return null
  return <ContextMenuShortcut>{formatKeys(keys[0]).split('+').join(' ')}</ContextMenuShortcut>
}

function TabItem({ tab, active, space }: { tab: Tab; active: boolean; space: SpaceInfo | null }) {
  const { activate, close, togglePersistent, pin, unpin } = useTabs.getState()
  const types = useSpaceTypes(space)
  const target = tabTarget(tab)
  const tabType = target?.kind === 'type' ? types.find((t) => t.id === target.typeId) : undefined
  const [importFor, setImportFor] = useState<TypeDef | null>(null)
  return (
    <>
    {importFor && <ImportCsvDialog type={importFor} open onOpenChange={(o) => !o && setImportFor(null)} />}
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="tab"
          aria-selected={active}
          data-persistent={tab.persistent ? '' : undefined}
          data-pinned={tab.pinned ? '' : undefined}
          tabIndex={0}
          title={tab.persistent ? undefined : 'Double-click to keep this tab open.'}
          onClick={() => activate(tab.id)}
          onDoubleClick={() => togglePersistent(tab.id)}
          onAuxClick={(e) => e.button === 1 && !tab.pinned && close(tab.id)}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && activate(tab.id)}
          className={cn(
            'group flex h-8 max-w-[200px] min-w-[60px] shrink cursor-default items-center gap-1.5 rounded-lg pr-1 pl-2 text-[15px] font-medium select-none',
            !tab.persistent && 'italic',
            tab.pinned && 'pr-2',
            active ? 'text-fg' : 'text-fg-muted hover:bg-hover',
          )}
        >
          <TabLabel tab={tab} space={space} />
          {!tab.pinned && (
            <button
              type="button"
              aria-label="Close tab"
              title="Close tab"
              onClick={(e) => {
                e.stopPropagation()
                close(tab.id)
              }}
              onDoubleClick={(e) => e.stopPropagation()}
              className="ml-auto flex size-5 shrink-0 items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-hover-2"
            >
              <Icon name="ph-x" size={12} />
            </button>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="border-line bg-raised text-fg">
        {/* A type tab: Pin to sidebar, Pin tab, Object type settings, Import (Ctrl I). */}
        {tabType && <PinTypeItem type={tabType} />}
        {tab.pinned ? (
          <ContextMenuItem onSelect={() => unpin(tab.id)}>
            <Icon name="ph-push-pin-slash" size={15} />
            Unpin tab
          </ContextMenuItem>
        ) : (
          <ContextMenuItem onSelect={() => pin(tab.id)}>
            <Icon name="ph-push-pin" size={15} />
            Pin tab
          </ContextMenuItem>
        )}
        {tabType && (
          <>
            <ContextMenuItem onSelect={() => useTabs.getState().open({ kind: 'typeSettings', typeId: tabType.id })}>
              <Icon name="ph-gear" size={15} />
              {TYPE_MENU_TEXT.settings}
            </ContextMenuItem>
            {canCreateFromMenu(tabType) && (
              <ContextMenuItem onSelect={() => setImportFor(tabType)}>
                <Icon name="ph-download-simple" size={15} />
                {IMPORT_TEXT}
                <ImportKeys />
              </ContextMenuItem>
            )}
          </>
        )}
        {!tab.pinned && (
          <ContextMenuItem onSelect={() => close(tab.id)}>
            <Icon name="ph-x" size={15} />
            Close tab
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
    </>
  )
}

export function TabStrip({ space }: { space: SpaceInfo | null }) {
  const tabs = useTabs((s) => s.tabs)
  const activeId = useTabs((s) => s.activeId)
  const listRef = useRef<HTMLDivElement>(null)
  const [overflow, setOverflow] = useState({ left: false, right: false })

  const measure = useCallback(() => {
    const el = listRef.current
    if (!el) return
    const left = el.scrollLeft > 0
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
    setOverflow((o) => (o.left === left && o.right === right ? o : { left, right }))
  }, [])

  useLayoutEffect(measure, [measure, tabs])
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [measure])

  // Keep the active tab in view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [activeId])

  const scroll = (dir: number) => {
    const el = listRef.current
    if (!el) return
    if (typeof el.scrollBy === 'function') el.scrollBy({ left: dir * SCROLL_STEP, behavior: 'smooth' })
    else el.scrollLeft += dir * SCROLL_STEP
    measure()
  }

  return (
    <div className="flex min-w-0 items-center gap-0.5">
      {(overflow.left || overflow.right) && (
        <ScrollButton label="Scroll tab list left" icon="ph-caret-left" onClick={() => scroll(-1)} />
      )}
      <div
        ref={listRef}
        role="tablist"
        aria-label="Tabs"
        onScroll={measure}
        className="flex min-w-0 items-center gap-[5px] overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((tab) => (
          <TabItem key={tab.id} tab={tab} active={tab.id === activeId} space={space} />
        ))}
      </div>
      {(overflow.left || overflow.right) && (
        <ScrollButton label="Scroll tab list right" icon="ph-caret-right" onClick={() => scroll(1)} />
      )}
      <TabMenu space={space} />
    </div>
  )
}
