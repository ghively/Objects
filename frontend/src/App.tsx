import { useEffect, useMemo, useState } from 'react'
import { api } from '@/api/client'
import type { SpaceInfo, TypeDef } from '@/api/types'
import { Icon } from '@/components/Icon'
import { TooltipProvider } from '@/components/ui/tooltip'
import { LinkPicker } from '@/links/LinkPicker'
import { invalidateLinkIndex, stemOf, useLinkIndex } from '@/links/linkIndex'
import { canGoBack, canGoForward, currentTarget, tabTarget, useTabs, type Tab } from '@/nav/tabs'
import { ObjectPage } from '@/object/ObjectPage'
import { ObjectIcon } from '@/object/ObjectHeader'
import { ObjectPeek } from '@/object/ObjectPeek'
import { MainPanel } from '@/shell/MainPanel'
import { RightPanel } from '@/shell/RightPanel'
import { Sidebar, TypeChip } from '@/shell/Sidebar'
import { TopBar } from '@/shell/TopBar'
import { cn } from '@/lib/utils'
import { TypePage } from '@/types/TypePage'

const REFRESH_DELAY_MS = 150

/** The space's types: the link index's (reloaded as files bring new types), else the initial fetch's. */
function useSpaceTypes(space: SpaceInfo | null): TypeDef[] {
  const indexTypes = useLinkIndex((s) => s.types)
  return indexTypes.length > 0 ? indexTypes : (space?.types ?? [])
}

function TabLabel({ tab, space }: { tab: Tab; space: SpaceInfo | null }) {
  const target = tabTarget(tab)
  const objects = useLinkIndex((s) => s.objects)
  const types = useSpaceTypes(space)
  if (!target) return <span className="truncate">New tab</span>
  if (target.kind === 'type') {
    const type = types.find((t) => t.id === target.typeId)
    return (
      <>
        {type && <TypeChip type={type} size={22} />}
        <span className="truncate">{type?.pluralName ?? target.typeId}</span>
      </>
    )
  }
  const summary = objects.find((o) => o.path === target.path)
  const type = types.find((t) => t.id === summary?.type)
  return (
    <>
      {summary?.icon ? <ObjectIcon icon={summary.icon} size={15} /> : type && <TypeChip type={type} size={22} />}
      <span className="truncate">{summary?.title ?? stemOf(target.path)}</span>
    </>
  )
}

function TabStrip({ space }: { space: SpaceInfo | null }) {
  const { tabs, activeId, activate, close } = useTabs()
  return (
    <div role="tablist" aria-label="Tabs" className="flex min-w-0 items-center gap-1 overflow-hidden">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tab"
          aria-selected={tab.id === activeId}
          tabIndex={0}
          onClick={() => activate(tab.id)}
          onAuxClick={(e) => e.button === 1 && close(tab.id)}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && activate(tab.id)}
          className={cn(
            'group flex h-8 max-w-[220px] min-w-0 cursor-default items-center gap-1.5 rounded-lg pr-1 pl-2 text-[15px] font-medium',
            tab.id === activeId ? 'text-fg' : 'text-fg-muted hover:bg-hover',
          )}
        >
          <TabLabel tab={tab} space={space} />
          <button
            type="button"
            aria-label="Close tab"
            onClick={(e) => {
              e.stopPropagation()
              close(tab.id)
            }}
            className="flex size-5 shrink-0 items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-hover-2"
          >
            <Icon name="ph-x" size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}

export default function App() {
  const [space, setSpace] = useState<SpaceInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(false)
  const tabs = useTabs()
  const target = currentTarget(tabs)

  useEffect(() => {
    api
      .space()
      .then((s) => {
        setSpace(s)
        document.title = `${s.name} · Object`
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
    void useLinkIndex.getState().load()
  }, [])

  // Objects created, changed (a title edit) or deleted, on disk or by our own
  // saves: refresh the summaries and types (sidebar, counts, tab labels, link
  // colours and resolutions). Bursts of events coalesce into one reload.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = api.onChange(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        void invalidateLinkIndex()
      }, REFRESH_DELAY_MS)
    })
    return () => {
      if (timer) clearTimeout(timer)
      off()
    }
  }, [])

  const objects = useLinkIndex((s) => s.objects)
  const indexLoaded = useLinkIndex((s) => s.loaded)
  const types = useSpaceTypes(space)
  const counts = useMemo(() => {
    if (!space || (!indexLoaded && objects.length === 0)) return undefined
    const c: Record<string, number> = Object.fromEntries(types.map((t) => [t.id, 0]))
    for (const o of objects) c[o.type] = (c[o.type] ?? 0) + 1
    return c
  }, [space, types, objects, indexLoaded])

  const activeType = target?.kind === 'type' ? types.find((t) => t.id === target.typeId) : undefined

  let content
  if (error) {
    content = (
      <Centered title="Can't reach the Object back end." subtitle={error} />
    )
  } else if (target?.kind === 'object') {
    content = <ObjectPage path={target.path} />
  } else if (target?.kind === 'type' && activeType) {
    content = <TypePage type={activeType} />
  } else if (target?.kind === 'type' && space) {
    content = <Centered title="Unknown object type" subtitle={target.typeId} />
  } else {
    content = <Centered title="Pick an object type" subtitle="Choose a type in the sidebar to see its objects." />
  }

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex h-full flex-col bg-app text-fg">
        <TopBar
          spaceName={space?.name ?? '…'}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          onToggleRightPanel={() => setRightOpen((v) => !v)}
          rightPanelOpen={rightOpen}
          onBack={tabs.back}
          onForward={tabs.forward}
          canGoBack={canGoBack(tabs)}
          canGoForward={canGoForward(tabs)}
          onNewTab={tabs.newTab}
          tabs={<TabStrip space={space} />}
        />
        <div className="flex min-h-0 flex-1">
          {sidebarOpen && (
            <Sidebar
              types={types}
              activeTypeId={activeType?.id}
              onOpenType={(t) => tabs.open({ kind: 'type', typeId: t.id })}
              counts={counts}
            />
          )}
          <MainPanel aside={<RightPanel open={rightOpen} />}>{content}</MainPanel>
        </div>
        <ObjectPeek />
        <LinkPicker />
      </div>
    </TooltipProvider>
  )
}

function Centered({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex h-full items-center justify-center p-8 text-center">
      <div>
        <p className="font-semibold">{title}</p>
        <p className="mt-1 text-fg-muted">{subtitle}</p>
      </div>
    </div>
  )
}
