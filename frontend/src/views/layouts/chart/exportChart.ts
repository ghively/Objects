// "Export PNG" / "Export SVG" (our strings): the chart's frame (title row aside) rendered with
// `html-to-image`, as the whiteboard export does, and saved as `<name>.png|.svg`. Only
// same-origin images are embedded, so nothing is fetched from the network.
import { toPng as htmlToPng, toSvg as htmlToSvg } from 'html-to-image'
import { backgroundOf, downloadDataUrl, isSameOrigin } from '@/whiteboard/exportPng'

export type ChartExportFormat = 'png' | 'svg'

/** Our strings. */
export const EXPORT_PNG = 'Export PNG'
export const EXPORT_SVG = 'Export SVG'
export const CHART_EXPORT_FAILED = 'The chart could not be exported.'
export const CHART_NOT_SHOWN = 'The chart isn’t on screen, so it can’t be exported.'

/** Pixel ratio of the PNG (as the whiteboard's). */
export const CHART_PIXEL_RATIO = 2

/** `<name>.png|.svg`, with characters no file system takes replaced (blank → "Chart"). */
export function chartFileName(name: string | null | undefined, format: ChartExportFormat): string {
  // eslint-disable-next-line no-control-regex
  const clean = (name ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim()
  return `${clean || 'Chart'}.${format}`
}

export interface ChartExportDeps {
  toPng?: typeof htmlToPng
  toSvg?: typeof htmlToSvg
  download?(dataUrl: string, name: string): void
}

/** Renders `el` and downloads it; false when rendering failed. */
export async function exportChart(el: HTMLElement, format: ChartExportFormat, name: string | null | undefined, deps: ChartExportDeps = {}): Promise<boolean> {
  const filter = (node: HTMLElement): boolean => {
    if (!(node instanceof Element)) return true
    if (node.matches('[data-chart-export-skip]')) return false
    if (node.tagName === 'IMG' && !isSameOrigin(node.getAttribute('src') ?? '')) return false
    return true
  }
  const options = { backgroundColor: backgroundOf(el), cacheBust: false, filter }
  try {
    const url =
      format === 'png'
        ? await (deps.toPng ?? htmlToPng)(el, { ...options, pixelRatio: CHART_PIXEL_RATIO })
        : await (deps.toSvg ?? htmlToSvg)(el, options)
    ;(deps.download ?? downloadDataUrl)(url, chartFileName(name, format))
    return true
  } catch {
    return false
  }
}

// The Customize page exports the chart the layout draws: the layout registers its frame under the
// view definition it draws (the page gets the same object), and the page looks it up.
const frames = new WeakMap<object, { el: HTMLElement; name: string | null }>()

export function registerChartFrame(key: object, el: HTMLElement | null, name: string | null): void {
  if (el) frames.set(key, { el, name })
  else frames.delete(key)
}

export function chartFrameFor(key: object): { el: HTMLElement; name: string | null } | undefined {
  const f = frames.get(key)
  return f && f.el.isConnected ? f : undefined
}
