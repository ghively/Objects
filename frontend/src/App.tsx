import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api } from '@/api/client'
import { AiHost } from '@/ai/AiHost'
import type { ChangeKind, ObjectSummary, SpaceInfo, TypeDef } from '@/api/types'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { TooltipProvider } from '@/components/ui/tooltip'
import { newNote, noteTypeId } from '@/create/newNote'
import { NewObjectMenu } from '@/create/NewObjectMenu'
import { AllNotesView } from '@/allnotes/AllNotesView'
import { AgentPage } from '@/agents/AgentPage'
import { CollectionPage } from '@/collections/CollectionPage'
import { QueriesPage } from '@/queries/QueriesPage'
import { QueryPage } from '@/queries/QueryPage'
import { LinkPicker } from '@/links/LinkPicker'
import { ensureLinkIndex, invalidateLinkIndex, refreshLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { forgetSaved, moveUnsaved, setUnsavedSpace, takeRenamedAway } from '@/editor/unsaved'
import { setLastTypeSpace } from '@/create/lastType'
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
import { isDailyNoteType } from '@/object/ObjectHeader'
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
import { isEditableTarget, keysFor, matches, newKeyAllowed } from '@/lib/shortcuts'
import { lazyWithReload } from '@/lib/lazyReload'
import { applyOpenOnStart } from '@/nav/startup'
import { prefetchOnIdle } from '@/nav/prefetch'
import { useSettings } from '@/settings/useSettings'
import { fetchSpace } from '@/settings/useSpaceInfo'
import { TopBar } from '@/shell/TopBar'
import { TrashView } from '@/trash/TrashView'
import { CreateTypeDialog } from '@/types/CreateTypeDialog'
import { DeleteTypeDialog } from '@/types/DeleteTypeDialog'
import { TypePage } from '@/types/TypePage'
import { HomePage } from '@/home/HomePage'
import { TasksHidden } from '@/tasks/TasksHidden'
import { TasksPage, tasksListForWorkView } from '@/tasks/TasksPage'
import { useTasksHidden } from '@/tasks/tasksHidden'
import { WorkPage } from '@/work/page/WorkPage'
import { WorkOverlays } from '@/work/session/WorkOverlays'
import { WorkToasts } from '@/work/state/WorkToasts.tsx'
import { useWorkOn } from '@/work/useWorkOn'

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
const SpaceHistoryPage = lazyWithReload(() => import('@/vcs/SpaceHistoryPage').then((m) => ({ default: m.SpaceHistoryPage })))

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

/**
 * The type the new-note key makes: a Note, as the "New" button does (M32: never the last type
 * made). One exception: on a type's own page, where its notes are listed, it makes one more of
 * that type, as that page's own "New" button does. On a single note's or task's page it makes a
 * Note (the walk's W5: it made a Task on a task's page). A daily note is made by its date, so on
 * the Daily notes page the key makes a Note too.
 */
function currentTypeId(types: TypeDef[]): string {
  const target = currentTarget(useTabs.getState())
  const type = target?.kind === 'type' ? types.find((x) => x.id === target.typeId) : undefined
  return type && !isDailyNoteType(type) ? type.id : noteTypeId(types)
}

interface PageCtx {
  types: TypeDef[]
  space: SpaceInfo | null
  open: (t: Target, o?: OpenOptions) => void
  /** M32: whether the Work page is on for this space (`useWorkOn`). */
  workOn: boolean
  /** M32: "Hide Tasks in this space": the Tasks and Work pages give way to one quiet line. */
  tasksHidden: boolean
}

/** The page a target shows, in the main panel or in a side-panel entry (`open` navigates that place). */
function pageFor(target: Target, { types, space, open, workOn, tasksHidden }: PageCtx): ReactNode {
  switch (target.kind) {
    case 'object':
      // M23: `work: true` (the item panel) shows the work header above the object's page.
      return <ObjectPage path={target.path} workHeader={target.work} />
    case 'type': {
      const type = types.find((t) => t.id === target.typeId)
      if (type) return <TypePage key={type.id} type={type} />
      return space ? <Centered title="Unknown type" subtitle={target.typeId} /> : null
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
      // M32: the plain Tasks page; the dashboard is the Work page (`work`), when it is on.
      return tasksHidden ? <TasksHidden /> : <TasksPage />
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
      // M23's Work page (the dashboard), on its view. M32: only while Work is on for this space;
      // off, a work target (a restored tab, an old link) shows the Tasks page, on the list that
      // stands for the view it named (`{view: 'today'}` → Today, `inbox` → Inbox…). "Hide Tasks
      // in this space" hides Tasks, not Work: with Work on the dashboard stays and leaves its own
      // task lists out (M23's rule, `WorkPage`); with Work off the target is the Tasks page,
      // which the setting hides.
      if (workOn) return <WorkPage view={target.view} />
      return tasksHidden ? <TasksHidden /> : <TasksPage list={tasksListForWorkView(target.view)} />
    case 'spaceHistory':
      // 2026-11-08: the space's git history and "Restore space to this point".
      return (
        <Suspense fallback={null}>
          <SpaceHistoryPage />
        </Suspense>
      )
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
        // Text a closed window kept while its save was still on its way: what the file now holds
        // is forgotten here, so it is not offered as unsaved later (`editor/unsaved.ts`).
        void forgetSaved(async (path) => {
          const d = await api.object(path)
          return { body: d.body, id: d.summary.id ?? null }
        })
        await Promise.all([setTabsSpace(s.root), setRecentSpace(s.root), setLastTypeSpace(s.root), settingsReady])
        if (!live) return
        // A title committed as the last window closed moved its note's file after that page was
        // gone: the tabs it left still name the old path. They follow the note, found by its id.
        void ensureLinkIndex()
          .then(() => {
            for (const [oldPath, path] of takeRenamedAway(useLinkIndex.getState().objects)) {
              useTabs.getState().retarget(oldPath, path)
              moveUnsaved(oldPath, path)
            }
          })
          .catch(() => undefined)
        // "When this space opens" (per space, on this device).
        applyOpenOnStart(useSettings.getState().settings.openOnStart?.[s.root])
        // "Show the sidebar when Object opens" (Appearance); off starts with it collapsed.
        if (useSettings.getState().settings.showSidebarOnStart === false) setSidebarOpen(false)
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
  // M32: the Work page, its toasts and its overlays exist only while Work is on for this space.
  const workOn = useWorkOn()
  // M32: "Hide Tasks in this space" hides the Tasks entry and page (not Work: the dashboard stays).
  const tasksHidden = useTasksHidden()

  // Shortcuts (their keys are in `lib/shortcuts.ts`): the New menu (Ctrl+U, Alt+Shift+N), a new
  // note, or on a type's page one more of that type (Ctrl+N, Alt+N), and Ctrl+Backspace "Delete
  // this …?". A key held down acts once: its repeats are swallowed and make nothing more.
  // M32: the two "new" keys also work with the caret in a note's text or title (`newKeyAllowed`
  // keeps each key's own editing meaning); Delete stays out of editable elements, where
  // Ctrl+Backspace deletes a word.
  const typesRef = useRef(types)
  useLayoutEffect(() => {
    typesRef.current = types
  }, [types])
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      if (matches(e, keysFor('openAddEntityMenu'))) {
        if (!newKeyAllowed('openAddEntityMenu', e)) return
        e.preventDefault()
        if (e.repeat) return
        // What gets made opens in the tab: a note popped out over it steps aside.
        usePeek.getState().close()
        setNewMenuOpen(true)
      } else if (matches(e, keysFor('createNewEntityOfType'))) {
        if (!newKeyAllowed('createNewEntityOfType', e)) return
        e.preventDefault()
        if (e.repeat) return
        usePeek.getState().close()
        void newNote({}, currentTypeId(typesRef.current))
      } else if (matches(e, keysFor('deleteCurrentPage'))) {
        if (isEditableTarget(e.target) || isEditableTarget(document.activeElement)) return
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
    content = pageFor(target, { types, space, open, workOn, tasksHidden })
  } else if (!tabsReady) {
    content = null
  } else {
    // M32: an empty tab (and a first open with nothing to restore) is Home.
    content = <HomePage types={types} />
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
        <Centered title="Graph View" subtitle="Open a note to see its graph." />
      )
    }
    // M8: the backlinks entry follows the tab's current object.
    if (t.kind === 'backlinks') return <BacklinksPanel path={target?.kind === 'object' ? target.path : null} />
    // M10: `SidePanelArea` shows the AI chat itself (it needs the entry).
    if (t.kind === 'aiChat') return null
    return pageFor(t, { types, space, workOn, tasksHidden, open: (x, o) => (o?.newTab ? open(x, o) : nav.open(x, o)) })
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
                onNew={(e) =>
                  void newNote({ ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey }, noteTypeId(types))
                }
                onNewMenu={() => setNewMenuOpen(true)}
                onCreateType={() => setCreateTypeOpen(true)}
                onOpenTypeSettings={(t) => open({ kind: 'typeSettings', typeId: t.id })}
                onDeleteType={setDeleting}
                onOpenTrash={() => open({ kind: 'trash' })}
                trashActive={target?.kind === 'trash'}
                onOpenTarget={(t, o) => open(t, o)}
                queriesActive={target?.kind === 'queries'}
                notesActive={target?.kind === 'allNotes'}
                calendarActive={target?.kind === 'calendar'}
                // A `work` target shows the Tasks page while Work is off (M32).
                tasksActive={target?.kind === 'tasks' || (target?.kind === 'work' && !workOn)}
                graphActive={target?.kind === 'graph'}
                workActive={target?.kind === 'work' && workOn}
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
        {/* M23: the work toasts (problems and Undo) and the focus session / Make it smaller, once.
            M32: only while Work is on for this space ("Hide Tasks" leaves them: it hides Tasks). */}
        {workOn && <WorkToasts />}
        {workOn && <WorkOverlays />}
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
