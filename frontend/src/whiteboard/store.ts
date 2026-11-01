/**
 * One zustand store per mounted board: the document (board plus ink strokes), selection, tool,
 * the text being edited, tool memory and the undo history. Every edit goes through `apply`, which
 * records one history step and bumps `boardSeq`/`strokesSeq` so `useBoard` (and the page, for the
 * ink) know what to save. Panning, zooming and selecting never touch the document.
 */
import { createContext, useContext } from 'react'
import { createStore, useStore, type StoreApi } from 'zustand'
import type { NodeChange } from '@xyflow/react'
import type {
  WhiteboardBoardToolMemory,
  WhiteboardData,
  WhiteboardPosition,
  WhiteboardTool,
} from '@/api/whiteboardTypes'
import * as A from './actions'
import type { BoardActions } from './canvasTypes'
import type { BoardDoc } from './flowMapping'
import { fromFlowChange } from './flowMapping'
import { History } from './history'
import { mergeBoards } from './merge'
import {
  emptyBoard,
  isCircuitLabel,
  isMediaTool,
  isOneShotTool,
  isPointerTool,
  isShapeMenuTool,
  isShapeTool,
} from './model'
import type { InkStroke, InkToolState } from './plugin'

export type { BoardDoc }

/** Store-internal actions the canvas and `useBoard` use (not part of the sub-lane contract). */
export interface CanvasActions {
  /** A document from the server (first load or external reload): replaces the doc; the steps are rebased onto it. */
  load(doc: BoardDoc): void
  /** The board after a merge: replaces it without marking it dirty; the steps are rebased onto it. */
  replaceBoard(board: WhiteboardData): void
  /** Strokes from the ink file (first load or the ink doc's own merge): no step, not dirty, the steps rebased. */
  loadStrokes(strokes: InkStroke[]): void
  setReadOnly(reason: string | null): void
  /** The ink file can't be written: no edit (clear, undo, redo, ink select) touches the strokes. */
  setInkReadOnly(readOnly: boolean): void
  setInkTool(tool: InkToolState | null): void
  /** A node drag starts: frames take the nodes wholly inside them (containment at drag start). */
  beginDrag(ids: string[], opts?: { duplicate?: boolean }): void
  /**
   * React Flow position/size changes during a drag or resize (one coalesced step per gesture; a
   * resize's step ends at its `resizing: false` change).
   */
  applyFlowChanges(changes: NodeChange[]): void
  endDrag(): void
  /** Rendered sizes of nodes (auto-sized blocks): used for frame containment and wrapping. */
  measure(sizes: A.MeasuredSizes): void
}

export interface BoardState {
  doc: BoardDoc
  /** Selected node and edge ids. */
  selection: string[]
  tool: WhiteboardTool
  /** The ink tool in use (pen group), or null for the canvas tools. */
  inkTool: InkToolState | null
  editingId: string | null
  memory: WhiteboardBoardToolMemory
  /** Set when the board file can't be written (unreadable or from a newer version). */
  readOnlyReason: string | null
  /** Set when the ink file can't be written; the strokes then stay as loaded (see `setInkReadOnly`). */
  inkReadOnly: boolean
  canUndo: boolean
  canRedo: boolean
  /** Bumped by every local change to the board / the strokes (what to save). */
  boardSeq: number
  strokesSeq: number
  dragging: boolean
  actions: BoardActions
  canvas: CanvasActions
}

export type BoardStore = StoreApi<BoardState>

export interface CreateBoardStoreOptions {
  doc?: BoardDoc
  tool?: WhiteboardTool
  memory?: WhiteboardBoardToolMemory
  /** Called whenever the tool memory changes (the page persists it). */
  onMemory?(memory: WhiteboardBoardToolMemory): void
}

/** Whether the board accepts edits (not read-only, not locked). */
export function isEditable(s: Pick<BoardState, 'readOnlyReason' | 'doc'>): boolean {
  return !s.readOnlyReason && s.doc.board.locked !== true
}

export function createBoardStore(opts: CreateBoardStoreOptions = {}): BoardStore {
  const initial: BoardDoc = opts.doc ?? { board: emptyBoard(), strokes: [] }
  const history = new History<BoardDoc>(initial)
  let gesture = 0
  let measured: Record<string, { width: number; height: number }> = {}
  /** `contents`: each dragged frame's followers; a node inside several dragged frames follows one. */
  let drag: { key: string; contents: Map<string, string[]> } | null = null

  return createStore<BoardState>()((set, get) => {
    const sync = () => ({ canUndo: history.canUndo, canRedo: history.canRedo })

    /** Records `next` as one step and marks what changed. */
    const commit = (next: BoardDoc, label: string, coalesceKey?: string) => {
      const { doc, boardSeq, strokesSeq } = get()
      if (next === doc || (next.board === doc.board && next.strokes === doc.strokes)) return
      history.push(next, label, coalesceKey)
      set({
        doc: next,
        boardSeq: next.board !== doc.board ? boardSeq + 1 : boardSeq,
        strokesSeq: next.strokes !== doc.strokes ? strokesSeq + 1 : strokesSeq,
        ...sync(),
      })
    }

    /** A board edit, refused when read-only or locked (except the lock itself). */
    const edit = (label: string, fn: (b: WhiteboardData) => WhiteboardData, coalesceKey?: string, evenLocked = false) => {
      const s = get()
      if (s.readOnlyReason) return
      if (!evenLocked && s.doc.board.locked === true) return
      const board = fn(s.doc.board)
      if (board === s.doc.board) return
      commit({ ...s.doc, board }, label, coalesceKey)
    }

    const ids = (given?: string[]) => given ?? get().selection

    /**
     * `doc` replaces the current document from outside (a reload, a merge, the ink file): each
     * history step keeps its own changes, replayed onto `doc` (boards by a three-way merge,
     * strokes by id), so the undo history survives.
     */
    const rebase = (doc: BoardDoc) => {
      history.rebase(doc, (step, old) => ({
        board:
          doc.board === old.board
            ? step.board
            : step.board === old.board
              ? doc.board
              : keepRemoteDeletes(old.board, doc.board, mergeBoards(old.board, step.board, doc.board)),
        strokes:
          doc.strokes === old.strokes
            ? step.strokes
            : step.strokes === old.strokes
              ? doc.strokes
              : rebaseStrokes(old.strokes as InkStroke[], step.strokes as InkStroke[], doc.strokes as InkStroke[]),
      }))
    }

    /** A history step to show: with the ink read-only, the strokes stay as they are. */
    const keepInk = (step: BoardDoc, current: BoardDoc): BoardDoc =>
      get().inkReadOnly && step.strokes !== current.strokes ? { ...step, strokes: current.strokes } : step

    const remember = (patch: Partial<WhiteboardBoardToolMemory>) => {
      const memory = { ...get().memory, ...patch }
      set({ memory })
      opts.onMemory?.(memory)
    }

    /** Creates with an id we know, then selects it; returns the id or null. */
    const created = (label: string, make: (b: WhiteboardData, id: string) => WhiteboardData): string | null => {
      const id = A.newId()
      const before = get().doc.board
      edit(label, (b) => make(b, id))
      if (get().doc.board === before) return null
      set({ selection: [id] })
      return id
    }

    const afterPlacing = (tool: WhiteboardTool) => {
      if (isOneShotTool(tool)) set({ tool: 'select' })
    }

    const actions: BoardActions = {
      apply(label, fn, coalesceKey) {
        edit(label, fn, coalesceKey)
      },
      undo() {
        if (get().readOnlyReason) return
        const step = history.undo()
        if (!step) return
        const prev = get().doc
        const doc = keepInk(step, prev)
        set({
          doc,
          boardSeq: doc.board !== prev.board ? get().boardSeq + 1 : get().boardSeq,
          strokesSeq: doc.strokes !== prev.strokes ? get().strokesSeq + 1 : get().strokesSeq,
          selection: get().selection.filter((id) => id in doc.board.nodes || id in doc.board.edges),
          ...sync(),
        })
      },
      redo() {
        if (get().readOnlyReason) return
        const step = history.redo()
        if (!step) return
        const prev = get().doc
        const doc = keepInk(step, prev)
        set({
          doc,
          boardSeq: doc.board !== prev.board ? get().boardSeq + 1 : get().boardSeq,
          strokesSeq: doc.strokes !== prev.strokes ? get().strokesSeq + 1 : get().strokesSeq,
          selection: get().selection.filter((id) => id in doc.board.nodes || id in doc.board.edges),
          ...sync(),
        })
      },
      select(next) {
        const cur = get().selection
        if (cur.length === next.length && cur.every((id, i) => id === next[i])) return
        set({ selection: [...next] })
      },
      setTool(tool) {
        set({ tool, inkTool: null })
        const patch: Partial<WhiteboardBoardToolMemory> = { lastUsedTool: tool }
        if (isPointerTool(tool)) patch.lastPointerTool = tool
        if (isShapeMenuTool(tool)) patch.lastShapeTool = tool
        if (isShapeTool(tool)) patch.lastShape = tool
        if (isCircuitLabel(tool)) patch.lastCircuitTool = tool
        if (isMediaTool(tool)) patch.lastMediaTool = tool
        remember(patch)
      },
      beginEdit(id) {
        if (!isEditable(get())) return
        history.seal()
        set({ editingId: id })
      },
      endEdit() {
        history.seal()
        set({ editingId: null })
      },
      remember,

      createFromTool(tool, at, o = {}) {
        const m = get().memory
        const id = created('create', (b, nid) =>
          A.createFromTool(b, tool, at, {
            id: nid,
            snap: o.snap,
            text: o.text,
            lastConnection: m.lastEdgeConnection,
            lastLine: m.lastEdgeLine,
          }),
        )
        if (id) afterPlacing(tool)
        return id
      },
      createEntity(link, at, o = {}) {
        return created('create', (b, nid) => A.createEntity(b, link, at, { id: nid, snap: o.snap }))
      },
      connect(source, target, handles, style) {
        const m = get().memory
        const st = { connection: m.lastEdgeConnection, line: m.lastEdgeLine, ...style }
        return created('connect', (b, nid) => A.connect(b, source, target, handles, st, nid))
      },
      updateNode(id, patch, coalesceKey) {
        edit('update', (b) => A.updateNode(b, id, patch), coalesceKey)
      },
      updateEdge(id, patch, coalesceKey) {
        edit('update', (b) => A.updateEdge(b, id, patch), coalesceKey)
      },
      setBlock(ownerId, block) {
        edit('text', (b) => A.setBlock(b, ownerId, block))
      },
      removeSelection(given) {
        const sel = ids(given)
        edit('delete', (b) => A.removeSelection(b, sel))
        const board = get().doc.board
        set({ selection: get().selection.filter((id) => id in board.nodes || id in board.edges) })
      },
      duplicate(given) {
        const sel = ids(given)
        let copies: string[] = []
        edit('duplicate', (b) => {
          const r = A.duplicateSelection(b, sel)
          copies = r.ids
          return r.board
        })
        if (copies.length) set({ selection: copies })
      },
      nudge(dx, dy, given) {
        const sel = ids(given)
        edit('move', (b) => A.nudge(b, sel, dx, dy, measured))
      },
      order(mode, given) {
        const sel = ids(given)
        edit('order', (b) => A.order(b, sel, mode))
      },
      place(mode, given) {
        const sel = ids(given)
        edit('place', (b) => A.place(b, sel, mode))
      },
      flip(axis, given) {
        const sel = ids(given)
        edit('flip', (b) => A.flip(b, sel, axis))
      },
      wrapInFrame(given) {
        const sel = ids(given)
        created('wrap', (b, nid) => A.wrapInFrame(b, sel, { id: nid, measured }))
      },
      clearBoard() {
        const s = get()
        if (!isEditable(s)) return
        const board = A.clearBoard(s.doc.board)
        const strokes = s.doc.strokes.length && !s.inkReadOnly ? [] : s.doc.strokes
        commit({ board, strokes }, 'clear')
        set({ selection: [], editingId: null })
      },
      setLocked(locked) {
        edit(locked ? 'lock' : 'unlock', (b) => A.setLocked(b, locked), undefined, true)
        if (locked) set({ selection: [], editingId: null })
      },
      addEdgeLabel(edgeId) {
        edit('label', (b) => A.addEdgeLabel(b, edgeId))
      },
      removeEdgeLabel(edgeId) {
        edit('label', (b) => A.removeEdgeLabel(b, edgeId))
      },
      addFrameTitle(frameId) {
        edit('title', (b) => A.addFrameTitle(b, frameId))
      },
      removeFrameTitle(frameId) {
        edit('title', (b) => A.removeFrameTitle(b, frameId))
      },
      setStrokes(next, label) {
        const s = get()
        if (!isEditable(s) || s.inkReadOnly) return
        commit({ ...s.doc, strokes: next }, label)
      },
    }

    const canvas: CanvasActions = {
      load(doc) {
        rebase(doc)
        set({
          doc,
          selection: get().selection.filter((id) => id in doc.board.nodes || id in doc.board.edges),
          ...sync(),
        })
      },
      replaceBoard(board) {
        // Every older step is rebased onto the merged board, so undoing one doesn't delete the
        // other window's merged changes on the next save.
        const doc = { ...get().doc, board }
        rebase(doc)
        set({
          doc,
          selection: get().selection.filter((id) => id in board.nodes || id in board.edges),
          ...sync(),
        })
      },
      loadStrokes(strokes) {
        const doc = { ...get().doc, strokes }
        // Strokes arrive once the ink file loads: every older step is rebased onto them, so undo
        // neither drops them nor loses the steps made before.
        rebase(doc)
        set({ doc, ...sync() })
      },
      setReadOnly(reason) {
        set({ readOnlyReason: reason, ...(reason ? { editingId: null } : {}) })
      },
      setInkReadOnly(readOnly) {
        if (get().inkReadOnly !== readOnly) set({ inkReadOnly: readOnly })
      },
      setInkTool(tool) {
        set(tool ? { inkTool: tool, tool: 'select' } : { inkTool: null })
      },
      beginDrag(dragIds, o = {}) {
        if (!isEditable(get())) return
        gesture++
        const key = `drag:${gesture}`
        // Containment is read before an Alt+drag copy exists, so a frame's copy doesn't follow it.
        const board = get().doc.board
        if (o.duplicate) {
          // Alt+drag: copies stay where the originals were; the originals move (one step).
          edit('duplicate', (b) => A.duplicateSelection(b, dragIds, 0).board, key)
        }
        const contents = new Map<string, string[]>()
        const claimed = new Set<string>(dragIds)
        for (const id of dragIds) {
          if (board.nodes[id]?.kind !== 'frame') continue
          const followers = A.frameContents(board, id, measured).filter((c) => !claimed.has(c))
          for (const c of followers) claimed.add(c)
          contents.set(id, followers)
        }
        drag = { key, contents }
        set({ dragging: true })
      },
      applyFlowChanges(changes) {
        const s = get()
        if (!isEditable(s)) return
        // React Flow ends a resize with `resizing: false`: the gesture's step is complete.
        if (!drag && changes.some((c) => c.type === 'dimensions' && c.resizing === false)) history.seal()
        const relevant = changes.filter(
          (c) => (c.type === 'position' && c.position) || (c.type === 'dimensions' && (c.resizing || c.setAttributes)),
        )
        if (!relevant.length) return
        const key = drag?.key ?? `resize:${relevant.map((c) => ('id' in c ? c.id : '')).join(',')}`
        edit(
          drag ? 'move' : 'resize',
          (b) => {
            let next = fromFlowChange(b, relevant)
            if (drag && drag.contents.size) {
              // The frame moved by (dx, dy): the nodes inside it follow.
              for (const c of relevant) {
                if (c.type !== 'position' || !c.position) continue
                const before = b.nodes[c.id]
                if (!before || before.kind !== 'frame') continue
                const dx = c.position.x - before.position.x
                const dy = c.position.y - before.position.y
                const followers = (drag.contents.get(c.id) ?? []).filter(
                  (id) => !relevant.some((r) => 'id' in r && r.id === id),
                )
                next = moveBy(next, followers, dx, dy)
              }
            }
            return next
          },
          key,
        )
      },
      endDrag() {
        drag = null
        history.seal()
        set({ dragging: false })
      },
      measure(sizes) {
        measured = { ...measured, ...sizes }
      },
    }

    return {
      doc: initial,
      selection: [],
      tool: opts.tool ?? 'select',
      inkTool: null,
      editingId: null,
      memory: opts.memory ?? {},
      readOnlyReason: null,
      inkReadOnly: false,
      canUndo: false,
      canRedo: false,
      boardSeq: 0,
      strokesSeq: 0,
      dragging: false,
      actions,
      canvas,
    }
  })
}

/**
 * A history step replayed onto a reloaded board (`merged`): nodes, edges and blocks that were in
 * the board the step was taken against (`old`) but are gone from the reloaded one were deleted
 * elsewhere, and undo or redo must not bring them back (`mergeBoards` lets a local change win,
 * which suits a save but not a step of history). Edges left without an end go too; a block still
 * used by a remaining node or edge stays, so the board stays valid.
 */
function keepRemoteDeletes(old: WhiteboardData, loaded: WhiteboardData, merged: WhiteboardData): WhiteboardData {
  const gone = (rec: 'nodes' | 'edges' | 'blocks') =>
    Object.keys(old[rec] ?? {}).filter((id) => !(id in (loaded[rec] ?? {})) && id in (merged[rec] ?? {}))
  const nodes = gone('nodes')
  const edges = gone('edges')
  const blocks = gone('blocks')
  if (nodes.length + edges.length + blocks.length === 0) return merged
  const out: WhiteboardData = {
    ...merged,
    nodes: { ...merged.nodes },
    edges: { ...merged.edges },
    blocks: { ...merged.blocks },
  }
  for (const id of nodes) delete out.nodes[id]
  for (const id of edges) delete out.edges[id]
  for (const [id, e] of Object.entries(out.edges)) {
    if (!out.nodes[e.source] || !out.nodes[e.target]) delete out.edges[id]
  }
  const used = new Set(
    [...Object.values(out.nodes), ...Object.values(out.edges)].map((o) => o.blockId).filter((id) => id !== undefined),
  )
  for (const id of blocks) if (!used.has(id)) delete out.blocks[id]
  return out
}

/**
 * The strokes of a history step replayed onto newly loaded ones, by id (as the ink module's
 * `mergeStrokes`; snapshots share stroke objects, so a stroke changed in the step is a new object):
 * strokes the step removed stay removed, ones it added or changed are kept.
 */
function rebaseStrokes(base: readonly InkStroke[], step: readonly InkStroke[], loaded: readonly InkStroke[]): InkStroke[] {
  const baseById = new Map(base.map((s) => [s.id, s]))
  const stepIds = new Set(step.map((s) => s.id))
  const changed = new Map(step.filter((s) => baseById.has(s.id) && baseById.get(s.id) !== s).map((s) => [s.id, s]))
  const out = loaded.filter((s) => !baseById.has(s.id) || stepIds.has(s.id)).map((s) => changed.get(s.id) ?? s)
  const have = new Set(out.map((s) => s.id))
  for (const s of step) if (!baseById.has(s.id) && !have.has(s.id)) out.push(s)
  return out
}

function moveBy(board: WhiteboardData, ids: string[], dx: number, dy: number): WhiteboardData {
  if ((!dx && !dy) || !ids.length) return board
  let nodes: WhiteboardData['nodes'] | null = null
  for (const id of ids) {
    const n = board.nodes[id]
    if (!n || n.locked) continue
    nodes ??= { ...board.nodes }
    const p: WhiteboardPosition = { ...n.position, x: n.position.x + dx, y: n.position.y + dy }
    nodes[id] = { ...n, position: p }
  }
  return nodes ? { ...board, nodes } : board
}

export const BoardStoreContext = createContext<BoardStore | null>(null)

/** The store of the board being rendered. */
export function useBoardStore(): BoardStore {
  const store = useContext(BoardStoreContext)
  if (!store) throw new Error('useBoardStore outside a whiteboard')
  return store
}

/** Select from the board store. */
export function useBoardState<T>(selector: (s: BoardState) => T): T {
  return useStore(useBoardStore(), selector)
}

/** The store actions (what nodes, edges and chrome call). */
export function useBoardActions(): BoardActions {
  return useStore(useBoardStore(), (s) => s.actions)
}
