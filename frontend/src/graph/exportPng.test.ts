import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { TOOLBAR_TEXT } from './GraphToolbar'
import { composeGraphCanvas, exportGraphPng, GRAPH_PNG_NAME, graphBackground, type GraphRenderer } from './exportPng'

interface Call {
  op: string
  args: unknown[]
}

/** A recording 2D context (jsdom has no canvas backend). */
function stubCanvas() {
  const calls: Call[] = []
  const ctx = {
    fillStyle: '',
    fillRect: (...args: unknown[]) => calls.push({ op: 'fillRect', args: [ctx.fillStyle, ...args] }),
    drawImage: (...args: unknown[]) => calls.push({ op: 'drawImage', args }),
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ctx as unknown as CanvasRenderingContext2D,
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, cb, type) {
    cb(new Blob([`png ${this.width}x${this.height}`], { type: type ?? 'image/png' }))
  })
  return calls
}

function layer(name: string, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  c.dataset.layer = name
  return c
}

function renderer(canvases: Record<string, HTMLCanvasElement>): GraphRenderer & { order: string[] } {
  const order: string[] = []
  return {
    order,
    refresh: () => order.push('refresh'),
    getCanvases: () => {
      order.push('getCanvases')
      return canvases
    },
  }
}

const root = document.documentElement

beforeEach(() => {
  root.style.setProperty('--bg-app', '#123456')
})
afterEach(() => {
  root.style.removeProperty('--bg-app')
  vi.restoreAllMocks()
})

describe('exportPng', () => {
  test('test export composes sigma layers into one png', async () => {
    const calls = stubCanvas()
    // Sigma's layers at a device pixel ratio of 2 (a 400x300 view): edges, nodes, labels, hovers.
    const layers = { edges: layer('edges', 800, 600), nodes: layer('nodes', 800, 600), labels: layer('labels', 800, 600), hovers: layer('hovers', 800, 600) }
    const r = renderer(layers)
    const out = composeGraphCanvas(r)

    // Refreshed first, so the WebGL buffers hold the current frame.
    expect(r.order).toEqual(['refresh', 'getCanvases'])
    expect([out.width, out.height]).toEqual([800, 600])
    // The theme background first, then every layer in order, each at its full pixel size.
    expect(calls[0]).toEqual({ op: 'fillRect', args: ['#123456', 0, 0, 800, 600] })
    const drawn = calls.slice(1)
    expect(drawn.map((c) => (c.args[0] as HTMLCanvasElement).dataset.layer)).toEqual(['edges', 'nodes', 'labels', 'hovers'])
    for (const c of drawn) expect(c.args.slice(1)).toEqual([0, 0, 800, 600])

    // One PNG, downloaded as graph.png.
    const created: Blob[] = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
      created.push(b as Blob)
      return 'blob:graph'
    })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const clicks: { href: string; download: string }[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push({ href: this.href, download: this.download })
    })
    await exportGraphPng(renderer(layers))
    expect(created).toHaveLength(1)
    expect(created[0].type).toBe('image/png')
    expect(await created[0].text()).toBe('png 800x600')
    expect(clicks).toEqual([{ href: 'blob:graph', download: GRAPH_PNG_NAME }])
    expect(GRAPH_PNG_NAME).toBe('graph.png')
  })

  test('empty layers are skipped and the background follows the theme token', () => {
    const calls = stubCanvas()
    root.style.setProperty('--bg-app', '#fafafa')
    expect(graphBackground()).toBe('#fafafa')
    composeGraphCanvas(renderer({ edges: layer('edges', 200, 100), mouse: layer('mouse', 0, 0) }))
    expect(calls.filter((c) => c.op === 'drawImage')).toHaveLength(1)
    expect(calls[0].args[0]).toBe('#fafafa')
  })

  test('the button label is GraphViewModal.exportPng verbatim', () => {
    const strings = fs.readFileSync(path.resolve(__dirname, '../../../docs/strings.txt'), 'utf8')
    expect(strings).toContain(`exportPng:{t:0,b:{t:2,i:[{t:3}],s:\`${TOOLBAR_TEXT.exportPng}\`}}`)
  })

  test('no renderer yet: nothing is exported', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click')
    await exportGraphPng(null)
    expect(click).not.toHaveBeenCalled()
  })
})
