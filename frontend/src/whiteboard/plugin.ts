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

/**
 * The ink tool as the canvas sees it. The ink module's own `InkToolState` (`ink/types.ts`) also
 * has `tool: 'select'` (M8): the canvas only stores and passes the value back, so it is left out
 * of this union, which the canvas uses as a `Record` key for the drawing tools' default widths.
 */
export interface InkToolState {
  tool: 'pen' | 'highlighter' | 'eraser'
  color: string
  width: number
  /** The eraser's mode (M8); absent means whole strokes. */
  eraseMode?: 'stroke' | 'partial'
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
