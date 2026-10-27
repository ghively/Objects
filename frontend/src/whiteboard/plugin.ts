/**
 * The ink plugin contract, declared structurally on the canvas side (lane C never imports
 * `whiteboard/ink/`; Task 13 passes Lane B's `inkPlugin` in, and `tsc` proves the two match).
 */
import type { ComponentType } from 'react'

/** One freehand stroke in canvas (flow) units (the same six fields as the ink module's `InkStroke`). */
export interface InkStroke {
  id: string
  tool: 'pen' | 'highlighter'
  color: string
  width: number
  points: [number, number, number][]
  d: string
}

export interface InkToolState {
  tool: 'pen' | 'highlighter' | 'eraser'
  color: string
  width: number
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
