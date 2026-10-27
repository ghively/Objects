/**
 * "Export as PNG" (M8; our label, adapted from `entity.settings.export.errors.whiteboardClosed`,
 * "Open the whiteboard to export it as a PNG."): rasterises React Flow's viewport (nodes,
 * connectors and the ink layer) with `html-to-image`, framed on the whole board or the
 * selection, at 2× with the theme's canvas background and no dot grid, and saves it as
 * `<title>.png`. Only same-origin resources are embedded: an image from another origin is left
 * out, so nothing is fetched from the network.
 */
import { getViewportForBounds } from '@xyflow/react'
import { toPng as htmlToPng } from 'html-to-image'
import { boundsOf } from './actions'
import { GRID, ZOOM_MIN, type Box } from './model'

/** Space around the exported content (two grid cells; our choice). */
export const EXPORT_PADDING = GRID * 2
/** Pixel ratio of the image ("2×"). */
export const EXPORT_PIXEL_RATIO = 2
/** The largest side of the image in CSS pixels (16384 device pixels at 2×, the canvas limit). */
export const EXPORT_MAX_SIDE = 8192

/** Our string: shown when the export fails. */
export const EXPORT_FAILED = 'The whiteboard could not be exported.'

/** Interface chrome inside the viewport that never goes into the image. */
const CHROME_SELECTORS = [
  '.react-flow__handle',
  '.react-flow__resize-control',
  '.react-flow__nodesselection',
  '.react-flow__edgeupdater',
  '[data-whiteboard-guide]',
  '[data-whiteboard-export-skip]',
]

export interface ExportFrame {
  /** Image size in CSS pixels (the PNG is `EXPORT_PIXEL_RATIO` times larger). */
  width: number
  height: number
  /** The viewport transform that puts the content inside the image. */
  x: number
  y: number
  zoom: number
}

/**
 * The image size and viewport transform for content `boxes`: the content at 100 % with
 * `EXPORT_PADDING` around it, zoomed out only when a side would pass `EXPORT_MAX_SIDE`.
 */
export function exportFrame(boxes: readonly Box[]): ExportFrame | null {
  const bounds = boundsOf(boxes)
  if (!bounds) return null
  const w = Math.max(1, bounds.width)
  const h = Math.max(1, bounds.height)
  const room = EXPORT_MAX_SIDE - 2 * EXPORT_PADDING
  const zoom = Math.min(1, room / w, room / h)
  const width = Math.ceil(w * zoom + 2 * EXPORT_PADDING)
  const height = Math.ceil(h * zoom + 2 * EXPORT_PADDING)
  const vp = getViewportForBounds({ x: bounds.x, y: bounds.y, width: w, height: h }, width, height, Math.min(ZOOM_MIN, zoom), zoom, `${EXPORT_PADDING}px`)
  return { width, height, x: vp.x, y: vp.y, zoom: vp.zoom }
}

/** Boxes of ink strokes (their points, grown by half the stroke width), for the whole-board frame. */
export function strokeBoxes(strokes: readonly { points: readonly (readonly number[])[]; width: number }[]): Box[] {
  const out: Box[] = []
  for (const s of strokes) {
    if (!s.points.length) continue
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const [x, y] of s.points) {
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
    const r = (Number.isFinite(s.width) ? s.width : 0) / 2
    out.push({ x: minX - r, y: minY - r, width: maxX - minX + 2 * r, height: maxY - minY + 2 * r })
  }
  return out
}

/** `<title>.png`, with characters no file system takes replaced (blank → "Whiteboard"). */
export function exportFileName(title: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim()
  return `${clean || 'Whiteboard'}.png`
}

/** Whether `url` is same-origin (or a data/blob URL): the only images the export embeds. */
export function isSameOrigin(url: string, base: string = typeof location !== 'undefined' ? location.href : 'http://127.0.0.1/'): boolean {
  if (!url || /^(data|blob):/i.test(url)) return true
  try {
    return new URL(url, base).origin === new URL(base).origin
  } catch {
    return false
  }
}

export interface ExportPngOptions {
  /** React Flow's `.react-flow__viewport` element. */
  viewport: HTMLElement
  /** The content to frame (the whole board or the selection), in board coordinates. */
  boxes: readonly Box[]
  /** The canvas background colour (the theme's). */
  background: string
  /** When set, only these node and edge ids are drawn (a selection export). */
  only?: ReadonlySet<string>
  /** Tests inject a fake. */
  toPng?: typeof htmlToPng
}

/** The PNG as a data URL, or null when there is nothing to export. */
export async function renderBoardPng(opts: ExportPngOptions): Promise<string | null> {
  const frame = exportFrame(opts.boxes)
  if (!frame) return null
  const toPng = opts.toPng ?? htmlToPng
  const only = opts.only
  const filter = (el: HTMLElement): boolean => {
    if (!(el instanceof Element)) return true
    if (CHROME_SELECTORS.some((s) => el.matches(s))) return false
    if (el.tagName === 'IMG' && !isSameOrigin((el as HTMLImageElement).getAttribute('src') ?? '')) return false
    if (only && (el.classList.contains('react-flow__node') || el.classList.contains('react-flow__edge'))) {
      const id = el.getAttribute('data-id')
      if (id !== null && !only.has(id)) return false
    }
    return true
  }
  return toPng(opts.viewport, {
    backgroundColor: opts.background,
    width: frame.width,
    height: frame.height,
    pixelRatio: EXPORT_PIXEL_RATIO,
    cacheBust: false,
    filter,
    style: {
      width: `${frame.width}px`,
      height: `${frame.height}px`,
      transform: `translate(${frame.x}px, ${frame.y}px) scale(${frame.zoom})`,
    },
  })
}

/** Saves a data URL as a download named `name`. */
export function downloadDataUrl(dataUrl: string, name: string): void {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = name
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/** The first non-transparent background colour from `el` up (the canvas's `--color-bg-back`). */
export function backgroundOf(el: Element | null): string {
  for (let cur: Element | null = el; cur; cur = cur.parentElement) {
    const c = getComputedStyle(cur).backgroundColor
    if (c && c !== 'transparent' && !/^rgba\(\s*0,\s*0,\s*0,\s*0\s*\)$/.test(c)) return c
  }
  return '#ffffff'
}
