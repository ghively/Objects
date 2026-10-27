/**
 * M6 whiteboard types: the board file (Object's `WhiteboardData` from `whiteboard.model.ts`,
 * plus our `blocks`), the board route's response and the user-level canvas display settings.
 * Unknown keys at every level are kept on read and on save, so each record allows extra keys.
 */

/** Object's 18 theme colours (`colorThemes.ts` `themeColors`). */
export type WhiteboardThemeColor =
  | 'gray'
  | 'rose'
  | 'pink'
  | 'fuchsia'
  | 'purple'
  | 'violet'
  | 'indigo'
  | 'blue'
  | 'sky'
  | 'cyan'
  | 'teal'
  | 'emerald'
  | 'green'
  | 'lime'
  | 'yellow'
  | 'amber'
  | 'orange'
  | 'red'

/** `colorThemes.ts` `backgroundColorThemes`: a shape's `fillColor`. */
export type WhiteboardFillColor = `bg-${WhiteboardThemeColor}`

export type WhiteboardNodeKind = 'block' | 'shape' | 'point' | 'frame'

export type WhiteboardShape =
  | 'rectangle'
  | 'roundedRectangle'
  | 'ellipse'
  | 'diamond'
  | 'triangle'
  | 'triangleDown'
  | 'star'
  | 'parallelogram'
  | 'bubble'
  | 'blockArrow'
  | 'blockArrowLeft'
  | 'heart'

/** Shapes offered in the picker (`whiteboardPickerShapes`). */
export type WhiteboardPickerShape =
  | 'rectangle'
  | 'ellipse'
  | 'diamond'
  | 'parallelogram'
  | 'triangle'
  | 'star'
  | 'bubble'
  | 'blockArrow'
  | 'heart'

export type WhiteboardCircuitLabel = 'not' | 'and' | 'nand' | 'or' | 'nor' | 'xor' | 'xnor' | 'high' | 'low'

export type WhiteboardMarker = 'none' | 'arrow' | 'arrowClosed' | 'dot' | 'double'
/** Tips offered in the picker; `arrowClosed` still parses and renders as `arrow`. */
export type WhiteboardPickerMarker = 'none' | 'arrow' | 'dot' | 'double'
export type WhiteboardEdgeConnection = 'straight' | 'cornered' | 'curved'
export type WhiteboardEdgeLine = 'solid' | 'dashed' | 'dotted'
export type WhiteboardTextAlign = 'left' | 'center' | 'right'
export type WhiteboardTextVerticalAlign = 'top' | 'center' | 'bottom'

export type WhiteboardConnectorTool = 'line' | 'arrow'
export type WhiteboardPointerTool = 'select' | 'hand'
export type WhiteboardShapeMenuTool = WhiteboardConnectorTool | WhiteboardPickerShape

/** The media tools (`whiteboardMediaTools`, M8): pick a file (or type a URL) and place it. */
export type WhiteboardMediaTool = 'image' | 'pdf' | 'audio' | 'file' | 'weblink'

/**
 * The canvas tools (`whiteboardTools`, in its order).
 * The pen group (pen, highlighter, eraser) belongs to the ink plugin, not to this union.
 */
export type WhiteboardTool =
  | WhiteboardPointerTool
  | 'text'
  | 'link'
  | 'create'
  | WhiteboardMediaTool
  | WhiteboardConnectorTool
  | WhiteboardShape
  | WhiteboardCircuitLabel
  | 'frame'

export interface WhiteboardPosition {
  x: number
  y: number
}

export interface WhiteboardNode {
  id: string
  kind: WhiteboardNodeKind
  blockId?: string
  position: WhiteboardPosition
  width?: number
  height?: number
  z?: number
  shape?: WhiteboardShape
  fillColor?: WhiteboardFillColor
  borderColor?: WhiteboardThemeColor
  locked?: boolean
  flipX?: boolean
  flipY?: boolean
  rotation?: number
  textVerticalAlign?: WhiteboardTextVerticalAlign
  headless?: boolean
  title?: string
  [unknown: string]: unknown
}

export interface WhiteboardEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
  markerStart?: WhiteboardMarker
  markerEnd?: WhiteboardMarker
  connection?: WhiteboardEdgeConnection
  line?: WhiteboardEdgeLine
  color?: WhiteboardThemeColor
  blockId?: string
  /** @deprecated plain-string label; becomes a text block on edit. */
  label?: string
  [unknown: string]: unknown
}

export interface WhiteboardTextBlock {
  type: 'text'
  markdown: string
  align?: WhiteboardTextAlign
  [unknown: string]: unknown
}

/** M7's four object views; an entity block's optional `view` (M8, our key; the View menu). */
export type WhiteboardEntityView = 'inline' | 'smallCard' | 'wideCard' | 'embed'

export interface WhiteboardEntityBlock {
  type: 'entity'
  /** A wikilink, `[[Title]]`. */
  link: string
  view?: WhiteboardEntityView
  [unknown: string]: unknown
}

/**
 * An uploaded file on the board (M8, our format): a relative space path, usually
 * `Attachments/<file>`; the kind (image, PDF, audio, video, file) comes from the extension.
 */
export interface WhiteboardMediaBlock {
  type: 'media'
  path: string
  [unknown: string]: unknown
}

/** A web link on the board (M8): only what the user typed; nothing is ever fetched. */
export interface WhiteboardWeblinkBlock {
  type: 'weblink'
  url: string
  title?: string
  [unknown: string]: unknown
}

export type WhiteboardBlock = WhiteboardTextBlock | WhiteboardEntityBlock | WhiteboardMediaBlock | WhiteboardWeblinkBlock

export interface WhiteboardViewport {
  x: number
  y: number
  zoom: number
  paneWidth?: number
  paneHeight?: number
  [unknown: string]: unknown
}

export interface WhiteboardData {
  version: number
  nodes: Record<string, WhiteboardNode>
  edges: Record<string, WhiteboardEdge>
  blocks: Record<string, WhiteboardBlock>
  viewport?: WhiteboardViewport
  locked?: boolean
  readingOrder?: string[]
  [unknown: string]: unknown
}

/** `GET /api/whiteboard`. `revision` is `''` when the board has no file yet. */
export interface BoardResponse {
  path: string
  board: WhiteboardData
  revision: string
  readOnlyReason?: string
}

/** `POST /api/whiteboards` (as `POST /api/objects`). */
export interface CreatedWhiteboard {
  path: string
  version: string
  typeIds: string[]
}

/** `ui.json` key `whiteboard` (Object's user-level names; absent = the defaults). */
export interface WhiteboardSettings {
  isSnappingToGrid?: boolean
  isSnappingToNodes?: boolean
  isShowingDots?: boolean
  isZoomingOnScroll?: boolean
  isEngineeringMode?: boolean
}

/** Per-board tool memory (`WhiteboardBoardToolMemory`), kept in `localStorage`. */
export interface WhiteboardBoardToolMemory {
  lastUsedTool?: WhiteboardTool
  lastCircuitTool?: WhiteboardCircuitLabel
  lastPointerTool?: WhiteboardPointerTool
  lastShape?: WhiteboardShape
  lastShapeTool?: WhiteboardTool
  lastMediaTool?: WhiteboardTool
  lastFillColor?: WhiteboardFillColor
  lastBorderColor?: WhiteboardThemeColor
  lastEdgeConnection?: WhiteboardEdgeConnection
  lastEdgeLine?: WhiteboardEdgeLine
  lastNodeSize?: { width: number; height: number }
}
