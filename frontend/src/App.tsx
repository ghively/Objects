import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/api/client'
import type { SpaceInfo, TypeDef } from '@/api/types'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { TooltipProvider } from '@/components/ui/tooltip'
import { createAndOpen } from '@/create/createAndOpen'
import { NewObjectMenu } from '@/create/NewObjectMenu'
import { AllNotesView } from '@/allnotes/AllNotesView'
import { CalendarPage } from '@/calendar/CalendarPage'
import { CalendarSidePanel } from '@/calendar/CalendarSidePanel'
import { CollectionPage } from '@/collections/CollectionPage'
import { QueriesPage } from '@/queries/QueriesPage'
import { QueryPage } from '@/queries/QueryPage'
import { GraphPage } from '@/graph/GraphPage'
import { LocalGraphPanel } from '@/graph/LocalGraphPanel'
import { LinkPicker } from '@/links/LinkPicker'
import { invalidateLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { setRecentSpace } from '@/nav/recent'
import { canGoBack, canGoForward, currentTarget, setTabsSpace, usePeek, useTabs } from '@/nav/tabs'
import { useDeleteRequest } from '@/object/DeleteObjectDialog'
import { ObjectPage } from '@/object/ObjectPage'
import { ObjectPeek } from '@/object/ObjectPeek'
import { CommandPalette } from '@/palette/CommandPalette'
import { MainPanel } from '@/shell/MainPanel'
import { RightPanel } from '@/shell/RightPanel'
import { Sidebar } from '@/shell/Sidebar'
import { TabStrip, useSpaceTypes } from '@/shell/TabStrip'
import { useTabShortcuts } from '@/shell/shortcuts'
import { isEditableTarget } from '@/lib/shortcuts'
import { applyOpenOnStart } from '@/nav/startup'
import { useSettings } from '@/settings/useSettings'
import { TopBar } from '@/shell/TopBar'
import { TasksPage } from '@/tasks/TasksPage'
import { TrashView } from '@/trash/TrashView'
import { CreateTypeDialog } from '@/types/CreateTypeDialog'
import { DeleteTypeDialog } from '@/types/DeleteTypeDialog'
import { TypePage } from '@/types/TypePage'
import { TypeSettings } from '@/types/TypeSettings'

const REFRESH_DELAY_MS = 150

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

export default function App() {
  const [space, setSpace] = useState<SpaceInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(false)
  const [createTypeOpen, setCreateTypeOpen] = useState(false)
  const [deleting, setDeleting] = useState<TypeDef | null>(null)
  const [newMenuOpen, setNewMenuOpen] = useState(false)
  // Tabs and recent items are stored per space: content waits until this space's tabs are loaded.
  const [tabsReady, setTabsReady] = useState(false)
  const tabs = useTabs()
  const target = tabsReady ? currentTarget(tabs) : null
  useTabShortcuts()

  useEffect(() => {
    let live = true
    api
      .space()
      .then(async (s) => {
        await Promise.all([setTabsSpace(s.root), setRecentSpace(s.root)])
        if (!live) return
        // "When this space opens" (per space, on this device). A settings failure keeps the tabs.
        const settings = useSettings.getState()
        if (!settings.loaded) await settings.load().catch(() => undefined)
        if (!live) return
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
  // colours and resolutions). Bursts of events coalesce into one reload.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = api.onChange((e) => {
      // A file moved (renamed, or retyped into another folder): every tab and the peek follow it.
      if (e.kind === 'renamed' && e.oldPath) useTabs.getState().retarget(e.oldPath, e.path)
      // `types` (a type definition saved) and every file change reload the summaries and types.
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

  const indexLoaded = useLinkIndex((s) => s.loaded)
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
    content = <TypePage key={activeType.id} type={activeType} />
  } else if (target?.kind === 'type' && space) {
    content = <Centered title="Unknown object type" subtitle={target.typeId} />
  } else if (target?.kind === 'typeSettings') {
    content = (
      <TypeSettings
        key={target.typeId}
        typeId={target.typeId}
        onOpenType={(typeId) => tabs.open({ kind: 'type', typeId })}
        onOpenTemplate={(path) => tabs.open({ kind: 'object', path })}
        onDeleted={() => tabs.open({ kind: 'trash' })}
      />
    )
  } else if (target?.kind === 'trash') {
    content = <TrashView />
  } else if (target?.kind === 'collection') {
    content = <CollectionPage key={target.id} id={target.id} />
  } else if (target?.kind === 'query') {
    content = <QueryPage key={target.id} id={target.id} />
  } else if (target?.kind === 'queries') {
    content = <QueriesPage />
  } else if (target?.kind === 'allNotes') {
    content = <AllNotesView />
  } else if (target?.kind === 'calendar') {
    content = (
      <CalendarPage
        rightPanelOpen={rightOpen}
        onToggleRightPanel={() => setRightOpen((v) => !v)}
        onOpenTarget={(t) => tabs.open(t)}
      />
    )
  } else if (target?.kind === 'tasks') {
    content = <TasksPage />
  } else if (target?.kind === 'graph') {
    content = <GraphPage onOpenTarget={(t, o) => tabs.open(t, o)} />
  } else if (!tabsReady) {
    content = null
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
            <ErrorBoundary what="The sidebar">
              <Sidebar
                types={types}
                activeTypeId={activeType?.id}
                onOpenType={(t) => tabs.open({ kind: 'type', typeId: t.id })}
                counts={counts}
                onNew={() => setNewMenuOpen(true)}
                onCreateType={() => setCreateTypeOpen(true)}
                onOpenTypeSettings={(t) => tabs.open({ kind: 'typeSettings', typeId: t.id })}
                onDeleteType={setDeleting}
                onOpenTrash={() => tabs.open({ kind: 'trash' })}
                trashActive={target?.kind === 'trash'}
                onOpenTarget={(t, o) => tabs.open(t, o)}
                queriesActive={target?.kind === 'queries'}
                allNotesActive={target?.kind === 'allNotes'}
                calendarActive={target?.kind === 'calendar'}
                tasksActive={target?.kind === 'tasks'}
                graphActive={target?.kind === 'graph'}
              />
            </ErrorBoundary>
          )}
          <MainPanel
            aside={
              <RightPanel open={rightOpen}>
                {target?.kind === 'calendar' && <CalendarSidePanel />}
                {target?.kind === 'object' && <LocalGraphPanel path={target.path} />}
              </RightPanel>
            }
          >
            <ErrorBoundary what="This page" resetKey={target ? JSON.stringify(target) : ''}>
              {content}
            </ErrorBoundary>
          </MainPanel>
        </div>
        <ObjectPeek />
        <CommandPalette
          onOpenTarget={(t, o) => tabs.open(t, o)}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          onToggleRightPanel={() => setRightOpen((v) => !v)}
          onShowRightPanel={() => setRightOpen(true)}
        />
        <LinkPicker />
        <NewObjectMenu open={newMenuOpen} onOpenChange={setNewMenuOpen} />
        <CreateTypeDialog
          open={createTypeOpen}
          onOpenChange={setCreateTypeOpen}
          onCreated={(t) => tabs.open({ kind: 'typeSettings', typeId: t.id })}
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
