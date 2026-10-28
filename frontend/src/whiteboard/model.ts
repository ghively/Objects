/**
 * Whiteboard constants and rules. Values and behaviour follow Object's
 * `whiteboard.model.ts` (docs/design-notes); this is our own code.
 */
import type {
  WhiteboardBlock,
  WhiteboardCircuitLabel,
  WhiteboardConnectorTool,
  WhiteboardData,
  WhiteboardEdgeConnection,
  WhiteboardEdgeLine,
  WhiteboardMarker,
  WhiteboardMediaTool,
  WhiteboardNode,
  WhiteboardNodeKind,
  WhiteboardPickerMarker,
  WhiteboardPickerShape,
  WhiteboardPointerTool,
  WhiteboardPosition,
  WhiteboardSettings,
  WhiteboardShape,
  WhiteboardShapeMenuTool,
  WhiteboardTool,
} from '@/api/whiteboardTypes'
import { attachmentKind, type AttachmentKind } from '@/editor/annotations'

export const DATA_VERSION = 1

/** Snap lattice and dotted-background gap. */
export const GRID = 30
/** Free arrow tips in empty space. */
export const GRID_HALF = GRID / 2

export const DEFAULT_NODE_WIDTH = GRID * 14 // 420
export const DEFAULT_NODE_HEIGHT = GRID * 2 // 60
export const AUTO_MIN_WIDTH = DEFAULT_NODE_WIDTH
export const AUTO_MAX_WIDTH = 480
export const AUTO_MAX_HEIGHT = 420
/** CSS `--whiteboard-auto-text-min-height`. */
export const AUTO_TEXT_MIN_HEIGHT = 60
export const LINK_BLOCK_MIN_WIDTH = 360
/**
 * Embedded object caption bar above the node box. The model says 40, the shipped CSS
 * `--whiteboard-embed-caption-height: 30px` with a 6px gap; we use what renders (the CSS).
 */
export const EMBED_CAPTION_HEIGHT = 30
export const EMBED_CAPTION_GAP = 6
export const MIN_BLOCK_WIDTH = 40
export const MIN_BLOCK_HEIGHT = GRID
export const MIN_SHAPE_WIDTH = GRID * 3 // 90
export const MIN_SHAPE_HEIGHT = GRID * 3
export const DEFAULT_CIRCUIT_WIDTH = MIN_SHAPE_WIDTH
export const DEFAULT_CIRCUIT_HEIGHT = MIN_SHAPE_HEIGHT
export const DEFAULT_FRAME_WIDTH = 480
export const DEFAULT_FRAME_HEIGHT = GRID * 14 // 420
/** Content nodes always stack above frames. */
export const CONTENT_Z_MIN = 1

export const ZOOM_MIN = 0.02
export const ZOOM_MAX = 4
export const ZOOM_PRESETS = [0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const

export const NODE_KINDS = ['block', 'shape', 'point', 'frame'] as const satisfies readonly WhiteboardNodeKind[]

export const SHAPES = [
  'rectangle',
  'roundedRectangle',
  'ellipse',
  'diamond',
  'triangle',
  'triangleDown',
  'star',
  'parallelogram',
  'bubble',
  'blockArrow',
  'blockArrowLeft',
  'heart',
] as const satisfies readonly WhiteboardShape[]

/** `roundedRectangle`, `triangleDown` and `blockArrowLeft` render but are not in the picker. */
export const PICKER_SHAPES = [
  'rectangle',
  'ellipse',
  'diamond',
  'parallelogram',
  'triangle',
  'star',
  'bubble',
  'blockArrow',
  'heart',
] as const satisfies readonly WhiteboardPickerShape[]

export const CONNECTOR_TOOLS = ['line', 'arrow'] as const satisfies readonly WhiteboardConnectorTool[]

/** Same order in the toolbox shape menu and the change-shape menu. */
export const SHAPE_MENU_TOOLS = [
  'line',
  'arrow',
  'rectangle',
  'ellipse',
  'diamond',
  'parallelogram',
  'triangle',
  'star',
  'bubble',
  'blockArrow',
  'heart',
] as const satisfies readonly WhiteboardShapeMenuTool[]

/** Gates: persisted as a `rectangle` whose text block is exactly `CIRCUIT_TEXT[label]`. */
export const CIRCUIT_LABELS = [
  'not',
  'and',
  'nand',
  'or',
  'nor',
  'xor',
  'xnor',
  'high',
  'low',
] as const satisfies readonly WhiteboardCircuitLabel[]

export const CIRCUIT_TEXT = {
  not: 'NOT',
  and: 'AND',
  nand: 'NAND',
  or: 'OR',
  nor: 'NOR',
  xor: 'XOR',
  xnor: 'XNOR',
  high: 'HIGH',
  low: 'LOW',
} as const satisfies Record<WhiteboardCircuitLabel, string>

export const MARKERS = ['none', 'arrow', 'arrowClosed', 'dot', 'double'] as const satisfies readonly WhiteboardMarker[]
export const PICKER_MARKERS = ['none', 'arrow', 'dot', 'double'] as const satisfies readonly WhiteboardPickerMarker[]
export const CONNECTIONS = ['straight', 'cornered', 'curved'] as const satisfies readonly WhiteboardEdgeConnection[]
export const LINES = ['solid', 'dashed', 'dotted'] as const satisfies readonly WhiteboardEdgeLine[]

export const DASHED_DASHARRAY = '8 8'
/** Round caps plus zero-length dashes read as dots. */
export const DOTTED_DASHARRAY = '0 10'

/** `whiteboardMediaTools` (M8), in the media menu's order. */
export const MEDIA_TOOLS = ['image', 'pdf', 'audio', 'file', 'weblink'] as const satisfies readonly WhiteboardMediaTool[]

/** `whiteboardTools` order. */
export const TOOLS = [
  'select',
  'hand',
  'text',
  'link',
  'create',
  ...MEDIA_TOOLS,
  'line',
  'arrow',
  ...SHAPES,
  ...CIRCUIT_LABELS,
  'frame',
] as const satisfies readonly WhiteboardTool[]

export const POINTER_TOOLS = ['select', 'hand'] as const satisfies readonly WhiteboardPointerTool[]

/** Tools that open a picker instead of placing directly (`whiteboardPickerTools`). */
export const PICKER_TOOLS = ['link', 'create', ...MEDIA_TOOLS] as const satisfies readonly WhiteboardTool[]

/** Tools that place one item and hand control back to Move. */
export const ONE_SHOT_TOOLS: readonly WhiteboardTool[] = [
  'text',
  ...SHAPES,
  ...CIRCUIT_LABELS,
  'frame',
  ...CONNECTOR_TOOLS,
  ...PICKER_TOOLS,
]

/** Canvas display defaults (absent keys in `ui.json`). */
export const DEFAULT_SETTINGS: Required<WhiteboardSettings> = {
  isSnappingToGrid: true,
  isSnappingToNodes: true,
  isShowingDots: true,
  isZoomingOnScroll: true,
  isEngineeringMode: false,
}

// ---- type guards ----

const has = (list: readonly string[], v: unknown): boolean => typeof v === 'string' && list.includes(v)

export const isTool = (t: unknown): t is WhiteboardTool => has(TOOLS, t)
export const isShapeTool = (t: unknown): t is WhiteboardShape => has(SHAPES, t)
export const isPickerShape = (t: unknown): t is WhiteboardPickerShape => has(PICKER_SHAPES, t)
export const isCircuitLabel = (t: unknown): t is WhiteboardCircuitLabel => has(CIRCUIT_LABELS, t)
export const isConnectorTool = (t: unknown): t is WhiteboardConnectorTool => has(CONNECTOR_TOOLS, t)
export const isPointerTool = (t: unknown): t is WhiteboardPointerTool => has(POINTER_TOOLS, t)
export const isShapeMenuTool = (t: unknown): t is WhiteboardShapeMenuTool => has(SHAPE_MENU_TOOLS, t)
export const isOneShotTool = (t: unknown): boolean => has(ONE_SHOT_TOOLS, t)
export const isMediaTool = (t: unknown): t is WhiteboardMediaTool => has(MEDIA_TOOLS, t)

// ---- connectors ----

/** Unset (or unknown) is cornered: React Flow's smoothstep. */
export function normalizeConnection(c: WhiteboardEdgeConnection | undefined): WhiteboardEdgeConnection {
  return c === 'straight' || c === 'curved' ? c : 'cornered'
}

/** Unset (or unknown) is solid. */
export function normalizeLine(l: WhiteboardEdgeLine | undefined): WhiteboardEdgeLine {
  return l === 'dashed' || l === 'dotted' ? l : 'solid'
}

/** `arrowClosed` renders and edits as `arrow`; unset or unknown is `none`. */
export function normalizeMarker(m: WhiteboardMarker | undefined): WhiteboardPickerMarker {
  if (m === 'dot' || m === 'double') return m
  if (m === 'arrow' || m === 'arrowClosed') return 'arrow'
  return 'none'
}

export function dasharray(l: WhiteboardEdgeLine | undefined): string | undefined {
  const n = normalizeLine(l)
  if (n === 'dotted') return DOTTED_DASHARRAY
  if (n === 'dashed') return DASHED_DASHARRAY
  return undefined
}

/** The board's last connection and line, copied onto a new edge (only the keys that are set). */
export function rememberedEdgeStyle(
  lastConnection: WhiteboardEdgeConnection | undefined,
  lastLine: WhiteboardEdgeLine | undefined,
): { connection?: WhiteboardEdgeConnection; line?: WhiteboardEdgeLine } {
  return {
    ...(lastConnection ? { connection: lastConnection } : {}),
    ...(lastLine ? { line: lastLine } : {}),
  }
}

// ---- snapping ----

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export function snap(value: number, grid = GRID): number {
  if (!Number.isFinite(value)) return 0
  const g = grid > 0 ? grid : GRID
  return Math.round(value / g) * g
}

export function snapPosition(p: WhiteboardPosition, grid = GRID): WhiteboardPosition {
  return { x: snap(p.x, grid), y: snap(p.y, grid) }
}

/** The smallest on-grid span: one cell, or `min` rounded up onto the grid. */
export function snapSpanMin(min: number, grid = GRID): number {
  const g = grid > 0 ? grid : GRID
  if (!Number.isFinite(min) || min <= 0) return g
  return Math.max(g, Math.ceil(min / g) * g)
}

/** Snap a drawn box so its origin and far edges land on the grid, no smaller than `min`. */
export function snapBox(box: Box, min: { width: number; height: number } = { width: 0, height: 0 }): Box {
  const x = snap(box.x)
  const y = snap(box.y)
  const x2 = snap(box.x + box.width)
  const y2 = snap(box.y + box.height)
  return {
    x,
    y,
    width: Math.max(snapSpanMin(min.width), x2 - x),
    height: Math.max(snapSpanMin(min.height), y2 - y),
  }
}

export function minSizeFor(kind: WhiteboardNodeKind): { width: number; height: number } {
  if (kind === 'block') return { width: MIN_BLOCK_WIDTH, height: MIN_BLOCK_HEIGHT }
  if (kind === 'point') return { width: 0, height: 0 }
  return { width: MIN_SHAPE_WIDTH, height: MIN_SHAPE_HEIGHT }
}

/** A horizontal connector through the middle of a box (turning a shape into a line or arrow). */
export function connectorFromNodeBox(box: Box): { start: WhiteboardPosition; end: WhiteboardPosition } {
  const y = box.y + box.height / 2
  return { start: { x: box.x, y }, end: { x: box.x + box.width, y } }
}

// ---- z order ----

type Zed = { kind?: string; z?: number }

/** Next z for blocks, shapes and points: at least `CONTENT_Z_MIN`, above all other content. */
export function nextContentZ(nodes: Iterable<Zed>): number {
  let max = CONTENT_Z_MIN - 1
  for (const n of nodes) {
    if (n.kind === 'frame') continue
    max = Math.max(max, n.z ?? 0)
  }
  return Math.max(CONTENT_Z_MIN, max + 1)
}

/** Next z for a new frame: behind every existing frame, always below content. */
export function nextFrameZ(nodes: Iterable<Zed>): number {
  let min = 1
  let found = false
  for (const n of nodes) {
    if (n.kind !== 'frame') continue
    found = true
    min = Math.min(min, n.z ?? 0)
  }
  return found ? min - 1 : 0
}

/** The lowest z content sent to the back may take, still above every frame. */
export function contentSendToBackStartZ(
  nodes: Iterable<{ id: string; kind?: string; z?: number }>,
  movingIds: Iterable<string>,
): number {
  const moving = new Set(movingIds)
  const byId = new Map<string, Zed>()
  let minContent = Infinity
  for (const n of nodes) {
    byId.set(n.id, n)
    if (n.kind === 'frame' || moving.has(n.id)) continue
    minContent = Math.min(minContent, n.z ?? CONTENT_Z_MIN)
  }
  let count = 0
  for (const id of moving) if (byId.get(id)?.kind !== 'frame') count++
  const next = Number.isFinite(minContent) ? minContent - Math.max(count, 1) : CONTENT_Z_MIN
  return Math.max(CONTENT_Z_MIN, next)
}

const FRAME_TITLE = /^Frame (\d+)$/

/** The next unused "Frame N"; custom titles don't use a number. */
export function nextFrameTitle(nodes: Iterable<{ kind?: string; title?: string }>): string {
  const used = new Set<number>()
  for (const n of nodes) {
    if (n.kind !== 'frame') continue
    const m = FRAME_TITLE.exec(n.title?.trim() ?? '')
    if (m) used.add(Number(m[1]))
  }
  let i = 1
  while (used.has(i)) i++
  return `Frame ${i}`
}

// ---- tool resolution ----

/** The pointer button re-arms Move or Hand, whichever was last. */
export function resolvePointerTool(
  lastPointer?: WhiteboardTool,
  lastUsed?: WhiteboardTool,
): WhiteboardPointerTool {
  if (isPointerTool(lastPointer)) return lastPointer
  if (isPointerTool(lastUsed)) return lastUsed
  return 'select'
}

/** The Shapes button re-arms the last shape-menu tool, else Rectangle. */
export function resolveShapeMenuTool(
  lastShapeTool?: WhiteboardTool,
  lastUsed?: WhiteboardTool,
  lastShape?: WhiteboardShape,
): WhiteboardShapeMenuTool {
  if (isShapeMenuTool(lastShapeTool)) return lastShapeTool
  if (isShapeMenuTool(lastUsed)) return lastUsed
  if (isPickerShape(lastShape)) return lastShape
  return 'rectangle'
}

/** The media button re-arms the last media-menu option, else Image (`resolveWhiteboardMediaTool`). */
export function resolveWhiteboardMediaTool(lastMediaTool?: WhiteboardTool, lastUsed?: WhiteboardTool): WhiteboardMediaTool {
  if (isMediaTool(lastMediaTool)) return lastMediaTool
  if (isMediaTool(lastUsed)) return lastUsed
  return 'image'
}

/** The Gates button re-arms the last gate, else NAND. */
export function resolveCircuitTool(lastCircuitTool?: WhiteboardTool, lastUsed?: WhiteboardTool): WhiteboardCircuitLabel {
  if (isCircuitLabel(lastCircuitTool)) return lastCircuitTool
  if (isCircuitLabel(lastUsed)) return lastUsed
  return 'nand'
}

/** The tool a board opens on: the last used, else Move; gates fall back to Move without Engineering mode. */
export function resolveLastUsedTool(lastUsed: WhiteboardTool | string | undefined, engineering = false): WhiteboardTool {
  if (!lastUsed) return 'select'
  if (isCircuitLabel(lastUsed) && !engineering) return 'select'
  if (!isTool(lastUsed)) return 'select'
  return lastUsed
}

// ---- nodes ----

/** Points never take connectors; frames, shapes, text and objects do. */
export function isConnectable(node: { kind?: string } | undefined): boolean {
  return !!node && node.kind !== 'point'
}

/** The gate a node is, if it is a rectangle whose text block is exactly a gate's text. */
export function circuitLabelOf(
  node: Pick<WhiteboardNode, 'kind' | 'shape' | 'blockId'> | undefined,
  blocks: Record<string, WhiteboardBlock>,
): WhiteboardCircuitLabel | null {
  if (!node || node.kind !== 'shape' || node.shape !== 'rectangle' || !node.blockId) return null
  const block = blocks[node.blockId]
  if (!block || block.type !== 'text') return null
  for (const label of CIRCUIT_LABELS) if (block.markdown === CIRCUIT_TEXT[label]) return label
  return null
}

export function isCircuitNode(
  node: Pick<WhiteboardNode, 'kind' | 'shape' | 'blockId'> | undefined,
  blocks: Record<string, WhiteboardBlock>,
): boolean {
  return circuitLabelOf(node, blocks) !== null
}

// ---- media (M8) ----

/** The kind of a media block's file, from its extension (M7's `kind_of` rules). */
export function mediaKindOf(path: string): AttachmentKind {
  return attachmentKind(path)
}

/** The file kind each upload tool accepts (the picker's `accept`; File takes anything). */
export const MEDIA_TOOL_KIND = {
  image: 'image',
  pdf: 'pdf',
  audio: 'audio',
  file: 'file',
} as const satisfies Record<Exclude<WhiteboardMediaTool, 'weblink'>, AttachmentKind>

/**
 * A new media node's size by kind, on the grid (our choice; the trimmed reference has no
 * defaults): image and video 420 × 300, PDF 420 × 540, audio 420 × 90, file 360 × 90.
 */
export const MEDIA_DEFAULT_SIZE: Record<AttachmentKind, { width: number; height: number }> = {
  image: { width: GRID * 14, height: GRID * 10 },
  video: { width: GRID * 14, height: GRID * 10 },
  pdf: { width: GRID * 14, height: GRID * 18 },
  audio: { width: GRID * 14, height: GRID * 3 },
  file: { width: GRID * 12, height: GRID * 3 },
}

/** A new web-link card's size (our choice): 360 × 90, the embedded object's minimum width. */
export const WEBLINK_DEFAULT_SIZE = { width: GRID * 12, height: GRID * 3 }

/** Images and videos keep their aspect while resizing. */
export function keepsAspect(kind: AttachmentKind): boolean {
  return kind === 'image' || kind === 'video'
}

/**
 * A URL a web link may store: `http`/`https` with a host, no spaces or control characters (the
 * server's rule). A bare `example.org` gets `https://` in front (our choice); `null` otherwise.
 */
export function normalizeWeblinkUrl(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0020\u007f]/.test(raw)) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (!url.hostname) return null
  // The authority must be written out (`https:///x` parses with a host in WHATWG URL, not on the server).
  if (!/^[a-z]+:\/\/[^/?#]/i.test(withScheme)) return null
  return withScheme
}

/** The host a web-link card shows (without `www.`), or `''` for something that isn't a URL. */
export function weblinkHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** The empty board as the server writes it. */
export function emptyBoard(): WhiteboardData {
  return { version: DATA_VERSION, nodes: {}, edges: {}, blocks: {} }
}
