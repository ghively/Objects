import '@/whiteboard/test/flowEnv'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { WhiteboardData } from '@/api/whiteboardTypes'
import { OBJECT_DRAG_MIME } from './dnd'
import type { WhiteboardHost } from './host'
import { DEFAULT_SETTINGS } from './model'
import type { InkLayerProps, InkPlugin, InkStroke } from './plugin'
import { BoardStoreContext, createBoardStore, type BoardStore } from './store'
import { board, node } from './test/boards'
import { CAMERA_KEY, TOOLS_KEY, saveToolMemory } from './toolMemory'
import { WhiteboardCanvas } from './WhiteboardCanvas'

const KEY = 'Whiteboards/Board.md'

function fakeHost(): WhiteboardHost {
  return {
    openObject: vi.fn(),
    linkFor: vi.fn((path: string) => `[[${path.split('/').pop()!.replace(/\.md$/, '')}]]`),
    resolve: vi.fn(async () => null),
    rows: vi.fn(async () => []),
    requestDelete: vi.fn(),
    createObject: vi.fn(async () => 'Pages/New.md'),
    objects: vi.fn(async () => []),
  }
}

const stroke = (id: string): InkStroke => ({ id, tool: 'pen', color: '#5c5959', width: 4, points: [[0, 0, 0.5]], d: 'M0 0Z' })

function fakeInk() {
  const layerProps: InkLayerProps[] = []
  const plugin: InkPlugin = {
    Layer: (p: InkLayerProps) => {
      layerProps.push(p)
      return <div data-testid="ink-layer" data-tool={p.tool?.tool ?? ''} data-strokes={p.strokes.length} />
    },
    Toolbar: () => null,
    useInkDoc: () => ({ strokes: [], readOnlyReason: null, save: vi.fn(), flush: vi.fn(async () => {}) }),
  }
  return { plugin, layerProps }
}

interface Opts {
  doc?: { board: WhiteboardData; strokes: InkStroke[] }
  settings?: Partial<typeof DEFAULT_SETTINGS>
  ink?: InkPlugin
  host?: WhiteboardHost
  store?: BoardStore
}

function renderCanvas(opts: Opts = {}) {
  const store = opts.store ?? createBoardStore({ doc: opts.doc ?? { board: board(), strokes: [] } })
  const host = opts.host ?? fakeHost()
  const utils = render(
    <BoardStoreContext.Provider value={store}>
      <div style={{ width: 1280, height: 800 }}>
        <WhiteboardCanvas boardKey={KEY} settings={{ ...DEFAULT_SETTINGS, ...opts.settings }} host={host} ink={opts.ink} />
      </div>
    </BoardStoreContext.Provider>,
  )
  return { store, host, ...utils, wrapper: screen.getByTestId('whiteboard-canvas') }
}

function placementLayer() {
  return screen.getByTestId('whiteboard-placement')
}

function click(el: Element, x: number, y: number) {
  fireEvent.pointerDown(el, { clientX: x, clientY: y, button: 0, pointerId: 1 })
  fireEvent.pointerUp(el, { clientX: x, clientY: y, button: 0, pointerId: 1 })
}

function drag(el: Element, from: [number, number], to: [number, number]) {
  fireEvent.pointerDown(el, { clientX: from[0], clientY: from[1], button: 0, pointerId: 1 })
  fireEvent.pointerMove(el, { clientX: to[0], clientY: to[1], button: 0, pointerId: 1 })
  fireEvent.pointerUp(el, { clientX: to[0], clientY: to[1], button: 0, pointerId: 1 })
}

let fetchSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  localStorage.clear()
  fetchSpy = vi.fn(async () => new Response('{}'))
  vi.stubGlobal('fetch', fetchSpy)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('WhiteboardCanvas', () => {
  test('open, pan, zoom and select save nothing', async () => {
    const b = board([node({ id: 'a', position: { x: 0, y: 0 }, width: 420, height: 60 })])
    const { store, wrapper } = renderCanvas({ doc: { board: b, strokes: [] } })
    await act(async () => {})
    act(() => store.getState().actions.select(['a']))
    fireEvent.keyDown(wrapper, { key: '=', ctrlKey: true })
    fireEvent.keyDown(wrapper, { key: '-', ctrlKey: true })
    fireEvent.keyDown(wrapper, { key: ' ', code: 'Space' })
    fireEvent.keyUp(wrapper, { key: ' ', code: 'Space' })
    fireEvent.keyDown(wrapper, { key: 'h' })
    fireEvent.keyDown(wrapper, { key: 'v' })
    expect(store.getState().boardSeq).toBe(0)
    expect(store.getState().strokesSeq).toBe(0)
    expect(store.getState().doc.board).toBe(b)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('camera and tool memory go to localStorage only (and survive a throwing localStorage)', async () => {
    const store = createBoardStore({ onMemory: (m) => saveToolMemory(KEY, m) })
    const { wrapper } = renderCanvas({ store })
    await act(async () => {})
    fireEvent.keyDown(wrapper, { key: '=', ctrlKey: true })
    const camera = JSON.parse(localStorage.getItem(CAMERA_KEY + KEY) ?? 'null')
    expect(camera).toMatchObject({ zoom: 1.25 })
    fireEvent.keyDown(wrapper, { key: 'h' })
    expect(JSON.parse(localStorage.getItem(TOOLS_KEY + KEY) ?? '{}')).toMatchObject({ lastPointerTool: 'hand' })
    expect(fetchSpy).not.toHaveBeenCalled()

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const second = createBoardStore({ onMemory: (m) => saveToolMemory('other', m) })
    render(
      <BoardStoreContext.Provider value={second}>
        <WhiteboardCanvas boardKey="other" settings={DEFAULT_SETTINGS} host={fakeHost()} />
      </BoardStoreContext.Provider>,
    )
    const wrappers = screen.getAllByTestId('whiteboard-canvas')
    fireEvent.keyDown(wrappers[1], { key: '=', ctrlKey: true })
    fireEvent.keyDown(wrappers[1], { key: 'h' })
    expect(second.getState().tool).toBe('hand')
  })

  test('the saved camera wins over the file viewport', async () => {
    localStorage.setItem(CAMERA_KEY + KEY, JSON.stringify({ x: 10, y: 20, zoom: 2 }))
    const b = board([node({ id: 'a' })], [], {}, { viewport: { x: 0, y: 0, zoom: 0.5 } })
    const { container } = renderCanvas({ doc: { board: b, strokes: [] } })
    await act(async () => {})
    const vp = container.querySelector('.react-flow__viewport') as HTMLElement
    expect(vp.style.transform).toContain('scale(2)')
  })

  test('click and rubber band placement with one-shot tools returning to Move', async () => {
    const { store } = renderCanvas()
    await act(async () => {})
    act(() => store.getState().actions.setTool('rectangle'))
    click(placementLayer(), 300, 300)
    let nodes = Object.values(store.getState().doc.board.nodes)
    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toMatchObject({ kind: 'shape', shape: 'rectangle', width: 90, height: 90 })
    expect(store.getState().tool).toBe('select')
    expect(screen.queryByTestId('whiteboard-placement')).toBeNull()

    act(() => store.getState().actions.setTool('frame'))
    drag(placementLayer(), [60, 60], [250, 170])
    nodes = Object.values(store.getState().doc.board.nodes).filter((n) => n.kind === 'frame')
    expect(nodes).toHaveLength(1)
    // Snapped with the frame floor: x 60 → 60, far edge 250 → 240, 170 → 180; height 120 is above the 90 floor.
    expect(nodes[0]).toMatchObject({ position: { x: 60, y: 60 }, width: 180, height: 120, title: 'Frame 1' })
    expect(store.getState().tool).toBe('select')

    act(() => store.getState().actions.setTool('arrow'))
    drag(placementLayer(), [400, 400], [640, 400])
    const edges = Object.values(store.getState().doc.board.edges)
    expect(edges).toHaveLength(1)
    expect(edges[0].markerEnd).toBe('arrow')
    const ends = [store.getState().doc.board.nodes[edges[0].source], store.getState().doc.board.nodes[edges[0].target]]
    expect(ends.map((n) => n.kind)).toEqual(['point', 'point'])
    expect(ends.map((n) => n.position)).toEqual([
      { x: 390, y: 390 },
      { x: 630, y: 390 },
    ])
  })

  test('a text block placed with the Text tool opens for typing', async () => {
    const { store } = renderCanvas()
    await act(async () => {})
    act(() => store.getState().actions.setTool('text'))
    click(placementLayer(), 300, 300)
    const nodes = Object.values(store.getState().doc.board.nodes)
    expect(nodes).toHaveLength(1)
    expect(store.getState().editingId).toBe(nodes[0].id)
    expect(store.getState().tool).toBe('select')
    // Other tools place without editing.
    act(() => store.getState().actions.endEdit())
    act(() => store.getState().actions.setTool('rectangle'))
    click(placementLayer(), 600, 300)
    expect(store.getState().editingId).toBeNull()
  })

  test('dropping an object path creates an entity node at the drop point', async () => {
    const { store, wrapper, host } = renderCanvas({ settings: { isSnappingToGrid: false } })
    await act(async () => {})
    const ev = new Event('drop', { bubbles: true, cancelable: true })
    const data: Record<string, string> = { [OBJECT_DRAG_MIME]: 'Objects/Router A.md' }
    Object.defineProperties(ev, {
      clientX: { value: 500 },
      clientY: { value: 300 },
      dataTransfer: { value: { getData: (f: string) => data[f] ?? '', types: [OBJECT_DRAG_MIME] } },
    })
    act(() => {
      wrapper.dispatchEvent(ev)
    })
    expect(host.linkFor).toHaveBeenCalledWith('Objects/Router A.md')
    const b = store.getState().doc.board
    const n = Object.values(b.nodes)[0]
    expect(b.blocks[n.blockId!]).toEqual({ type: 'entity', link: '[[Router A]]' })
    const box = { x: n.position.x, y: n.position.y, w: n.width!, h: n.height! }
    expect(500).toBeGreaterThanOrEqual(box.x)
    expect(500).toBeLessThanOrEqual(box.x + box.w)
    expect(300).toBeGreaterThanOrEqual(box.y)
    expect(300).toBeLessThanOrEqual(box.y + box.h)
    expect(box.x + box.w / 2).toBe(500)
  })

  test('a plain [[wikilink]] drop also works; a locked board takes no drops', async () => {
    const { store, wrapper } = renderCanvas()
    await act(async () => {})
    const drop = () => {
      const ev = new Event('drop', { bubbles: true, cancelable: true })
      Object.defineProperties(ev, {
        clientX: { value: 100 },
        clientY: { value: 100 },
        dataTransfer: { value: { getData: (f: string) => (f === 'text/plain' ? '[[Router B]]' : ''), types: ['text/plain'] } },
      })
      act(() => {
        wrapper.dispatchEvent(ev)
      })
    }
    drop()
    const b = store.getState().doc.board
    expect(Object.values(b.blocks)).toEqual([{ type: 'entity', link: '[[Router B]]' }])
    act(() => store.getState().actions.setLocked(true))
    drop()
    expect(Object.keys(store.getState().doc.board.nodes)).toHaveLength(1)
  })

  test('empty and lost states', async () => {
    const empty = renderCanvas()
    await act(async () => {})
    expect(screen.getByText('You can change this by creating a new node.')).toBeInTheDocument()
    empty.unmount()

    const far = board([node({ id: 'far', position: { x: 50000, y: 50000 }, width: 420, height: 60 })], [], {}, { viewport: { x: 0, y: 0, zoom: 1 } })
    renderCanvas({ doc: { board: far, strokes: [] } })
    await act(async () => {})
    expect(screen.queryByText('You can change this by creating a new node.')).toBeNull()
    expect(screen.getByText('Nothing in this view')).toBeInTheDocument()
    expect(screen.getByText("But don't worry, we can just take you back.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back to content' }))
    await act(async () => {})
    expect(screen.queryByText('Nothing in this view')).toBeNull()
  })

  test('the lost state counts ink in view and lets pointer input through around its card', async () => {
    const { plugin } = fakeInk()
    const far = board([node({ id: 'far', position: { x: 50000, y: 50000 }, width: 420, height: 60 })], [], {}, { viewport: { x: 0, y: 0, zoom: 1 } })
    const inView = { ...stroke('s1'), points: [[100, 100, 0.5], [300, 300, 0.5]] as [number, number, number][] }
    const withInk = renderCanvas({ doc: { board: far, strokes: [inView] }, ink: plugin })
    await act(async () => {})
    expect(screen.queryByText('Nothing in this view')).toBeNull()
    withInk.unmount()

    renderCanvas({ doc: { board: far, strokes: [] } })
    await act(async () => {})
    const lost = document.querySelector('[data-whiteboard-lost]') as HTMLElement
    expect(lost).not.toBeNull()
    expect(lost.className).toContain('pointer-events-none')
    expect(screen.getByRole('button', { name: 'Back to content' }).parentElement!.className).toContain('pointer-events-auto')
  })

  test('ink layer rendered only with a plugin, with the store strokes and tool', async () => {
    const without = renderCanvas({ doc: { board: board(), strokes: [stroke('s1')] } })
    await act(async () => {})
    expect(screen.queryByTestId('ink-layer')).toBeNull()
    // Keys for the pen group do nothing without a plugin.
    fireEvent.keyDown(without.wrapper, { key: 'p' })
    expect(without.store.getState().inkTool).toBeNull()
    without.unmount()

    const { plugin, layerProps } = fakeInk()
    const { store, wrapper } = renderCanvas({ doc: { board: board(), strokes: [stroke('s1'), stroke('s2')] }, ink: plugin })
    await act(async () => {})
    const layer = screen.getByTestId('ink-layer')
    expect(layer.dataset.strokes).toBe('2')
    expect(layer.dataset.tool).toBe('')
    fireEvent.keyDown(wrapper, { key: 'p' })
    expect(screen.getByTestId('ink-layer').dataset.tool).toBe('pen')
    expect(store.getState().inkTool).toEqual({ tool: 'pen', color: '#5c5959', width: 4 })
    const last = layerProps[layerProps.length - 1]
    expect(last.readOnly).toBe(false)
    act(() => last.onStrokesChange([stroke('s1')], 'erase'))
    expect(store.getState().doc.strokes).toEqual([stroke('s1')])
    expect(screen.getByTestId('ink-layer').dataset.strokes).toBe('1')
    // A canvas tool turns the ink tool off.
    fireEvent.keyDown(wrapper, { key: 'v' })
    expect(store.getState().inkTool).toBeNull()
  })

  test('escape clears the selection first, then lets the key through', async () => {
    const onKey = vi.fn()
    const b = board([node({ id: 'a' })])
    const { store, wrapper } = renderCanvas({ doc: { board: b, strokes: [] } })
    document.addEventListener('keydown', onKey)
    await act(async () => {})
    act(() => store.getState().actions.select(['a']))
    fireEvent.keyDown(wrapper, { key: 'Escape' })
    expect(store.getState().selection).toEqual([])
    expect(onKey).not.toHaveBeenCalled()
    fireEvent.keyDown(wrapper, { key: 'Escape' })
    expect(onKey).toHaveBeenCalledTimes(1)
    document.removeEventListener('keydown', onKey)
  })

  test('keys edit the selection and undo through the store', async () => {
    const b = board([node({ id: 'a', kind: 'shape', shape: 'rectangle', position: { x: 0, y: 0 }, width: 90, height: 90, z: 1 })])
    const { store, wrapper } = renderCanvas({ doc: { board: b, strokes: [] } })
    await act(async () => {})
    act(() => store.getState().actions.select(['a']))
    fireEvent.keyDown(wrapper, { key: 'ArrowRight' })
    expect(store.getState().doc.board.nodes.a.position.x).toBe(30)
    fireEvent.keyDown(wrapper, { key: 'H', shiftKey: true })
    expect(store.getState().doc.board.nodes.a.flipX).toBe(true)
    fireEvent.keyDown(wrapper, { key: 'z', ctrlKey: true })
    fireEvent.keyDown(wrapper, { key: 'z', ctrlKey: true })
    expect(store.getState().doc.board).toBe(b)
    fireEvent.keyDown(wrapper, { key: 'Delete' })
    expect(store.getState().doc.board.nodes).toEqual({})
  })

  test('read-only and locked boards place nothing', async () => {
    const { store } = renderCanvas({ doc: { board: board([], [], {}, { locked: true }), strokes: [] } })
    await act(async () => {})
    act(() => store.getState().actions.setTool('text'))
    expect(screen.queryByTestId('whiteboard-placement')).toBeNull()
    expect(screen.getByTestId('whiteboard-canvas').dataset.tool).toBe('locked')
  })
})

describe('WhiteboardCanvas theme (M7)', () => {
  // index.html's default: class="dark", no data-theme.
  beforeEach(() => document.documentElement.classList.add('dark'))
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.classList.add('dark')
  })

  test('test graph and whiteboard canvases follow a theme change (whiteboard)', async () => {
    const n = node({ id: 'n-blue', width: 200, height: 80, fillColor: 'bg-blue' })
    const { container } = renderCanvas({ doc: { board: board([n], [], {}), strokes: [] } })
    const flowRoot = () => container.querySelector('.react-flow') as HTMLElement
    const fill = () => (screen.getByTestId('whiteboard-text-node') as HTMLElement).style.backgroundColor
    // Dark: React Flow's dark colours and colors.ts' bgDark (#263956).
    expect(flowRoot().classList.contains('dark')).toBe(true)
    expect(fill()).toBe('rgb(38, 57, 86)')

    await act(async () => {
      document.documentElement.setAttribute('data-theme', 'light')
      document.documentElement.classList.remove('dark')
      await Promise.resolve()
    })
    // Light: React Flow's light colours and bgLight (#E4EFFE), without a remount.
    expect(flowRoot().classList.contains('light')).toBe(true)
    expect(fill()).toBe('rgb(228, 239, 254)')

    await act(async () => {
      document.documentElement.setAttribute('data-theme', 'darkDimmed')
      document.documentElement.classList.add('dark')
      await Promise.resolve()
    })
    expect(flowRoot().classList.contains('dark')).toBe(true)
    expect(fill()).toBe('rgb(38, 57, 86)')
  })
})
