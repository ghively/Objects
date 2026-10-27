import '@/whiteboard/test/flowEnv'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { WhiteboardData } from '@/api/whiteboardTypes'

const toPng = vi.fn(async (_el: HTMLElement, _opts?: Record<string, unknown>) => 'data:image/png;base64,AAAA')
vi.mock('html-to-image', () => ({ toPng: (el: HTMLElement, opts?: Record<string, unknown>) => toPng(el, opts) }))

import { EXPORT_AS_PNG, EXPORT_SELECTION_AS_PNG, BoardMenu } from './chrome/BoardMenu'
import {
  EXPORT_MAX_SIDE,
  EXPORT_PADDING,
  EXPORT_PIXEL_RATIO,
  exportFileName,
  exportFrame,
  isSameOrigin,
  renderBoardPng,
  strokeBoxes,
} from './exportPng'
import type { WhiteboardHost } from './host'
import { DEFAULT_SETTINGS } from './model'
import { BoardStoreContext, createBoardStore } from './store'
import { board, node, textBlock } from './test/boards'
import { WhiteboardCanvas, type BoardExporter } from './WhiteboardCanvas'

function sample(): WhiteboardData {
  return board(
    [
      node({ id: 'a', blockId: 'ba', position: { x: -300, y: -120 }, width: 420, height: 60, z: 1 }),
      node({ id: 'b', kind: 'shape', shape: 'rectangle', position: { x: 900, y: 600 }, width: 90, height: 90, z: 2 }),
      node({ id: 'c', kind: 'shape', shape: 'ellipse', position: { x: 300, y: 0 }, width: 60, height: 60, z: 3 }),
    ],
    [],
    { ba: textBlock('Alpha') },
  )
}

const host = (): WhiteboardHost => ({
  openObject: vi.fn(),
  linkFor: vi.fn((p: string) => `[[${p}]]`),
  resolve: vi.fn(async () => null),
  rows: vi.fn(async () => []),
  requestDelete: vi.fn(),
  createObject: vi.fn(async () => 'Pages/New.md'),
  objects: vi.fn(async () => []),
  uploadAttachment: vi.fn(async (f: File) => ({ path: `Attachments/${f.name}` })),
  fileUrl: vi.fn((p: string) => `/api/file?path=${encodeURIComponent(p)}`),
  openAttachment: vi.fn(async () => ({ ok: true })),
})

let clicked: { href: string; download: string }[]

beforeEach(() => {
  localStorage.clear()
  toPng.mockClear()
  clicked = []
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push({ href: this.href, download: this.download })
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('whiteboard PNG export', () => {
  test('test export png covers all nodes', async () => {
    const store = createBoardStore({
      doc: { board: sample(), strokes: [{ id: 's1', tool: 'pen', points: [[1200, 900, 0.5]], width: 10, color: '#000', d: '' }] },
    })
    const exportRef: { current: BoardExporter | null } = { current: null }
    render(
      <BoardStoreContext.Provider value={store}>
        <div style={{ width: 1280, height: 800 }}>
          <WhiteboardCanvas boardKey="Whiteboards/Export.md" settings={{ ...DEFAULT_SETTINGS }} host={host()} exportRef={exportRef} />
        </div>
      </BoardStoreContext.Provider>,
    )
    screen.getByTestId('whiteboard-canvas')
    await act(async () => {})
    expect(exportRef.current).toBeTypeOf('function')
    act(() => store.getState().actions.select(['c']))

    let ok = false
    await act(async () => {
      ok = await exportRef.current!('Plan: Q4/26')
    })
    expect(ok).toBe(true)
    expect(toPng).toHaveBeenCalledTimes(1)
    const [el, opts] = toPng.mock.calls[0] as [HTMLElement, Record<string, unknown>]
    expect(el.classList.contains('react-flow__viewport')).toBe(true)
    // The frame spans every node and the stroke: x -300..1205, y -120..905, plus padding, at 2x.
    expect(opts.width).toBe(1505 + 2 * EXPORT_PADDING)
    expect(opts.height).toBe(1025 + 2 * EXPORT_PADDING)
    expect(opts.pixelRatio).toBe(EXPORT_PIXEL_RATIO)
    expect(typeof opts.backgroundColor).toBe('string')
    expect((opts.style as Record<string, string>).transform).toBe(
      `translate(${300 + EXPORT_PADDING}px, ${120 + EXPORT_PADDING}px) scale(1)`,
    )
    // Every node was rendered for the export, and the selection is back afterwards.
    const filter = opts.filter as (n: HTMLElement) => boolean
    for (const id of ['a', 'b', 'c']) {
      const nodeEl = el.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`)
      if (nodeEl) expect(filter(nodeEl)).toBe(true)
    }
    expect(store.getState().selection).toEqual(['c'])
    expect(clicked).toEqual([{ href: 'data:image/png;base64,AAAA', download: 'Plan- Q4-26.png' }])
    // The board was not changed by exporting.
    expect(store.getState().doc.board).toEqual(sample())

    // Selection export frames only the selection and draws only it.
    toPng.mockClear()
    await act(async () => {
      ok = await exportRef.current!('Plan', { selection: true })
    })
    expect(ok).toBe(true)
    const [, sel] = toPng.mock.calls[0] as [HTMLElement, Record<string, unknown>]
    expect(sel.width).toBe(60 + 2 * EXPORT_PADDING)
    const selFilter = sel.filter as (n: HTMLElement) => boolean
    const fake = (id: string) => {
      const d = document.createElement('div')
      d.className = 'react-flow__node'
      d.setAttribute('data-id', id)
      return d
    }
    expect(selFilter(fake('c'))).toBe(true)
    expect(selFilter(fake('a'))).toBe(false)
  })

  test('frame, file name, origin filter and menu labels', async () => {
    expect(exportFrame([])).toBeNull()
    const big = exportFrame([{ x: 0, y: 0, width: 40000, height: 100 }])!
    expect(big.width).toBeLessThanOrEqual(EXPORT_MAX_SIDE)
    expect(big.zoom).toBeLessThan(1)
    expect(strokeBoxes([{ points: [[0, 0], [10, 20]], width: 4 }])).toEqual([{ x: -2, y: -2, width: 14, height: 24 }])
    expect(exportFileName('  ')).toBe('Whiteboard.png')
    expect(isSameOrigin('/api/file?path=a.png', 'http://127.0.0.1:8000/')).toBe(true)
    expect(isSameOrigin('https://example.org/x.png', 'http://127.0.0.1:8000/')).toBe(false)
    expect(isSameOrigin('data:image/png;base64,AA')).toBe(true)

    // Images from another origin are left out, so nothing is fetched.
    const vp = document.createElement('div')
    await renderBoardPng({ viewport: vp, boxes: [{ x: 0, y: 0, width: 10, height: 10 }], background: '#fff', toPng: toPng as never })
    const f = (toPng.mock.calls[0][1] as { filter: (n: HTMLElement) => boolean }).filter
    const img = document.createElement('img')
    img.setAttribute('src', 'https://example.org/x.png')
    expect(f(img)).toBe(false)
    const handle = document.createElement('div')
    handle.className = 'react-flow__handle'
    expect(f(handle)).toBe(false)

    expect(EXPORT_AS_PNG).toBe('Export as PNG')
    expect(EXPORT_SELECTION_AS_PNG).toBe('Export selection as PNG')
    expect(typeof BoardMenu).toBe('function')
  })
})
