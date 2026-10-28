import '@/whiteboard/test/flowEnv'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { WhiteboardData } from '@/api/whiteboardTypes'
import {
  CLIPBOARD_PREFIX,
  classifyText,
  parsePayload,
  pastePayload,
  selectionPayload,
  serializePayload,
} from './clipboard'
import type { WhiteboardHost } from './host'
import { DEFAULT_SETTINGS } from './model'
import { BoardStoreContext, createBoardStore, type BoardStore } from './store'
import { board, edge, node, textBlock } from './test/boards'
import { WhiteboardCanvas } from './WhiteboardCanvas'

vi.mock('html-to-image', () => ({ toPng: vi.fn(async () => 'data:image/png;base64,AAAA') }))

function sample(): WhiteboardData {
  return board(
    [
      node({ id: 'a', blockId: 'ba', position: { x: 0, y: 0 }, width: 420, height: 60, z: 1, locked: true }),
      node({ id: 'b', kind: 'shape', shape: 'rectangle', position: { x: 600, y: 0 }, width: 90, height: 90, z: 2 }),
      node({ id: 'c', blockId: 'bc', position: { x: 0, y: 300 }, width: 420, height: 60, z: 3 }),
      node({ id: 'p1', kind: 'point', position: { x: 0, y: 600 } }),
      node({ id: 'p2', kind: 'point', position: { x: 120, y: 600 } }),
    ],
    [
      edge({ id: 'ab', source: 'a', target: 'b', markerEnd: 'arrow' }),
      edge({ id: 'bc', source: 'b', target: 'c' }),
      edge({ id: 'line', source: 'p1', target: 'p2' }),
    ],
    { ba: textBlock('Alpha'), bc: textBlock('Gamma'), 'x-unused': textBlock('unused') },
    { 'x-board-key': 1 },
  )
}

function host(over: Partial<WhiteboardHost> = {}): WhiteboardHost {
  return {
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
    ...over,
  }
}

function renderCanvas(b: WhiteboardData = sample(), h: WhiteboardHost = host()) {
  const store: BoardStore = createBoardStore({ doc: { board: b, strokes: [] } })
  render(
    <BoardStoreContext.Provider value={store}>
      <div style={{ width: 1280, height: 800 }}>
        <WhiteboardCanvas boardKey="Whiteboards/Clip.md" settings={{ ...DEFAULT_SETTINGS }} host={h} />
      </div>
    </BoardStoreContext.Provider>,
  )
  const wrapper = screen.getByTestId('whiteboard-canvas')
  wrapper.focus()
  return { store, host: h, wrapper }
}

let clip: { text: string; writeText: ReturnType<typeof vi.fn>; readText: ReturnType<typeof vi.fn>; read?: ReturnType<typeof vi.fn> }

function installClipboard(withRead = false) {
  clip = {
    text: '',
    writeText: vi.fn(async (t: string) => {
      clip.text = t
    }),
    readText: vi.fn(async () => clip.text),
  }
  if (withRead) clip.read = vi.fn(async () => [])
  Object.defineProperty(navigator, 'clipboard', { value: clip, configurable: true })
}

let fetchSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  localStorage.clear()
  installClipboard()
  fetchSpy = vi.fn(async () => new Response('{}'))
  vi.stubGlobal('fetch', fetchSpy)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const ids = (b: WhiteboardData) => ({
  nodes: new Set(Object.keys(b.nodes)),
  edges: new Set(Object.keys(b.edges)),
  blocks: new Set(Object.keys(b.blocks)),
})

describe('whiteboard clipboard', () => {
  test('test copy writes prefixed json', async () => {
    const { store, wrapper } = renderCanvas()
    await act(async () => {})
    act(() => store.getState().actions.select(['a', 'b']))
    fireEvent.keyDown(wrapper, { key: 'c', code: 'KeyC', ctrlKey: true })
    await waitFor(() => expect(clip.writeText).toHaveBeenCalledTimes(1))
    const text = clip.text
    expect(text.startsWith(CLIPBOARD_PREFIX)).toBe(true)
    const payload = JSON.parse(text.slice(CLIPBOARD_PREFIX.length))
    // The two nodes, only the edge between them, and only their blocks.
    expect(payload.nodes.map((n: { id: string }) => n.id).sort()).toEqual(['a', 'b'])
    expect(payload.edges.map((e: { id: string }) => e.id)).toEqual(['ab'])
    expect(Object.keys(payload.blocks)).toEqual(['ba'])
    // Copy changes nothing on the board.
    expect(Object.keys(store.getState().doc.board.nodes)).toHaveLength(5)

    // A selected Line brings its two end points.
    const line = selectionPayload(sample(), ['line'])!
    expect(line.nodes.map((n) => n.id).sort()).toEqual(['p1', 'p2'])
    expect(line.edges.map((e) => e.id)).toEqual(['line'])
    expect(selectionPayload(sample(), [])).toBeNull()
    expect(parsePayload(serializePayload(line))).toEqual(line)
    expect(parsePayload('capacities-whiteboard-v1:{}')).toBeNull()
    expect(parsePayload(CLIPBOARD_PREFIX + '{not json')).toBeNull()

    // The browser's own copy event carries it too (no permission needed), and cancels the fallback.
    clip.writeText.mockClear()
    act(() => store.getState().actions.select(['c']))
    fireEvent.keyDown(wrapper, { key: 'c', code: 'KeyC', ctrlKey: true })
    const data = { setData: vi.fn(), getData: vi.fn(() => '') }
    const ev = new Event('copy', { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown }
    Object.defineProperty(ev, 'clipboardData', { value: data })
    document.body.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(data.setData).toHaveBeenCalledWith('text/plain', expect.stringMatching(/^object-whiteboard-v1:/))
    await new Promise((r) => setTimeout(r, 100))
    expect(clip.writeText).not.toHaveBeenCalled()
  })

  test('test paste assigns fresh ids and offsets', async () => {
    const { store, wrapper } = renderCanvas()
    await act(async () => {})
    act(() => store.getState().actions.select(['a', 'b']))
    fireEvent.keyDown(wrapper, { key: 'c', code: 'KeyC', ctrlKey: true })
    await waitFor(() => expect(clip.writeText).toHaveBeenCalled())
    const before = ids(store.getState().doc.board)

    fireEvent.keyDown(wrapper, { key: 'v', code: 'KeyV', ctrlKey: true })
    await waitFor(() => expect(Object.keys(store.getState().doc.board.nodes)).toHaveLength(7))
    const b1 = store.getState().doc.board
    const fresh = Object.values(b1.nodes).filter((n) => !before.nodes.has(n.id))
    expect(fresh).toHaveLength(2)
    const newEdges = Object.values(b1.edges).filter((e) => !before.edges.has(e.id))
    expect(newEdges).toHaveLength(1)
    const freshIds = new Set(fresh.map((n) => n.id))
    expect(freshIds.has(newEdges[0].source) && freshIds.has(newEdges[0].target)).toBe(true)
    expect(newEdges[0].markerEnd).toBe('arrow')
    // Fresh block ids too, holding copies of the text.
    const text = fresh.find((n) => n.blockId)!
    expect(before.blocks.has(text.blockId!)).toBe(false)
    expect(b1.blocks[text.blockId!]).toEqual({ type: 'text', markdown: 'Alpha' })
    // 30 px down and right of the originals, unlocked, on top, and selected.
    expect(text.position).toEqual({ x: 30, y: 30 })
    expect(text.locked).toBeUndefined()
    expect(Math.min(...fresh.map((n) => n.z ?? 0))).toBeGreaterThan(3)
    expect(new Set(store.getState().selection)).toEqual(new Set([...freshIds, newEdges[0].id]))
    // Unknown keys of the board survive.
    expect(b1['x-board-key']).toBe(1)

    // A second paste of the same clipboard sits another 30 px further.
    fireEvent.keyDown(wrapper, { key: 'v', code: 'KeyV', ctrlKey: true })
    await waitFor(() => expect(Object.keys(store.getState().doc.board.nodes)).toHaveLength(9))
    const b2 = store.getState().doc.board
    const second = Object.values(b2.nodes).filter((n) => !b1.nodes[n.id] && n.blockId)
    expect(second[0].position).toEqual({ x: 60, y: 60 })
    // All ids unique across the board.
    const all = [...Object.keys(b2.nodes), ...Object.keys(b2.edges)]
    expect(new Set(all).size).toBe(all.length)

    // One undo step per paste.
    act(() => store.getState().actions.undo())
    expect(Object.keys(store.getState().doc.board.nodes)).toHaveLength(7)

    // Pure: pasting the same payload twice never repeats an id.
    const payload = selectionPayload(sample(), ['a', 'b', 'line'])!
    const r1 = pastePayload(sample(), payload)
    const r2 = pastePayload(r1.board, payload)
    expect(r1.ids.some((id) => r2.ids.includes(id))).toBe(false)
  })

  test('cut copies and removes the selection, keeping locked nodes', async () => {
    const { store, wrapper } = renderCanvas()
    await act(async () => {})
    act(() => store.getState().actions.select(['a', 'c']))
    fireEvent.keyDown(wrapper, { key: 'x', code: 'KeyX', ctrlKey: true })
    await waitFor(() => expect(store.getState().doc.board.nodes.c).toBeUndefined())
    expect(clip.text.startsWith(CLIPBOARD_PREFIX)).toBe(true)
    // `a` is locked: copied, but it stays.
    expect(store.getState().doc.board.nodes.a).toBeDefined()
  })

  test('test paste text image and url', async () => {
    const h = host()
    const { store, wrapper } = renderCanvas(board(), h)
    await act(async () => {})
    const blocksOf = () => Object.values(store.getState().doc.board.blocks)

    // Plain text becomes a text block.
    clip.text = 'Shopping list\n- milk'
    fireEvent.keyDown(wrapper, { key: 'v', code: 'KeyV', ctrlKey: true })
    await waitFor(() => expect(blocksOf()).toHaveLength(1))
    expect(blocksOf()[0]).toEqual({ type: 'text', markdown: 'Shopping list\n- milk' })

    // A URL becomes a web-link card; nothing is fetched.
    clip.text = 'https://example.org/docs?q=1'
    fireEvent.keyDown(wrapper, { key: 'v', code: 'KeyV', ctrlKey: true })
    await waitFor(() => expect(blocksOf()).toHaveLength(2))
    expect(blocksOf()[1]).toEqual({ type: 'weblink', url: 'https://example.org/docs?q=1' })
    expect(fetchSpy).not.toHaveBeenCalled()

    // An image (through `navigator.clipboard.read`) is uploaded and placed as a media node.
    installClipboard(true)
    const png = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })
    clip.read!.mockResolvedValue([{ types: ['image/png'], getType: vi.fn(async () => png) }])
    fireEvent.keyDown(wrapper, { key: 'v', code: 'KeyV', ctrlKey: true })
    await waitFor(() => expect(blocksOf()).toHaveLength(3))
    expect(h.uploadAttachment).toHaveBeenCalledTimes(1)
    expect(blocksOf()[2]).toEqual({ type: 'media', path: 'Attachments/Pasted image.png' })

    // The browser's paste event (files and text, no prompt) works the same and wins over the fallback.
    const file = new File([new Uint8Array([1])], 'photo.jpg', { type: 'image/jpeg' })
    fireEvent.keyDown(wrapper, { key: 'v', code: 'KeyV', ctrlKey: true })
    const ev = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown }
    Object.defineProperty(ev, 'clipboardData', { value: { files: [file], getData: () => '' } })
    document.body.dispatchEvent(ev)
    await waitFor(() => expect(blocksOf()).toHaveLength(4))
    expect(blocksOf()[3]).toEqual({ type: 'media', path: 'Attachments/photo.jpg' })
    await new Promise((r) => setTimeout(r, 100))
    expect(blocksOf()).toHaveLength(4)
    expect(clip.read).toHaveBeenCalledTimes(1)

    // Classification: only a lone http(s) URL is a link; empty text pastes nothing.
    expect(classifyText('example.org')).toEqual({ kind: 'text', markdown: 'example.org' })
    expect(classifyText('see https://example.org')).toMatchObject({ kind: 'text' })
    expect(classifyText('javascript:alert(1)')).toMatchObject({ kind: 'text' })
    expect(classifyText('  \n ')).toBeNull()
  })

  test('paste does nothing on a locked board or while typing in a text block', async () => {
    const { store, wrapper } = renderCanvas(board([], [], {}, { locked: true }))
    await act(async () => {})
    clip.text = 'hello'
    fireEvent.keyDown(wrapper, { key: 'v', code: 'KeyV', ctrlKey: true })
    await new Promise((r) => setTimeout(r, 100))
    expect(Object.keys(store.getState().doc.board.nodes)).toHaveLength(0)
    expect(clip.readText).not.toHaveBeenCalled()
  })
})
