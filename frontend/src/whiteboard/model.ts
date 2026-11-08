/**
 * The whiteboard's vocabulary and geometry: which shapes, tools, gates and connector styles
 * exist, how big new things are, how the 30 px grid snaps, and how stacking order is picked.
 *
 * Every string id here is written to disk (`*.whiteboard.json` nodes and edges, the tool memory
 * in `ui.json`), so ids never change; their menu order lives in the tables below.
 */
import type {
  WhiteboardBlock,
  WhiteboardCircuitLabel,
  WhiteboardConnectorTool,
  WhiteboardData,
  WhiteboardEdge,
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

/** The `version` a board file is written with. */
export const DATA_VERSION = 1

// ---- geometry ----

/** One grid cell (design spec: "grid of 30 px"). Everything below is counted in cells. */
export const GRID = 30
/** Free connector ends snap to half cells, so a loose arrow can sit between two nodes. */
export const GRID_HALF = GRID / 2

const cells = (n: number) => n * GRID

export interface Size {
  width: number
  height: number
}

export interface Box extends Size {
  x: number
  y: number
}

/** A new text node: 13 cells wide, two tall (one line of text and its padding). */
export const DEFAULT_NODE_WIDTH = cells(13)
export const DEFAULT_NODE_HEIGHT = cells(2)
/** A text node that has never been resized hugs its text between these bounds. */
export const AUTO_MIN_WIDTH = DEFAULT_NODE_WIDTH
export const AUTO_MAX_WIDTH = cells(20)
export const AUTO_MAX_HEIGHT = cells(16)
/** Mirrors the stylesheet's `--whiteboard-auto-text-min-height`. */
export const AUTO_TEXT_MIN_HEIGHT = cells(2)
/** An embedded object card is never narrower than this (its title, type chip and icon fit). */
export const LINK_BLOCK_MIN_WIDTH = cells(12)
/** The object card's title strip, drawn above the node box (`--whiteboard-embed-caption-height`/`-gap`). */
export const EMBED_CAPTION_HEIGHT = cells(1)
export const EMBED_CAPTION_GAP = 6
/** Resize floors. */
export const MIN_BLOCK_WIDTH = cells(2)
export const MIN_BLOCK_HEIGHT = cells(1)
export const MIN_SHAPE_WIDTH = cells(3)
export const MIN_SHAPE_HEIGHT = cells(3)
/** A clicked gate is a square at the shape floor. */
export const DEFAULT_CIRCUIT_WIDTH = MIN_SHAPE_WIDTH
export const DEFAULT_CIRCUIT_HEIGHT = MIN_SHAPE_HEIGHT
/** A clicked frame: wide enough to hold a couple of text nodes side by side. */
export const DEFAULT_FRAME_WIDTH = cells(20)
export const DEFAULT_FRAME_HEIGHT = cells(12)

/** Frames take z ≤ 0 and everything else z ≥ this, so content is never hidden behind a frame. */
export const CONTENT_Z_MIN = 1

// ---- camera ----

export const ZOOM_MIN = 0.02
export const ZOOM_MAX = 4
/** The zoom menu's entries and the stops of zoom in / zoom out, smallest first. */
export const ZOOM_PRESETS: readonly number[] = [0.05, 0.1, 0.2, 0.33, 0.5, 0.75, 1, 1.25, 1.6, 2, 3]

// ---- vocabulary ----

/** Node kinds, in the order a board file is usually read: frames behind, then content. */
export const NODE_KINDS: readonly WhiteboardNodeKind[] = ['frame', 'block', 'shape', 'point']

/**
 * Every shape a node can have. `menu` is the shape's place in the shape pickers (the toolbox
 * menu, quick create and "Change shape"); shapes without it still render on boards that use them.
 */
const SHAPE_TABLE: Record<WhiteboardShape, { menu?: number }> = {
  blockArrow: { menu: 8 },
  blockArrowLeft: {},
  bubble: { menu: 7 },
  diamond: { menu: 3 },
  ellipse: { menu: 2 },
  heart: { menu: 9 },
  parallelogram: { menu: 4 },
  rectangle: { menu: 1 },
  roundedRectangle: {},
  star: { menu: 6 },
  triangle: { menu: 5 },
  triangleDown: {},
}

export const SHAPES = Object.keys(SHAPE_TABLE) as readonly WhiteboardShape[]

export const PICKER_SHAPES: readonly WhiteboardPickerShape[] = SHAPES.filter((s) => SHAPE_TABLE[s].menu !== undefined).sort(
  (a, b) => SHAPE_TABLE[a].menu! - SHAPE_TABLE[b].menu!,
) as WhiteboardPickerShape[]

export const CONNECTOR_TOOLS: readonly WhiteboardConnectorTool[] = ['line', 'arrow']

/** The shape menu: the two connectors, then the picker shapes. */
export const SHAPE_MENU_TOOLS: readonly WhiteboardShapeMenuTool[] = [...CONNECTOR_TOOLS, ...PICKER_SHAPES]

/**
 * Logic gates (Engineering mode). A gate is stored as a plain `rectangle` whose text block is
 * the gate's name in capitals (`CIRCUIT_TEXT`), so a board stays readable without the mode.
 * Listed in menu order: the two-input basics, their negations, then the fixed inputs.
 */
export const CIRCUIT_LABELS: readonly WhiteboardCircuitLabel[] = ['and', 'or', 'not', 'nand', 'nor', 'xor', 'xnor', 'high', 'low']
/** The fixed-level inputs, shown under "I/O" in the gates menu. */
export const CIRCUIT_IO: readonly WhiteboardCircuitLabel[] = ['high', 'low']

export const CIRCUIT_TEXT = Object.fromEntries(CIRCUIT_LABELS.map((g) => [g, g.toUpperCase()])) as Readonly<
  Record<WhiteboardCircuitLabel, string>
>

/** The connector ends the style menu offers, top to bottom. */
export const PICKER_MARKERS: readonly WhiteboardPickerMarker[] = ['none', 'arrow', 'dot', 'double']
/** Every connector end a board file may hold: the offered ones plus `arrowClosed`, read and drawn as `arrow`. */
export const MARKERS: readonly WhiteboardMarker[] = [...PICKER_MARKERS, 'arrowClosed']
export const CONNECTIONS: readonly WhiteboardEdgeConnection[] = ['straight', 'cornered', 'curved']
export const LINES: readonly WhiteboardEdgeLine[] = ['solid', 'dashed', 'dotted']

export const DASHED_DASHARRAY = '8 8'
/** Zero-length dashes with round line caps draw a row of dots. */
export const DOTTED_DASHARRAY = '0 10'

/** The media menu (M8): the upload tools, then the web link. */
const UPLOAD_TOOLS = ['image', 'pdf', 'audio', 'file'] as const
export const MEDIA_TOOLS: readonly WhiteboardMediaTool[] = [...UPLOAD_TOOLS, 'weblink']

export const POINTER_TOOLS: readonly WhiteboardPointerTool[] = ['select', 'hand']

/** Tools that ask for something first (an object, a file, a URL) and then place it. */
const OBJECT_TOOLS: readonly WhiteboardTool[] = ['link', 'create']
export const PICKER_TOOLS: readonly WhiteboardTool[] = [...OBJECT_TOOLS, ...MEDIA_TOOLS]

/** Every canvas tool; the pen group belongs to the ink layer and is not listed. */
export const TOOLS: readonly WhiteboardTool[] = [
  ...POINTER_TOOLS,
  'text',
  ...PICKER_TOOLS,
  ...CONNECTOR_TOOLS,
  ...SHAPES,
  'frame',
  ...CIRCUIT_LABELS,
]

/** Tools that place one thing and then hand the pointer back to Move. */
export const ONE_SHOT_TOOLS: readonly WhiteboardTool[] = TOOLS.filter((t) => !POINTER_TOOLS.includes(t as WhiteboardPointerTool))

/** Display defaults, used for every key missing from `ui.json`. */
export const DEFAULT_SETTINGS: Required<WhiteboardSettings> = {
  isSnappingToGrid: true,
  isSnappingToNodes: true,
  isShowingDots: true,
  isZoomingOnScroll: true,
  isEngineeringMode: false,
}

// ---- type guards ----

function memberOf<T extends string>(list: readonly T[]): (v: unknown) => v is T {
  const set = new Set<string>(list)
  return (v: unknown): v is T => typeof v === 'string' && set.has(v)
}

export const isTool = memberOf(TOOLS)
export const isShapeTool = memberOf(SHAPES)
export const isPickerShape = memberOf(PICKER_SHAPES)
export const isCircuitLabel = memberOf(CIRCUIT_LABELS)
export const isConnectorTool = memberOf(CONNECTOR_TOOLS)
export const isPointerTool = memberOf(POINTER_TOOLS)
export const isShapeMenuTool = memberOf(SHAPE_MENU_TOOLS)
export const isMediaTool = memberOf(MEDIA_TOOLS)
const oneShot = memberOf(ONE_SHOT_TOOLS)
export const isOneShotTool = (t: unknown): boolean => oneShot(t)

// ---- connectors ----

const isConnection = memberOf(CONNECTIONS)
const isLine = memberOf(LINES)

/** A connector without a (known) `connection` draws as `cornered`, React Flow's smoothstep path. */
export function normalizeConnection(c: WhiteboardEdgeConnection | undefined): WhiteboardEdgeConnection {
  return isConnection(c) ? c : 'cornered'
}

/** A connector without a (known) `line` is solid. */
export function normalizeLine(l: WhiteboardEdgeLine | undefined): WhiteboardEdgeLine {
  return isLine(l) ? l : 'solid'
}

/** The end marker as the style menu shows it: `arrowClosed` is an arrow, anything unknown none. */
export function normalizeMarker(m: WhiteboardMarker | undefined): WhiteboardPickerMarker {
  if (m === 'arrowClosed') return 'arrow'
  return PICKER_MARKERS.includes(m as WhiteboardPickerMarker) ? (m as WhiteboardPickerMarker) : 'none'
}

/** The SVG `stroke-dasharray` for a line style (solid has none). */
export function dasharray(l: WhiteboardEdgeLine | undefined): string | undefined {
  switch (normalizeLine(l)) {
    case 'dashed':
      return DASHED_DASHARRAY
    case 'dotted':
      return DOTTED_DASHARRAY
    default:
      return undefined
  }
}

export type EdgeStyle = Pick<WhiteboardEdge, 'connection' | 'line'>

/** The style a new connector inherits from the last one drawn on this board; unset keys stay unset. */
export function rememberedEdgeStyle(connection?: WhiteboardEdgeConnection, line?: WhiteboardEdgeLine): EdgeStyle {
  const style: EdgeStyle = {}
  if (connection) style.connection = connection
  if (line) style.line = line
  return style
}

// ---- snapping ----

const step = (grid: number) => (grid > 0 ? grid : GRID)

/** `value` on the nearest grid line (non-numbers land on 0). */
export function snap(value: number, grid = GRID): number {
  const g = step(grid)
  return Number.isFinite(value) ? Math.round(value / g) * g : 0
}

export function snapPosition(p: WhiteboardPosition, grid = GRID): WhiteboardPosition {
  return { x: snap(p.x, grid), y: snap(p.y, grid) }
}

/** The shortest length that is a whole number of cells and at least `min` (always one cell or more). */
export function snapSpanMin(min: number, grid = GRID): number {
  const g = step(grid)
  const wanted = Number.isFinite(min) && min > 0 ? Math.ceil(min / g) : 1
  return Math.max(1, wanted) * g
}

/** A drawn box with all four edges moved onto the grid, kept at least `min` in each direction. */
export function snapBox(box: Box, min?: Size): Box {
  const [left, right] = [box.x, box.x + box.width].map((v) => snap(v))
  const [top, bottom] = [box.y, box.y + box.height].map((v) => snap(v))
  const width = Math.max(right - left, snapSpanMin(min?.width ?? 0))
  const height = Math.max(bottom - top, snapSpanMin(min?.height ?? 0))
  return { x: left, y: top, width, height }
}

/** The resize floor of a node kind; a point has no size at all. */
export function minSizeFor(kind: WhiteboardNodeKind): Size {
  switch (kind) {
    case 'point':
      return { width: 0, height: 0 }
    case 'block':
      return { width: MIN_BLOCK_WIDTH, height: MIN_BLOCK_HEIGHT }
    default:
      return { width: MIN_SHAPE_WIDTH, height: MIN_SHAPE_HEIGHT }
  }
}

/** Turning a shape into a line or arrow: a level connector across the shape's middle. */
export function connectorFromNodeBox({ x, y, width, height }: Box): { start: WhiteboardPosition; end: WhiteboardPosition } {
  const middle = y + height / 2
  return { start: { x, y: middle }, end: { x: x + width, y: middle } }
}

// ---- stacking order ----

type Stackable = { kind?: string; z?: number }
type StackNode = Stackable & { id: string }
type TitledNode = { kind?: string; title?: string }

const isFrame = (n: Stackable | undefined) => n?.kind === 'frame'

/** The z for a new block, shape or point: one above the highest content (frames ignored). */
export function nextContentZ(nodes: Iterable<Stackable>): number {
  let top = 0
  for (const n of nodes) if (!isFrame(n)) top = Math.max(top, n.z ?? 0)
  return Math.max(CONTENT_Z_MIN, top + 1)
}

/** The z for a new frame: one below the lowest frame, and never above 0. */
export function nextFrameZ(nodes: Iterable<Stackable>): number {
  const frameZs: number[] = []
  for (const n of nodes) if (isFrame(n)) frameZs.push(n.z ?? 0)
  return frameZs.length === 0 ? 0 : Math.min(1, ...frameZs) - 1
}

/**
 * "Send to back" for content: the z the first moved node gets, so the moved nodes fit under
 * the content that stays without dropping below `CONTENT_Z_MIN` (frames stay behind them).
 */
export function contentSendToBackStartZ(nodes: Iterable<StackNode>, moved: Iterable<string>): number {
  const moving = new Set(moved)
  const frameIds = new Set<string>()
  let lowestStaying: number | undefined
  for (const n of nodes) {
    if (isFrame(n)) {
      frameIds.add(n.id)
    } else if (!moving.has(n.id)) {
      const z = n.z ?? CONTENT_Z_MIN
      lowestStaying = lowestStaying === undefined ? z : Math.min(lowestStaying, z)
    }
  }
  if (lowestStaying === undefined) return CONTENT_Z_MIN
  const movingContent = [...moving].filter((id) => !frameIds.has(id)).length
  return Math.max(CONTENT_Z_MIN, lowestStaying - Math.max(1, movingContent))
}

/** "Frame N" with the smallest N no frame on the board already uses (other titles don't count). */
export function nextFrameTitle(nodes: Iterable<TitledNode>): string {
  const taken = new Set<number>()
  for (const n of nodes) {
    if (!isFrame(n)) continue
    const m = /^Frame (\d+)$/.exec((n.title ?? '').trim())
    if (m) taken.add(parseInt(m[1], 10))
  }
  let n = 1
  for (; taken.has(n); n++);
  return `Frame ${n}`
}

// ---- which tool a button arms ----

/** The pointer button: Move or Hand, whichever was used last; Move by default. */
export function resolvePointerTool(lastPointer?: WhiteboardTool, lastUsed?: WhiteboardTool): WhiteboardPointerTool {
  return [lastPointer, lastUsed].find(isPointerTool) ?? 'select'
}

/** The Shapes button: the last tool from the shape menu (or last shape drawn); Rectangle by default. */
export function resolveShapeMenuTool(
  lastShapeTool?: WhiteboardTool,
  lastUsed?: WhiteboardTool,
  lastShape?: WhiteboardShape,
): WhiteboardShapeMenuTool {
  return [lastShapeTool, lastUsed, lastShape].find(isShapeMenuTool) ?? 'rectangle'
}

/** The media button: the last media-menu entry; Image by default. */
export function resolveWhiteboardMediaTool(lastMediaTool?: WhiteboardTool, lastUsed?: WhiteboardTool): WhiteboardMediaTool {
  return [lastMediaTool, lastUsed].find(isMediaTool) ?? 'image'
}

/** The Gates button: the last gate; NAND (the gate every other one can be built from) by default. */
export function resolveCircuitTool(lastCircuitTool?: WhiteboardTool, lastUsed?: WhiteboardTool): WhiteboardCircuitLabel {
  return [lastCircuitTool, lastUsed].find(isCircuitLabel) ?? 'nand'
}

/** The tool a board opens with: its last one if that still exists; gates need Engineering mode; else Move. */
export function resolveLastUsedTool(lastUsed: WhiteboardTool | string | undefined, engineering = false): WhiteboardTool {
  if (!isTool(lastUsed)) return 'select'
  return isCircuitLabel(lastUsed) && !engineering ? 'select' : lastUsed
}

// ---- nodes ----

/** Whether connectors may attach to a node: anything but a point (a point is a connector's own end). */
export function isConnectable(node?: { kind?: string }): boolean {
  return node !== undefined && node.kind !== 'point'
}

const GATE_BY_TEXT = new Map<string, WhiteboardCircuitLabel>(CIRCUIT_LABELS.map((g) => [CIRCUIT_TEXT[g], g]))

/** The gate a node stands for: a rectangle whose text block reads exactly a gate's name, else `null`. */
export function circuitLabelOf(
  node: Pick<WhiteboardNode, 'kind' | 'shape' | 'blockId'> | undefined,
  blocks: Record<string, WhiteboardBlock>,
): WhiteboardCircuitLabel | null {
  if (node?.kind !== 'shape' || node.shape !== 'rectangle' || !node.blockId) return null
  const block = blocks[node.blockId]
  return block?.type === 'text' ? (GATE_BY_TEXT.get(block.markdown) ?? null) : null
}

export function isCircuitNode(
  node: Pick<WhiteboardNode, 'kind' | 'shape' | 'blockId'> | undefined,
  blocks: Record<string, WhiteboardBlock>,
): boolean {
  return circuitLabelOf(node, blocks) !== null
}

// ---- media (M8) ----

/** A media file's kind, from its extension (the same rules as attachments, M7). */
export function mediaKindOf(path: string): AttachmentKind {
  return attachmentKind(path)
}

/** The file kind each upload tool asks for (the file picker's `accept`; File takes anything). */
export const MEDIA_TOOL_KIND = {
  image: 'image',
  pdf: 'pdf',
  audio: 'audio',
  file: 'file',
} as const satisfies Record<Exclude<WhiteboardMediaTool, 'weblink'>, AttachmentKind>

/** A new media node's size by kind: pictures 14 × 10 cells, a PDF page 14 × 18, a player or file row 3 cells tall. */
export const MEDIA_DEFAULT_SIZE: Record<AttachmentKind, Size> = {
  image: { width: cells(14), height: cells(10) },
  video: { width: cells(14), height: cells(10) },
  pdf: { width: cells(14), height: cells(18) },
  audio: { width: cells(14), height: cells(3) },
  file: { width: cells(12), height: cells(3) },
}

/** A new web-link card: 12 × 3 cells. */
export const WEBLINK_DEFAULT_SIZE: Size = { width: cells(12), height: cells(3) }

/** Pictures and videos keep their proportions while resizing. */
export function keepsAspect(kind: AttachmentKind): boolean {
  return kind === 'image' || kind === 'video'
}

/**
 * The URL a web link stores, or `null`: `http` or `https`, a written-out host, no whitespace or
 * control characters (the server checks the same). A bare `example.org` becomes `https://example.org`.
 */
export function normalizeWeblinkUrl(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  // eslint-disable-next-line no-control-regex
  if (/[\u0000- \u007f]/.test(raw)) return null
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

/** A board with nothing on it, as the server writes a new one. */
export function emptyBoard(): WhiteboardData {
  return { version: DATA_VERSION, nodes: {}, edges: {}, blocks: {} }
}
