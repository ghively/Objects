/**
 * Board actions: pure `(board, …) -> board` functions the store wraps. They follow the rules of
 * Capacities' `whiteboard.model.ts` (defaults, z order, frame titles, remembered edge style, gates
 * as a rectangle plus label). A function that changes nothing returns the board it was given.
 * Functions that create something take an optional `id` so the caller can select it afterwards.
 */
import type {
  WhiteboardBlock,
  WhiteboardData,
  WhiteboardEdge,
  WhiteboardEdgeConnection,
  WhiteboardEdgeLine,
  WhiteboardFillColor,
  WhiteboardMarker,
  WhiteboardNode,
  WhiteboardPosition,
  WhiteboardThemeColor,
  WhiteboardTool,
} from '@/api/whiteboardTypes'
import {
  CIRCUIT_TEXT,
  CONTENT_Z_MIN,
  DEFAULT_CIRCUIT_HEIGHT,
  DEFAULT_CIRCUIT_WIDTH,
  DEFAULT_FRAME_HEIGHT,
  DEFAULT_FRAME_WIDTH,
  DEFAULT_NODE_HEIGHT,
  DEFAULT_NODE_WIDTH,
  GRID,
  LINK_BLOCK_MIN_WIDTH,
  MEDIA_DEFAULT_SIZE,
  MIN_SHAPE_HEIGHT,
  MIN_SHAPE_WIDTH,
  isCircuitLabel,
  isConnectable,
  isConnectorTool,
  isShapeTool,
  mediaKindOf,
  minSizeFor,
  nextContentZ,
  nextFrameTitle,
  nextFrameZ,
  rememberedEdgeStyle,
  snapBox,
  snapPosition,
  WEBLINK_DEFAULT_SIZE,
  type Box,
} from './model'

// ---- ids ----

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** A ULID-like id (10 characters of time, 16 random; Crockford base 32), safe as a record key. */
export function newId(now: number = Date.now()): string {
  let t = Math.max(0, Math.floor(now))
  let time = ''
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32] + time
    t = Math.floor(t / 32)
  }
  const bytes = new Uint8Array(16)
  const c = globalThis.crypto as Crypto | undefined
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes)
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  let rand = ''
  for (const b of bytes) rand += ALPHABET[b % 32]
  return time + rand
}

// ---- geometry helpers ----

/** Click-placed shape size (our choice: the 90 × 90 shape floor, as a gate). */
export const DEFAULT_SHAPE_WIDTH = MIN_SHAPE_WIDTH
export const DEFAULT_SHAPE_HEIGHT = MIN_SHAPE_HEIGHT
/** Embedded object default height (our choice: four grid cells under the 360 minimum width). */
export const DEFAULT_ENTITY_HEIGHT = GRID * 4
/** A click with the Line or Arrow tool draws this long a horizontal connector (our choice). */
export const DEFAULT_CONNECTOR_LENGTH = GRID * 4

/** A node's box; a missing size falls back to its kind's default (points are size 0). */
export function nodeBox(n: WhiteboardNode): Box {
  let w = n.width
  let h = n.height
  if (typeof w !== 'number' || typeof h !== 'number') {
    const d =
      n.kind === 'point'
        ? { width: 0, height: 0 }
        : n.kind === 'frame'
          ? { width: DEFAULT_FRAME_WIDTH, height: DEFAULT_FRAME_HEIGHT }
          : n.kind === 'shape'
            ? { width: DEFAULT_SHAPE_WIDTH, height: DEFAULT_SHAPE_HEIGHT }
            : { width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT }
    w = typeof w === 'number' ? w : d.width
    h = typeof h === 'number' ? h : d.height
  }
  return { x: n.position.x, y: n.position.y, width: w, height: h }
}

export function boundsOf(boxes: readonly Box[]): Box | null {
  if (boxes.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const b of boxes) {
    minX = Math.min(minX, b.x)
    minY = Math.min(minY, b.y)
    maxX = Math.max(maxX, b.x + b.width)
    maxY = Math.max(maxY, b.y + b.height)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

const isPointLike = (at: unknown): at is WhiteboardPosition =>
  !!at && typeof at === 'object' && typeof (at as Box).width !== 'number' && !('start' in (at as object))

const isSegment = (at: unknown): at is { start: WhiteboardPosition; end: WhiteboardPosition } =>
  !!at && typeof at === 'object' && 'start' in (at as object) && 'end' in (at as object)

/** Writes `patch` onto `obj`; an `undefined` value removes the key. */
function patched<T extends object>(obj: T, patch: Partial<T>): T {
  const out = { ...obj } as Record<string, unknown>
  let changed = false
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) {
      if (k in out) {
        delete out[k]
        changed = true
      }
    } else if (out[k] !== v) {
      out[k] = v
      changed = true
    }
  }
  return changed ? (out as T) : obj
}

function withNodes(board: WhiteboardData, nodes: Record<string, WhiteboardNode>): WhiteboardData {
  return { ...board, nodes }
}

function idSet(ids: Iterable<string>): Set<string> {
  return ids instanceof Set ? (ids as Set<string>) : new Set(ids)
}

// ---- creating ----

export interface CreateOptions {
  /** The id of the created node (the edge for Line and Arrow). */
  id?: string
  /** Snap to the grid (default true; off while Ctrl is held). */
  snap?: boolean
  /** Remembered edge style of the board (`rememberedWhiteboardEdgeStyle`). */
  lastConnection?: WhiteboardEdgeConnection
  lastLine?: WhiteboardEdgeLine
  /** Shape colours (the tool memory's last fill and border). */
  fillColor?: WhiteboardFillColor
  borderColor?: WhiteboardThemeColor
  /** Click-placed size for shapes (the tool memory's last node size). */
  size?: { width: number; height: number }
  /** Initial Markdown of a text block. */
  text?: string
}

type Placement = Box | WhiteboardPosition | { start: WhiteboardPosition; end: WhiteboardPosition }

/** A click (point, default size centred on it) or a drag (box, snapped with the floor). */
function placeBox(at: Placement, size: { width: number; height: number }, min: { width: number; height: number }, snap: boolean): Box {
  if (isSegment(at)) {
    at = {
      x: Math.min(at.start.x, at.end.x),
      y: Math.min(at.start.y, at.end.y),
      width: Math.abs(at.end.x - at.start.x),
      height: Math.abs(at.end.y - at.start.y),
    }
  }
  if (isPointLike(at)) {
    const box = { x: at.x - size.width / 2, y: at.y - size.height / 2, width: size.width, height: size.height }
    if (!snap) return box
    const p = snapPosition(box)
    return { ...box, x: p.x, y: p.y }
  }
  const b = at as Box
  const norm: Box = {
    x: b.width < 0 ? b.x + b.width : b.x,
    y: b.height < 0 ? b.y + b.height : b.y,
    width: Math.abs(b.width),
    height: Math.abs(b.height),
  }
  if (snap) return snapBox(norm, min)
  return { ...norm, width: Math.max(min.width, norm.width), height: Math.max(min.height, norm.height) }
}

function addNode(board: WhiteboardData, node: WhiteboardNode, blocks?: Record<string, WhiteboardBlock>): WhiteboardData {
  return {
    ...board,
    nodes: { ...board.nodes, [node.id]: node },
    blocks: blocks ? { ...board.blocks, ...blocks } : board.blocks,
  }
}

function boxFields(b: Box): Pick<WhiteboardNode, 'position' | 'width' | 'height'> {
  return { position: { x: b.x, y: b.y }, width: b.width, height: b.height }
}

/**
 * Places what `tool` makes: a text block, a shape, a gate (a rectangle whose text block is the
 * gate's label), a frame ("Frame N", behind content) or a Line/Arrow connector between two new
 * points. Pointer and picker tools make nothing (the picker calls `createEntity`).
 */
export function createFromTool(board: WhiteboardData, tool: WhiteboardTool, at: Placement, opts: CreateOptions = {}): WhiteboardData {
  const snap = opts.snap !== false
  const nodes = Object.values(board.nodes)
  if (tool === 'text') {
    const id = opts.id ?? newId()
    const blockId = newId()
    const box = placeBox(at, { width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT }, minSizeFor('block'), snap)
    return addNode(
      board,
      { id, kind: 'block', blockId, ...boxFields(box), z: nextContentZ(nodes) },
      { [blockId]: { type: 'text', markdown: opts.text ?? '' } },
    )
  }
  if (isCircuitLabel(tool)) {
    const id = opts.id ?? newId()
    const blockId = newId()
    const box = placeBox(at, { width: DEFAULT_CIRCUIT_WIDTH, height: DEFAULT_CIRCUIT_HEIGHT }, minSizeFor('shape'), snap)
    return addNode(
      board,
      { id, kind: 'shape', shape: 'rectangle', blockId, ...boxFields(box), z: nextContentZ(nodes) },
      { [blockId]: { type: 'text', markdown: CIRCUIT_TEXT[tool] } },
    )
  }
  if (isShapeTool(tool)) {
    const id = opts.id ?? newId()
    const size = opts.size ?? { width: DEFAULT_SHAPE_WIDTH, height: DEFAULT_SHAPE_HEIGHT }
    const box = placeBox(at, size, minSizeFor('shape'), snap)
    const node: WhiteboardNode = { id, kind: 'shape', shape: tool, ...boxFields(box), z: nextContentZ(nodes) }
    if (opts.fillColor) node.fillColor = opts.fillColor
    if (opts.borderColor) node.borderColor = opts.borderColor
    if (opts.text !== undefined) {
      const blockId = newId()
      node.blockId = blockId
      return addNode(board, node, { [blockId]: { type: 'text', markdown: opts.text } })
    }
    return addNode(board, node)
  }
  if (tool === 'frame') {
    const id = opts.id ?? newId()
    const box = placeBox(at, { width: DEFAULT_FRAME_WIDTH, height: DEFAULT_FRAME_HEIGHT }, minSizeFor('frame'), snap)
    return addNode(board, { id, kind: 'frame', title: nextFrameTitle(nodes), ...boxFields(box), z: nextFrameZ(nodes) })
  }
  if (isConnectorTool(tool)) {
    let start: WhiteboardPosition
    let end: WhiteboardPosition
    if (isSegment(at)) {
      start = at.start
      end = at.end
    } else if (isPointLike(at)) {
      start = { x: at.x - DEFAULT_CONNECTOR_LENGTH / 2, y: at.y }
      end = { x: at.x + DEFAULT_CONNECTOR_LENGTH / 2, y: at.y }
    } else {
      const b = at as Box
      start = { x: b.x, y: b.y }
      end = { x: b.x + b.width, y: b.y + b.height }
    }
    if (snap) {
      start = snapPosition(start)
      end = snapPosition(end)
    }
    if (start.x === end.x && start.y === end.y) end = { x: start.x + DEFAULT_CONNECTOR_LENGTH, y: start.y }
    const a: WhiteboardNode = { id: newId(), kind: 'point', position: start }
    const b: WhiteboardNode = { id: newId(), kind: 'point', position: end }
    const edge: WhiteboardEdge = {
      id: opts.id ?? newId(),
      source: a.id,
      target: b.id,
      ...rememberedEdgeStyle(opts.lastConnection, opts.lastLine),
    }
    if (tool === 'arrow') edge.markerEnd = 'arrow'
    return {
      ...board,
      nodes: { ...board.nodes, [a.id]: a, [b.id]: b },
      edges: { ...board.edges, [edge.id]: edge },
    }
  }
  return board
}

/** An embedded object (an entity block holding `link`, a `[[wikilink]]`) centred on `at`. */
export function createEntity(
  board: WhiteboardData,
  link: string,
  at: WhiteboardPosition,
  opts: { id?: string; snap?: boolean } = {},
): WhiteboardData {
  const id = opts.id ?? newId()
  const blockId = newId()
  const box = placeBox(at, { width: LINK_BLOCK_MIN_WIDTH, height: DEFAULT_ENTITY_HEIGHT }, minSizeFor('block'), opts.snap !== false)
  return addNode(
    board,
    { id, kind: 'block', blockId, ...boxFields(box), z: nextContentZ(Object.values(board.nodes)) },
    { [blockId]: { type: 'entity', link } },
  )
}

/**
 * A media node (M8): a block node whose block is `{type: 'media', path}`, at its kind's default
 * size (`MEDIA_DEFAULT_SIZE`) centred on `at` and snapped to the grid. `headless` is Capacities'
 * flag for a media primitive placed from the media tool (no caption bar, fills its frame).
 */
export function createMedia(
  board: WhiteboardData,
  path: string,
  at: WhiteboardPosition,
  opts: { id?: string; snap?: boolean } = {},
): WhiteboardData {
  const id = opts.id ?? newId()
  const blockId = newId()
  const size = MEDIA_DEFAULT_SIZE[mediaKindOf(path)]
  const box = placeBox(at, size, minSizeFor('block'), opts.snap !== false)
  return addNode(
    board,
    { id, kind: 'block', blockId, ...boxFields(box), z: nextContentZ(Object.values(board.nodes)), headless: true },
    { [blockId]: { type: 'media', path } },
  )
}

/** A web-link card (M8): `{type: 'weblink', url, title?}`, 360 × 90 on the grid. Nothing is fetched. */
export function createWeblink(
  board: WhiteboardData,
  link: { url: string; title?: string },
  at: WhiteboardPosition,
  opts: { id?: string; snap?: boolean } = {},
): WhiteboardData {
  const id = opts.id ?? newId()
  const blockId = newId()
  const box = placeBox(at, WEBLINK_DEFAULT_SIZE, minSizeFor('block'), opts.snap !== false)
  const title = link.title?.trim()
  return addNode(
    board,
    { id, kind: 'block', blockId, ...boxFields(box), z: nextContentZ(Object.values(board.nodes)) },
    { [blockId]: { type: 'weblink', url: link.url, ...(title ? { title } : {}) } },
  )
}

export interface EdgeStyle {
  connection?: WhiteboardEdgeConnection
  line?: WhiteboardEdgeLine
  markerStart?: WhiteboardMarker
  markerEnd?: WhiteboardMarker
  color?: WhiteboardThemeColor
}

/** A connector between two existing nodes; refused (board unchanged) for a missing node, a self loop or a point. */
export function connect(
  board: WhiteboardData,
  source: string,
  target: string,
  handles: { sourceHandle?: string | null; targetHandle?: string | null } = {},
  style: EdgeStyle = {},
  id: string = newId(),
): WhiteboardData {
  const s = board.nodes[source]
  const t = board.nodes[target]
  if (!s || !t || source === target || !isConnectable(s) || !isConnectable(t)) return board
  const edge: WhiteboardEdge = { id, source, target }
  if (handles.sourceHandle) edge.sourceHandle = handles.sourceHandle
  if (handles.targetHandle) edge.targetHandle = handles.targetHandle
  for (const [k, v] of Object.entries(style)) if (v !== undefined) edge[k] = v
  return { ...board, edges: { ...board.edges, [id]: edge } }
}

// ---- editing ----

/** Patches a node (an `undefined` value removes the key); `id` and `kind` can't change. */
export function updateNode(board: WhiteboardData, id: string, patch: Partial<WhiteboardNode>): WhiteboardData {
  const n = board.nodes[id]
  if (!n) return board
  const { id: _i, kind: _k, ...rest } = patch
  void _i
  void _k
  const next = patched(n, rest)
  return next === n ? board : withNodes(board, { ...board.nodes, [id]: next })
}

/** Patches an edge (an `undefined` value removes the key); `id`, `source` and `target` stay. */
export function updateEdge(board: WhiteboardData, id: string, patch: Partial<WhiteboardEdge>): WhiteboardData {
  const e = board.edges[id]
  if (!e) return board
  const { id: _i, ...rest } = patch
  void _i
  const next = patched(e, rest)
  return next === e ? board : { ...board, edges: { ...board.edges, [id]: next } }
}

/**
 * Sets the block of a node or edge (`ownerId`), creating it and linking `blockId` when the owner
 * has none; `null` removes the block and the link. An edge's deprecated `label` goes once it has
 * a block. `ownerId` may also be a block id, which replaces that block.
 */
export function setBlock(board: WhiteboardData, ownerId: string, block: WhiteboardBlock | null): WhiteboardData {
  const node = board.nodes[ownerId]
  const edge = node ? undefined : board.edges[ownerId]
  if (!node && !edge) {
    if (!board.blocks[ownerId]) return board
    if (block === null) return board // a block still linked from an owner can't go on its own
    return { ...board, blocks: { ...board.blocks, [ownerId]: block } }
  }
  const owner = (node ?? edge)!
  const blocks = { ...board.blocks }
  let blockId = owner.blockId
  if (block === null) {
    if (blockId === undefined && !(edge && 'label' in edge)) return board
    if (blockId !== undefined) delete blocks[blockId]
    const next: Record<string, unknown> = { ...owner }
    delete next.blockId
    if (edge) delete next.label
    return node
      ? { ...board, blocks, nodes: { ...board.nodes, [ownerId]: next as WhiteboardNode } }
      : { ...board, blocks, edges: { ...board.edges, [ownerId]: next as WhiteboardEdge } }
  }
  blockId ??= newId()
  blocks[blockId] = block
  const next: Record<string, unknown> = { ...owner, blockId }
  if (edge) delete next.label
  return node
    ? { ...board, blocks, nodes: { ...board.nodes, [ownerId]: next as WhiteboardNode } }
    : { ...board, blocks, edges: { ...board.edges, [ownerId]: next as WhiteboardEdge } }
}

/** Adds a label text block to an edge (from its deprecated `label` string, when it has one). */
export function addEdgeLabel(board: WhiteboardData, edgeId: string): WhiteboardData {
  const e = board.edges[edgeId]
  if (!e) return board
  if (e.blockId !== undefined && board.blocks[e.blockId]) return board
  return setBlock(board, edgeId, { type: 'text', markdown: typeof e.label === 'string' ? e.label : '' })
}

export function removeEdgeLabel(board: WhiteboardData, edgeId: string): WhiteboardData {
  return board.edges[edgeId] ? setBlock(board, edgeId, null) : board
}

export function addFrameTitle(board: WhiteboardData, frameId: string): WhiteboardData {
  const f = board.nodes[frameId]
  if (!f || f.kind !== 'frame' || (typeof f.title === 'string' && f.title !== '')) return board
  const others = Object.values(board.nodes).filter((n) => n.id !== frameId)
  return updateNode(board, frameId, { title: nextFrameTitle(others) })
}

export function removeFrameTitle(board: WhiteboardData, frameId: string): WhiteboardData {
  const f = board.nodes[frameId]
  if (!f || f.kind !== 'frame') return board
  return updateNode(board, frameId, { title: undefined })
}

/** "Lock whiteboard" / "Unlock whiteboard". */
export function setLocked(board: WhiteboardData, locked: boolean): WhiteboardData {
  if (locked) return board.locked === true ? board : { ...board, locked: true }
  if (!('locked' in board)) return board
  const next = { ...board }
  delete next.locked
  return next
}

/** "Clear Whiteboard": no nodes, edges or blocks; every other key (viewport, readingOrder, …) stays. */
export function clearBoard(board: WhiteboardData): WhiteboardData {
  return { ...board, nodes: {}, edges: {}, blocks: {} }
}

// ---- removing ----

function blocksInUse(board: WhiteboardData): Set<string> {
  const used = new Set<string>()
  for (const n of Object.values(board.nodes)) if (n.blockId !== undefined) used.add(n.blockId)
  for (const e of Object.values(board.edges)) if (e.blockId !== undefined) used.add(e.blockId)
  return used
}

/**
 * Removes the selected nodes and edges, the edges touching removed nodes, the points left
 * without any connector by it (a Line's ends; our choice) and the blocks nothing uses any more.
 * Locked nodes stay (with their edges).
 */
export function removeSelection(board: WhiteboardData, ids: Iterable<string>): WhiteboardData {
  const sel = idSet(ids)
  const nodes = { ...board.nodes }
  const edges = { ...board.edges }
  const removedNodes = new Set<string>()
  for (const id of sel) {
    const n = nodes[id]
    if (n && !n.locked) {
      delete nodes[id]
      removedNodes.add(id)
    }
  }
  const touchedPoints = new Set<string>()
  let removedEdges = 0
  for (const [id, e] of Object.entries(edges)) {
    if (sel.has(id) || removedNodes.has(e.source) || removedNodes.has(e.target)) {
      delete edges[id]
      removedEdges++
      touchedPoints.add(e.source)
      touchedPoints.add(e.target)
    }
  }
  if (removedNodes.size === 0 && removedEdges === 0) return board
  const stillUsed = new Set<string>()
  for (const e of Object.values(edges)) {
    stillUsed.add(e.source)
    stillUsed.add(e.target)
  }
  for (const id of touchedPoints) {
    const n = nodes[id]
    if (n && n.kind === 'point' && !n.locked && !stillUsed.has(id)) {
      delete nodes[id]
      removedNodes.add(id)
    }
  }
  const next: WhiteboardData = { ...board, nodes, edges }
  const used = blocksInUse(next)
  const removedBlocks = new Set<string>()
  for (const n of [...Object.values(board.nodes), ...Object.values(board.edges)]) {
    if (n.blockId !== undefined && !used.has(n.blockId)) removedBlocks.add(n.blockId)
  }
  if (removedBlocks.size) {
    const blocks = { ...board.blocks }
    for (const id of removedBlocks) delete blocks[id]
    next.blocks = blocks
  }
  if (Array.isArray(board.readingOrder) && board.readingOrder.some((id) => removedNodes.has(id))) {
    next.readingOrder = board.readingOrder.filter((id) => !removedNodes.has(id))
  }
  return next
}

// ---- duplicating and moving ----

/** Duplicates nodes (and the edges between them, and their blocks); returns the new board and the new ids. */
export function duplicateSelection(
  board: WhiteboardData,
  ids: Iterable<string>,
  offset = GRID,
): { board: WhiteboardData; ids: string[] } {
  const sel = idSet(ids)
  const nodes = { ...board.nodes }
  const edges = { ...board.edges }
  const blocks = { ...board.blocks }
  const map = new Map<string, string>()
  const created: string[] = []
  const copyBlock = (blockId: string | undefined): string | undefined => {
    if (blockId === undefined || !board.blocks[blockId]) return undefined
    const nb = newId()
    blocks[nb] = structuredClone(board.blocks[blockId])
    return nb
  }
  const originals = Object.values(board.nodes)
    .filter((n) => sel.has(n.id))
    .sort((a, b) => (a.z ?? 0) - (b.z ?? 0))
  for (const n of originals) {
    const copy: WhiteboardNode = structuredClone(n)
    copy.id = newId()
    copy.position = { ...n.position, x: n.position.x + offset, y: n.position.y + offset }
    const all = Object.values(nodes)
    if (n.kind === 'frame') copy.z = nextFrameZ(all)
    else if (n.kind !== 'point' || n.z !== undefined) copy.z = nextContentZ(all)
    const nb = copyBlock(n.blockId)
    if (nb !== undefined) copy.blockId = nb
    else delete copy.blockId
    delete copy.locked
    nodes[copy.id] = copy
    map.set(n.id, copy.id)
    created.push(copy.id)
  }
  for (const e of Object.values(board.edges)) {
    const s = map.get(e.source)
    const t = map.get(e.target)
    if (!s || !t) continue
    const copy: WhiteboardEdge = structuredClone(e)
    copy.id = newId()
    copy.source = s
    copy.target = t
    const nb = copyBlock(e.blockId)
    if (nb !== undefined) copy.blockId = nb
    else delete copy.blockId
    edges[copy.id] = copy
    created.push(copy.id)
  }
  if (created.length === 0) return { board, ids: [] }
  return { board: { ...board, nodes, edges, blocks }, ids: created }
}

export function duplicate(board: WhiteboardData, ids: Iterable<string>, offset = GRID): WhiteboardData {
  return duplicateSelection(board, ids, offset).board
}

/** Ids of the nodes wholly inside a frame (computed from geometry; the schema has no parent). */
export function frameContents(board: WhiteboardData, frameId: string): string[] {
  const f = board.nodes[frameId]
  if (!f || f.kind !== 'frame') return []
  const fb = nodeBox(f)
  const out: string[] = []
  for (const n of Object.values(board.nodes)) {
    if (n.id === frameId) continue
    const b = nodeBox(n)
    if (b.x >= fb.x && b.y >= fb.y && b.x + b.width <= fb.x + fb.width && b.y + b.height <= fb.y + fb.height) out.push(n.id)
  }
  return out
}

/** Moves nodes by `(dx, dy)`; a moved frame takes the nodes inside it along. Locked nodes stay. */
export function nudge(board: WhiteboardData, ids: Iterable<string>, dx: number, dy: number): WhiteboardData {
  if ((!dx && !dy) || !Number.isFinite(dx) || !Number.isFinite(dy)) return board
  const moving = new Set<string>()
  for (const id of idSet(ids)) {
    const n = board.nodes[id]
    if (!n) continue
    moving.add(id)
    if (n.kind === 'frame') for (const c of frameContents(board, id)) moving.add(c)
  }
  let nodes: Record<string, WhiteboardNode> | null = null
  for (const id of moving) {
    const n = board.nodes[id]
    if (n.locked) continue
    nodes ??= { ...board.nodes }
    nodes[id] = { ...n, position: { ...n.position, x: n.position.x + dx, y: n.position.y + dy } }
  }
  return nodes ? withNodes(board, nodes) : board
}

// ---- z order ----

export type OrderMode = 'front' | 'forward' | 'backward' | 'back'

function reorderLayer(list: WhiteboardNode[], sel: Set<string>, mode: OrderMode): WhiteboardNode[] {
  const out = [...list]
  if (mode === 'front') return [...out.filter((n) => !sel.has(n.id)), ...out.filter((n) => sel.has(n.id))]
  if (mode === 'back') return [...out.filter((n) => sel.has(n.id)), ...out.filter((n) => !sel.has(n.id))]
  if (mode === 'forward') {
    for (let i = out.length - 2; i >= 0; i--) {
      if (sel.has(out[i].id) && !sel.has(out[i + 1].id)) [out[i], out[i + 1]] = [out[i + 1], out[i]]
    }
  } else {
    for (let i = 1; i < out.length; i++) {
      if (sel.has(out[i].id) && !sel.has(out[i - 1].id)) [out[i], out[i - 1]] = [out[i - 1], out[i]]
    }
  }
  return out
}

/** z values for a layer in its new order: the old values when they are distinct, else renumbered. */
function layerZs(before: WhiteboardNode[], frames: boolean): number[] {
  const zs = before.map((n) => n.z ?? (frames ? 0 : CONTENT_Z_MIN))
  if (new Set(zs).size === zs.length && zs.every((z) => (frames ? true : z >= CONTENT_Z_MIN))) return zs
  const n = before.length
  return before.map((_, i) => (frames ? i - (n - 1) : CONTENT_Z_MIN + i))
}

/**
 * Bring to front / forward, send backward / to back. Frames reorder among frames and content among
 * content, so frames always stay behind content.
 */
export function order(board: WhiteboardData, ids: Iterable<string>, mode: OrderMode): WhiteboardData {
  const sel = idSet(ids)
  const all = Object.values(board.nodes)
  const byZ = (frames: boolean) =>
    all
      .map((n, i) => ({ n, i }))
      .filter(({ n }) => (n.kind === 'frame') === frames)
      .sort((a, b) => (a.n.z ?? (frames ? 0 : CONTENT_Z_MIN)) - (b.n.z ?? (frames ? 0 : CONTENT_Z_MIN)) || a.i - b.i)
      .map(({ n }) => n)
  let nodes: Record<string, WhiteboardNode> | null = null
  for (const frames of [true, false]) {
    const before = byZ(frames)
    if (!before.some((n) => sel.has(n.id))) continue
    const after = reorderLayer(before, sel, mode)
    const zs = layerZs(before, frames)
    after.forEach((n, i) => {
      if (n.z !== zs[i]) {
        nodes ??= { ...board.nodes }
        nodes[n.id] = { ...n, z: zs[i] }
      }
    })
  }
  return nodes ? withNodes(board, nodes) : board
}

// ---- place (align and distribute) ----

export type PlaceMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' | 'row' | 'column' | 'grid'

/**
 * Aligns the selected nodes to the selection's left, centre, right, top, middle or bottom, or lays
 * them out in a row, a column or a grid one grid cell apart, from the selection's top-left corner.
 */
export function place(board: WhiteboardData, ids: Iterable<string>, mode: PlaceMode): WhiteboardData {
  const sel = idSet(ids)
  const items = Object.values(board.nodes).filter((n) => sel.has(n.id) && !n.locked)
  if (items.length < 2) return board
  const boxes = new Map(items.map((n) => [n.id, nodeBox(n)]))
  const bounds = boundsOf([...boxes.values()])!
  const target = new Map<string, WhiteboardPosition>()
  const at = (n: WhiteboardNode, x: number, y: number) => target.set(n.id, { x, y })
  const box = (n: WhiteboardNode) => boxes.get(n.id)!
  switch (mode) {
    case 'left':
      for (const n of items) at(n, bounds.x, box(n).y)
      break
    case 'right':
      for (const n of items) at(n, bounds.x + bounds.width - box(n).width, box(n).y)
      break
    case 'center':
      for (const n of items) at(n, bounds.x + bounds.width / 2 - box(n).width / 2, box(n).y)
      break
    case 'top':
      for (const n of items) at(n, box(n).x, bounds.y)
      break
    case 'bottom':
      for (const n of items) at(n, box(n).x, bounds.y + bounds.height - box(n).height)
      break
    case 'middle':
      for (const n of items) at(n, box(n).x, bounds.y + bounds.height / 2 - box(n).height / 2)
      break
    case 'row': {
      let x = bounds.x
      for (const n of [...items].sort((a, b) => box(a).x - box(b).x || box(a).y - box(b).y)) {
        at(n, x, bounds.y)
        x += box(n).width + GRID
      }
      break
    }
    case 'column': {
      let y = bounds.y
      for (const n of [...items].sort((a, b) => box(a).y - box(b).y || box(a).x - box(b).x)) {
        at(n, bounds.x, y)
        y += box(n).height + GRID
      }
      break
    }
    case 'grid': {
      const cols = Math.ceil(Math.sqrt(items.length))
      const cellW = Math.max(...items.map((n) => box(n).width))
      const cellH = Math.max(...items.map((n) => box(n).height))
      const sorted = [...items].sort((a, b) => box(a).y - box(b).y || box(a).x - box(b).x)
      sorted.forEach((n, i) => {
        at(n, bounds.x + (i % cols) * (cellW + GRID), bounds.y + Math.floor(i / cols) * (cellH + GRID))
      })
      break
    }
  }
  let nodes: Record<string, WhiteboardNode> | null = null
  for (const [id, p] of target) {
    const n = board.nodes[id]
    if (n.position.x === p.x && n.position.y === p.y) continue
    nodes ??= { ...board.nodes }
    nodes[id] = { ...n, position: { ...n.position, x: p.x, y: p.y } }
  }
  return nodes ? withNodes(board, nodes) : board
}

// ---- flip and frames ----

/** Flip horizontal / vertical: toggles `flipX`/`flipY` on the selected shapes (unset when off). */
export function flip(board: WhiteboardData, ids: Iterable<string>, axis: 'x' | 'y'): WhiteboardData {
  const key = axis === 'x' ? 'flipX' : 'flipY'
  let nodes: Record<string, WhiteboardNode> | null = null
  for (const id of idSet(ids)) {
    const n = board.nodes[id]
    if (!n || n.kind !== 'shape' || n.locked) continue
    nodes ??= { ...board.nodes }
    const next = { ...n }
    if (n[key]) delete next[key]
    else next[key] = true
    nodes[id] = next
  }
  return nodes ? withNodes(board, nodes) : board
}

/** "Wrap in new frame": a frame around the selection, one grid cell of padding, snapped outward, titled "Frame N". */
export function wrapInFrame(board: WhiteboardData, ids: Iterable<string>, opts: { id?: string } = {}): WhiteboardData {
  const sel = idSet(ids)
  const items = Object.values(board.nodes).filter((n) => sel.has(n.id))
  const b = boundsOf(items.map(nodeBox))
  if (!b) return board
  const x = Math.floor((b.x - GRID) / GRID) * GRID
  const y = Math.floor((b.y - GRID) / GRID) * GRID
  const x2 = Math.ceil((b.x + b.width + GRID) / GRID) * GRID
  const y2 = Math.ceil((b.y + b.height + GRID) / GRID) * GRID
  const all = Object.values(board.nodes)
  const frame: WhiteboardNode = {
    id: opts.id ?? newId(),
    kind: 'frame',
    title: nextFrameTitle(all),
    position: { x, y },
    width: x2 - x,
    height: y2 - y,
    z: nextFrameZ(all),
  }
  return addNode(board, frame)
}
