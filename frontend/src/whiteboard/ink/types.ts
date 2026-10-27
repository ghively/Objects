import type { ComponentType } from 'react'

/** The ink tools (Gene's addition; no Object original). */
export type InkTool = 'pen' | 'highlighter' | 'eraser'

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
  /** Debounced 400 ms; merges by stroke id on 409. */
  save(next: InkStroke[]): void
  flush(): Promise<void>
}

export interface InkPlugin {
  Layer: ComponentType<InkLayerProps>
  Toolbar: ComponentType<InkToolbarProps>
  useInkDoc(path: string): InkDoc
}
