// M8 Task 23: the floating inspector, reading order, board Notes and the presentation.
import '@/whiteboard/test/flowEnv'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Editor as TiptapEditor } from '@tiptap/core'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { WhiteboardData } from '@/api/whiteboardTypes'
import { objectDetail, objectSummary } from '@/test/mockApi'
import { nodeBox } from './actions'
import { fitBox } from './camera'
import type { WhiteboardHost } from './host'
import { ZOOM_MAX } from './model'
import { boardOutline, boardStats, headingsOf, orderedFrames, presentationSlides, setFrameOrder, wordCount } from './readingOrder'
import { WB } from './strings'
import { board, edge, node, textBlock } from './test/boards'
import { mockWhiteboardApi } from './test/mockWhiteboardApi'
import { FIT_PADDING } from './WhiteboardCanvas'
import { WhiteboardPage } from './WhiteboardPage'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'

const PATH = 'Whiteboards/Board.md'
const PANE = { width: 1280, height: 800 }

function fakeHost(): WhiteboardHost {
  return {
    openObject: vi.fn(),
    linkFor: vi.fn((p: string) => `[[${p.split('/').pop()!.replace(/\.md$/, '')}]]`),
    resolve: vi.fn(async () => null),
    rows: vi.fn(async () => []),
    requestDelete: vi.fn(),
    createObject: vi.fn(async () => 'Pages/New.md'),
    objects: vi.fn(async () => []),
  }
}

async function renderPage(b: WhiteboardData) {
  const client = mockWhiteboardApi(b, 'rev-1')
  const utils = render(
    <div style={{ width: 1280, height: 800 }}>
      <WhiteboardPage path={PATH} mode="page" host={fakeHost()} client={client} />
    </div>,
  )
  await waitFor(() => expect(screen.getByTestId('whiteboard-canvas')).toBeInTheDocument())
  await waitFor(() => expect(screen.getByText('Board')).toBeInTheDocument())
  return { client, ...utils }
}

/** The canvas camera, read from React Flow's viewport transform. */
function camera(container: HTMLElement): { x: number; y: number; zoom: number } {
  const el = container.querySelector<HTMLElement>('.react-flow__viewport')!
  const m = /translate\(([-\d.e]+)px,\s*([-\d.e]+)px\)\s*scale\(([-\d.e]+)\)/.exec(el.style.transform)
  if (!m) throw new Error(`no transform: ${el.style.transform}`)
  return { x: Number(m[1]), y: Number(m[2]), zoom: Number(m[3]) }
}

function expectCamera(container: HTMLElement, vp: { x: number; y: number; zoom: number }) {
  const c = camera(container)
  expect(c.zoom).toBeCloseTo(vp.zoom, 4)
  expect(c.x).toBeCloseTo(vp.x, 2)
  expect(c.y).toBeCloseTo(vp.y, 2)
}

function openInspector() {
  fireEvent.click(screen.getByRole('button', { name: WB.inspector.text }))
  return screen.getByTestId('whiteboard-inspector')
}

const FRAMES = () =>
  board([
    node({ id: 'f1', kind: 'frame', title: 'Intro', position: { x: 0, y: 0 }, width: 480, height: 420 }),
    node({ id: 'f2', kind: 'frame', title: 'Middle', position: { x: 0, y: 600 }, width: 600, height: 300 }),
    node({ id: 'f3', kind: 'frame', title: 'End', position: { x: 900, y: 1200 }, width: 300, height: 300 }),
  ])

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})

describe('reading order (pure)', () => {
  test('test reading order puts explicit ids first, then top-to-bottom, left-to-right', () => {
    const b = board([
      node({ id: 'c', kind: 'frame', position: { x: 0, y: 900 } }),
      node({ id: 'b', kind: 'frame', position: { x: 600, y: 0 } }),
      node({ id: 'a', kind: 'frame', position: { x: 0, y: 0 } }),
      node({ id: 'x', kind: 'block', position: { x: 0, y: -50 } }),
    ])
    expect(orderedFrames(b).map((n) => n.id)).toEqual(['a', 'b', 'c'])
    expect(orderedFrames({ ...b, readingOrder: ['c', 'gone', 'x'] }).map((n) => n.id)).toEqual(['c', 'a', 'b'])
    // Reordering frames keeps other explicit ids after them and never moves geometry.
    const next = setFrameOrder({ ...b, readingOrder: ['x', 'a'] }, ['b', 'a', 'c'])
    expect(next.readingOrder).toEqual(['b', 'a', 'c', 'x'])
    expect(next.nodes).toBe(b.nodes)
  })

  test('test headings skip code fences and strip inline markup', () => {
    expect(headingsOf('# One\ntext\n```\n# not\n```\n### **Three** [[Ada|A]]\n#nohash')).toEqual([
      { level: 1, text: 'One' },
      { level: 3, text: 'Three A' },
    ])
    // Shapes' text counts too; nodes come in reading order.
    const b = board(
      [node({ id: 'low', blockId: 'b1', position: { x: 0, y: 500 } }), node({ id: 's', kind: 'shape', blockId: 'b2', position: { x: 0, y: 0 } })],
      [],
      { b1: textBlock('## Low'), b2: textBlock('# Shape heading') },
    )
    expect(boardOutline(b).map((h) => h.nodeId)).toEqual(['s', 'low'])
    expect(boardOutline({ ...b, readingOrder: ['low'] }).map((h) => h.text)).toEqual(['Low', 'Shape heading'])
  })

  test('test stats counts', () => {
    const b = board(
      [
        node({ id: 't', blockId: 'bt' }),
        node({ id: 'o', blockId: 'bo' }),
        node({ id: 'm', blockId: 'bm' }),
        node({ id: 'w', blockId: 'bw' }),
        node({ id: 's', kind: 'shape', shape: 'rectangle', blockId: 'bs' }),
        node({ id: 'f', kind: 'frame' }),
        node({ id: 'p', kind: 'point' }),
      ],
      [edge({ id: 'e1', source: 't', target: 'o', blockId: 'be' }), edge({ id: 'e2', source: 'o', target: 'm', label: 'old label' })],
      {
        bt: textBlock('# Hello world\n\nThree more words'),
        bo: { type: 'entity', link: '[[Ada]]' },
        bm: { type: 'media', path: 'Attachments/a.png' },
        bw: { type: 'weblink', url: 'https://example.com' },
        bs: textBlock('In shape'),
        be: textBlock('yes'),
      },
    )
    expect(boardStats(b, [{}, {}])).toEqual({
      text: 1,
      objects: 1,
      media: 1,
      weblinks: 1,
      shapes: 1,
      frames: 1,
      connectors: 2,
      words: 5 + 2 + 1 + 2,
      strokes: 2,
    })
    expect(wordCount('**bold** [[Target|alias]] it’s x-ray')).toBe(5)
  })

  test('test slides follow reading order, a board without frames is one slide', () => {
    const b = { ...FRAMES(), readingOrder: ['f3'] }
    expect(presentationSlides(b).map((s) => s.frameId)).toEqual(['f3', 'f1', 'f2'])
    const plain = board([node({ id: 'a', position: { x: 0, y: 0 }, width: 100, height: 50 }), node({ id: 'b', position: { x: 300, y: 300 }, width: 100, height: 100 })])
    expect(presentationSlides(plain)).toEqual([{ frameId: null, label: '', box: { x: 0, y: 0, width: 400, height: 400 } }])
    expect(presentationSlides(board())).toEqual([])
  })
})

describe('floating inspector', () => {
  test('test outline lists headings and zooms', async () => {
    const b = board(
      [
        node({ id: 'late', blockId: 'b2', position: { x: 2000, y: 1500 }, width: 420, height: 120 }),
        node({ id: 'early', blockId: 'b1', position: { x: 0, y: 0 }, width: 420, height: 60 }),
        node({ id: 'plain', blockId: 'b3', position: { x: 0, y: 300 }, width: 420, height: 60 }),
      ],
      [],
      { b1: textBlock('# Intro\nSome text'), b2: textBlock('## Details\n### Deeper'), b3: textBlock('no heading') },
    )
    const { container } = await renderPage(b)
    const panel = openInspector()
    const items = within(within(panel).getByTestId('inspector-outline')).getAllByRole('button')
    expect(items.map((i) => i.textContent)).toEqual(['Intro', 'Details', 'Deeper'])
    expect(items.map((i) => i.dataset.level)).toEqual(['1', '2', '3'])
    fireEvent.click(items[1])
    expectCamera(container, fitBox([nodeBox(b.nodes.late)], PANE, FIT_PADDING))
  })

  test('test outline and frames empty states', async () => {
    await renderPage(board([node({ id: 'a', blockId: 'b' })], [], { b: textBlock('plain') }))
    const panel = openInspector()
    expect(within(panel).getByText('This page has no headings')).toBeInTheDocument()
    fireEvent.click(within(panel).getByRole('tab', { name: 'Frames' }))
    expect(within(panel).getByText('This whiteboard has no frames')).toBeInTheDocument()
  })

  test('test frames reorder writes reading order', async () => {
    const b = FRAMES()
    const { client, container } = await renderPage(b)
    const panel = openInspector()
    fireEvent.click(within(panel).getByRole('tab', { name: 'Frames' }))
    const list = within(panel).getByTestId('inspector-frames')
    const rows = () => Array.from(list.querySelectorAll<HTMLElement>('li[data-frame-id]'))
    expect(rows().map((r) => r.dataset.frameId)).toEqual(['f1', 'f2', 'f3'])

    // Click zooms to the frame.
    fireEvent.click(within(rows()[1]).getByRole('button'))
    expectCamera(container, fitBox([nodeBox(b.nodes.f2)], PANE, FIT_PADDING))

    // Drag "End" onto "Intro".
    const data = new Map<string, string>()
    const dataTransfer = { setData: (k: string, v: string) => data.set(k, v), getData: (k: string) => data.get(k) ?? '', effectAllowed: '' }
    fireEvent.dragStart(rows()[2], { dataTransfer })
    fireEvent.dragOver(rows()[0], { dataTransfer })
    fireEvent.drop(rows()[0], { dataTransfer })
    await waitFor(() => expect(client.saveBoard).toHaveBeenCalled())
    expect(client.saveBoard.mock.lastCall![1].readingOrder).toEqual(['f3', 'f1', 'f2'])
    // Geometry untouched.
    expect(client.saveBoard.mock.lastCall![1].nodes).toEqual(b.nodes)
    expect(rows().map((r) => r.dataset.frameId)).toEqual(['f3', 'f1', 'f2'])

    // Alt+ArrowDown moves a frame one down (our choice).
    fireEvent.keyDown(within(rows()[0]).getByRole('button'), { key: 'ArrowDown', altKey: true })
    await waitFor(() => expect(client.saveBoard.mock.lastCall![1].readingOrder).toEqual(['f1', 'f3', 'f2']))
  })

  test('test frames do not reorder on a locked board', async () => {
    const { client } = await renderPage({ ...FRAMES(), locked: true })
    const panel = openInspector()
    fireEvent.click(within(panel).getByRole('tab', { name: 'Frames' }))
    const rows = within(panel).getByTestId('inspector-frames').querySelectorAll<HTMLElement>('li[data-frame-id]')
    expect(rows[0].getAttribute('draggable')).toBe('false')
    fireEvent.keyDown(within(rows[0]).getByRole('button'), { key: 'ArrowDown', altKey: true })
    await new Promise((r) => setTimeout(r, 450))
    expect(client.saveBoard).not.toHaveBeenCalled()
  })

  test('test stats tab shows the counts', async () => {
    await renderPage(
      board([node({ id: 'a', blockId: 'b' }), node({ id: 'f', kind: 'frame' })], [], { b: textBlock('one two three') }),
    )
    const panel = openInspector()
    fireEvent.click(within(panel).getByRole('tab', { name: 'Stats' }))
    const stats = within(panel).getByTestId('inspector-stats')
    const value = (k: string) => stats.querySelector(`[data-stat="${k}"] dd`)!.textContent
    expect(value('text')).toBe('1')
    expect(value('frames')).toBe('1')
    expect(value('words')).toBe('3')
    expect(value('connectors')).toBe('0')
    expect(within(stats).getByText('Words')).toBeInTheDocument()
  })

  test('test pin keeps the inspector open on the next visit', async () => {
    const first = await renderPage(FRAMES())
    expect(screen.queryByTestId('whiteboard-inspector')).toBeNull()
    const panel = openInspector()
    fireEvent.click(within(panel).getByRole('button', { name: 'Pin' }))
    expect(within(panel).getByRole('button', { name: 'Unpin' })).toBeInTheDocument()
    first.unmount()
    await renderPage(FRAMES())
    expect(screen.getByTestId('whiteboard-inspector')).toBeInTheDocument()
  })
})

describe('presentation', () => {
  test('test play steps frames in reading order', async () => {
    const b = { ...FRAMES(), readingOrder: ['f3', 'f1'] }
    const { container } = await renderPage(b)
    const fill = (id: string) => fitBox([nodeBox(b.nodes[id])], PANE, FIT_PADDING, ZOOM_MAX)

    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    const bar = screen.getByTestId('whiteboard-presentation')
    expect(screen.queryByRole('toolbar', { name: 'Whiteboard tools' })).toBeNull()
    expect(bar.dataset.slide).toBe('1')
    expect(within(bar).getByText('End')).toBeInTheDocument()
    expectCamera(container, fill('f3'))
    expect(within(bar).getByRole('button', { name: 'Previous page' })).toBeDisabled()

    fireEvent.click(within(bar).getByRole('button', { name: 'Next page' }))
    expect(bar.dataset.slide).toBe('2')
    expectCamera(container, fill('f1'))

    fireEvent.keyDown(screen.getByTestId('whiteboard-canvas'), { key: 'ArrowRight' })
    expect(bar.dataset.slide).toBe('3')
    expectCamera(container, fill('f2'))
    expect(within(bar).getByRole('button', { name: 'Next page' })).toBeDisabled()

    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(bar.dataset.slide).toBe('2')

    fireEvent.keyDown(screen.getByTestId('whiteboard-canvas'), { key: 'Escape' })
    expect(screen.queryByTestId('whiteboard-presentation')).toBeNull()
    expect(screen.getByRole('toolbar', { name: 'Whiteboard tools' })).toBeInTheDocument()
  })

  test('test exit presentation button exits', async () => {
    await renderPage(FRAMES())
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    fireEvent.click(screen.getByRole('button', { name: 'Exit presentation' }))
    expect(screen.queryByTestId('whiteboard-presentation')).toBeNull()
  })

  test('test an empty board does not present', async () => {
    await renderPage(board())
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    expect(screen.queryByTestId('whiteboard-presentation')).toBeNull()
  })
})

describe('board notes', () => {
  function pmEditor(): TiptapEditor {
    const dom = screen.getByTestId('whiteboard-notes-editor').querySelector('.ProseMirror') as (HTMLElement & { editor?: TiptapEditor }) | null
    if (!dom?.editor) throw new Error('editor not mounted')
    return dom.editor
  }

  test('test notes editor saves the board body', async () => {
    const body = 'First note line.\n'
    vi.mocked(api.object).mockImplementation(async (path: string) =>
      objectDetail({ summary: objectSummary({ path }), body, version: 'v1' }),
    )
    const saveBody = vi.mocked(api.saveBody)
    await renderPage(board())
    const notes = await screen.findByTestId('whiteboard-notes')
    // Collapsed by default (our choice): no editor until opened.
    const toggle = within(notes).getByRole('button', { name: 'Notes' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('whiteboard-notes-editor')).toBeNull()

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await waitFor(() => expect(screen.getByTestId('whiteboard-notes-editor')).toHaveTextContent('First note line.'))
    // Opening never writes.
    await new Promise((r) => setTimeout(r, 50))
    expect(saveBody).not.toHaveBeenCalled()

    const editor = pmEditor()
    act(() => {
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' More.')
    })
    // Collapsing saves now (no wait for the debounce).
    fireEvent.click(toggle)
    await waitFor(() => expect(saveBody).toHaveBeenCalledTimes(1))
    expect(saveBody).toHaveBeenCalledWith(PATH, 'First note line. More.\n', 'v1')
    await waitFor(() => expect(screen.queryByTestId('whiteboard-notes-editor')).toBeNull())

    // Reopened, it shows the saved text; a rename after it uses the saved version.
    fireEvent.click(toggle)
    await waitFor(() => expect(screen.getByTestId('whiteboard-notes-editor')).toHaveTextContent('First note line. More.'))
    fireEvent.click(screen.getByText('Board'))
    const input = screen.getByRole('textbox', { name: 'Title' })
    fireEvent.change(input, { target: { value: 'Renamed' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(api.renameObject).toHaveBeenCalledWith(PATH, 'Renamed', 'v1+1'))
    expect(saveBody).toHaveBeenCalledTimes(1)
  })
})
