/**
 * Camera maths: wheel zoom and pan, fit to boxes, and zoom steps through the reference presets
 * (`WHITEBOARD_ZOOM_LEVELS`) within `WHITEBOARD_ZOOM_MIN`/`MAX`.
 */
import { ZOOM_MAX, ZOOM_MIN, ZOOM_PRESETS, type Box } from './model'

export interface Viewport {
  x: number
  y: number
  zoom: number
}

export interface WheelInput {
  deltaX: number
  deltaY: number
  ctrlKey: boolean
  /** Pointer position relative to the canvas pane (not the window). */
  clientX: number
  clientY: number
  shiftKey?: boolean
  /** `WheelEvent.deltaMode`: 1 = lines, 2 = pages; 0 (pixels) when absent. */
  deltaMode?: number
}

export const clampZoom = (z: number): number =>
  Number.isFinite(z) ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) : 1

/** Zoom to `zoom` keeping the pane point `(px, py)` over the same flow point. */
export function zoomAbout(viewport: Viewport, zoom: number, px: number, py: number): Viewport {
  const z = clampZoom(zoom)
  const fx = (px - viewport.x) / viewport.zoom
  const fy = (py - viewport.y) / viewport.zoom
  return { x: px - fx * z, y: py - fy * z, zoom: z }
}

function pixels(delta: number, mode: number | undefined): number {
  if (mode === 1) return delta * 16
  if (mode === 2) return delta * 400
  return delta
}

/**
 * The viewport after a wheel event: zoom about the pointer when "Zoom with scroll wheel" is on or
 * Ctrl is held (trackpad pinch arrives as a Ctrl wheel), else pan (Shift turns vertical into
 * horizontal scrolling, as browsers do).
 */
export function wheelViewport(viewport: Viewport, e: WheelInput, zoomOnScroll: boolean): Viewport {
  const dx = pixels(e.deltaX, e.deltaMode)
  const dy = pixels(e.deltaY, e.deltaMode)
  if (zoomOnScroll || e.ctrlKey) {
    const speed = e.ctrlKey ? 0.01 : 0.002
    const factor = Math.pow(2, -dy * speed)
    return zoomAbout(viewport, viewport.zoom * factor, e.clientX, e.clientY)
  }
  if (e.shiftKey && dx === 0) return { ...viewport, x: viewport.x - dy }
  return { ...viewport, x: viewport.x - dx, y: viewport.y - dy }
}

/** Highest zoom "Zoom to fit" / "Zoom to selection" use (our choice: never magnify past 100 %). */
export const FIT_MAX_ZOOM = 1

/** The viewport that shows every box inside `pane` with `padding` pixels around; zoom 1 at the origin when empty. */
export function fitBox(
  boxes: readonly Box[],
  pane: { width: number; height: number },
  padding = 0,
  /** The highest zoom used (M8: a presented frame fills the view, up to the 400 % limit). */
  maxZoom = FIT_MAX_ZOOM,
): Viewport {
  if (boxes.length === 0) return { x: 0, y: 0, zoom: 1 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const b of boxes) {
    minX = Math.min(minX, b.x)
    minY = Math.min(minY, b.y)
    maxX = Math.max(maxX, b.x + Math.max(0, b.width))
    maxY = Math.max(maxY, b.y + Math.max(0, b.height))
  }
  const bw = maxX - minX
  const bh = maxY - minY
  const aw = Math.max(1, pane.width - 2 * padding)
  const ah = Math.max(1, pane.height - 2 * padding)
  let zoom = Math.min(bw > 0 ? aw / bw : Infinity, bh > 0 ? ah / bh : Infinity)
  if (!Number.isFinite(zoom)) zoom = maxZoom
  zoom = clampZoom(Math.min(maxZoom, zoom))
  const cx = minX + bw / 2
  const cy = minY + bh / 2
  return { x: pane.width / 2 - cx * zoom, y: pane.height / 2 - cy * zoom, zoom }
}

const EPS = 1e-6

/** The next preset in or out; beyond the last preset, the zoom limits (4 and 0.02). */
export function zoomStep(zoom: number, direction: 'in' | 'out'): number {
  if (direction === 'in') {
    for (const p of ZOOM_PRESETS) if (p > zoom + EPS) return p
    return ZOOM_MAX
  }
  for (let i = ZOOM_PRESETS.length - 1; i >= 0; i--) if (ZOOM_PRESETS[i] < zoom - EPS) return ZOOM_PRESETS[i]
  return ZOOM_MIN
}
