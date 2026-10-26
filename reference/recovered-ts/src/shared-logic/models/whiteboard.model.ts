import { z } from 'zod'
import {
  backgroundColorThemeSchema,
  themeColorSchema,
  type BackgroundColorTheme,
  type ThemeColor,
} from '../util/colorThemes.js'

/**
 * Whiteboard metadata lives on the entity (`data.whiteboard`), never on blocks.
 * Blocks stay canonical Capacities blocks in `data.blocks[WHITEBOARD_CANVAS_PROPERTY_ID]`;
 * the whiteboard layer only references them by `blockId`. The shape mirrors the canvas
 * library's node/edge model so mapping in both directions stays a plain projection.
 */

export const WHITEBOARD_DATA_VERSION = 1

/** Snap lattice and dotted-background gap. One editor text block tall. */
export const WHITEBOARD_GRID_SIZE = 30
/** Free arrow tips in empty space; node boxes stay on `WHITEBOARD_GRID_SIZE`. */
export const WHITEBOARD_GRID_HALF = WHITEBOARD_GRID_SIZE / 2
/** Floor for a single line of editor text. Same as one grid cell. */
export const WHITEBOARD_MIN_BLOCK_HEIGHT = WHITEBOARD_GRID_SIZE

/**
 * Default geometry for freshly created nodes, in canvas units.
 *
 * `width`/`height` on a node are *user-set* sizes. While they are absent the node sizes itself to
 * its content — growing in width up to the auto maximum, then wrapping and growing in height.
 * Resizing pins both. Default text height is 2 grid spaces (half-block pad + one block + pad)
 * so side handles sit on the lattice. Width is an even cell count so top/bottom handles do too.
 */
export const WHITEBOARD_DEFAULT_NODE_WIDTH = WHITEBOARD_GRID_SIZE * 14
export const WHITEBOARD_DEFAULT_NODE_HEIGHT = WHITEBOARD_GRID_SIZE * 2
export const WHITEBOARD_AUTO_MIN_WIDTH = WHITEBOARD_DEFAULT_NODE_WIDTH
/** Link-block (inline) column: auto min plus room for `p-2.5` padding and a tag chip. */
export const WHITEBOARD_LINK_BLOCK_MIN_WIDTH = 360
export const WHITEBOARD_AUTO_MAX_WIDTH = 480
/** Cap while a block node still hugs its content. A user resize can go taller. */
export const WHITEBOARD_AUTO_MAX_HEIGHT = 420
/** Object title bar that sits above a standard embed, outside the node box. */
export const WHITEBOARD_EMBED_CAPTION_HEIGHT = 40
/** Floor when the user resizes a block node. Fresh text nodes stay auto-sized below this. */
export const WHITEBOARD_MIN_BLOCK_WIDTH = 40
/** Floor for shape nodes. Three cells; nearest on-grid size to the old 80px floor. */
export const WHITEBOARD_MIN_SHAPE_WIDTH = WHITEBOARD_GRID_SIZE * 3
export const WHITEBOARD_MIN_SHAPE_HEIGHT = WHITEBOARD_GRID_SIZE * 3
/** Click- and quick-create labeled gates. Square at the shape floor; rubber-band overwrites. */
export const WHITEBOARD_DEFAULT_CIRCUIT_WIDTH = WHITEBOARD_MIN_SHAPE_WIDTH
export const WHITEBOARD_DEFAULT_CIRCUIT_HEIGHT = WHITEBOARD_MIN_SHAPE_HEIGHT
/** Click-created frames are larger than a shape so they can sit behind several objects. */
export const WHITEBOARD_DEFAULT_FRAME_WIDTH = 480
export const WHITEBOARD_DEFAULT_FRAME_HEIGHT = WHITEBOARD_GRID_SIZE * 14
/** Content nodes always stack above frames. */
export const WHITEBOARD_CONTENT_Z_MIN = 1

export const whiteboardNodeKinds = ['block', 'shape', 'point', 'frame'] as const
export const whiteboardNodeKindSchema = z.enum(whiteboardNodeKinds)
export type WhiteboardNodeKind = z.infer<typeof whiteboardNodeKindSchema>

/**
 * Gates-menu tools. Persist as `rectangle` plus this exact label; never as `node.shape`.
 */
export const whiteboardCircuitLabels = ['not', 'and', 'nand', 'or', 'nor', 'xor', 'xnor', 'high', 'low'] as const
export type WhiteboardCircuitLabel = (typeof whiteboardCircuitLabels)[number]

export const whiteboardCircuitLabelText = {
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

export const whiteboardShapes = [
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
] as const
export const whiteboardShapeSchema = z.enum(whiteboardShapes)
export type WhiteboardShape = z.infer<typeof whiteboardShapeSchema>

export const whiteboardMarkers = ['none', 'arrow', 'arrowClosed', 'dot', 'double'] as const
export const whiteboardMarkerSchema = z.enum(whiteboardMarkers)
export type WhiteboardMarker = z.infer<typeof whiteboardMarkerSchema>

/** Tips offered in the picker. `arrowClosed` still parses so older boards keep loading. */
export const whiteboardPickerMarkers = ['none', 'arrow', 'dot', 'double'] as const
export type WhiteboardPickerMarker = (typeof whiteboardPickerMarkers)[number]

/**
 * Connector geometry. `cornered` is Vue Flow smoothstep; `curved` is the bezier default.
 * Unset edges keep the historical cornered path.
 */
export const whiteboardEdgeConnections = ['straight', 'cornered', 'curved'] as const
export const whiteboardEdgeConnectionSchema = z.enum(whiteboardEdgeConnections)
export type WhiteboardEdgeConnection = z.infer<typeof whiteboardEdgeConnectionSchema>

export const whiteboardEdgeLines = ['solid', 'dashed', 'dotted'] as const
export const whiteboardEdgeLineSchema = z.enum(whiteboardEdgeLines)
export type WhiteboardEdgeLine = z.infer<typeof whiteboardEdgeLineSchema>

export function normalizeWhiteboardEdgeConnection(
  connection: WhiteboardEdgeConnection | undefined
): WhiteboardEdgeConnection {
  if (connection === 'straight' || connection === 'curved') return connection
  return 'cornered'
}

export function normalizeWhiteboardEdgeLine(line: WhiteboardEdgeLine | undefined): WhiteboardEdgeLine {
  if (line === 'dashed' || line === 'dotted') return line
  return 'solid'
}

/** Last-used connector geometry/stroke copied onto a newly created edge. */
export function rememberedWhiteboardEdgeStyle(
  lastConnection: WhiteboardEdgeConnection | undefined,
  lastLine: WhiteboardEdgeLine | undefined
): { connection?: WhiteboardEdgeConnection; line?: WhiteboardEdgeLine } {
  return {
    ...(lastConnection ? { connection: lastConnection } : {}),
    ...(lastLine ? { line: lastLine } : {}),
  }
}

/** Round caps + zero-length dashes read as a dotted stroke. */
export const WHITEBOARD_EDGE_DOTTED_DASHARRAY = '0 10'
/** Distinct from dotted: visible dashes with the same round caps as a solid stroke. */
export const WHITEBOARD_EDGE_DASHED_DASHARRAY = '8 8'

export function whiteboardEdgeDasharray(line: WhiteboardEdgeLine | undefined): string | undefined {
  const normalized = normalizeWhiteboardEdgeLine(line)
  if (normalized === 'dotted') return WHITEBOARD_EDGE_DOTTED_DASHARRAY
  if (normalized === 'dashed') return WHITEBOARD_EDGE_DASHED_DASHARRAY
  return undefined
}

/** Filled tips (`arrowClosed`) render and edit as the open arrow. */
export function normalizeWhiteboardMarker(marker: WhiteboardMarker | undefined): WhiteboardPickerMarker {
  if (marker === 'dot') return 'dot'
  if (marker === 'double') return 'double'
  if (marker === 'arrow' || marker === 'arrowClosed') return 'arrow'
  return 'none'
}

export const whiteboardPositionSchema = z.object({
  x: z.number(),
  y: z.number(),
})
export type WhiteboardPosition = z.infer<typeof whiteboardPositionSchema>

export const whiteboardNodeSchema = z.object({
  /** Stable node id. Survives shape -> block conversion, so it is not the block id. */
  id: z.string(),
  kind: whiteboardNodeKindSchema,
  /**
   * Reference into `data.blocks[WHITEBOARD_CANVAS_PROPERTY_ID]`.
   * Block nodes point at a GroupBlock; shapes point at their in-shape TextBlock.
   */
  blockId: z.string().optional(),
  position: whiteboardPositionSchema,
  width: z.number().optional(),
  height: z.number().optional(),
  /** Stacking order. Higher renders on top. */
  z: z.number().optional(),
  shape: whiteboardShapeSchema.optional(),
  fillColor: backgroundColorThemeSchema.optional(),
  borderColor: themeColorSchema.optional(),
  /** Per-node lock. Independent of the board-level `whiteboard.locked`. */
  locked: z.boolean().optional(),
  /** Horizontal mirror for asymmetric shapes (bubble tail, parallelogram, block arrow). */
  flipX: z.boolean().optional(),
  /** Vertical mirror for asymmetric shapes. */
  flipY: z.boolean().optional(),
  /** Clockwise rotation in degrees. Unset means 0. Shapes only. */
  rotation: z.number().optional(),
  /**
   * Vertical placement of in-shape text. Horizontal alignment lives on the TextBlock.
   * Unset means center, matching a freshly created shape.
   */
  textVerticalAlign: z.enum(['top', 'center', 'bottom']).optional(),
  /**
   * Fill-frame media primitive from the media tool (true) or @ / + (false). Unset
   * legacy media stays a primitive. Picking a card or standard embed view clears this.
   */
  headless: z.boolean().optional(),
  /** Optional caption on a `frame` node. Empty/omitted means no title bar. */
  title: z.string().optional(),
})
export type WhiteboardNode = z.infer<typeof whiteboardNodeSchema>

export const whiteboardEdgeSchema = z.object({
  id: z.string(),
  /** Source node id. */
  source: z.string(),
  /** Target node id. */
  target: z.string(),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
  markerStart: whiteboardMarkerSchema.optional(),
  markerEnd: whiteboardMarkerSchema.optional(),
  /** Unset means cornered (smoothstep), matching arrows drawn before this field existed. */
  connection: whiteboardEdgeConnectionSchema.optional(),
  /** Unset means a solid stroke. */
  line: whiteboardEdgeLineSchema.optional(),
  color: themeColorSchema.optional(),
  /**
   * Reference into `data.blocks[WHITEBOARD_CANVAS_PROPERTY_ID]`. Same TextBlock as in-shape
   * text. Absent until the user double-clicks the connector; cleared again if the text is empty.
   */
  blockId: z.string().optional(),
  /** @deprecated Plain-string labels. Rich text lives on `blockId`. */
  label: z.string().optional(),
})
export type WhiteboardEdge = z.infer<typeof whiteboardEdgeSchema>

export const whiteboardViewportSchema = z.object({
  x: z.number(),
  y: z.number(),
  zoom: z.number(),
  /** Pane size when this camera was saved. Needed to re-aim `x`/`y` on a different viewport. */
  paneWidth: z.number().optional(),
  paneHeight: z.number().optional(),
})
export type WhiteboardViewport = z.infer<typeof whiteboardViewportSchema>

export const whiteboardDataSchema = z.object({
  version: z.number(),
  /** Keyed by node id so concurrent edits to different nodes merge independently. */
  nodes: z.record(z.string(), whiteboardNodeSchema),
  edges: z.record(z.string(), whiteboardEdgeSchema),
  viewport: whiteboardViewportSchema.optional(),
  /** View-only lock, independent of `permissions.edit`. */
  locked: z.boolean().optional(),
  /**
   * Explicit node-id reading order. When set, export / search / the outline use this sequence
   * first; remaining nodes keep the geometric top-to-bottom, left-to-right sort. Reordering
   * never moves canvas geometry.
   */
  readingOrder: z.array(z.string()).optional(),
})
export type WhiteboardData = z.infer<typeof whiteboardDataSchema>

export function initializeWhiteboardData(): WhiteboardData {
  return {
    version: WHITEBOARD_DATA_VERSION,
    nodes: {},
    edges: {},
  }
}

/**
 * Tools available in the whiteboard toolbox. Persisted as the user's last used tool.
 *
 * `select` is Move: left-drag marquees, a node handle moves the node. `hand` pans with left-drag.
 * `line` / `arrow` draw connectors (free-standing via `kind: 'point'` endpoints, or node-to-node).
 */
export const whiteboardMediaTools = ['image', 'pdf', 'audio', 'file', 'weblink'] as const
export type WhiteboardMediaTool = (typeof whiteboardMediaTools)[number]

export const whiteboardMediaToolStructures = {
  image: 'MediaImage',
  pdf: 'MediaPDF',
  audio: 'MediaAudio',
  file: 'MediaFile',
  weblink: 'MediaWebResource',
} as const satisfies Record<WhiteboardMediaTool, string>

export const whiteboardTools = [
  'select',
  'hand',
  'text',
  'link',
  'create',
  ...whiteboardMediaTools,
  'line',
  'arrow',
  ...whiteboardShapes,
  ...whiteboardCircuitLabels,
  'frame',
] as const
export const whiteboardToolSchema = z.enum(whiteboardTools)
export type WhiteboardTool = z.infer<typeof whiteboardToolSchema>

/**
 * Filled shapes offered in both the global toolbox and the in-canvas change-shape menu.
 * `roundedRectangle`, `triangleDown`, and `blockArrowLeft` stay renderable for existing
 * boards but are not in the picker.
 */
export const whiteboardPickerShapes = [
  'rectangle',
  'ellipse',
  'diamond',
  'parallelogram',
  'triangle',
  'star',
  'bubble',
  'blockArrow',
  'heart',
] as const
export type WhiteboardPickerShape = (typeof whiteboardPickerShapes)[number]

/** Connector tools live in the shape menu even though they are not node shapes. */
export const whiteboardConnectorTools = ['line', 'arrow'] as const
export type WhiteboardConnectorTool = (typeof whiteboardConnectorTools)[number]

/** Pointer family in the toolbox: click the icon to re-arm the last of these. */
export const whiteboardPointerTools = ['select', 'hand'] as const
export type WhiteboardPointerTool = (typeof whiteboardPointerTools)[number]

/** Same order in the global shape menu and the in-canvas change-shape menu. */
export const whiteboardShapeMenuTools = [
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
] as const
export type WhiteboardShapeMenuTool = (typeof whiteboardShapeMenuTools)[number]

export function isWhiteboardMediaTool(tool: WhiteboardTool): tool is WhiteboardMediaTool {
  return (whiteboardMediaTools as readonly string[]).includes(tool)
}

/** Clicking the media tool re-arms the last media-menu option, falling back to image. */
export function resolveWhiteboardMediaTool(
  lastMediaTool?: WhiteboardTool | undefined,
  lastUsed?: WhiteboardTool | undefined
): WhiteboardMediaTool {
  if (lastMediaTool && isWhiteboardMediaTool(lastMediaTool)) return lastMediaTool
  if (lastUsed && isWhiteboardMediaTool(lastUsed)) return lastUsed
  return 'image'
}

/**
 * Last tool, colors, and connector style for one whiteboard. Stored per board so a
 * new board opens on Move with default colors instead of inheriting another board.
 */
export type WhiteboardBoardToolMemory = {
  lastUsedTool?: WhiteboardTool | undefined
  lastCircuitTool?: WhiteboardCircuitLabel | undefined
  lastPointerTool?: WhiteboardPointerTool | undefined
  lastShape?: WhiteboardShape | undefined
  lastShapeTool?: WhiteboardTool | undefined
  lastMediaTool?: WhiteboardTool | undefined
  lastFillColor?: BackgroundColorTheme | undefined
  lastBorderColor?: ThemeColor | undefined
  lastEdgeConnection?: WhiteboardEdgeConnection | undefined
  lastEdgeLine?: WhiteboardEdgeLine | undefined
  lastNodeSize?: { width: number; height: number } | undefined
}

export function whiteboardBoardToolMemory(
  boards: Record<string, WhiteboardBoardToolMemory> | undefined,
  entityId: string
): WhiteboardBoardToolMemory {
  return boards?.[entityId] ?? {}
}

export function patchWhiteboardBoardToolMemory(
  boards: Record<string, WhiteboardBoardToolMemory> | undefined,
  entityId: string,
  patch: WhiteboardBoardToolMemory
): Record<string, WhiteboardBoardToolMemory> {
  return {
    ...(boards ?? {}),
    [entityId]: { ...(boards?.[entityId] ?? {}), ...patch },
  }
}

export function resolveWhiteboardLastUsedTool(
  lastUsed?: WhiteboardTool | undefined,
  isEngineeringMode = false
): WhiteboardTool {
  if (!lastUsed) return 'select'
  if (isWhiteboardCircuitLabel(lastUsed) && !isEngineeringMode) return 'select'
  if (!(whiteboardTools as readonly string[]).includes(lastUsed)) return 'select'
  return lastUsed
}

/** Tools that open a picker rather than placing something directly under the pointer. */
export const whiteboardPickerTools: WhiteboardTool[] = ['link', 'create', ...whiteboardMediaTools]

/** Tools that place a single element and then hand control back to Move (`select`). Zoom is not in this list. */
export const whiteboardOneShotTools: WhiteboardTool[] = [
  'text',
  ...whiteboardShapes,
  ...whiteboardCircuitLabels,
  'frame',
  ...whiteboardConnectorTools,
  ...whiteboardPickerTools,
]

export function isWhiteboardShapeTool(tool: WhiteboardTool): tool is WhiteboardShape {
  return (whiteboardShapes as readonly string[]).includes(tool)
}

export function isWhiteboardCircuitLabel(tool: WhiteboardTool | string | undefined): tool is WhiteboardCircuitLabel {
  return !!tool && (whiteboardCircuitLabels as readonly string[]).includes(tool)
}

export function isWhiteboardPickerShapeTool(tool: WhiteboardTool): tool is WhiteboardPickerShape {
  return (whiteboardPickerShapes as readonly string[]).includes(tool)
}

export function isWhiteboardConnectorTool(tool: WhiteboardTool): tool is WhiteboardConnectorTool {
  return (whiteboardConnectorTools as readonly string[]).includes(tool)
}

export function isWhiteboardPointerTool(tool: WhiteboardTool): tool is WhiteboardPointerTool {
  return (whiteboardPointerTools as readonly string[]).includes(tool)
}

/** Move is the only tool that grabs nodes. Hand pans; placement tools draw through existing items. */
export function isWhiteboardNodeMoveTool(tool: WhiteboardTool): boolean {
  return tool === 'select'
}

/** Click-drag on the canvas places geometry, including over existing nodes. */
export function isWhiteboardDirectDrawTool(tool: WhiteboardTool): boolean {
  return (
    isWhiteboardShapeTool(tool) ||
    isWhiteboardCircuitLabel(tool) ||
    isWhiteboardFrameTool(tool) ||
    tool === 'text' ||
    isWhiteboardConnectorTool(tool)
  )
}

export function isWhiteboardShapeMenuTool(tool: WhiteboardTool): tool is WhiteboardShapeMenuTool {
  return (whiteboardShapeMenuTools as readonly string[]).includes(tool)
}

export function isWhiteboardFrameTool(tool: WhiteboardTool): tool is 'frame' {
  return tool === 'frame'
}

export function isWhiteboardFrameNode(node: { kind?: string } | undefined): boolean {
  return node?.kind === 'frame'
}

/** Points never take arrows. Frames, shapes, text, and objects do. */
export function isWhiteboardConnectableNode(node: { kind?: string } | undefined): boolean {
  return !!node && node.kind !== 'point'
}

/** Next z for blocks/shapes/points. Always at or above {@link WHITEBOARD_CONTENT_Z_MIN}. */
export function nextWhiteboardContentZ(nodes: Iterable<{ kind?: string; z?: number }>): number {
  let max = WHITEBOARD_CONTENT_Z_MIN - 1
  for (const node of nodes) {
    if (node.kind === 'frame') continue
    max = Math.max(max, node.z ?? 0)
  }
  return Math.max(WHITEBOARD_CONTENT_Z_MIN, max + 1)
}

/** Next z for a new frame: further back than existing frames, always below content. */
export function nextWhiteboardFrameZ(nodes: Iterable<{ kind?: string; z?: number }>): number {
  let min = 1
  let found = false
  for (const node of nodes) {
    if (node.kind !== 'frame') continue
    found = true
    min = Math.min(min, node.z ?? 0)
  }
  return found ? min - 1 : 0
}

/** Lowest z a content node may use when sent backward, still above every frame. */
export function whiteboardContentSendToBackStartZ(
  nodes: Iterable<{ id: string; kind?: string; z?: number }>,
  movingIds: Iterable<string>
): number {
  const moving = new Set(movingIds)
  const byId = new Map<string, { kind?: string; z?: number }>()
  let minContent = Infinity
  for (const node of nodes) {
    byId.set(node.id, node)
    if (node.kind === 'frame' || moving.has(node.id)) continue
    minContent = Math.min(minContent, node.z ?? WHITEBOARD_CONTENT_Z_MIN)
  }
  let movingCount = 0
  for (const id of moving) {
    if (byId.get(id)?.kind === 'frame') continue
    movingCount++
  }
  const next = Number.isFinite(minContent) ? minContent - Math.max(movingCount, 1) : WHITEBOARD_CONTENT_Z_MIN
  return Math.max(WHITEBOARD_CONTENT_Z_MIN, next)
}

const WHITEBOARD_FRAME_TITLE_PATTERN = /^Frame (\d+)$/

/** Next unused `Frame N` title. Custom titles do not consume a number. */
export function nextWhiteboardFrameTitle(nodes: Iterable<{ kind?: string; title?: string }>): string {
  const used = new Set<number>()
  for (const node of nodes) {
    if (node.kind !== 'frame') continue
    const match = WHITEBOARD_FRAME_TITLE_PATTERN.exec(node.title?.trim() ?? '')
    if (!match) continue
    used.add(Number(match[1]))
  }
  let n = 1
  while (used.has(n)) n++
  return `Frame ${n}`
}

/** Clicking the pointer tool re-arms Move or Hand, whichever was used last. */
export function resolveWhiteboardPointerTool(
  lastPointer?: WhiteboardTool | undefined,
  lastUsed?: WhiteboardTool | undefined
): WhiteboardPointerTool {
  if (lastPointer && isWhiteboardPointerTool(lastPointer)) return lastPointer
  if (lastUsed && isWhiteboardPointerTool(lastUsed)) return lastUsed
  return 'select'
}

/** Clicking the shapes tool re-arms the last shape-menu option, falling back to rectangle. */
export function resolveWhiteboardShapeMenuTool(
  lastShapeTool?: WhiteboardTool | undefined,
  lastUsed?: WhiteboardTool | undefined,
  lastShape?: WhiteboardShape | undefined
): WhiteboardShapeMenuTool {
  if (lastShapeTool && isWhiteboardShapeMenuTool(lastShapeTool)) return lastShapeTool
  if (lastUsed && isWhiteboardShapeMenuTool(lastUsed)) return lastUsed
  if (lastShape && isWhiteboardPickerShapeTool(lastShape)) return lastShape
  return 'rectangle'
}

export function minSizeForWhiteboardNode(kind: WhiteboardNodeKind): { width: number; height: number } {
  if (kind === 'block') return { width: WHITEBOARD_MIN_BLOCK_WIDTH, height: WHITEBOARD_MIN_BLOCK_HEIGHT }
  if (kind === 'point') return { width: 0, height: 0 }
  return { width: WHITEBOARD_MIN_SHAPE_WIDTH, height: WHITEBOARD_MIN_SHAPE_HEIGHT }
}

/** Clicking the circuit tool re-arms the last gate, falling back to NAND. */
export function resolveWhiteboardCircuitTool(
  lastCircuitTool?: WhiteboardTool | undefined,
  lastUsed?: WhiteboardTool | undefined
): WhiteboardCircuitLabel {
  if (lastCircuitTool && isWhiteboardCircuitLabel(lastCircuitTool)) return lastCircuitTool
  if (lastUsed && isWhiteboardCircuitLabel(lastUsed)) return lastUsed
  return 'nand'
}

export const WHITEBOARD_ZOOM_MIN = 0.02
export const WHITEBOARD_ZOOM_MAX = 4
/** Presets in the zoom menu. Pinch and zoom-out can still reach `WHITEBOARD_ZOOM_MIN`. */
export const WHITEBOARD_ZOOM_LEVELS = [0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const

export function snapToWhiteboardGrid(value: number, gridSize = WHITEBOARD_GRID_SIZE): number {
  if (!Number.isFinite(value)) return 0
  const grid = gridSize > 0 ? gridSize : WHITEBOARD_GRID_SIZE
  return Math.round(value / grid) * grid
}

export function snapWhiteboardPosition(
  position: WhiteboardPosition,
  gridSize = WHITEBOARD_GRID_SIZE
): WhiteboardPosition {
  return { x: snapToWhiteboardGrid(position.x, gridSize), y: snapToWhiteboardGrid(position.y, gridSize) }
}

/** Smallest on-lattice span: one cell, or `min` rounded up onto the grid. */
export function snapWhiteboardSpanMin(min: number, gridSize = WHITEBOARD_GRID_SIZE): number {
  const grid = gridSize > 0 ? gridSize : WHITEBOARD_GRID_SIZE
  if (!Number.isFinite(min) || min <= 0) return grid
  return Math.max(grid, Math.ceil(min / grid) * grid)
}

/** Horizontal connector through the middle of a shape, used when converting to line/arrow. */
export function whiteboardConnectorFromNodeBox(box: { x: number; y: number; width: number; height: number }): {
  start: WhiteboardPosition
  end: WhiteboardPosition
} {
  const y = box.y + box.height / 2
  return {
    start: { x: box.x, y },
    end: { x: box.x + box.width, y },
  }
}

/** Snap a drawn box so both origin and far edges land on the grid. */
export function snapWhiteboardBox(
  box: { x: number; y: number; width: number; height: number },
  min: { width: number; height: number } = { width: 0, height: 0 }
): { x: number; y: number; width: number; height: number } {
  const x = snapToWhiteboardGrid(box.x)
  const y = snapToWhiteboardGrid(box.y)
  const x2 = snapToWhiteboardGrid(box.x + box.width)
  const y2 = snapToWhiteboardGrid(box.y + box.height)
  return {
    x,
    y,
    width: Math.max(snapWhiteboardSpanMin(min.width), x2 - x),
    height: Math.max(snapWhiteboardSpanMin(min.height), y2 - y),
  }
}

/** Prefix for a canvas selection copied to the system clipboard. */
export const WHITEBOARD_CLIPBOARD_PREFIX = 'capacities-whiteboard-v1:'
