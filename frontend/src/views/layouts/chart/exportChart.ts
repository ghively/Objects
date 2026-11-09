// "Export PNG" / "Export SVG" (our strings), saved as `<name>.png|.svg`. PNG is the chart's frame
// (title row aside) rendered with `html-to-image`, as the whiteboard export does; only same-origin
// images are embedded, so nothing is fetched from the network. SVG is the chart's own `<svg>` (the
// layouts draw real SVG) with the styles the browser applied written as attributes, over a
// background rect, the legend drawn below it as swatches and text: vector shapes a vector editor
// opens, not a bitmap in a `<foreignObject>` (known limit, fixed 2026-11-09). A frame with no chart
// svg (the number chart) still goes through `html-to-image`'s SVG.
import { toPng as htmlToPng, toSvg as htmlToSvg } from 'html-to-image'
import { backgroundOf, downloadDataUrl, isSameOrigin } from '@/whiteboard/exportPng'
import { truncate } from './scale'

export type ChartExportFormat = 'png' | 'svg'

/** Our strings. */
export const EXPORT_PNG = 'Export PNG'
export const EXPORT_SVG = 'Export SVG'
export const CHART_EXPORT_FAILED = 'The chart could not be exported.'
export const CHART_NOT_SHOWN = 'The chart isn’t on screen, so it can’t be exported.'

/** Pixel ratio of the PNG (as the whiteboard's). */
export const CHART_PIXEL_RATIO = 2

/** The SVG file is a `data:` URL with this prefix and the percent-encoded document. */
export const SVG_DATA_URL_PREFIX = 'data:image/svg+xml;charset=utf-8,'

const SVG_NS = 'http://www.w3.org/2000/svg'
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/'

/** The presentation styles written onto each shape (the ones the layouts set). */
const STYLE_PROPS = [
  'fill',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'font-family',
  'font-size',
  'font-weight',
  'opacity',
  'text-anchor',
  'dominant-baseline',
] as const
/** Of those, the ones SVG inherits: written only where they differ from the parent's. */
const INHERITED = new Set<string>(STYLE_PROPS.filter((p) => p !== 'opacity'))
/** Attributes that mean nothing in a file: the stylesheet classes, the inline styles and the button-ness. */
const DROPPED_ATTRS = ['style', 'class', 'tabindex', 'role', 'aria-pressed']

/** The legend's measurements in the file, as the rendered `Legend` has them (12 px text, 16 px between items). */
const LEGEND = { font: 12, row: 18, swatch: 10, padX: 8, gap: 16, swatchGap: 6, top: 8, bottom: 6, charW: 6.6, maxChars: 38 }

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
  const download = deps.download ?? downloadDataUrl
  if (format === 'svg') {
    const svg = el.querySelector<SVGSVGElement>('svg[data-chart-kind]')
    if (svg) {
      try {
        download(chartSvgDataUrl(el, svg), chartFileName(name, format))
        return true
      } catch {
        return false
      }
    }
  }
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
    download(url, chartFileName(name, format))
    return true
  } catch {
    return false
  }
}

/** The value of `prop` on `el` as the browser applied it (variables and `currentColor` resolved);
 * the inline one where there is no computed style (jsdom). */
function styleOf(el: Element, prop: string): string {
  let value = ''
  try {
    value = getComputedStyle(el).getPropertyValue(prop).trim()
  } catch {
    value = ''
  }
  if (!value && 'style' in el) value = (el as HTMLElement | SVGElement).style.getPropertyValue(prop).trim()
  // A transparent paint (`none` or `transparent`, computed as a colour) is `none` in the file.
  if ((prop === 'fill' || prop === 'stroke') && /^rgba\(\s*0,\s*0,\s*0,\s*0\s*\)$/.test(value)) return 'none'
  return value
}

/** Writes the applied styles of `source` and its shapes onto `clone` (the same tree) as attributes,
 * and drops what only the page needs. `<title>` children (the hover names) stay as they are. */
function writeStyles(source: Element, clone: Element): void {
  const from = [source, ...Array.from(source.querySelectorAll('*'))]
  const to = [clone, ...Array.from(clone.querySelectorAll('*'))]
  from.forEach((src, i) => {
    const dst = to[i]
    if (!dst || src.tagName.toLowerCase() === 'title' || src.closest('title')) return
    const parent = src === source ? null : src.parentElement
    for (const prop of STYLE_PROPS) {
      const value = styleOf(src, prop)
      if (!value) continue
      if (prop === 'opacity' && value === '1') continue
      if (parent && INHERITED.has(prop) && styleOf(parent, prop) === value) continue
      dst.setAttribute(prop, value)
    }
    for (const attr of DROPPED_ATTRS) dst.removeAttribute(attr)
  })
}

/** A side of the chart's svg in CSS pixels: its attribute, else its box on screen. */
function sideOf(svg: SVGSVGElement, side: 'width' | 'height'): number {
  const attr = Number(svg.getAttribute(side))
  if (Number.isFinite(attr) && attr > 0) return attr
  const box = svg.getBoundingClientRect()[side]
  return box > 0 ? box : 1
}

interface LegendEntry {
  color: string
  label: string
}

/** The rendered legend's swatch colours and labels, with its text colour and font. */
function readLegend(frame: HTMLElement): { entries: LegendEntry[]; color: string; font: string } | null {
  const ul = frame.querySelector('[data-chart-legend]')
  if (!ul) return null
  const entries: LegendEntry[] = []
  ul.querySelectorAll('[data-chart-legend-item]').forEach((li) => {
    const swatch = li.querySelector('[data-chart-swatch]')
    const label = (li.querySelector('[data-chart-legend-label]') ?? li).textContent?.trim() ?? ''
    entries.push({ color: swatch ? styleOf(swatch, 'background-color') : '', label })
  })
  if (entries.length === 0) return null
  return { entries, color: styleOf(ul, 'color'), font: styleOf(ul, 'font-family') }
}

/** The legend as SVG below the chart: a swatch and its label per item, wrapped to `width`. */
function drawLegend(legend: NonNullable<ReturnType<typeof readLegend>>, width: number, top: number): { g: SVGGElement; height: number } {
  const doc = document
  const g = doc.createElementNS(SVG_NS, 'g')
  g.setAttribute('data-chart-legend', '')
  g.setAttribute('transform', `translate(0 ${top})`)
  g.setAttribute('font-size', String(LEGEND.font))
  if (legend.font) g.setAttribute('font-family', legend.font)
  if (legend.color) g.setAttribute('fill', legend.color)
  let x = LEGEND.padX
  let row = 0
  for (const entry of legend.entries) {
    const label = truncate(entry.label, LEGEND.maxChars)
    const w = LEGEND.swatch + LEGEND.swatchGap + label.length * LEGEND.charW
    if (x > LEGEND.padX && x + w > width - LEGEND.padX) {
      x = LEGEND.padX
      row += 1
    }
    const y = LEGEND.top + row * LEGEND.row
    const rect = doc.createElementNS(SVG_NS, 'rect')
    rect.setAttribute('x', String(x))
    rect.setAttribute('y', String(y + (LEGEND.row - LEGEND.swatch) / 2))
    rect.setAttribute('width', String(LEGEND.swatch))
    rect.setAttribute('height', String(LEGEND.swatch))
    rect.setAttribute('rx', '2')
    if (entry.color) rect.setAttribute('fill', entry.color)
    const text = doc.createElementNS(SVG_NS, 'text')
    text.setAttribute('x', String(x + LEGEND.swatch + LEGEND.swatchGap))
    text.setAttribute('y', String(y + LEGEND.row / 2))
    text.setAttribute('dominant-baseline', 'central')
    text.textContent = label
    g.append(rect, text)
    x += w + LEGEND.gap
  }
  return { g, height: LEGEND.top + (row + 1) * LEGEND.row + LEGEND.bottom }
}

/** The chart's svg as a standalone file: a background, the chart with its styles as attributes,
 * the legend below. */
export function chartSvgDataUrl(frame: HTMLElement, svg: SVGSVGElement): string {
  const width = sideOf(svg, 'width')
  const height = sideOf(svg, 'height')
  const chart = svg.cloneNode(true) as SVGSVGElement
  writeStyles(svg, chart)
  chart.setAttribute('width', String(width))
  chart.setAttribute('height', String(height))
  const legend = readLegend(frame)
  const drawn = legend ? drawLegend(legend, width, height) : null
  const total = height + (drawn?.height ?? 0)
  const out = document.createElementNS(SVG_NS, 'svg')
  out.setAttributeNS(XMLNS_NS, 'xmlns', SVG_NS)
  out.setAttribute('width', String(width))
  out.setAttribute('height', String(total))
  out.setAttribute('viewBox', `0 0 ${width} ${total}`)
  const background = document.createElementNS(SVG_NS, 'rect')
  background.setAttribute('width', String(width))
  background.setAttribute('height', String(total))
  background.setAttribute('fill', backgroundOf(frame))
  out.append(background, chart)
  if (drawn) out.append(drawn.g)
  return SVG_DATA_URL_PREFIX + encodeURIComponent(new XMLSerializer().serializeToString(out))
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
