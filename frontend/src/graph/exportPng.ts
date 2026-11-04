// "Export view as PNG": the graph view as the renderer draws it,
// every sigma layer (edges, nodes, labels, hovers) composed in DOM order onto the theme's
// `--bg-app` background, at the canvases' own pixel size (sigma sizes them at the device pixel
// ratio). The file is made and saved in the browser (`graph.png`); nothing goes to the server.

/** The part of a sigma 3 renderer the export needs. */
export interface GraphRenderer {
  refresh(): unknown
  getCanvases(): Record<string, HTMLCanvasElement>
}

export const GRAPH_PNG_NAME = 'graph.png'

/** Fallback background when the token can't be read (our choice; the theme always sets it). */
const FALLBACK_BG = 'black'

/** The theme's app background colour, read from the `--bg-app` token. */
export function graphBackground(): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--bg-app').trim()
  return v || FALLBACK_BG
}

/**
 * One canvas holding every layer of `renderer` over `background`. Refreshes first so the WebGL
 * layers hold the current frame (their drawing buffers are only valid right after a render).
 */
export function composeGraphCanvas(renderer: GraphRenderer, background: string = graphBackground()): HTMLCanvasElement {
  renderer.refresh()
  const layers = Object.values(renderer.getCanvases()).filter((c) => c.width > 0 && c.height > 0)
  const width = Math.max(1, ...layers.map((c) => c.width))
  const height = Math.max(1, ...layers.map((c) => c.height))
  const out = document.createElement('canvas')
  out.width = width
  out.height = height
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('Could not create a 2D canvas for the PNG export.')
  ctx.fillStyle = background
  ctx.fillRect(0, 0, width, height)
  for (const layer of layers) ctx.drawImage(layer, 0, 0, layer.width, layer.height)
  return out
}

/** The composed view as a PNG blob. */
export function graphPngBlob(renderer: GraphRenderer, background?: string): Promise<Blob> {
  const canvas = composeGraphCanvas(renderer, background)
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the PNG.'))), 'image/png')
  })
}

/** Save `blob` as `filename` through a temporary object URL (a client-side download). */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Export the renderer's current view as `graph.png`. */
export async function exportGraphPng(renderer: GraphRenderer | null | undefined): Promise<void> {
  if (!renderer) return
  const blob = await graphPngBlob(renderer)
  downloadBlob(blob, GRAPH_PNG_NAME)
}
