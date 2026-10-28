import type { ReactNode } from 'react'
import type { MdStamp } from '@/api/whiteboardTypes'

/** The ink tools (Gene's addition; no Object original). `select` picks, moves and scales strokes (M8). */
export type InkTool = 'pen' | 'highlighter' | 'eraser' | 'select'

/** The eraser's modes: whole strokes (M6) or cutting strokes where it passes (M8; our choice of default `stroke`). */
export type InkEraseMode = 'stroke' | 'partial'

/** A stored stroke: a drawing tool, never the eraser. */
export type InkStrokeTool = 'pen' | 'highlighter'

/**
 * One freehand stroke in canvas (flow) units. `d` is the SVG path of the `perfect-freehand`
 * outline, computed by the client. `colorName` is the theme colour behind `color`, written as the
 * SVG's `data-color` (optional; the server accepts it as such).
 */
export interface InkStroke {
  id: string
  tool: InkStrokeTool
  color: string
  width: number
  points: [number, number, number][]
  d: string
  colorName?: string
}

export interface InkToolState {
  tool: InkTool
  color: string
  width: number
  /** The eraser's mode; absent means `stroke`. */
  eraseMode?: InkEraseMode
}

/** `GET /api/whiteboard/ink`: `revision` `''` when the file doesn't exist yet. */
export interface InkResponse {
  path: string
  strokes: InkStroke[]
  revision: string
  readOnlyReason?: string
}

/** Rendered as a child of `<ReactFlow>`; may use useReactFlow/useViewport/ViewportPortal. */
export interface InkLayerProps {
  strokes: InkStroke[]
  tool: InkToolState | null
  readOnly: boolean
  panning: boolean
  onStrokesChange(next: InkStroke[], label: 'draw' | 'erase'): void
  /** The canvas zooms or pans; the capture overlay forwards wheels while an ink tool is on. */
  onWheel(e: WheelEvent): void
}

export interface InkToolbarProps {
  value: InkToolState | null
  readOnly: boolean
  onChange(next: InkToolState | null): void
}

export interface InkDoc {
  /** `null` while loading. */
  strokes: InkStroke[] | null
  readOnlyReason: string | null
  /** The last save's failure ("Could not save the ink. …"), `null` once a save lands. */
  saveError?: string | null
  /** Debounced 400 ms; merges by stroke id on 409. */
  save(next: InkStroke[]): void
  flush(): Promise<void>
}

/**
 * The ink module's plugin. `Layer` and `Toolbar` are plain function components (not
 * `ComponentType`) so the canvas's declaration (`whiteboard/plugin.ts`), whose `InkToolState.tool`
 * leaves out the ink-only `'select'`, still accepts them: the canvas only stores the tool state
 * and passes it back.
 */
export interface InkPlugin {
  Layer: (props: InkLayerProps) => ReactNode
  Toolbar: (props: InkToolbarProps) => ReactNode
  /** M9: `onMdStamp` receives each landed save's stamp of the board `.md`. */
  useInkDoc(path: string, onMdStamp?: (stamp: MdStamp) => void): InkDoc
}
