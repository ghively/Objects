/**
 * Mermaid diagram export (M8 Task 29): "Download as SVG" and "Download as PNG"
 * (our labels) on a rendered Mermaid preview. Everything happens in the page
 * (no server round trip, no network).
 *
 * - SVG: the diagram as rendered in the preview, saved as is.
 * - PNG: Mermaid renders the text once more with `htmlLabels: false` (labels as
 *   SVG text, no `<foreignObject>`, so drawing it does not taint the canvas),
 *   then the SVG is drawn on a canvas at 2× and saved. The background stays
 *   transparent, as in the preview (our choice).
 *
 * File names are `diagram.svg` / `diagram.png` (our choice, like the code
 * block's `snippet.<ext>`).
 */

export const PNG_SCALE = 2
export const SVG_FILE = 'diagram.svg'
export const PNG_FILE = 'diagram.png'

let exportSeq = 0

/** Save `blob` as `filename` through a temporary object URL. */
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

/** The SVG text as a downloadable blob (an XML prolog is added when missing). */
export function svgBlob(svg: string): Blob {
  const text = svg.trimStart().startsWith('<?xml') ? svg : `<?xml version="1.0" encoding="UTF-8"?>\n${svg}`
  return new Blob([text], { type: 'image/svg+xml;charset=utf-8' })
}

/** "Download as SVG": the diagram as rendered. */
export function downloadSvg(svg: string, filename = SVG_FILE): void {
  downloadBlob(svgBlob(svg), filename)
}

/** The drawing size of an SVG: its `width`/`height` in px, else its `viewBox`, else 300×150. */
export function svgSize(svg: string): { width: number; height: number } {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const el = doc.documentElement
  const px = (v: string | null) => {
    if (!v || v.endsWith('%')) return NaN
    const n = parseFloat(v)
    return Number.isFinite(n) && n > 0 ? n : NaN
  }
  let width = px(el.getAttribute('width'))
  let height = px(el.getAttribute('height'))
  const vb = (el.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number)
  if (vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0) {
    if (!Number.isFinite(width) && !Number.isFinite(height)) {
      width = vb[2]
      height = vb[3]
    } else if (!Number.isFinite(width)) width = (height * vb[2]) / vb[3]
    else if (!Number.isFinite(height)) height = (width * vb[3]) / vb[2]
  }
  if (!Number.isFinite(width) || !Number.isFinite(height)) return { width: 300, height: 150 }
  return { width, height }
}

/** The SVG with explicit pixel `width`/`height` (an `<img>` needs them to draw at size). */
function sized(svg: string, width: number, height: number): string {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const el = doc.documentElement
  el.setAttribute('width', String(width))
  el.setAttribute('height', String(height))
  el.removeAttribute('style')
  if (!el.getAttribute('xmlns')) el.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  return new XMLSerializer().serializeToString(el)
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('The diagram could not be drawn.'))
    img.src = src
  })
}

/** Draw `svg` on a canvas at `scale`× and return the PNG. */
export async function svgToPng(svg: string, scale = PNG_SCALE): Promise<Blob> {
  const { width, height } = svgSize(svg)
  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sized(svg, width, height))}`
  const img = await loadImage(src)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('The diagram could not be drawn.')
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The diagram could not be drawn.'))), 'image/png')
  })
}

/**
 * Render `text` for export: Mermaid with `securityLevel: 'strict'`, the app's
 * theme and `htmlLabels: false`. Mermaid's global config is put back to the
 * preview's afterwards.
 */
export async function renderForExport(text: string, dark: boolean): Promise<string> {
  const mermaid = (await import('mermaid')).default
  const theme = dark ? 'dark' : 'default'
  const id = `mermaid-export-${++exportSeq}`
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme, htmlLabels: false, flowchart: { htmlLabels: false } })
  try {
    const { svg } = await mermaid.render(id, text)
    return svg
  } finally {
    document.getElementById(`d${id}`)?.remove()
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme })
  }
}

/** "Download as PNG": the export render drawn at 2×. */
export async function downloadPng(text: string, dark: boolean, filename = PNG_FILE): Promise<void> {
  const svg = await renderForExport(text, dark)
  downloadBlob(await svgToPng(svg), filename)
}
