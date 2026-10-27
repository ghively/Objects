/**
 * The canvas: React Flow (the React sibling of the Vue Flow canvas Capacities uses) over the
 * board store. Pan and zoom (2 % to 400 %), the 30 px dotted grid, snap to grid and to nodes,
 * marquee and Shift multi-select, tool placement (click = default size, drag = a box snapped
 * with `snapBox`), connections, frames dragging what is inside them, Alt-drag duplicate,
 * dropping objects in, the empty and lost states, and the ink layer when a plugin is given.
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
  type EdgeTypes as FlowEdgeTypes,
  type EdgeChange,
  type NodeChange,
  type OnNodeDrag,
  type Viewport as FlowViewport,
} from '@xyflow/react'
import type { WhiteboardPosition, WhiteboardTool } from '@/api/whiteboardTypes'
import { boundsOf, nodeBox } from './actions'
import { fitBox, zoomStep, wheelViewport, type Viewport } from './camera'
import type { Placement, ResolvedSettings, ZoomCommand } from './canvasTypes'
import { ObjectPicker } from './chrome'
import { mayCarryObject, readDroppedObject } from './dnd'
import { MarkerDefs, edgeTypes } from './edges'
import { toFlow, type FlowEdge, type FlowNode } from './flowMapping'
import type { WhiteboardHost } from './host'
import { GRID, ZOOM_MAX, ZOOM_MIN, isConnectorTool, isTool, type Box } from './model'
import { nodeTypes } from './nodes'
import type { InkPlugin, InkStroke, InkToolState } from './plugin'
import { keyToCommand, type Command } from './shortcuts'
import { snapToNodes, type SnapGuide } from './snapGuides'
import { isEditable, useBoardStore, useBoardState } from './store'
import { WB } from './strings'
import { loadCamera, saveCamera } from './toolMemory'

/** Padding around "Zoom to fit" / "Zoom to selection" (two grid cells; our choice). */
export const FIT_PADDING = GRID * 2

/** Ink tool defaults when a shortcut arms one (the plan's pen 4, highlighter 16, gray). */
const INK_DEFAULTS: Record<InkToolState['tool'], number> = { pen: 4, highlighter: 16, eraser: 4 }
const INK_DEFAULT_COLOR = '#5c5959'

/** Tools that place something with a click or a drag on the canvas. */
function isPlacementTool(tool: WhiteboardTool): boolean {
  return isTool(tool) && tool !== 'select' && tool !== 'hand'
}

export interface CanvasControls {
  zoom: number
  onZoom(cmd: ZoomCommand): void
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
}

export function WhiteboardCanvas(props: WhiteboardCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  )
}

function CanvasInner({ boardKey, settings, host, ink, inkReadOnly, renderChrome }: WhiteboardCanvasProps) {
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
  const [picker, setPicker] = useState<{ mode: 'link' | 'create'; at: WhiteboardPosition } | null>(null)
  const [zoom, setZoom] = useState(1)

  const selected = useMemo(() => new Set(selection), [selection])
  const flow = useMemo(() => toFlow(board, selected), [board, selected])
  const nodes = useMemo(
    () => flow.nodes.map((n) => (measured[n.id] ? { ...n, measured: measured[n.id] } : n)),
    [flow.nodes, measured],
  )
  const edges = flow.edges

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
      const id = actions.createFromTool(t, at, { snap })
      // A text block placed with the Text tool opens for typing at once (our choice).
      if (id && t === 'text') actions.beginEdit(id)
    },
    [actions, store],
  )

  const onPick = useCallback(
    ({ path }: { path: string }) => {
      const p = picker
      setPicker(null)
      if (!p) return
      actions.createEntity(host.linkFor(path), p.at, { snap: settings.isSnappingToGrid })
      actions.setTool('select')
    },
    [picker, actions, host, settings.isSnappingToGrid],
  )

  // ---- drag and drop of objects ----

  const onDragOver = useCallback(
    (e: ReactDragEvent) => {
      if (!editable || !mayCarryObject(e.dataTransfer)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    },
    [editable],
  )

  const onDrop = useCallback(
    (e: ReactDragEvent) => {
      if (!isEditable(store.getState())) return
      const obj = readDroppedObject(e.dataTransfer)
      if (!obj) return
      e.preventDefault()
      const at = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })
      const link = 'path' in obj ? host.linkFor(obj.path) : obj.link
      actions.createEntity(link, at, { snap: settings.isSnappingToGrid })
    },
    [store, rf, host, actions, settings.isSnappingToGrid],
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
          if (picker) {
            setPicker(null)
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
      }
      return false
    },
    [store, actions, canvas, ink, inkReadOnly, onZoom, picker],
  )

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Control' || e.key === 'Meta') setCtrlHeld(true)
      const cmd = keyToCommand(e.nativeEvent, { hasSelection: store.getState().selection.length > 0 })
      if (!cmd) return
      if (run(cmd, e)) {
        e.preventDefault()
        e.stopPropagation()
      }
    },
    [run, store],
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
  const placing = editable && !inkTool && !spaceHeld && isPlacementTool(tool) && !picker
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
        onlyRenderVisibleElements
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
        {renderChrome?.({ zoom, onZoom })}
      </ReactFlow>
      {placing && <PlacementLayer tool={tool} snapToGrid={settings.isSnappingToGrid} onPlace={place} />}
      {isEmpty && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center" data-whiteboard-empty="">
          <p className="text-[14px] text-fg-muted">{WB.emptyStateDescription.text}</p>
        </div>
      )}
      {picker && (
        <div className="absolute top-1/2 left-1/2 z-20 -translate-x-1/2 -translate-y-1/2">
          <ObjectPicker
            mode={picker.mode}
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
