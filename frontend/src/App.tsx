import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api } from '@/api/client'
import { AiHost } from '@/ai/AiHost'
import type { ChangeKind, ObjectSummary, SpaceInfo, TypeDef } from '@/api/types'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { TooltipProvider } from '@/components/ui/tooltip'
import { createAndOpen } from '@/create/createAndOpen'
import { NewObjectMenu } from '@/create/NewObjectMenu'
import { AllNotesView } from '@/allnotes/AllNotesView'
import { AgentPage } from '@/agents/AgentPage'
import { CollectionPage } from '@/collections/CollectionPage'
import { QueriesPage } from '@/queries/QueriesPage'
import { QueryPage } from '@/queries/QueryPage'
import { LinkPicker } from '@/links/LinkPicker'
import { invalidateLinkIndex, refreshLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { moveUnsaved, setUnsavedSpace } from '@/editor/unsaved'
import { setRecentSpace } from '@/nav/recent'
import { isSidepanelShown } from '@/nav/sidepanel'
import {
  activeTab,
  canGoBack,
  canGoForward,
  currentTarget,
  setTabsSpace,
  usePeek,
  useTabs,
  type OpenOptions,
  type SidepanelTarget,
  type Target,
} from '@/nav/tabs'
import { useDeleteRequest } from '@/object/DeleteObjectDialog'
import { ObjectPage } from '@/object/ObjectPage'
import { ObjectPeek } from '@/object/ObjectPeek'
import { BacklinksPanel } from '@/references/BacklinksPanel'
import { SearchPage } from '@/search/SearchPage'
import { CommandPalette } from '@/palette/CommandPalette'
import { Breadcrumbs } from '@/shell/Breadcrumbs'
import { MainPanel } from '@/shell/MainPanel'
import { SidePanel } from '@/shell/SidePanel'
import { Sidebar } from '@/shell/Sidebar'
import { TabStrip, useSpaceTypes } from '@/shell/TabStrip'
import { usePanelShortcuts, useTabShortcuts } from '@/shell/shortcuts'
import { isEditableTarget } from '@/lib/shortcuts'
import { lazyWithReload } from '@/lib/lazyReload'
import { applyOpenOnStart } from '@/nav/startup'
import { prefetchOnIdle } from '@/nav/prefetch'
import { useSettings } from '@/settings/useSettings'
import { fetchSpace } from '@/settings/useSpaceInfo'
import { TopBar } from '@/shell/TopBar'
import { TasksPage } from '@/tasks/TasksPage'
import { TrashView } from '@/trash/TrashView'
import { CreateTypeDialog } from '@/types/CreateTypeDialog'
import { DeleteTypeDialog } from '@/types/DeleteTypeDialog'
import { TypePage } from '@/types/TypePage'
import { WorkPage } from '@/work/page/WorkPage'
import { WorkOverlays } from '@/work/session/WorkOverlays'
import { WorkToasts } from '@/work/state/WorkToasts.tsx'

// Pages whose code the shell does not need at start (the graph's sigma and graphology, the
// calendar, type settings) load when first shown (audit 2026-11-01 F1).
const loadCalendarPage = () => import('@/calendar/CalendarPage')
const loadGraphPage = () => import('@/graph/GraphPage')
const loadLocalGraphPanel = () => import('@/graph/LocalGraphPanel')
// A chunk that fails to load (the app was rebuilt while this window was open) reloads the window
// once (lazyWithReload); the idle prefetch below stays silent and leaves that to the real open.
const CalendarPage = lazyWithReload(() => loadCalendarPage().then((m) => ({ default: m.CalendarPage })))
const GraphPage = lazyWithReload(() => loadGraphPage().then((m) => ({ default: m.GraphPage })))
const LocalGraphPanel = lazyWithReload(() => loadLocalGraphPanel().then((m) => ({ default: m.LocalGraphPanel })))
// Warm those chunks once the shell is idle, so their first open costs no download.
const PREFETCH = [loadGraphPage, loadLocalGraphPanel, loadCalendarPage]
const TypeSettings = lazyWithReload(() => import('@/types/TypeSettings').then((m) => ({ default: m.TypeSettings })))

const REFRESH_DELAY_MS = 150
/** Events after which the whole object list and the types are fetched again (a `changed` refreshes one summary). */
const RELOAD_INDEX_KINDS = new Set<ChangeKind>(['created', 'deleted', 'renamed', 'types'])

let lastCounts: Record<string, number> | undefined
/**
 * Objects per type id, as a store selector: the same object while the numbers are the same, so a
 * refreshed summary (a new `objects` array, one body save) re-renders neither the shell nor the
 * sidebar. Undefined until the index has answered once.
 */
function countsByType(s: { objects: ObjectSummary[]; loaded: boolean }): Record<string, number> | undefined {
  if (!s.loaded && s.objects.length === 0) return undefined
  const c: Record<string, number> = {}
  for (const o of s.objects) c[o.type] = (c[o.type] ?? 0) + 1
  const prev = lastCounts
  const keys = Object.keys(c)
  if (prev && keys.length === Object.keys(prev).length && keys.every((k) => prev[k] === c[k])) return prev
  lastCounts = c
  return c
}

/** Inputs, text areas, selects, contenteditable (the body editor) and CodeMirror (raw mode). */
export { isEditableTarget }

/** The type Ctrl+N creates: the open type, else the open object's type, else Page. */
function currentTypeId(types: TypeDef[]): string {
  const target = currentTarget(useTabs.getState())
  if (target?.kind === 'type' || target?.kind === 'typeSettings') return target.typeId
  if (target?.kind === 'object') {
    const t = useLinkIndex.getState().objects.find((o) => o.path === target.path)?.type
    if (t && types.some((x) => x.id === t)) return t
  }
  return types.find((t) => t.name.toLowerCase() === 'page')?.id ?? 'page'
}

interface PageCtx {
  types: TypeDef[]
  space: SpaceInfo | null
  open: (t: Target, o?: OpenOptions) => void
}

/** The page a target shows, in the main panel or in a side-panel entry (`open` navigates that place). */
function pageFor(target: Target, { types, space, open }: PageCtx): ReactNode {
  switch (target.kind) {
    case 'object':
      // M23: `work: true` (the item panel) shows the work header above the object's page.
      return <ObjectPage path={target.path} workHeader={target.work} />
    case 'type': {
      const type = types.find((t) => t.id === target.typeId)
      if (type) return <TypePage key={type.id} type={type} />
      return space ? <Centered title="Unknown object type" subtitle={target.typeId} /> : null
    }
    case 'typeSettings':
      return (
        <Suspense fallback={null}>
          <TypeSettings
            key={target.typeId}
            typeId={target.typeId}
            onOpenType={(typeId) => open({ kind: 'type', typeId })}
            onOpenTemplate={(path) => open({ kind: 'object', path })}
            onDeleted={() => open({ kind: 'trash' })}
          />
        </Suspense>
      )
    case 'trash':
      return <TrashView />
    case 'collection':
      return <CollectionPage key={target.id} id={target.id} />
    case 'query':
      return <QueryPage key={target.id} id={target.id} />
    case 'queries':
      return <QueriesPage />
    case 'allNotes':
      return <AllNotesView />
    case 'calendar':
      return (
        <Suspense fallback={null}>
          <CalendarPage onOpenTarget={(t) => open(t)} />
        </Suspense>
      )
    case 'tasks':
      return <TasksPage />
    case 'graph':
      return (
        <Suspense fallback={null}>
          <GraphPage onOpenTarget={(t, o) => open(t, o)} />
        </Suspense>
      )
    case 'search':
      // M8: the extended search page; a new query or toggle remounts it with what was typed.
      return <SearchPage key={`${target.q ?? ''}|${target.textOnly ? 1 : 0}`} q={target.q} textOnly={target.textOnly} />
    case 'agent':
      // M17: the agent page (Profile, Instructions, Tools, Chats).
      return <AgentPage key={target.id} id={target.id} tab={target.tab} />
    case 'work':
      // M23: the Work section's page, on its view.
      return <WorkPage view={target.view} />
  }
}

export default function App() {
  const [space, setSpace] = useState<SpaceInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [createTypeOpen, setCreateTypeOpen] = useState(false)
  const [deleting, setDeleting] = useState<TypeDef | null>(null)
  const [newMenuOpen, setNewMenuOpen] = useState(false)
  // Tabs and recent items are stored per space: content waits until this space's tabs are loaded.
  const [tabsReady, setTabsReady] = useState(false)
  // Individual selectors, not the whole tabs store: a navigation or history push in some other
  // tab must not re-render the shell. The actions are stable, read once.
  const current = useTabs(currentTarget)
  const target = tabsReady ? current : null
  const panelShown = useTabs((s) => isSidepanelShown(activeTab(s)))
  const backable = useTabs(canGoBack)
  const forwardable = useTabs(canGoForward)
  const { open, toggleSidepanel, back, forward, newTab, openInSidepanel } = useTabs.getState()
  useTabShortcuts()
  usePanelShortcuts({ toggleLeftSidebar: () => setSidebarOpen((v) => !v) })
  const sidepanelShown = tabsReady && panelShown

  useEffect(() => prefetchOnIdle(PREFETCH), [])

  useEffect(() => {
    let live = true
    // The device settings don't depend on the space: fetched alongside it, not after it. A
    // settings failure keeps the tabs. `fetchSpace` is one request shared with the link index.
    const settings = useSettings.getState()
    const settingsReady = settings.loaded ? Promise.resolve() : settings.load().catch(() => undefined)
    fetchSpace()
      .then(async (s) => {
        setUnsavedSpace(s.root)
        await Promise.all([setTabsSpace(s.root), setRecentSpace(s.root), settingsReady])
        if (!live) return
        // "When this space opens" (per space, on this device).
        applyOpenOnStart(useSettings.getState().settings.openOnStart?.[s.root])
        setSpace(s)
        setTabsReady(true)
        document.title = `${s.name} · Object`
      })
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)))
    void useLinkIndex.getState().load()
    return () => {
      live = false
    }
  }, [])

  // Objects created, changed (a title edit) or deleted, on disk or by our own
  // saves: refresh the summaries and types (sidebar, counts, tab labels, link
  // colours and resolutions). Bursts of events coalesce into one refresh: the
  // changed objects' summaries alone, or the whole list when the set of objects
  // or a type changed.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let full = false
    const changedPaths = new Set<string>()
    const off = api.onChange((e) => {
      // A file moved (renamed, or retyped into another folder): every tab and the peek follow it.
      if (e.kind === 'renamed' && e.oldPath) {
        useTabs.getState().retarget(e.oldPath, e.path)
        // Text kept unsaved under the old path (`editor/unsaved.ts`) is offered at the new one.
        moveUnsaved(e.oldPath, e.path)
      }
      if (e.kind === 'changed') changedPaths.add(e.path)
      else if (RELOAD_INDEX_KINDS.has(e.kind)) full = true
      else return // ui, collections, queries, views, whiteboard: not the index's business
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        const paths = [...changedPaths]
        changedPaths.clear()
        if (full) {
          full = false
          void invalidateLinkIndex()
        } else void refreshLinkIndex(paths)
      }, REFRESH_DELAY_MS)
    })
    return () => {
      if (timer) clearTimeout(timer)
      off()
    }
  }, [])

  const types = useSpaceTypes(space)

  // Shortcuts, only when focus is not in an editable element (there Ctrl+Backspace deletes a word):
  // Ctrl+U "+ New" menu, Ctrl+N a new object of the current type, Ctrl+Backspace "Delete this object?".
  const typesRef = useRef(types)
  useLayoutEffect(() => {
    typesRef.current = types
  }, [types])
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return
      if (isEditableTarget(e.target) || isEditableTarget(document.activeElement)) return
      const key = e.key.toLowerCase()
      if (key === 'u') {
        e.preventDefault()
        setNewMenuOpen(true)
      } else if (key === 'n') {
        e.preventDefault()
        void createAndOpen(currentTypeId(typesRef.current)).catch((err: unknown) =>
          console.warn('Could not create an object:', err),
        )
      } else if (key === 'backspace') {
        const peekPath = usePeek.getState().path
        const target = currentTarget(useTabs.getState())
        const path = peekPath ?? (target?.kind === 'object' ? target.path : null)
        if (!path) return
        e.preventDefault()
        useDeleteRequest.getState().requestDelete(path, peekPath ? 'peek' : 'page')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const objectCounts = useLinkIndex(countsByType)
  const counts = useMemo(() => {
    if (!space || !objectCounts) return undefined
    const c: Record<string, number> = Object.fromEntries(types.map((t) => [t.id, 0]))
    return { ...c, ...objectCounts }
  }, [space, types, objectCounts])

  const activeType = target?.kind === 'type' ? types.find((t) => t.id === target.typeId) : undefined

  let content
  if (error) {
    content = <Centered title="Can't reach the Object back end." subtitle={error} />
  } else if (target) {
    content = pageFor(target, { types, space, open })
  } else if (!tabsReady) {
    content = null
  } else {
    content = <Centered title="Pick an object type" subtitle="Choose a type in the sidebar to see its objects." />
  }

  // A side-panel entry: M5's local graph follows the tab's current object; links in a page open
  // into the entry, and a new-tab open still makes a tab.
  const renderSidepanel = (t: SidepanelTarget, nav: { open(t: Target, o?: OpenOptions): void }): ReactNode => {
    if (t.kind === 'localGraph') {
      return target?.kind === 'object' ? (
        <Suspense fallback={null}>
          <LocalGraphPanel path={target.path} />
        </Suspense>
      ) : (
        <Centered title="Graph View" subtitle="Open an object to see its graph." />
      )
    }
    // M8: the backlinks entry follows the tab's current object.
    if (t.kind === 'backlinks') return <BacklinksPanel path={target?.kind === 'object' ? target.path : null} />
    // M10: `SidePanelArea` shows the AI chat itself (it needs the entry).
    if (t.kind === 'aiChat') return null
    return pageFor(t, { types, space, open: (x, o) => (o?.newTab ? open(x, o) : nav.open(x, o)) })
  }

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex h-full flex-col bg-app text-fg">
        <TopBar
          spaceName={space?.name ?? '…'}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          onToggleRightPanel={toggleSidepanel}
          rightPanelOpen={sidepanelShown}
          onBack={back}
          onForward={forward}
          canGoBack={backable}
          canGoForward={forwardable}
          onNewTab={newTab}
          tabs={<TabStrip space={space} />}
        />
        <div className="flex min-h-0 flex-1">
          {sidebarOpen && (
            <ErrorBoundary what="The sidebar">
              <Sidebar
                types={types}
                activeTypeId={activeType?.id}
                onOpenType={(t) => open({ kind: 'type', typeId: t.id })}
                counts={counts}
                onNew={() => setNewMenuOpen(true)}
                onCreateType={() => setCreateTypeOpen(true)}
                onOpenTypeSettings={(t) => open({ kind: 'typeSettings', typeId: t.id })}
                onDeleteType={setDeleting}
                onOpenTrash={() => open({ kind: 'trash' })}
                trashActive={target?.kind === 'trash'}
                onOpenTarget={(t, o) => open(t, o)}
                queriesActive={target?.kind === 'queries'}
                allNotesActive={target?.kind === 'allNotes'}
                calendarActive={target?.kind === 'calendar'}
                tasksActive={target?.kind === 'tasks'}
                graphActive={target?.kind === 'graph'}
                workActive={target?.kind === 'work'}
                activeCollectionId={target?.kind === 'collection' ? target.id : null}
              />
            </ErrorBoundary>
          )}
          <MainPanel aside={tabsReady && <SidePanel space={space} renderTarget={renderSidepanel} />}>
            <div className="flex h-full min-h-0 flex-col">
              <Breadcrumbs space={space} />
              <div className="min-h-0 flex-1">
                <ErrorBoundary what="This page" resetKey={target ? JSON.stringify(target) : ''}>
                  {content}
                </ErrorBoundary>
              </div>
            </div>
          </MainPanel>
        </div>
        <ObjectPeek />
        <AiHost />
        <CommandPalette
          onOpenTarget={(t, o) => open(t, o)}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          onToggleRightPanel={toggleSidepanel}
          onShowRightPanel={() => openInSidepanel({ kind: 'localGraph' })}
        />
        <LinkPicker />
        {/* M23: the work toasts (problems and Undo) and the focus session / Make it smaller, once. */}
        <WorkToasts />
        <WorkOverlays />
        <NewObjectMenu open={newMenuOpen} onOpenChange={setNewMenuOpen} />
        <CreateTypeDialog
          open={createTypeOpen}
          onOpenChange={setCreateTypeOpen}
          onCreated={(t) => open({ kind: 'typeSettings', typeId: t.id })}
        />
        {deleting && (
          <DeleteTypeDialog
            type={deleting}
            open
            onOpenChange={(o) => !o && setDeleting(null)}
            onDeleted={() => setDeleting(null)}
          />
        )}
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
