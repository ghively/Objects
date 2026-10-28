// colour-literals: content palette
/**
 * The canvas: React Flow (the React sibling of the Vue Flow canvas Capacities uses) over the
 * board store. Pan and zoom (2 % to 400 %), the 30 px dotted grid, snap to grid and to nodes,
 * marquee and Shift multi-select, tool placement (click = default size, drag = a box snapped
 * with `snapBox`), connections, frames dragging what is inside them, Alt-drag duplicate,
 * dropping objects in, the empty and lost states, and the ink layer when a plugin is given.
 * M8: the media tools (Image, PDF, Audio, File open the file picker for their kind, upload into
 * `Attachments/` and place a media node of the default size on the grid; Web link asks for a URL
 * and an optional title and places a card, never fetching), and files dropped on the board
 * become media nodes the same way.
 * M8 (Task 21): a connector dropped on empty canvas opens the quick-create menu at the drop
 * point (`QuickCreateMenu`); Ctrl/Cmd+Arrow resizes the selection from its right or bottom
 * edge by a grid step (five with Shift); locked nodes stay put.
 * M8 (Task 22): Ctrl/Cmd+C, X and V copy, cut and paste the selection through the system
 * clipboard (`clipboard.ts`; pasted text, URLs and images become text blocks, web-link cards and
 * media nodes in the middle of the view), and `exportRef` gives the page "Export as PNG"
 * (`exportPng.ts`).
 * M8 (Task 23): the chrome's controls also zoom to a node (the inspector) and fit a box (the
 * presentation, which magnifies a frame to fill the view).
 * Panning and zooming never touch the board; the camera is kept per viewer in localStorage.
 */
import '@xyflow/react/dist/base.css'
import './whiteboard.css'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  useReactFlow,
  useStore as useFlowStore,
  useViewport,
  type Connection,
  type FinalConnectionState,
  type EdgeTypes as FlowEdgeTypes,
  type EdgeChange,
  type NodeChange,
  type OnNodeDrag,
  type Viewport as FlowViewport,
} from '@xyflow/react'
import type { WhiteboardMediaTool, WhiteboardPosition, WhiteboardTool } from '@/api/whiteboardTypes'
import { MAX_UPLOAD_BYTES, openFilePicker, showToast, UPLOAD_LIMIT_MESSAGE } from '@/editor/media/upload'
import {
  contentOfPasteEvent,
  parsePayload,
  pastePayload,
  pasteText,
  PASTE_OFFSET,
  readClipboard,
  selectionPayload,
  serializePayload,
  writeClipboard,
  type ClipboardContent,
} from './clipboard'
import { backgroundOf, downloadDataUrl, EXPORT_FAILED, exportFileName, renderBoardPng, strokeBoxes } from './exportPng'
import { boundsOf, createMedia, createWeblink, newId, nodeBox, quickCreate, resizeBy, type ConnectorDrop, type QuickCreateChoice } from './actions'
import { fitBox, zoomStep, wheelViewport, type Viewport } from './camera'
import type { Placement, ResolvedSettings, ZoomCommand } from './canvasTypes'
import { ObjectPicker } from './chrome'
import { mayCarryObject, readDroppedObject } from './dnd'
import { MarkerDefs, edgeTypes } from './edges'
import { toFlow, type FlowEdge, type FlowNode } from './flowMapping'
import { QuickCreateMenu, type QuickCreatePick } from './chrome/QuickCreateMenu'
import { WeblinkInput } from './chrome/WeblinkInput'
import { mediaHost, type WhiteboardHost } from './host'
import { GRID, MEDIA_TOOL_KIND, ZOOM_MAX, ZOOM_MIN, isConnectorTool, isMediaTool, isTool, type Box } from './model'
import { nodeTypes } from './nodes'
import type { InkPlugin, InkStroke, InkToolState } from './plugin'
import { isEditableTarget, keyToCommand, type Command } from './shortcuts'
import { snapToNodes, type SnapGuide } from './snapGuides'
import { isEditable, useBoardStore, useBoardState } from './store'
import { WB } from './strings'
import { loadCamera, saveCamera } from './toolMemory'
import { useThemeName } from '@/theme/applyTheme'

/** Padding around "Zoom to fit" / "Zoom to selection" (two grid cells; our choice). */
export const FIT_PADDING = GRID * 2

/** Ink tool defaults when a shortcut arms one (the plan's pen 4, highlighter 16, gray). */
const INK_DEFAULTS: Record<InkToolState['tool'], number> = { pen: 4, highlighter: 16, eraser: 4 }
const INK_DEFAULT_COLOR = '#5c5959'

/** Files dropped together are placed in a diagonal cascade this far apart (our choice: one grid step). */
export const DROP_CASCADE = GRID

/**
 * Uploads `files` one after another (refusing any over 100 MiB before sending, M7's rule) and
 * hands each uploaded path to `place` with its index. Failures show a toast and are skipped.
 */
export async function uploadFiles(
  host: WhiteboardHost,
  files: readonly File[],
  place: (path: string, index: number) => void,
): Promise<void> {
  const media = mediaHost(host)
  let placed = 0
  for (const file of files) {
    if (file.size > MAX_UPLOAD_BYTES) {
      showToast(UPLOAD_LIMIT_MESSAGE)
      continue
    }
    try {
      const res = await media.uploadAttachment(file)
      place(res.path, placed++)
    } catch (err) {
      showToast(err instanceof Error && err.message ? err.message : 'The file could not be uploaded.')
    }
  }
}

/** Tools that place something with a click or a drag on the canvas. */
function isPlacementTool(tool: WhiteboardTool): boolean {
  return isTool(tool) && tool !== 'select' && tool !== 'hand'
}

/**
 * How long a Ctrl/Cmd+C or V waits for the browser's own copy or paste event (which carries the
 * clipboard without a permission prompt) before using `navigator.clipboard` instead (our choice).
 */
export const CLIPBOARD_EVENT_WAIT_MS = 60

/** "Export as PNG": the whole board, or with `selection` the selected nodes; false when nothing was exported. */
export type BoardExporter = (title: string, opts?: { selection?: boolean }) => Promise<boolean>

export interface CanvasControls {
  zoom: number
  onZoom(cmd: ZoomCommand): void
  /** M8 (inspector): zoom to fit one node (a heading's block or a frame). */
  zoomToNode(id: string): void
  /** M8 (presentation): fit a box; `fill` magnifies past 100 % so a frame fills the view. */
  zoomToBox(box: Box, opts?: { fill?: boolean }): void
}

export interface WhiteboardCanvasProps {
  /** The per-viewer camera key (board id or path). */
  boardKey: string
  settings: ResolvedSettings
  host: WhiteboardHost
  ink?: InkPlugin
  /** The ink file can't be written: the pen group is off. */
  inkReadOnly?: boolean
  /** Chrome rendered inside the canvas (toolbox, zoom menu, selection toolbar). */
  renderChrome?(controls: CanvasControls): ReactNode
  /** M8: set to the board's PNG exporter while the canvas is mounted. */
  exportRef?: { current: BoardExporter | null }
}

export function WhiteboardCanvas(props: WhiteboardCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  )
}

function CanvasInner({ boardKey, settings, host, ink, inkReadOnly, renderChrome, exportRef }: WhiteboardCanvasProps) {
  const store = useBoardStore()
  const board = useBoardState((s) => s.doc.board)
  const strokes = useBoardState((s) => s.doc.strokes) as InkStroke[]
  const selection = useBoardState((s) => s.selection)
  const tool = useBoardState((s) => s.tool)
  const inkTool = useBoardState((s) => s.inkTool)
  const readOnlyReason = useBoardState((s) => s.readOnlyReason)
  const actions = useBoardState((s) => s.actions)
  const canvas = useBoardState((s) => s.canvas)
  const editable = !readOnlyReason && board.locked !== true
  const rf = useReactFlow<FlowNode, FlowEdge>()
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  const [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({})
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [ctrlHeld, setCtrlHeld] = useState(false)
  const [guides, setGuides] = useState<SnapGuide[]>([])
  // `drop` (M8): the picker was opened from the quick-create menu; the pick is connected to it.
  const [picker, setPicker] = useState<{ mode: 'link' | 'create'; at: WhiteboardPosition; typeId?: string; drop?: ConnectorDrop } | null>(null)
  const [quick, setQuick] = useState<{ drop: ConnectorDrop; left: number; top: number } | null>(null)
  const [weblinkAt, setWeblinkAt] = useState<WhiteboardPosition | null>(null)
  const [zoom, setZoom] = useState(1)
  // M8: while exporting, every node is rendered (not only those on screen).
  const [exporting, setExporting] = useState(false)

  // The theme (M7): React Flow's own colours follow `colorMode`, and the nodes and edges get new
  // data on a change so their memoized views re-read `isDarkMode()` (whiteboard/colors.ts).
  const themeName = useThemeName()
  const dark = themeName === 'dark' || themeName === 'darkDimmed'
  const selected = useMemo(() => new Set(selection), [selection])
  const flow = useMemo(() => toFlow(board, selected), [board, selected])
  const nodes = useMemo(
    () =>
      flow.nodes.map((n) => ({
        ...n,
        ...(measured[n.id] ? { measured: measured[n.id] } : {}),
        data: { ...n.data, theme: themeName },
      })),
    [flow.nodes, measured, themeName],
  )
  const edges = useMemo(
    () => flow.edges.map((e) => (e.data ? { ...e, data: { ...e.data, theme: themeName } } : e)),
    [flow.edges, themeName],
  )

  const panning = spaceHeld || tool === 'hand'
  const snapGrid = settings.isSnappingToGrid && !ctrlHeld

  // ---- selection, drags and resizes ----

  const applySelect = useCallback(
    (changes: readonly (NodeChange | EdgeChange)[]) => {
      let next: string[] | null = null
      for (const c of changes) {
        if (c.type !== 'select') continue
        next ??= [...store.getState().selection]
        const i = next.indexOf(c.id)
        if (c.selected && i < 0) next.push(c.id)
        else if (!c.selected && i >= 0) next.splice(i, 1)
      }
      if (next) actions.select(next)
    },
    [actions, store],
  )

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      applySelect(changes)
      const sizes: Record<string, { width: number; height: number }> = {}
      let measuredAny = false
      const edits: NodeChange[] = []
      for (const c of changes) {
        if (c.type === 'dimensions' && c.dimensions && !c.resizing && !c.setAttributes) {
          sizes[c.id] = c.dimensions
          measuredAny = true
        } else if (c.type === 'position' && c.position) edits.push(c)
        else if (c.type === 'dimensions' && (c.resizing || c.setAttributes)) edits.push(c)
      }
      if (measuredAny) setMeasured((m) => ({ ...m, ...sizes }))
      if (!edits.length) return
      const st = store.getState()
      // Snap to nodes: one node dragged, lined up with the others' edges and centres.
      const moves = edits.filter((c) => c.type === 'position')
      if (settings.isSnappingToNodes && !ctrlHeld && st.dragging && moves.length === 1) {
        const c = moves[0] as Extract<NodeChange, { type: 'position' }>
        const n = st.doc.board.nodes[c.id]
        if (n && c.position) {
          const box = { ...nodeBox(n), x: c.position.x, y: c.position.y }
          const others = Object.values(st.doc.board.nodes)
            .filter((o) => o.id !== n.id && o.kind !== 'point')
            .map(nodeBox)
          const snap = snapToNodes(box, others)
          c.position = { x: c.position.x + snap.dx, y: c.position.y + snap.dy }
          setGuides(snap.guides)
        }
      }
      canvas.applyFlowChanges(edits)
    },
    [applySelect, canvas, store, settings.isSnappingToNodes, ctrlHeld],
  )

  const onEdgesChange = useCallback((changes: EdgeChange<FlowEdge>[]) => applySelect(changes), [applySelect])

  const onNodeDragStart: OnNodeDrag<FlowNode> = useCallback(
    (event, _node, dragged) => {
      canvas.beginDrag(
        dragged.map((n) => n.id),
        { duplicate: !!(event as unknown as MouseEvent).altKey },
      )
    },
    [canvas],
  )
  const onSelectionDragStart = useCallback(
    (event: ReactMouseEvent, dragged: FlowNode[]) => {
      canvas.beginDrag(
        dragged.map((n) => n.id),
        { duplicate: event.altKey },
      )
    },
    [canvas],
  )
  const onNodeDragStop = useCallback(() => {
    canvas.endDrag()
    setGuides([])
  }, [canvas])

  const onConnect = useCallback(
    (c: Connection) => {
      actions.connect(c.source, c.target, { sourceHandle: c.sourceHandle, targetHandle: c.targetHandle })
    },
    [actions],
  )

  // ---- quick-create on a connector drop (M8) ----

  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      if (!isEditable(store.getState())) return
      if (state.isValid || state.toNode || !state.fromNode || !state.fromHandle) return
      const target = event.target as Element | null
      // Let go over a node (not on a handle): no quick-create (our choice).
      if (target && typeof target.closest === 'function' && target.closest('.react-flow__node')) return
      const pt = 'changedTouches' in event && event.changedTouches.length ? event.changedTouches[0] : (event as MouseEvent)
      const at = rf.screenToFlowPosition({ x: pt.clientX, y: pt.clientY }, { snapToGrid: false })
      const rect = wrapperRef.current?.getBoundingClientRect()
      // Kept inside the canvas (the menu is 240 wide, at most 420 tall; our choice).
      const left = Math.max(8, Math.min(pt.clientX - (rect?.left ?? 0), (rect?.width ?? 1280) - 248))
      const top = Math.max(8, Math.min(pt.clientY - (rect?.top ?? 0), (rect?.height ?? 800) - 428))
      setQuick({
        drop: {
          nodeId: state.fromNode.id,
          handleId: state.fromHandle.id ?? null,
          fromTarget: state.fromHandle.type === 'target',
          at,
        },
        left,
        top,
      })
    },
    [rf, store],
  )

  /** Places `choice` at the drop point and connects it, as one step; selects what was placed. */
  const finishQuick = useCallback(
    (drop: ConnectorDrop, choice: QuickCreateChoice) => {
      if (!isEditable(store.getState())) return
      const m = store.getState().memory
      const ids = { node: newId(), edge: newId() }
      actions.apply('create', (b) =>
        quickCreate(b, drop, choice, {
          snap: settings.isSnappingToGrid,
          style: { connection: m.lastEdgeConnection, line: m.lastEdgeLine },
          ids,
        }),
      )
      const board = store.getState().doc.board
      if (ids.node in board.nodes && choice.kind !== 'none') actions.select([ids.node])
    },
    [actions, store, settings.isSnappingToGrid],
  )

  const onQuickPick = useCallback(
    (pick: QuickCreatePick) => {
      const q = quick
      setQuick(null)
      if (!q) return
      if (pick.kind === 'remove') return
      if (pick.kind === 'none') finishQuick(q.drop, { kind: 'none' })
      else if (pick.kind === 'shape') finishQuick(q.drop, { kind: 'shape', shape: pick.shape })
      else if (pick.kind === 'createObject') setPicker({ mode: 'create', at: q.drop.at, drop: q.drop })
      else setPicker({ mode: 'link', at: q.drop.at, drop: q.drop, typeId: pick.typeId })
    },
    [quick, finishQuick],
  )

  const closeQuick = useCallback(() => setQuick(null), [])

  // ---- camera ----

  const paneSize = useCallback((): { width: number; height: number } => {
    const el = wrapperRef.current
    return { width: el?.clientWidth || 1280, height: el?.clientHeight || 800 }
  }, [])

  const allBoxes = useCallback(
    (only?: Set<string>): Box[] =>
      Object.values(store.getState().doc.board.nodes)
        .filter((n) => !only || only.has(n.id))
        .map(nodeBox),
    [store],
  )

  const setCamera = useCallback(
    (vp: Viewport) => {
      void rf.setViewport(vp)
      setZoom(vp.zoom)
      saveCamera(boardKey, vp)
    },
    [rf, boardKey],
  )

  const onZoom = useCallback(
    (cmd: ZoomCommand) => {
      const vp = rf.getViewport()
      const pane = paneSize()
      const about = (z: number): Viewport => {
        const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))
        const cx = pane.width / 2
        const cy = pane.height / 2
        const fx = (cx - vp.x) / vp.zoom
        const fy = (cy - vp.y) / vp.zoom
        return { x: cx - fx * clamped, y: cy - fy * clamped, zoom: clamped }
      }
      if (typeof cmd === 'number') setCamera(about(cmd))
      else if (cmd === 'in' || cmd === 'out') setCamera(about(zoomStep(vp.zoom, cmd)))
      else if (cmd === 'reset') setCamera(about(1))
      else if (cmd === 'fit') setCamera(fitBox(allBoxes(), pane, FIT_PADDING))
      else if (cmd === 'selection') {
        const sel = new Set(store.getState().selection)
        const boxes = allBoxes(sel)
        setCamera(fitBox(boxes.length ? boxes : allBoxes(), pane, FIT_PADDING))
      }
    },
    [rf, paneSize, setCamera, allBoxes, store],
  )

  const zoomToBox = useCallback(
    (box: Box, opts: { fill?: boolean } = {}) => {
      setCamera(fitBox([box], paneSize(), FIT_PADDING, opts.fill ? ZOOM_MAX : undefined))
    },
    [paneSize, setCamera],
  )

  const zoomToNode = useCallback(
    (id: string) => {
      const n = store.getState().doc.board.nodes[id]
      if (!n) return
      const b = nodeBox(n)
      const m = measured[id]
      zoomToBox(m && typeof n.width !== 'number' ? { ...b, width: m.width, height: typeof n.height === 'number' ? b.height : m.height } : b)
    },
    [store, measured, zoomToBox],
  )

  const onMoveEnd = useCallback(
    (_: unknown, vp: FlowViewport) => {
      setZoom(vp.zoom)
      saveCamera(boardKey, vp)
    },
    [boardKey],
  )

  const onInkWheel = useCallback(
    (e: WheelEvent) => {
      const rect = wrapperRef.current?.getBoundingClientRect()
      const vp = wheelViewport(
        rf.getViewport(),
        {
          deltaX: e.deltaX,
          deltaY: e.deltaY,
          deltaMode: e.deltaMode,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          clientX: e.clientX - (rect?.left ?? 0),
          clientY: e.clientY - (rect?.top ?? 0),
        },
        settings.isZoomingOnScroll,
      )
      void rf.setViewport(vp)
      setZoom(vp.zoom)
    },
    [rf, settings.isZoomingOnScroll],
  )

  // ---- media (M8) ----

  /** Places an uploaded file as a media node at `at` (plus the cascade offset) and selects it. */
  const placeMedia = useCallback(
    (path: string, at: WhiteboardPosition, index = 0, snap = settings.isSnappingToGrid) => {
      if (!isEditable(store.getState())) return
      const id = newId()
      const p = { x: at.x + index * DROP_CASCADE, y: at.y + index * DROP_CASCADE }
      actions.apply('create', (b) => createMedia(b, path, p, { id, snap }))
      if (id in store.getState().doc.board.nodes) actions.select([id])
    },
    [actions, store, settings.isSnappingToGrid],
  )

  const startMedia = useCallback(
    (tool: WhiteboardMediaTool, at: WhiteboardPosition, snap: boolean) => {
      // One-shot, as every picker tool: control goes back to Move whether or not a file is chosen.
      // The tool memory keeps the media tool (`setTool` remembered it when it was armed).
      store.setState({ tool: 'select' })
      if (tool === 'weblink') {
        setWeblinkAt(at)
        return
      }
      openFilePicker(MEDIA_TOOL_KIND[tool], (files) => {
        void uploadFiles(host, files, (path, i) => placeMedia(path, at, i, snap))
      })
    },
    [store, host, placeMedia],
  )

  const onWeblink = useCallback(
    (link: { url: string; title?: string }) => {
      const at = weblinkAt
      setWeblinkAt(null)
      if (!at || !isEditable(store.getState())) return
      const id = newId()
      actions.apply('create', (b) => createWeblink(b, link, at, { id, snap: settings.isSnappingToGrid }))
      if (id in store.getState().doc.board.nodes) actions.select([id])
    },
    [weblinkAt, actions, store, settings.isSnappingToGrid],
  )

  // ---- clipboard (M8) ----

  /** The last copied (or pasted) clipboard text and how often it was pasted since. */
  const pasteCount = useRef<{ text: string; count: number } | null>(null)
  const pendingCopy = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingPaste = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** The selection as clipboard text, or null when nothing is selected. */
  const copyText = useCallback((): string | null => {
    const st = store.getState()
    const payload = selectionPayload(st.doc.board, st.selection)
    if (!payload) return null
    const text = serializePayload(payload)
    pasteCount.current = { text, count: 0 }
    return text
  }, [store])

  /** The middle of the visible part of the board (where pasted text, links and images go). */
  const viewCentre = useCallback((): WhiteboardPosition => {
    const rect = wrapperRef.current?.getBoundingClientRect()
    const pane = paneSize()
    const cx = (rect?.left ?? 0) + (rect?.width || pane.width) / 2
    const cy = (rect?.top ?? 0) + (rect?.height || pane.height) / 2
    return rf.screenToFlowPosition({ x: cx, y: cy }, { snapToGrid: false })
  }, [rf, paneSize])

  const applyPaste = useCallback(
    (content: ClipboardContent) => {
      if (!isEditable(store.getState())) return
      if (content.files.length) {
        const at = viewCentre()
        void uploadFiles(host, content.files, (path, i) => placeMedia(path, at, i))
        return
      }
      const text = content.text
      if (!text) return
      const payload = parsePayload(text)
      if (payload) {
        const prev = pasteCount.current
        const count = prev && prev.text === text ? prev.count + 1 : 1
        pasteCount.current = { text, count }
        let ids: string[] = []
        actions.apply('paste', (b) => {
          const r = pastePayload(b, payload, PASTE_OFFSET * count)
          ids = r.ids
          return r.board
        })
        if (ids.length) actions.select(ids)
        return
      }
      const id = newId()
      actions.apply('create', (b) => pasteText(b, text, viewCentre(), { id, snap: settings.isSnappingToGrid }))
      if (id in store.getState().doc.board.nodes) actions.select([id])
    },
    [store, actions, host, viewCentre, placeMedia, settings.isSnappingToGrid],
  )

  const clearPending = (ref: { current: ReturnType<typeof setTimeout> | null }) => {
    if (ref.current !== null) clearTimeout(ref.current)
    ref.current = null
  }

  /** Ctrl/Cmd+C or X: copy now if the browser's copy event doesn't come; X then removes the selection. */
  const startCopy = useCallback(
    (cut: boolean) => {
      clearPending(pendingCopy)
      const sel = [...store.getState().selection]
      pendingCopy.current = setTimeout(() => {
        pendingCopy.current = null
        const text = copyText()
        if (!text) return
        void writeClipboard(text)
        if (cut && isEditable(store.getState())) actions.removeSelection(sel)
      }, CLIPBOARD_EVENT_WAIT_MS)
    },
    [store, copyText, actions],
  )

  const startPaste = useCallback(() => {
    clearPending(pendingPaste)
    pendingPaste.current = setTimeout(() => {
      pendingPaste.current = null
      void readClipboard().then(applyPaste)
    }, CLIPBOARD_EVENT_WAIT_MS)
  }, [applyPaste])

  // The browser's own copy, cut and paste events while the canvas has focus (they target the
  // body when the focused element isn't editable, so they are caught on the document).
  useEffect(() => {
    const ours = (): boolean => {
      const el = wrapperRef.current
      const active = document.activeElement
      return !!el && !!active && el.contains(active) && !isEditableTarget(active)
    }
    const onCopy = (e: ClipboardEvent, cut: boolean) => {
      if (!ours() || !e.clipboardData) return
      const text = copyText()
      if (!text) return
      clearPending(pendingCopy)
      e.preventDefault()
      e.clipboardData.setData('text/plain', text)
      if (cut && isEditable(store.getState())) actions.removeSelection()
    }
    const copy = (e: ClipboardEvent) => onCopy(e, false)
    const cut = (e: ClipboardEvent) => onCopy(e, true)
    const paste = (e: ClipboardEvent) => {
      if (!ours()) return
      clearPending(pendingPaste)
      e.preventDefault()
      applyPaste(contentOfPasteEvent(e.clipboardData))
    }
    document.addEventListener('copy', copy)
    document.addEventListener('cut', cut)
    document.addEventListener('paste', paste)
    return () => {
      document.removeEventListener('copy', copy)
      document.removeEventListener('cut', cut)
      document.removeEventListener('paste', paste)
      clearPending(pendingCopy)
      clearPending(pendingPaste)
    }
  }, [copyText, applyPaste, actions, store])

  // ---- PNG export (M8) ----

  const exportPng = useCallback<BoardExporter>(
    async (title, opts = {}) => {
      const st = store.getState()
      const board = st.doc.board
      const payload = opts.selection ? selectionPayload(board, st.selection) : null
      if (opts.selection && !payload) return false
      const nodesIn = payload ? payload.nodes : Object.values(board.nodes)
      const boxes = nodesIn.map((n) => {
        const b = nodeBox(n)
        const m = measured[n.id]
        return m && typeof n.width !== 'number' ? { ...b, width: m.width, height: typeof n.height === 'number' ? b.height : m.height } : b
      })
      if (!payload) boxes.push(...strokeBoxes(st.doc.strokes as InkStroke[]))
      if (!boxes.length) return false
      const only = payload ? new Set([...payload.nodes.map((n) => n.id), ...payload.edges.map((e) => e.id)]) : undefined
      const kept = [...st.selection]
      actions.select([])
      setExporting(true)
      try {
        await nextFrames(2)
        const viewport = wrapperRef.current?.querySelector<HTMLElement>('.react-flow__viewport')
        if (!viewport) return false
        const url = await renderBoardPng({ viewport, boxes, background: backgroundOf(wrapperRef.current), only })
        if (!url) return false
        downloadDataUrl(url, exportFileName(title))
        return true
      } catch {
        showToast(EXPORT_FAILED)
        return false
      } finally {
        setExporting(false)
        actions.select(kept)
      }
    },
    [store, actions, measured],
  )

  useEffect(() => {
    if (!exportRef) return
    exportRef.current = exportPng
    return () => {
      if (exportRef.current === exportPng) exportRef.current = null
    }
  }, [exportRef, exportPng])

  // ---- placement ----

  const place = useCallback(
    (at: Placement, snap: boolean) => {
      const st = store.getState()
      if (!isEditable(st)) return
      const t = st.tool
      if (t === 'link' || t === 'create') {
        const point = 'start' in at ? at.start : 'width' in at ? { x: at.x, y: at.y } : at
        setPicker({ mode: t, at: point })
        return
      }
      if (isMediaTool(t)) {
        // A drag places at the box's centre (the media node keeps its default size; our choice).
        const point = 'start' in at ? at.start : 'width' in at ? { x: at.x + at.width / 2, y: at.y + at.height / 2 } : at
        startMedia(t, point, snap)
        return
      }
      const id = actions.createFromTool(t, at, { snap })
      // A text block placed with the Text tool opens for typing at once (our choice).
      if (id && t === 'text') actions.beginEdit(id)
    },
    [actions, store, startMedia],
  )

  const onPick = useCallback(
    ({ path }: { path: string }) => {
      const p = picker
      setPicker(null)
      if (!p) return
      if (p.drop) {
        finishQuick(p.drop, { kind: 'entity', link: host.linkFor(path) })
        return
      }
      actions.createEntity(host.linkFor(path), p.at, { snap: settings.isSnappingToGrid })
      actions.setTool('select')
    },
    [picker, actions, host, settings.isSnappingToGrid, finishQuick],
  )

  // ---- drag and drop of objects ----

  const onDragOver = useCallback(
    (e: ReactDragEvent) => {
      if (!editable || !(mayCarryObject(e.dataTransfer) || carriesFiles(e.dataTransfer))) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    },
    [editable],
  )

  const onDrop = useCallback(
    (e: ReactDragEvent) => {
      if (!isEditable(store.getState())) return
      const files = Array.from(e.dataTransfer?.files ?? [])
      if (files.length) {
        // Files from the OS (M8): uploaded and placed where they were dropped.
        e.preventDefault()
        const at = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })
        void uploadFiles(host, files, (path, i) => placeMedia(path, at, i))
        return
      }
      const obj = readDroppedObject(e.dataTransfer)
      if (!obj) return
      e.preventDefault()
      const at = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })
      const link = 'path' in obj ? host.linkFor(obj.path) : obj.link
      actions.createEntity(link, at, { snap: settings.isSnappingToGrid })
    },
    [store, rf, host, actions, settings.isSnappingToGrid, placeMedia],
  )

  // ---- keys ----

  const run = useCallback(
    (cmd: Command, e: ReactKeyboardEvent): boolean => {
      const st = store.getState()
      switch (cmd.type) {
        case 'tool':
          if (!isEditable(st) && cmd.tool !== 'select' && cmd.tool !== 'hand') return false
          actions.setTool(cmd.tool)
          return true
        case 'ink': {
          if (!ink || !isEditable(st) || inkReadOnly) return false
          const prev = st.inkTool
          canvas.setInkTool({
            tool: cmd.tool,
            color: prev?.color ?? INK_DEFAULT_COLOR,
            width: prev?.tool === cmd.tool ? prev.width : INK_DEFAULTS[cmd.tool],
          })
          return true
        }
        case 'zoom':
          onZoom(cmd.zoom)
          return true
        case 'duplicate':
          actions.duplicate()
          return true
        case 'nudge':
          actions.nudge(cmd.dx, cmd.dy)
          return true
        case 'resize': {
          const sel = st.selection
          actions.apply('resize', (b) => resizeBy(b, sel, cmd.dw, cmd.dh, measured))
          return true
        }
        case 'order':
          actions.order(cmd.mode)
          return true
        case 'flip':
          actions.flip(cmd.axis)
          return true
        case 'wrap':
          actions.wrapInFrame()
          return true
        case 'undo':
          actions.undo()
          return true
        case 'redo':
          actions.redo()
          return true
        case 'delete':
          actions.removeSelection()
          return true
        case 'escape':
          if (quick) {
            setQuick(null)
            return true
          }
          if (picker) {
            setPicker(null)
            return true
          }
          if (weblinkAt) {
            setWeblinkAt(null)
            return true
          }
          if (st.inkTool) {
            canvas.setInkTool(null)
            return true
          }
          if (st.selection.length) {
            actions.select([])
            return true
          }
          return false // the peek may close
        case 'cycle': {
          const ids = Object.values(st.doc.board.nodes)
            .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
            .map((n) => n.id)
          if (!ids.length) return false
          const cur = st.selection.length === 1 ? ids.indexOf(st.selection[0]) : -1
          const next = cmd.backward ? (cur <= 0 ? ids.length - 1 : cur - 1) : (cur + 1) % ids.length
          actions.select([ids[next]])
          return true
        }
        case 'pan':
          if (!e.repeat) setSpaceHeld(true)
          return true
        // The clipboard keys keep their default so the browser's own event can carry the data.
        case 'copy':
        case 'cut':
          startCopy(cmd.type === 'cut')
          return false
        case 'paste':
          if (!isEditable(st)) return false
          startPaste()
          return false
      }
      return false
    },
    [store, actions, canvas, ink, inkReadOnly, onZoom, picker, weblinkAt, quick, measured, startCopy, startPaste],
  )

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Control' || e.key === 'Meta') setCtrlHeld(true)
      const cmd = keyToCommand(e.nativeEvent, {
        hasSelection: store.getState().selection.length > 0,
        gridSnap: settings.isSnappingToGrid,
      })
      if (!cmd) return
      if (run(cmd, e)) {
        e.preventDefault()
        e.stopPropagation()
      }
    },
    [run, store, settings.isSnappingToGrid],
  )

  const onKeyUp = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === ' ') setSpaceHeld(false)
    if (e.key === 'Control' || e.key === 'Meta') setCtrlHeld(false)
  }, [])

  useEffect(() => {
    const reset = () => {
      setSpaceHeld(false)
      setCtrlHeld(false)
    }
    window.addEventListener('blur', reset)
    return () => window.removeEventListener('blur', reset)
  }, [])

  const toolAttr = !editable ? 'locked' : inkTool ? inkTool.tool : tool
  const placing = editable && !inkTool && !spaceHeld && isPlacementTool(tool) && !picker && !weblinkAt && !quick
  const isEmpty = Object.keys(board.nodes).length === 0 && strokes.length === 0

  return (
    <div
      ref={wrapperRef}
      className="whiteboard-canvas relative h-full w-full outline-none"
      data-tool={toolAttr}
      data-space-pan={spaceHeld ? 'true' : undefined}
      data-multi-node-selection={selection.filter((id) => id in board.nodes).length > 1 ? 'true' : undefined}
      data-testid="whiteboard-canvas"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <ReactFlow<FlowNode, FlowEdge>
        colorMode={dark ? 'dark' : 'light'}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes as unknown as FlowEdgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onSelectionDragStart={onSelectionDragStart}
        onSelectionDragStop={onNodeDragStop}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        onMoveEnd={onMoveEnd}
        minZoom={ZOOM_MIN}
        maxZoom={ZOOM_MAX}
        snapToGrid={snapGrid}
        snapGrid={[GRID, GRID]}
        zoomOnScroll={settings.isZoomingOnScroll}
        panOnScroll={!settings.isZoomingOnScroll}
        zoomOnDoubleClick={false}
        selectionOnDrag={tool === 'select' && !panning && !inkTool}
        panOnDrag={panning ? true : [1]}
        multiSelectionKeyCode="Shift"
        deleteKeyCode={null}
        nodesDraggable={editable && !panning}
        nodesConnectable={editable}
        elementsSelectable={!panning}
        onlyRenderVisibleElements={!exporting}
        proOptions={{ hideAttribution: true }}
      >
        <CameraInit boardKey={boardKey} onZoom={setZoom} paneSize={paneSize} />
        {settings.isShowingDots && <Background variant={BackgroundVariant.Dots} gap={GRID} />}
        <MarkerDefs edges={Object.values(board.edges)} />
        <Guides guides={guides} />
        {ink && (
          <ink.Layer
            strokes={strokes}
            tool={inkTool}
            readOnly={!editable || !!inkReadOnly}
            panning={panning}
            onStrokesChange={actions.setStrokes}
            onWheel={onInkWheel}
          />
        )}
        {!isEmpty && <LostState paneSize={paneSize} onBack={() => onZoom('fit')} />}
        {renderChrome?.({ zoom, onZoom, zoomToNode, zoomToBox })}
      </ReactFlow>
      {placing && <PlacementLayer tool={tool} snapToGrid={settings.isSnappingToGrid} onPlace={place} />}
      {isEmpty && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center" data-whiteboard-empty="">
          <p className="text-[14px] text-fg-muted">{WB.emptyStateDescription.text}</p>
        </div>
      )}
      {weblinkAt && (
        <div className="absolute top-1/2 left-1/2 z-20 -translate-x-1/2 -translate-y-1/2">
          <WeblinkInput onSubmit={onWeblink} onClose={() => setWeblinkAt(null)} />
        </div>
      )}
      {quick && (
        <div
          className="absolute z-20"
          style={{ left: quick.left, top: quick.top }}
          data-testid="whiteboard-quick-create-anchor"
        >
          <QuickCreateMenu onPick={onQuickPick} onClose={closeQuick} />
        </div>
      )}
      {picker && (
        <div className="absolute top-1/2 left-1/2 z-20 -translate-x-1/2 -translate-y-1/2">
          <ObjectPicker
            mode={picker.mode}
            typeId={picker.typeId}
            host={host}
            onPick={onPick}
            onClose={() => {
              setPicker(null)
              actions.setTool('select')
            }}
          />
        </div>
      )}
    </div>
  )
}

/** Resolves after `n` animation frames (so React Flow has rendered every node for the export). */
function nextFrames(n: number): Promise<void> {
  return new Promise((resolve) => {
    const step = (left: number) => {
      if (left <= 0) resolve()
      else if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => step(left - 1))
      else setTimeout(() => step(left - 1), 16)
    }
    step(n)
  })
}

/** Whether a drag carries files from the OS. */
function carriesFiles(dt: DataTransfer | null): boolean {
  if (!dt) return false
  return Array.from(dt.types ?? []).includes('Files') || (dt.files?.length ?? 0) > 0
}

/** Sets the first camera: the viewer's saved camera, else the file's viewport, else fit. */
function CameraInit({
  boardKey,
  onZoom,
  paneSize,
}: {
  boardKey: string
  onZoom(z: number): void
  paneSize(): { width: number; height: number }
}) {
  const rf = useReactFlow<FlowNode, FlowEdge>()
  const store = useBoardStore()
  const done = useRef(false)
  useEffect(() => {
    if (done.current) return
    done.current = true
    const board = store.getState().doc.board
    const saved = loadCamera(boardKey)
    let vp: Viewport
    if (saved) vp = saved
    else if (board.viewport && Number.isFinite(board.viewport.zoom) && board.viewport.zoom > 0) {
      vp = { x: board.viewport.x, y: board.viewport.y, zoom: board.viewport.zoom }
    } else {
      const boxes = Object.values(board.nodes).map(nodeBox)
      vp = fitBox(boxes, paneSize(), FIT_PADDING)
    }
    void rf.setViewport(vp)
    onZoom(vp.zoom)
  }, [rf, store, boardKey, onZoom, paneSize])
  return null
}

/** Snap-to-nodes guide lines while dragging. */
function Guides({ guides }: { guides: SnapGuide[] }) {
  if (!guides.length) return null
  return (
    <ViewportPortal>
      {guides.map((g, i) => (
        <div
          key={i}
          data-whiteboard-guide={g.orientation}
          style={{
            position: 'absolute',
            pointerEvents: 'none',
            background: 'var(--color-border-block-selection)',
            ...(g.orientation === 'vertical'
              ? { left: g.position, top: g.start, width: 1, height: g.end - g.start }
              : { top: g.position, left: g.start, height: 1, width: g.end - g.start }),
          }}
        />
      ))}
    </ViewportPortal>
  )
}

/** "Nothing in this view": the board has content but none of it is on screen. */
function LostState({ onBack, paneSize }: { onBack(): void; paneSize(): { width: number; height: number } }) {
  const { x, y, zoom } = useViewport()
  const board = useBoardState((s) => s.doc.board)
  const flowW = useFlowStore((s) => s.width)
  const flowH = useFlowStore((s) => s.height)
  const pane = flowW > 0 && flowH > 0 ? { width: flowW, height: flowH } : paneSize()
  const view: Box = { x: -x / zoom, y: -y / zoom, width: pane.width / zoom, height: pane.height / zoom }
  const boxes = Object.values(board.nodes).map(nodeBox)
  const bounds = boundsOf(boxes)
  if (!bounds) return null
  const visible = boxes.some(
    (b) =>
      b.x <= view.x + view.width &&
      b.x + b.width >= view.x &&
      b.y <= view.y + view.height &&
      b.y + b.height >= view.y,
  )
  if (visible) return null
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center" data-whiteboard-lost="">
      <div className="flex flex-col items-center gap-2 rounded-xl border border-line bg-raised px-6 py-5 text-center">
        <p className="text-[15px] font-semibold">{WB.lostTitle.text}</p>
        <p className="text-[13px] text-fg-muted">{WB.lostDescription.text}</p>
        <button
          type="button"
          className="mt-1 rounded-md bg-hover px-3 py-1 text-[13px]"
          onClick={onBack}
        >
          {WB.lostBackToContent.text}
        </button>
      </div>
    </div>
  )
}

/** Captures pointer input while a placement tool is armed: click places, drag draws a box. */
function PlacementLayer({
  tool,
  snapToGrid,
  onPlace,
}: {
  tool: WhiteboardTool
  snapToGrid: boolean
  onPlace(at: Placement, snap: boolean): void
}) {
  const rf = useReactFlow<FlowNode, FlowEdge>()
  const start = useRef<{ cx: number; cy: number } | null>(null)
  const [rubber, setRubber] = useState<Box | null>(null)
  const ref = useRef<HTMLDivElement | null>(null)

  const local = (cx: number, cy: number) => {
    const r = ref.current?.getBoundingClientRect()
    return { x: cx - (r?.left ?? 0), y: cy - (r?.top ?? 0) }
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    start.current = { cx: e.clientX, cy: e.clientY }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* jsdom, or a pointer already gone */
    }
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = start.current
    if (!s) return
    const a = local(s.cx, s.cy)
    const b = local(e.clientX, e.clientY)
    setRubber({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) })
  }
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = start.current
    start.current = null
    setRubber(null)
    if (!s) return
    const snap = snapToGrid && !(e.ctrlKey || e.metaKey)
    const p0 = rf.screenToFlowPosition({ x: s.cx, y: s.cy }, { snapToGrid: false })
    const p1 = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }, { snapToGrid: false })
    const moved = Math.hypot(e.clientX - s.cx, e.clientY - s.cy) >= 4
    if (!moved) onPlace(p0, snap)
    else if (isConnectorTool(tool)) onPlace({ start: p0, end: p1 }, snap)
    else
      onPlace(
        { x: Math.min(p0.x, p1.x), y: Math.min(p0.y, p1.y), width: Math.abs(p1.x - p0.x), height: Math.abs(p1.y - p0.y) },
        snap,
      )
  }

  return (
    <div
      ref={ref}
      className="absolute inset-0 z-[5]"
      style={{ cursor: 'crosshair', touchAction: 'none' }}
      data-whiteboard-placement={tool}
      data-testid="whiteboard-placement"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        start.current = null
        setRubber(null)
      }}
    >
      {rubber && (
        <div
          className="pointer-events-none absolute border border-dashed"
          style={{
            left: rubber.x,
            top: rubber.y,
            width: rubber.width,
            height: rubber.height,
            borderColor: 'var(--color-border-block-selection)',
          }}
        />
      )}
    </div>
  )
}
