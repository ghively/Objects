import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ChartViewConfig, Row, ViewState } from '@/api/types'
import { objectSummary, propertyDef, row, typeDef } from '@/test/mockApi'

const toPng = vi.fn(async (_el: HTMLElement, _opts?: Record<string, unknown>) => 'data:image/png;base64,AAAA')
const toSvg = vi.fn(async (_el: HTMLElement, _opts?: Record<string, unknown>) => 'data:image/svg+xml;charset=utf-8,%3Csvg%3E')
vi.mock('html-to-image', () => ({
  toPng: (el: HTMLElement, opts?: Record<string, unknown>) => toPng(el, opts),
  toSvg: (el: HTMLElement, opts?: Record<string, unknown>) => toSvg(el, opts),
}))

import { DataView, type LayoutProps } from '../../DataView'
import type { GroupCtx } from '../../group'
import { emptyFilterGroup } from '../../model'
import { ChartLayout, ChartSettings } from '../ChartLayout'
import { DEFAULT_CHART_CONFIG } from './chartData'
import { DRILL_PAGE, NOT_A_FILTER, SHOW_AS_TABLE } from './ChartView'
import { CHART_NOT_SHOWN, SVG_DATA_URL_PREFIX, chartFileName, exportChart } from './exportChart'

const opts = (...texts: string[]) => texts.map((t, i) => ({ id: `o${i + 1}`, text: t, color: i === 0 ? 'red' : 'green', icon: null }))
const task = typeDef({
  id: 'task',
  propertyDefinitions: [
    propertyDef({ id: 'title', type: 'entity_title' }),
    propertyDef({ id: 'status', type: 'label', name: 'Status', options: { set: opts('Todo', 'Done') } }),
    propertyDef({ id: 'size', type: 'label', name: 'Size', options: { set: opts('S', 'L') } }),
    propertyDef({ id: 'points', type: 'number', name: 'Points' }),
    propertyDef({ id: 'due', type: 'datetime', name: 'Due' }),
    propertyDef({ id: 'owner', type: 'entity', name: 'Owner' }),
  ],
})
const R = (n: number, values: Row['values']): Row => row({ summary: objectSummary({ path: `Tasks/T${n}.md`, type: 'task' }), values })
const ROWS = [
  R(1, { status: ['Todo'], size: ['S'], points: 3 }),
  R(2, { status: ['Todo'], size: ['L'], points: 5 }),
  R(3, { status: ['Done'], size: ['S'], points: 2 }),
]

const ctx: GroupCtx = { types: [task], viewTypeIds: ['task'], collections: [], tagIdsToTitles: {}, pathsById: {}, entityTitles: {}, now: new Date(2026, 9, 23) }
const stateFor = (patch: Partial<ChartViewConfig> = {}): ViewState => ({
  viewDefinition: { dataViewLayout: 'chart', chartConfig: { ...DEFAULT_CHART_CONFIG, ...patch } },
  filterGroup: emptyFilterGroup(),
  sorts: [],
  groupBy: null,
})

function props(state: ViewState, extra: Partial<LayoutProps> = {}): LayoutProps {
  return {
    groups: [],
    grouped: false,
    state,
    onState: vi.fn(),
    types: [task],
    typesById: { task },
    collections: [],
    ctx,
    multiType: false,
    viewTypes: [task],
    onOpen: vi.fn(),
    header: () => null,
    closed: () => false,
    flat: ROWS,
    groupCount: (g) => g.rows.length,
    loadPreviews: vi.fn(),
    showsPreviews: false,
    ...extra,
  }
}

let clicked: { href: string; download: string }[]
beforeEach(() => {
  toPng.mockClear()
  toSvg.mockClear()
  clicked = []
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push({ href: this.href, download: this.download })
  })
})
afterEach(() => vi.restoreAllMocks())

describe('chart layout', () => {
  test('draws a bar per group with its count, label colours, values when asked', () => {
    render(<ChartLayout {...props(stateFor({ showValues: true }))} />)
    const todo = screen.getByRole('button', { name: 'Todo: 2' })
    expect(todo.tagName.toLowerCase()).toBe('rect')
    expect(todo.getAttribute('style')).toContain('var(--line-red)')
    expect(screen.getByRole('button', { name: 'Done: 1' })).toBeTruthy()
    expect([...document.querySelectorAll('[data-chart-value]')].map((e) => e.textContent)).toEqual(['2', '1'])
  })

  test('each kind draws its own marks', () => {
    const { rerender } = render(<ChartLayout {...props(stateFor({ kind: 'horizontalBar' }))} />)
    expect(document.querySelector('[data-chart-kind="horizontalBar"]')).toBeTruthy()
    rerender(<ChartLayout {...props(stateFor({ kind: 'line', splitBy: 'size' }))} />)
    expect(document.querySelector('[data-chart-kind="line"]')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Todo · S: 1' }).tagName.toLowerCase()).toBe('circle')
    expect(within(screen.getByTestId('chart-legend')).getByText('L')).toBeTruthy()
    rerender(<ChartLayout {...props(stateFor({ kind: 'donut' }))} />)
    expect(screen.getByRole('button', { name: 'Todo: 2' }).tagName.toLowerCase()).toBe('path')
    expect(document.querySelector('[data-chart-total]')?.textContent).toBe('3')
    rerender(<ChartLayout {...props(stateFor({ kind: 'number', yCalc: 'sum', yProperty: 'points' }))} />)
    expect(screen.getByTestId('chart-number').textContent).toBe('10')
    expect(screen.getByText('Sum (Points)')).toBeTruthy()
  })

  test('line: the empty buckets between dates are no tab stops; with many, they draw no point', () => {
    const due = (d: string) => ({ start: d, resolution: 'day' })
    const line = (rows: Row[]) => props(stateFor({ kind: 'line', xProperty: 'due', xDateBucket: 'day', hideEmptyGroups: false }), { flat: rows })
    const { rerender } = render(<ChartLayout {...line([R(1, { due: due('2026-01-01') }), R(2, { due: due('2026-01-05') })])} />)
    const points = () => [...document.querySelectorAll('[data-chart-kind="line"] circle')] as SVGElement[]
    expect(points()).toHaveLength(5)
    expect(points().filter((c) => c.getAttribute('tabindex') === '0')).toHaveLength(2)
    // Still clickable: an empty bucket lists no rows.
    fireEvent.click(points()[1])
    expect(screen.getByTestId('chart-drill')).toBeTruthy()
    // Ninety days apart: only the two points with rows are drawn.
    rerender(<ChartLayout {...line([R(1, { due: due('2026-01-01') }), R(2, { due: due('2026-03-31') })])} />)
    expect(points()).toHaveLength(2)
    expect(points().every((c) => c.getAttribute('tabindex') === '0')).toBe(true)
  })

  test('no legend when turned off; nothing to chart without rows', () => {
    const { rerender } = render(<ChartLayout {...props(stateFor({ splitBy: 'size', showLegend: false }))} />)
    expect(screen.queryByTestId('chart-legend')).toBeNull()
    rerender(<ChartLayout {...props(stateFor(), { flat: [] })} />)
    expect(screen.getByTestId('chart-empty')).toBeTruthy()
  })

  test('clicking a bar lists its rows; a row opens; clicking again closes', () => {
    const p = props(stateFor())
    render(<ChartLayout {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'Todo: 2' }))
    const drill = screen.getByTestId('chart-drill')
    expect([...drill.querySelectorAll('li')].map((li) => li.getAttribute('data-path'))).toEqual(['Tasks/T1.md', 'Tasks/T2.md'])
    fireEvent.click(within(drill).getByText('T2'))
    expect(p.onOpen).toHaveBeenCalledWith(ROWS[1], expect.anything())
    fireEvent.keyDown(screen.getByRole('button', { name: 'Todo: 2' }), { key: 'Enter' })
    expect(screen.queryByTestId('chart-drill')).toBeNull()
  })

  test('a stacked segment lists the rows of that part', () => {
    render(<ChartLayout {...props(stateFor({ splitBy: 'size' }))} />)
    fireEvent.click(screen.getByRole('button', { name: 'Todo · L: 1' }))
    const drill = screen.getByTestId('chart-drill')
    expect(drill.getAttribute('aria-label')).toBe('Todo · L')
    expect([...drill.querySelectorAll('li')].map((li) => li.getAttribute('data-path'))).toEqual(['Tasks/T2.md'])
  })

  test('the drill-down pages long lists', () => {
    const many = Array.from({ length: DRILL_PAGE + 5 }, (_, i) => R(i + 10, { status: ['Todo'] }))
    render(<ChartLayout {...props(stateFor(), { flat: many })} />)
    fireEvent.click(screen.getByRole('button', { name: `Todo: ${many.length}` }))
    expect(screen.getByTestId('chart-drill').querySelectorAll('li')).toHaveLength(DRILL_PAGE)
    fireEvent.click(screen.getByText(`Show all (${many.length})`))
    expect(screen.getByTestId('chart-drill').querySelectorAll('li')).toHaveLength(many.length)
  })

  test('Show as table turns the view into a table with the group filter, in one state', () => {
    const s = stateFor({ splitBy: 'size' })
    const p = props(s)
    render(<ChartLayout {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'Todo · S: 1' }))
    fireEvent.click(screen.getByRole('button', { name: new RegExp(SHOW_AS_TABLE) }))
    expect(p.onState).toHaveBeenCalledTimes(1)
    const next = vi.mocked(p.onState).mock.calls[0][0]
    expect(next.viewDefinition.dataViewLayout).toBe('table')
    expect(next.filterGroup.elements).toEqual([
      { type: 'filter', propertyId: 'status', option: 'contains', referenceValue: ['o1'] },
      { type: 'filter', propertyId: 'size', option: 'contains', referenceValue: ['o1'] },
    ])
  })

  test('Show as table checks the filter against the rows on the click: a group it would not keep exactly says so', () => {
    // A label outside the option set is in "Other", which "is empty" would not keep.
    const rows = [R(1, { status: ['Ghost'] }), R(2, { status: [] }), R(3, { status: ['Todo'] })]
    const p = props(stateFor({ hideEmptyGroups: true }), { flat: rows })
    render(<ChartLayout {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'Other: 2' }))
    fireEvent.click(screen.getByRole('button', { name: new RegExp(SHOW_AS_TABLE) }))
    expect(p.onState).not.toHaveBeenCalled()
    expect(screen.getByTestId('chart-not-filter').textContent).toBe(NOT_A_FILTER)
    expect(screen.queryByRole('button', { name: new RegExp(SHOW_AS_TABLE) })).toBeNull()
  })

  test('no "Show as table" when the view does not offer the table', () => {
    render(<ChartLayout {...props(stateFor(), { layouts: ['list', 'chart'] })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Todo: 2' }))
    expect(screen.getByTestId('chart-drill')).toBeTruthy()
    expect(screen.queryByRole('button', { name: new RegExp(SHOW_AS_TABLE) })).toBeNull()
    expect(screen.queryByTestId('chart-not-filter')).toBeNull()
  })

  test('a group that is no filter says so instead', () => {
    const rows = [R(1, { owner: [{ target: 'Nobody', path: null }] })]
    render(<ChartLayout {...props(stateFor({ xProperty: 'owner' }), { flat: rows })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Nobody: 1' }))
    expect(screen.getByTestId('chart-not-filter').textContent).toBe(NOT_A_FILTER)
    expect(screen.queryByRole('button', { name: new RegExp(SHOW_AS_TABLE) })).toBeNull()
  })
})

describe('export', () => {
  test('the chart button exports PNG and SVG with html-to-image', async () => {
    render(<ChartLayout {...props(stateFor())} />)
    fireEvent.click(screen.getByRole('button', { name: 'Export chart' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Export PNG' }))
    })
    expect(toPng).toHaveBeenCalledTimes(1)
    const [el, options] = toPng.mock.calls[0]
    expect(el.hasAttribute('data-chart-frame')).toBe(true)
    expect(options?.pixelRatio).toBe(2)
    // The button itself is left out of the image.
    const filter = options?.filter as (n: HTMLElement) => boolean
    expect(filter(el.querySelector('[data-chart-export-skip]') as HTMLElement)).toBe(false)
    expect(filter(el.querySelector('svg') as unknown as HTMLElement)).toBe(true)
    expect(clicked).toEqual([{ href: 'data:image/png;base64,AAAA', download: 'Chart.png' }])

    fireEvent.click(screen.getByRole('button', { name: 'Export chart' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Export SVG' }))
    })
    // SVG is the chart's own drawing, not a bitmap of the frame.
    expect(toSvg).not.toHaveBeenCalled()
    expect(clicked[1].download).toBe('Chart.svg')
    expect(clicked[1].href.startsWith(SVG_DATA_URL_PREFIX)).toBe(true)
  })

  test('the SVG file holds the chart as vector shapes with its styles as attributes', async () => {
    render(<ChartLayout {...props(stateFor({ splitBy: 'size' }))} />)
    const drawn = document.querySelector('svg[data-chart-kind]') as SVGSVGElement
    const bars = Array.from(drawn.querySelectorAll('rect[role="button"]')) as SVGRectElement[]
    expect(bars.length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Export chart' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Export SVG' }))
    })
    const file = svgOf(clicked[0].href)
    const root = file.documentElement
    expect(root.tagName).toBe('svg')
    expect(root.getAttribute('xmlns')).toBe('http://www.w3.org/2000/svg')
    expect(root.getAttribute('width')).toBe(drawn.getAttribute('width'))
    const height = Number(root.getAttribute('height'))
    expect(height).toBeGreaterThan(Number(drawn.getAttribute('height'))) // the legend sits below the chart
    expect(root.getAttribute('viewBox')).toBe(`0 0 ${root.getAttribute('width')} ${height}`)
    // the background, then the chart, then the legend
    const background = root.firstElementChild as Element
    expect(background.tagName).toBe('rect')
    expect(background.getAttribute('fill')).toBe('white')
    const chart = root.querySelector('svg[data-chart-kind="bar"]') as Element
    expect(chart).toBeTruthy()
    const exported = Array.from(chart.querySelectorAll('rect[aria-label]'))
    expect(exported.map((r) => r.getAttribute('fill'))).toEqual(bars.map((r) => r.style.fill))
    expect(file.querySelector('[style]')).toBeNull()
    expect(file.querySelector('[class]')).toBeNull()
    expect(file.querySelector('[tabindex]')).toBeNull()
    const legend = root.querySelector('[data-chart-legend]') as Element
    const labels = Array.from(screen.getByTestId('chart-legend').querySelectorAll('li')).map((li) => li.textContent)
    expect(labels.length).toBe(2)
    expect(Array.from(legend.querySelectorAll('text')).map((t) => t.textContent)).toEqual(labels)
    expect(legend.querySelectorAll('rect').length).toBe(labels.length)
  })

  test("the export file takes the view's name", async () => {
    render(<ChartLayout {...props(stateFor(), { viewName: 'Sprint points' })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Export chart' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Export PNG' }))
    })
    expect(clicked[0].download).toBe('Sprint points.png')
  })

  test("the data view hands the chart its layouts and its owner's view name", async () => {
    render(<DataView rows={ROWS} types={[task]} scope={{ typeIds: ['task'] }} state={stateFor()} onState={vi.fn()} layouts={['list', 'chart']} viewName="Board" />)
    fireEvent.click(screen.getByRole('button', { name: 'Todo: 2' }))
    expect(screen.getByTestId('chart-drill')).toBeTruthy()
    expect(screen.queryByRole('button', { name: new RegExp(SHOW_AS_TABLE) })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Export chart' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Export SVG' }))
    })
    expect(clicked[0].download).toBe('Board.svg')
  })

  test('a failed export says so', async () => {
    toPng.mockRejectedValueOnce(new Error('nope'))
    render(<ChartLayout {...props(stateFor())} />)
    fireEvent.click(screen.getByRole('button', { name: 'Export chart' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Export PNG' }))
    })
    expect(screen.getByRole('alert').textContent).toBe('The chart could not be exported.')
  })

  test('file names', () => {
    expect(chartFileName('Sprint: points?', 'png')).toBe('Sprint- points-.png')
    expect(chartFileName('  ', 'svg')).toBe('Chart.svg')
    expect(chartFileName(null, 'svg')).toBe('Chart.svg')
  })

  test('the settings page exports the chart the view draws', async () => {
    const s = stateFor()
    render(
      <>
        <ChartLayout {...props(s)} />
        <ChartSettings types={[task]} state={s} onState={vi.fn()} />
      </>,
    )
    await act(async () => {
      fireEvent.click(within(screen.getByTestId('chart-settings')).getByRole('button', { name: 'Export SVG' }))
    })
    expect(toSvg).not.toHaveBeenCalled()
    expect(clicked[0].download).toBe('Chart.svg')
    expect(svgOf(clicked[0].href).querySelector('svg[data-chart-kind="bar"]')).toBeTruthy()
  })

  test('the settings page without the chart on screen says so', async () => {
    render(<ChartSettings types={[task]} state={stateFor()} onState={vi.fn()} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Export PNG' }))
    })
    expect(toPng).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toBe(CHART_NOT_SHOWN)
  })
})

/** The SVG document in an exported `data:` URL. */
function svgOf(dataUrl: string): Document {
  expect(dataUrl.startsWith(SVG_DATA_URL_PREFIX)).toBe(true)
  const text = decodeURIComponent(dataUrl.slice(SVG_DATA_URL_PREFIX.length))
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
  expect(doc.querySelector('parsererror')).toBeNull()
  return doc
}

describe('exportChart SVG', () => {
  const frame = (inner: string) => {
    const el = document.createElement('div')
    el.innerHTML = inner
    document.body.appendChild(el)
    return el
  }
  const CHART = `
    <svg width="200" height="100" data-chart-kind="line" role="group" aria-label="Count">
      <g data-chart-axis="value"><line x1="0" x2="200" y1="50" y2="50" style="stroke: var(--color-line); stroke-width: 1" opacity="0.6"></line></g>
      <path d="M0,0 L10,10" style="fill: none; stroke: rgb(1, 2, 3); stroke-width: 2"></path>
      <circle cx="5" cy="5" r="4" style="fill: rgb(1, 2, 3)" role="button" tabindex="0" class="cursor-pointer" opacity="0.4" aria-label="A: 1"><title>A: 1</title></circle>
      <text x="5" y="5" text-anchor="middle" style="fill: rgb(9, 9, 9); font-size: 11px; font-weight: 600">1</text>
    </svg>`
  const LEGEND = `
    <ul data-chart-legend>
      <li data-chart-legend-item><span data-chart-swatch style="background-color: rgb(1, 2, 3)"></span><span data-chart-legend-label>Todo &amp; done</span></li>
      <li data-chart-legend-item><span data-chart-swatch style="background-color: rgb(4, 5, 6)"></span><span data-chart-legend-label>Later</span></li>
    </ul>`

  test('copies the styles the browser applied onto each shape and sizes the file', async () => {
    const el = frame(CHART + LEGEND)
    const download = vi.fn()
    expect(await exportChart(el, 'svg', 'Points', { download })).toBe(true)
    expect(download.mock.calls[0][1]).toBe('Points.svg')
    const doc = svgOf(download.mock.calls[0][0])
    const root = doc.documentElement
    expect(root.getAttribute('width')).toBe('200')
    expect(Number(root.getAttribute('height'))).toBeGreaterThan(100)
    expect(root.getAttribute('viewBox')).toBe(`0 0 200 ${root.getAttribute('height')}`)
    const chart = root.querySelector('svg[data-chart-kind="line"]') as Element
    expect(chart.getAttribute('width')).toBe('200')
    expect(chart.getAttribute('height')).toBe('100')
    const line = chart.querySelector('line') as Element
    expect(line.getAttribute('stroke')).toBe('var(--color-line)') // jsdom resolves no variables; a browser does
    expect(line.getAttribute('stroke-width')).toBe('1')
    expect(line.getAttribute('opacity')).toBe('0.6')
    const path = chart.querySelector('path') as Element
    expect(path.getAttribute('fill')).toBe('none')
    expect(path.getAttribute('stroke')).toBe('rgb(1, 2, 3)')
    expect(path.getAttribute('stroke-width')).toBe('2')
    const circle = chart.querySelector('circle') as Element
    expect(circle.getAttribute('fill')).toBe('rgb(1, 2, 3)')
    expect(circle.getAttribute('opacity')).toBe('0.4')
    expect(circle.hasAttribute('class')).toBe(false)
    expect(circle.hasAttribute('tabindex')).toBe(false)
    expect(circle.hasAttribute('role')).toBe(false)
    expect(circle.querySelector('title')?.textContent).toBe('A: 1') // hover names stay
    const text = chart.querySelector('text') as Element
    expect(text.getAttribute('fill')).toBe('rgb(9, 9, 9)')
    expect(text.getAttribute('font-size')).toBe('11px')
    expect(text.getAttribute('font-weight')).toBe('600')
    expect(text.getAttribute('text-anchor')).toBe('middle')
    expect(doc.querySelector('[style]')).toBeNull()
    // the legend: a swatch and a label per item, below the chart
    const legend = root.querySelector('[data-chart-legend]') as Element
    expect(legend.getAttribute('transform')).toBe('translate(0 100)')
    expect(Array.from(legend.querySelectorAll('rect')).map((r) => r.getAttribute('fill'))).toEqual(['rgb(1, 2, 3)', 'rgb(4, 5, 6)'])
    expect(Array.from(legend.querySelectorAll('text')).map((t) => t.textContent)).toEqual(['Todo & done', 'Later'])
    // the source is untouched
    expect(el.querySelector('circle')?.getAttribute('class')).toBe('cursor-pointer')
  })

  test('without a legend the file is the chart alone over its background', async () => {
    const el = frame(CHART)
    const download = vi.fn()
    await exportChart(el, 'svg', null, { download })
    const root = svgOf(download.mock.calls[0][0]).documentElement
    expect(root.getAttribute('height')).toBe('100')
    expect(root.querySelector('[data-chart-legend]')).toBeNull()
    expect(root.firstElementChild?.tagName).toBe('rect')
    expect(root.firstElementChild?.getAttribute('fill')).toBe('white')
    expect(download.mock.calls[0][1]).toBe('Chart.svg')
  })

  test('falls back to html-to-image when the frame holds no chart svg', async () => {
    const el = frame('<div data-chart-kind="number">42</div>')
    const download = vi.fn()
    const fallback = vi.fn(async (_el: HTMLElement) => 'data:image/svg+xml;charset=utf-8,%3Csvg%3E')
    expect(await exportChart(el, 'svg', 'N', { toSvg: fallback as never, download })).toBe(true)
    expect(fallback).toHaveBeenCalledTimes(1)
    expect(fallback.mock.calls[0][0]).toBe(el)
    expect(download).toHaveBeenCalledWith('data:image/svg+xml;charset=utf-8,%3Csvg%3E', 'N.svg')
  })

  test('PNG still renders the frame with html-to-image', async () => {
    const el = frame(CHART)
    const download = vi.fn()
    await exportChart(el, 'png', 'P', { download })
    expect(toPng).toHaveBeenCalledTimes(1)
    expect(toPng.mock.calls[0][0]).toBe(el)
    expect(download).toHaveBeenCalledWith('data:image/png;base64,AAAA', 'P.png')
  })
})
