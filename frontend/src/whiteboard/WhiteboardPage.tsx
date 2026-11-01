/**
 * A whiteboard object, as a page or in the peek: always full width (Capacities' `wideLayoutMode`,
 * "The canvas owns the page"). The canvas with the title overlay top left, the toolbox bottom
 * centre (with the ink plugin's pen group), the zoom menu bottom right, the selection toolbar
 * over the selection, the read-only banner, the delete flow as `ObjectView` has it and
 * "Clear Whiteboard" (board and ink, one undo step).
 * M8: the board menu's "Export as PNG" (and "Export selection as PNG") call the canvas's exporter;
 * its "Version History" opens the Version History dialog on the board.
 * M8 (Task 23): the floating inspector (top right; "Outline", "Frames", "Stats", "Pin"), "Play"
 * (the toolbox) presenting the frames in reading order, and the board's "Notes" under the canvas:
 * M1's body editor on the board's `.md` body, collapsed by default (our choice). Opening the
 * notes never writes; only an edit saves the body (revision-checked like any body save).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { NodeToolbar, Panel } from '@xyflow/react'
import { api, ConflictError, isResync } from '@/api/client'
import type { ObjectDetail } from '@/api/types'
import { whiteboardApi, type WhiteboardApi } from '@/api/whiteboardClient'
import type { MdStamp, WhiteboardBoardToolMemory, WhiteboardSaveResult } from '@/api/whiteboardTypes'
import { Icon } from '@/components/Icon'
import { invalidateLinkIndex, stemOf } from '@/links/linkIndex'
import { canGoBack, useTabs } from '@/nav/tabs'
import { Editor } from '@/editor/Editor'
import { useVersionHistory } from '@/history/useVersionHistory'
import type { BodyEditorHandle } from '@/editor/useAutosave'
import { DeleteObjectDialog, useDeleteRequest } from '@/object/DeleteObjectDialog'
import { DeletedBanner } from '@/object/DeletedBanner'
import { BoardHeader } from './BoardHeader'
import type { BoardExporter, CanvasControls } from './WhiteboardCanvas'
import { WhiteboardCanvas } from './WhiteboardCanvas'
import { BoardMenu, SelectionToolbar, Toolbox, ZoomMenu } from './chrome'
import { BoardPresentation } from './chrome/BoardPresentation'
import { FloatingInspector, loadInspectorPinned, saveInspectorPinned } from './chrome/FloatingInspector'
import { presentationSlides, setFrameOrder } from './readingOrder'
import { defaultHost, WhiteboardHostContext, type WhiteboardHost } from './host'
import { isCircuitLabel, resolveLastUsedTool } from './model'
import type { InkDoc, InkPlugin, InkStroke } from './plugin'
import { BoardStoreContext, isEditable, useBoardState } from './store'
import { WB } from './strings'
import { loadToolMemory, saveToolMemory } from './toolMemory'
import { useBoard } from './useBoard'
import { useWhiteboardSettings, type WhiteboardSettingsState } from './useWhiteboardSettings'

/** How long the "Changed elsewhere. Reloaded." toast stays (our choice). */
export const TOAST_MS = 4000

export interface WhiteboardPageProps {
  path: string
  mode: 'page' | 'peek'
  ink?: InkPlugin
  host?: WhiteboardHost
  /** The peek's expand-to-page action. */
  onExpand?(): void
  /** Close (the peek). */
  onDismiss?(): void
  /** The peek's pager. */
  footer?: ReactNode
  /** The whiteboard routes (tests inject a mock). */
  client?: WhiteboardApi
}

const NO_INK: InkDoc = { strokes: [], readOnlyReason: null, save() {}, async flush() {} }
function useNoInkDoc(_path: string): InkDoc {
  return NO_INK
}

export function WhiteboardPage({
  path,
  mode,
  ink,
  host = defaultHost,
  onExpand,
  onDismiss,
  footer,
  client = whiteboardApi,
}: WhiteboardPageProps) {
  const [storeOptions] = useState(() => {
    const memory = loadToolMemory(path)
    return {
      memory,
      tool: resolveLastUsedTool(memory.lastUsedTool, true),
      onMemory: (m: WhiteboardBoardToolMemory) => saveToolMemory(path, m),
    }
  })
  // M9: a board save also stamps the .md's `lastUpdated`; the Notes adopt the `mdVersion` it
  // answers when they hold its `mdBaseVersion` (see `adoptMdVersion`), so their next body save
  // doesn't meet a 409.
  const mdVersionRef = useRef<(res: MdStamp) => void>(() => {})
  const boardClient = useMemo<WhiteboardApi>(
    () => ({
      ...client,
      async saveBoard(p, b, base) {
        const res: WhiteboardSaveResult = await client.saveBoard(p, b, base)
        mdVersionRef.current(res)
        return res
      },
    }),
    [client],
  )
  const { store, status, error, toast, dismissToast, flush } = useBoard(path, boardClient, storeOptions)
  const exportRef = useRef<BoardExporter | null>(null)
  const settingsState = useWhiteboardSettings(client)
  const useInk = ink?.useInkDoc ?? useNoInkDoc
  // An ink save stamps the .md too: the same guarded adopt as a board save's.
  const onInkStamp = useCallback((res: MdStamp) => mdVersionRef.current(res), [])
  const inkDoc = useInk(path, onInkStamp)
  const inkRef = useRef(inkDoc)
  useEffect(() => {
    inkRef.current = inkDoc
  })

  // ---- ink: the ink file feeds the store's strokes; stroke edits go back to the ink doc ----
  // While the ink file is read-only, no store edit (clear, undo, redo, ink select) may change the
  // strokes, or the store would diverge from the file (the ink doc ignores the change).
  const inkReadOnly = !!inkDoc.readOnlyReason
  useEffect(() => {
    store.getState().canvas.setInkReadOnly(inkReadOnly)
  }, [inkReadOnly, store])
  const sentRef = useRef<InkStroke[] | null>(null)
  useEffect(() => {
    const strokes = inkDoc.strokes
    if (!ink || strokes === null || strokes === sentRef.current) return
    if (strokes === store.getState().doc.strokes) return
    store.getState().canvas.loadStrokes(strokes)
  }, [ink, inkDoc.strokes, store])
  useEffect(
    () =>
      store.subscribe((s, prev) => {
        if (s.strokesSeq === prev.strokesSeq) return
        sentRef.current = s.doc.strokes as InkStroke[]
        inkRef.current.save(sentRef.current)
      }),
    [store],
  )

  // Gates need Engineering mode: a remembered gate falls back to Move without it.
  const engineering = settingsState.settings.isEngineeringMode
  useEffect(() => {
    if (!settingsState.loaded || engineering) return
    if (isCircuitLabel(store.getState().tool)) store.getState().actions.setTool('select')
  }, [settingsState.loaded, engineering, store])

  // ---- title and version of the .md (rename, delete) ----
  const [title, setTitle] = useState(() => stemOf(path))
  const versionRef = useRef('')
  const [hasDetail, setHasDetail] = useState(false)
  const [deleted, setDeleted] = useState(false)
  const deletedRef = useRef(false)
  const [trashId, setTrashId] = useState<string | null>(null)
  const [undoError, setUndoError] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  // ---- the board's Notes (the .md body) ----
  const [notes, setNotes] = useState<{ body: string; version: string } | null>(null)
  const [notesOpen, setNotesOpen] = useState(false)
  const [notesToast, setNotesToast] = useState<string | null>(null)
  const notesRef = useRef<BodyEditorHandle | null>(null)

  // Bumped by every local change of the `.md` (a Notes save, an adopted stamp, a rename, a
  // conflict reload) and every detail request: an answer to a request older than either is stale
  // (a GET ordered before a Notes save that has since landed) and must not replace newer state.
  const localSeqRef = useRef(0)
  const detailSeqRef = useRef(0)
  const loadDetail = useCallback(async () => {
    const run = async (again: boolean): Promise<void> => {
      const seq = ++detailSeqRef.current
      const local = localSeqRef.current
      try {
        const d = await api.object(path)
        setHasDetail(true)
        if (seq !== detailSeqRef.current) return
        // Older than a local change of the `.md`: ask once more, so a change made elsewhere
        // (a new title) shows now instead of waiting for the next event.
        if (local !== localSeqRef.current) return again ? undefined : run(true)
        apply(d)
      } catch {
        /* the board still opens; rename and delete wait for the title */
      }
    }
    const apply = (d: ObjectDetail) => {
      versionRef.current = d.version
      setTitle(d.summary.title)
      // Notes with unsaved edits keep them when the body changed on disk; their next save
      // meets the revision check and `onNotesConflict` settles it.
      const h = notesRef.current
      if (!(h && h.isDirty() && d.body !== h.savedBody())) setNotes({ body: d.body, version: d.version })
    }
    return run(false)
  }, [path])

  useEffect(() => {
    void loadDetail()
  }, [loadDetail])

  useEffect(
    () =>
      api.onChange((e) => {
        if (isResync(e, 'types')) {
          void loadDetail() // the stream reconnected: the title and notes may have changed meanwhile
          return
        }
        if (e.path !== path) return
        if (e.kind === 'deleted') {
          deletedRef.current = true
          setDeleted(true)
          return
        }
        if (e.kind === 'created') {
          deletedRef.current = false
          setDeleted(false)
          setTrashId(null)
        }
        if (e.kind === 'changed' || e.kind === 'created') {
          if (e.version && e.version === versionRef.current) return
          void loadDetail()
        }
      }),
    [path, loadDetail],
  )

  const flushAll = useCallback(async () => {
    await flush()
    await inkRef.current.flush()
    await notesRef.current?.flush()
  }, [flush])

  const onNotesSaved = useCallback((version: string) => {
    localSeqRef.current++
    versionRef.current = version
    setNotes((n) => ({ body: notesRef.current?.savedBody() ?? n?.body ?? '', version }))
  }, [])

  /**
   * A board save's new `.md` version (its `lastUpdated` stamp): the base of the next Notes save.
   * Adopted only when the stamp started from the version the Notes hold; otherwise the `.md`
   * has a change this window hasn't loaded, and the next Notes save meets the 409 that settles it.
   */
  const adoptMdVersion = useCallback(({ mdVersion: version, mdBaseVersion: base }: MdStamp) => {
    if (!version || !base || base !== versionRef.current) return
    localSeqRef.current++
    versionRef.current = version
    setNotes((n) => (n ? { body: notesRef.current?.savedBody() ?? n.body, version } : n))
  }, [])
  useEffect(() => {
    mdVersionRef.current = adoptMdVersion
  }, [adoptMdVersion])

  /** A notes save met a newer file: keep the edits when only other lines changed, else reload. */
  const onNotesConflict = useCallback(async () => {
    try {
      const d = await api.object(path)
      localSeqRef.current++
      versionRef.current = d.version
      setTitle(d.summary.title)
      const h = notesRef.current
      setNotes({ body: d.body, version: d.version })
      if (h && d.body === h.savedBody()) {
        await h.resume(d.version, true)
      } else {
        h?.reload(d.body, d.version)
        setNotesToast(WB.changedElsewhere.text)
      }
    } catch {
      /* the next edit retries */
    }
  }, [path])

  const toggleNotes = useCallback(async () => {
    if (!notesOpen) {
      setNotesOpen(true)
      return
    }
    const h = notesRef.current
    if (h) {
      await h.flush()
      const saved = h.savedBody()
      if (saved !== null) setNotes((n) => (n ? { ...n, body: saved } : n))
    }
    setNotesOpen(false)
  }, [notesOpen])

  const rename = useCallback(
    async (next: string) => {
      await flushAll()
      const res = await api.renameObject(path, next, versionRef.current)
      localSeqRef.current++
      versionRef.current = res.version
      setNotes((n) => (n ? { ...n, version: res.version } : n))
      setTitle(next)
      if (res.path !== path) useTabs.getState().retarget(path, res.path)
      void invalidateLinkIndex()
    },
    [flushAll, path],
  )

  const deleteObject = useCallback(async () => {
    await flushAll()
    try {
      const res = await api.deleteObject(path, { baseVersion: versionRef.current })
      setTrashId(res.trashId)
      setUndoError(null)
      deletedRef.current = true
      setDeleted(true)
      void invalidateLinkIndex()
    } catch (err) {
      if (err instanceof ConflictError) {
        await loadDetail()
        throw new Error('The object changed on disk. It has been reloaded; try again.', { cause: err })
      }
      throw err
    }
  }, [flushAll, path, loadDetail])

  const undoDelete = useCallback(async () => {
    if (!trashId) return
    try {
      const res = await api.restore(trashId)
      setTrashId(null)
      deletedRef.current = false
      setDeleted(false)
      const restored = res.paths?.[0]
      if (restored && restored !== path) useTabs.getState().retarget(path, restored)
      void invalidateLinkIndex()
    } catch (err) {
      setUndoError(err instanceof Error ? err.message : String(err))
    }
  }, [trashId, path])

  const goBack = useCallback(() => {
    if (mode === 'peek') {
      onDismiss?.()
      return
    }
    const tabs = useTabs.getState()
    if (canGoBack(tabs)) tabs.back()
  }, [mode, onDismiss])

  // Ctrl+Backspace (App.tsx) and the board menu's "Delete" ask the view showing this board.
  const deleteRequest = useDeleteRequest((s) => s.request)
  useEffect(() => {
    if (deleteRequest && deleteRequest.path === path && deleteRequest.where === mode) {
      useDeleteRequest.getState().clear()
      if (!deletedRef.current) setDeleteOpen(true)
    }
  }, [deleteRequest, path, mode])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(dismissToast, TOAST_MS)
    return () => clearTimeout(t)
  }, [toast, dismissToast])

  useEffect(() => {
    if (!notesToast) return
    const t = setTimeout(() => setNotesToast(null), TOAST_MS)
    return () => clearTimeout(t)
  }, [notesToast])

  // A failed ink save is told like a failed board save.
  const inkSaveError = inkDoc.saveError ?? null
  const [inkToast, setInkToast] = useState<string | null>(null)
  useEffect(() => {
    if (inkSaveError) setInkToast(inkSaveError)
  }, [inkSaveError])
  useEffect(() => {
    if (!inkToast) return
    const t = setTimeout(() => setInkToast(null), TOAST_MS)
    return () => clearTimeout(t)
  }, [inkToast])

  return (
    <WhiteboardHostContext.Provider value={host}>
      <BoardStoreContext.Provider value={store}>
        <div className="flex h-full w-full flex-col overflow-hidden" data-whiteboard-page={mode} data-testid="whiteboard-page">
        <div className="relative min-h-0 w-full flex-1 overflow-hidden">
          {status === 'ready' && (
            <WhiteboardCanvas
              boardKey={path}
              settings={settingsState.settings}
              host={host}
              ink={ink}
              inkReadOnly={!!inkDoc.readOnlyReason || deleted}
              exportRef={exportRef}
              renderChrome={(controls) => (
                <BoardChrome controls={controls} ink={ink} inkDoc={inkDoc} settingsState={settingsState} />
              )}
            />
          )}
          {status === 'loading' && <div className="absolute inset-0" aria-busy="true" />}
          {status === 'error' && (
            <p role="alert" className="absolute top-16 left-6 text-[14px] text-red-400">
              {error}
            </p>
          )}
          <BoardHeader
            title={title}
            readOnly={deleted || !hasDetail}
            onRename={rename}
            menu={
              <BoardMenuSlot
                onClear={() => store.getState().actions.clearBoard()}
                onDelete={() => host.requestDelete(path, mode)}
                onOpenAsPage={onExpand}
                onExportPng={() => void exportRef.current?.(title)}
                onExportSelectionPng={() => void exportRef.current?.(title, { selection: true })}
                onVersionHistory={() => useVersionHistory.getState().open(path)}
              />
            }
            actions={
              onExpand ? (
                <button
                  type="button"
                  aria-label="Open as page"
                  title="Open as page"
                  className="flex size-8 items-center justify-center rounded-md bg-raised hover:bg-hover"
                  onClick={onExpand}
                >
                  <Icon name="ph-arrows-out-simple" size={18} />
                </button>
              ) : undefined
            }
          />
          <Banners deleted={deleted} trashId={trashId} undoError={undoError} onBack={goBack} onUndo={() => void undoDelete()} />
          {(toast || notesToast || inkToast) && (
            <div
              role="status"
              className="absolute top-16 left-1/2 z-30 -translate-x-1/2 rounded-lg border border-line bg-raised-2 px-3 py-2 text-[13px]"
            >
              {toast || notesToast || inkToast}
            </div>
          )}
          {footer && <div className="absolute bottom-4 left-4 z-10">{footer}</div>}
          <DeleteObjectDialog open={deleteOpen} onOpenChange={setDeleteOpen} onConfirm={deleteObject} />
        </div>
        {notes && (
          <BoardNotes
            path={path}
            body={notes.body}
            version={notes.version}
            readOnly={deleted}
            open={notesOpen}
            onToggle={() => void toggleNotes()}
            controlRef={notesRef}
            onSaved={onNotesSaved}
            onConflict={() => void onNotesConflict()}
          />
        )}
        </div>
      </BoardStoreContext.Provider>
    </WhiteboardHostContext.Provider>
  )
}

/**
 * The board's "Notes" (`components.RootWhiteboard.propertyDefinitions.RootWhiteboard_notes.name`):
 * a bar under the canvas that opens M1's body editor on the board's `.md` body (collapsed by
 * default; the bar and its height are our choice).
 */
function BoardNotes({
  path,
  body,
  version,
  readOnly,
  open,
  onToggle,
  controlRef,
  onSaved,
  onConflict,
}: {
  path: string
  body: string
  version: string
  readOnly: boolean
  open: boolean
  onToggle(): void
  controlRef: { current: BodyEditorHandle | null }
  onSaved(version: string): void
  onConflict(currentVersion: string): void
}) {
  return (
    <section className="shrink-0 border-t border-line bg-app" data-testid="whiteboard-notes" data-open={open || undefined}>
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-4 py-2 text-left text-[13px] font-medium text-fg-muted hover:text-fg"
        onClick={onToggle}
      >
        <Icon name={open ? 'ph-caret-down' : 'ph-caret-right'} size={12} />
        <span>{WB.propNotes.text}</span>
      </button>
      {open && (
        <div className="max-h-[40vh] min-h-[120px] overflow-y-auto px-6 pb-6" data-testid="whiteboard-notes-editor">
          <Editor
            path={path}
            body={body}
            version={version}
            readOnly={readOnly}
            onSaved={onSaved}
            onConflict={onConflict}
            controlRef={controlRef}
          />
        </div>
      )}
    </section>
  )
}

/** The read-only and deleted banners, under the title. */
function Banners({
  deleted,
  trashId,
  undoError,
  onBack,
  onUndo,
}: {
  deleted: boolean
  trashId: string | null
  undoError: string | null
  onBack(): void
  onUndo(): void
}) {
  const readOnlyReason = useBoardState((s) => s.readOnlyReason)
  if (!deleted && !readOnlyReason) return null
  return (
    <div className="absolute top-16 left-4 z-20 max-w-[560px]">
      {deleted && <DeletedBanner onBack={onBack} onUndo={trashId ? onUndo : undefined} error={undoError} />}
      {readOnlyReason && !deleted && (
        <div
          role="status"
          data-whiteboard-readonly=""
          className="flex items-center gap-2 rounded-lg border border-line bg-raised px-3 py-2 text-[13px] text-fg-muted"
        >
          <Icon name="ph-lock-simple" size={16} />
          <span>{readOnlyReason || WB.readOnly.text}</span>
        </div>
      )}
    </div>
  )
}

function BoardMenuSlot({
  onExportSelectionPng,
  ...props
}: {
  onClear(): void
  onDelete(): void
  onOpenAsPage?(): void
  onExportPng?(): void
  onExportSelectionPng?(): void
  onVersionHistory?(): void
}) {
  const editable = useBoardState((s) => isEditable(s))
  const hasSelection = useBoardState((s) => s.selection.some((id) => id in s.doc.board.nodes))
  return <BoardMenu {...props} onExportSelectionPng={hasSelection ? onExportSelectionPng : undefined} disabled={!editable} />
}

/** Toolbox (bottom centre), zoom (bottom right) and the selection toolbar, inside the canvas. */
function BoardChrome({
  controls,
  ink,
  inkDoc,
  settingsState,
}: {
  controls: CanvasControls
  ink?: InkPlugin
  inkDoc: InkDoc
  settingsState: WhiteboardSettingsState
}) {
  const tool = useBoardState((s) => s.tool)
  const inkTool = useBoardState((s) => s.inkTool)
  const locked = useBoardState((s) => s.doc.board.locked === true)
  const readOnlyReason = useBoardState((s) => s.readOnlyReason)
  const canUndo = useBoardState((s) => s.canUndo)
  const canRedo = useBoardState((s) => s.canRedo)
  const memory = useBoardState((s) => s.memory)
  const actions = useBoardState((s) => s.actions)
  const canvas = useBoardState((s) => s.canvas)
  const selection = useBoardState((s) => s.selection)
  const board = useBoardState((s) => s.doc.board)
  const strokes = useBoardState((s) => s.doc.strokes)
  const editable = !readOnlyReason && !locked

  // ---- M8: the floating inspector and the presentation ----
  const [pinned, setPinned] = useState(loadInspectorPinned)
  const [inspectorOpen, setInspectorOpen] = useState(pinned)
  const [presenting, setPresenting] = useState(false)
  const slides = useMemo(() => presentationSlides(board), [board])
  const pin = useCallback((next: boolean) => {
    setPinned(next)
    saveInspectorPinned(next)
  }, [])
  const play = useCallback(() => {
    if (!slides.length) return
    actions.select([])
    setPresenting(true)
  }, [slides.length, actions])
  const reorderFrames = useCallback(
    (ids: string[]) => {
      if (!editable) return
      actions.apply('readingOrder', (b) => setFrameOrder(b, ids))
    },
    [actions, editable],
  )

  const selNodes = useMemo(() => selection.map((id) => board.nodes[id]).filter(Boolean), [selection, board])
  const selEdges = useMemo(() => selection.map((id) => board.edges[id]).filter(Boolean), [selection, board])

  const toolbar =
    editable && (selNodes.length > 0 || selEdges.length > 0) ? (
      <SelectionToolbar nodes={selNodes} edges={selEdges} blocks={board.blocks} actions={actions} />
    ) : null

  if (presenting) {
    return (
      <Panel position="bottom-center">
        <BoardPresentation
          slides={slides}
          onShow={(slide) => controls.zoomToBox(slide.box, { fill: true })}
          onExit={() => setPresenting(false)}
        />
      </Panel>
    )
  }

  return (
    <>
      <Panel position="top-right" style={{ marginTop: 64 }}>
        <div className="flex flex-col items-end gap-2">
          <button
            type="button"
            aria-label={WB.inspector.text}
            title={WB.inspector.text}
            aria-expanded={inspectorOpen}
            className="flex size-8 items-center justify-center rounded-md border border-line bg-raised text-fg-muted shadow-sm hover:bg-hover hover:text-fg"
            onClick={() => setInspectorOpen((o) => !o)}
          >
            <Icon name="ph-list-bullets" size={16} />
          </button>
          {inspectorOpen && (
            <FloatingInspector
              board={board}
              strokes={strokes}
              editable={editable}
              pinned={pinned}
              onPin={pin}
              onZoomTo={controls.zoomToNode}
              onReorderFrames={reorderFrames}
            />
          )}
        </div>
      </Panel>
      <Panel position="bottom-center">
        <Toolbox
          tool={tool}
          onTool={actions.setTool}
          settings={settingsState.settings}
          onSettings={(k, v) => void settingsState.set(k, v)}
          locked={locked}
          onLock={actions.setLocked}
          inkSlot={
            ink ? (
              <ink.Toolbar value={inkTool} readOnly={!editable || !!inkDoc.readOnlyReason} onChange={canvas.setInkTool} />
            ) : undefined
          }
          onUndo={actions.undo}
          onRedo={actions.redo}
          canUndo={canUndo && !readOnlyReason}
          canRedo={canRedo && !readOnlyReason}
          memory={memory}
          readOnly={!!readOnlyReason}
          onPlay={play}
        />
      </Panel>
      <Panel position="bottom-right">
        <ZoomMenu zoom={controls.zoom} onZoom={controls.onZoom} />
      </Panel>
      {toolbar &&
        (selNodes.length > 0 ? (
          <NodeToolbar nodeId={selNodes.map((n) => n.id)} isVisible>
            {toolbar}
          </NodeToolbar>
        ) : (
          <Panel position="top-center">{toolbar}</Panel>
        ))}
    </>
  )
}
