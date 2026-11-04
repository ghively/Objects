import '@/whiteboard/test/flowEnv'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { NodeChange } from '@xyflow/react'
import type { TypeDef } from '@/api/types'
import type { WhiteboardData, WhiteboardEntityBlock } from '@/api/whiteboardTypes'
import { useLinkIndex } from '@/links/linkIndex'
import * as A from './actions'
import { SelectionToolbar } from './chrome/SelectionToolbar'
import { fromFlowChange, toFlowNode } from './flowMapping'
import type { WhiteboardHost } from './host'
import { DEFAULT_SETTINGS, GRID, LINK_BLOCK_MIN_WIDTH } from './model'
import { fakeHost as nodeHost, fakeRow, renderBoard } from './nodes/test/harness'
import { keyToCommand } from './shortcuts'
import { BoardStoreContext, createBoardStore, type BoardStore } from './store'
import { QUICK_CREATE_LINK_TYPED, WB, quickCreateLinkTyped } from './strings'
import { board, node } from './test/boards'
import { WhiteboardCanvas } from './WhiteboardCanvas'

// React Flow measures handle bounds with layout jsdom doesn't have, so a real handle drag never
// starts a connection here. The canvas's own `onConnectEnd` is called with what React Flow hands
// it on a drop over empty canvas (`isValid: null`, no `toNode`).
const flowProps = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }))
vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>()
  const ReactFlow = ((props: Record<string, unknown>) => {
    if (props.onConnectEnd) flowProps.current = props
    const Real = actual.ReactFlow as unknown as (p: Record<string, unknown>) => ReactElement
    return <Real {...props} />
  }) as unknown as typeof actual.ReactFlow
  return { ...actual, ReactFlow }
})

const KEY = 'Whiteboards/Quick.md'

function host(over: Partial<WhiteboardHost> = {}): WhiteboardHost {
  return {
    openObject: vi.fn(),
    linkFor: vi.fn((p: string) => `[[${p.split('/').pop()!.replace(/\.md$/, '')}]]`),
    resolve: vi.fn(async () => null),
    rows: vi.fn(async () => []),
    requestDelete: vi.fn(),
    createObject: vi.fn(async () => 'Pages/Fresh idea.md'),
    objects: vi.fn(async () => [
      fakeRow('Pages/Alpha.md', 'Alpha', 'Page').summary,
      fakeRow('People/Bea.md', 'Bea', 'Person').summary,
    ]),
    ...over,
  }
}

const TYPES = [
  { id: 'Page', name: 'Page', pluralName: 'Pages', icon: null, basic: true },
  { id: 'Person', name: 'Person', pluralName: 'People', icon: null, basic: false },
] as unknown as TypeDef[]

function renderCanvas(b: WhiteboardData, h: WhiteboardHost = host()) {
  const store = createBoardStore({ doc: { board: b, strokes: [] } })
  render(
    <BoardStoreContext.Provider value={store}>
      <div style={{ width: 1280, height: 800 }}>
        <WhiteboardCanvas boardKey={KEY} settings={{ ...DEFAULT_SETTINGS }} host={h} />
      </div>
    </BoardStoreContext.Provider>,
  )
  return { store, host: h, wrapper: screen.getByTestId('whiteboard-canvas') }
}

/** Lets go of a connector dragged from node `id`'s `handle` over the empty pane at (x, y). */
function dropConnector(id: string, x: number, y: number, handle = 'right', type: 'source' | 'target' = 'source') {
  const pane = document.querySelector('.react-flow__pane')!
  const onConnectEnd = flowProps.current?.onConnectEnd as (e: MouseEvent, s: unknown) => void
  expect(onConnectEnd, 'the canvas handles connector drops').toBeTypeOf('function')
  const event = new MouseEvent('mouseup', { clientX: x, clientY: y })
  Object.defineProperty(event, 'target', { value: pane })
  act(() =>
    onConnectEnd(event, {
      isValid: null,
      from: { x: 420, y: 30 },
      fromHandle: { id: handle, nodeId: id, type, position: 'right', x: 0, y: 0, width: 1, height: 1 },
      fromPosition: 'right',
      fromNode: { id },
      to: { x, y },
      toHandle: null,
      toPosition: null,
      toNode: null,
      pointer: { x, y },
    }),
  )
}

const source = () => node({ id: 'a', position: { x: 0, y: 0 }, width: 420, height: 60, blockId: 'ba' })
const sourceBoard = () => board([source()], [], { ba: { type: 'text', markdown: 'Start' } })

let fetchSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  localStorage.clear()
  fetchSpy = vi.fn(async () => new Response('{}'))
  vi.stubGlobal('fetch', fetchSpy)
  useLinkIndex.setState({ types: TYPES })
  Element.prototype.scrollIntoView ??= function () {}
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('quick-create on a connector drop', () => {
  test('test connector drop opens quick create', async () => {
    const { store } = renderCanvas(sourceBoard())
    await act(async () => {})
    dropConnector('a', 700, 300)
    const menu = await screen.findByRole('menu', { name: WB.quickCreateObjects.text })
    const m = within(menu)
    // Objects: Create Object, Link Object, Link {name} per type; Shapes; Nothing; Remove.
    expect(m.getByText('Objects')).toBeTruthy()
    expect(m.getByRole('menuitem', { name: 'Create Object' })).toBeTruthy()
    expect(m.getByRole('menuitem', { name: 'Link Object' })).toBeTruthy()
    expect(m.getByRole('menuitem', { name: 'Link Page' })).toBeTruthy()
    expect(m.getByRole('menuitem', { name: 'Link Person' })).toBeTruthy()
    expect(m.getByText('Shapes')).toBeTruthy()
    for (const shape of ['Rectangle', 'Ellipse', 'Diamond', 'Parallelogram', 'Triangle', 'Star', 'Bubble', 'Arrow right', 'Heart']) {
      expect(m.getByRole('menuitem', { name: shape })).toBeTruthy()
    }
    expect(m.getByRole('menuitem', { name: 'Nothing' })).toBeTruthy()
    expect(m.getByRole('menuitem', { name: 'Remove' })).toBeTruthy()
    // Opening the menu changes nothing yet.
    expect(store.getState().boardSeq).toBe(0)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('test quick create creates and connects an object', async () => {
    const h = host()
    const { store } = renderCanvas(sourceBoard(), h)
    await act(async () => {})
    dropConnector('a', 700, 300)
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Create Object' }))
    // The type picker; picking a type creates the object through the host.
    const picker = await screen.findByRole('dialog', { name: WB.toolCreate.text })
    fireEvent.click(await within(picker).findByText('Person'))
    await waitFor(() => expect(h.createObject).toHaveBeenCalledWith('Person'))
    await waitFor(() => expect(Object.keys(store.getState().doc.board.edges)).toHaveLength(1))
    const b = store.getState().doc.board
    const e = Object.values(b.edges)[0]
    expect(e.source).toBe('a')
    expect(e.sourceHandle).toBe('right')
    const created = b.nodes[e.target]
    expect(created.kind).toBe('block')
    expect(b.blocks[created.blockId!]).toEqual({ type: 'entity', link: '[[Fresh idea]]' })
    // Placed at the drop point (centred, snapped), connected on the side facing the source.
    expect(e.targetHandle).toBe(A.facingHandle(A.nodeBox(created), { x: 210, y: 30 }))
    expect(created.position.x % GRID).toBe(0)
    expect(store.getState().selection).toEqual([created.id])
    // One undo step removes node and connector together.
    act(() => store.getState().actions.undo())
    expect(Object.keys(store.getState().doc.board.edges)).toHaveLength(0)
    expect(Object.keys(store.getState().doc.board.nodes)).toEqual(['a'])
  })

  test('test link typed lists only that type and connects the pick', async () => {
    const h = host()
    const { store } = renderCanvas(sourceBoard(), h)
    await act(async () => {})
    dropConnector('a', 700, 300)
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Link Person' }))
    const picker = await screen.findByRole('dialog', { name: WB.toolLink.text })
    await within(picker).findByText('Bea')
    expect(within(picker).queryByText('Alpha')).toBeNull()
    fireEvent.click(within(picker).getByText('Bea'))
    await waitFor(() => expect(Object.keys(store.getState().doc.board.edges)).toHaveLength(1))
    const b = store.getState().doc.board
    const target = b.nodes[Object.values(b.edges)[0].target]
    expect((b.blocks[target.blockId!] as WhiteboardEntityBlock).link).toBe('[[Bea]]')
  })

  test('test quick create a shape places it at the drop point', async () => {
    const { store } = renderCanvas(sourceBoard())
    await act(async () => {})
    dropConnector('a', 700, 300)
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Ellipse' }))
    const b = store.getState().doc.board
    const e = Object.values(b.edges)[0]
    expect(b.nodes[e.target]).toMatchObject({ kind: 'shape', shape: 'ellipse' })
    expect(screen.queryByRole('menu', { name: WB.quickCreateObjects.text })).toBeNull()
  })

  test('test nothing keeps a point and remove drops the edge', async () => {
    const { store } = renderCanvas(sourceBoard())
    await act(async () => {})
    dropConnector('a', 700, 300)
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove' }))
    expect(Object.keys(store.getState().doc.board.edges)).toHaveLength(0)
    expect(Object.keys(store.getState().doc.board.nodes)).toEqual(['a'])
    expect(store.getState().boardSeq).toBe(0)

    dropConnector('a', 700, 300)
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Nothing' }))
    const b = store.getState().doc.board
    const e = Object.values(b.edges)[0]
    expect(e.source).toBe('a')
    expect(b.nodes[e.target].kind).toBe('point')
    expect(e.targetHandle).toBeUndefined()

    // Escape closes the menu as "Remove".
    dropConnector('a', 700, 500)
    const menu = await screen.findByRole('menu', { name: WB.quickCreateObjects.text })
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(screen.queryByRole('menu', { name: WB.quickCreateObjects.text })).toBeNull()
    expect(Object.keys(store.getState().doc.board.edges)).toHaveLength(1)
  })

  test('test quick create pure action keeps a point and connects from a target handle', () => {
    const b = sourceBoard()
    const kept = A.quickCreate(b, { nodeId: 'a', handleId: 'right', at: { x: 611, y: 289 } }, { kind: 'none' }, { ids: { node: 'p', edge: 'e' } })
    expect(kept.nodes.p).toEqual({ id: 'p', kind: 'point', position: { x: 600, y: 300 } })
    expect(kept.edges.e).toEqual({ id: 'e', source: 'a', target: 'p', sourceHandle: 'right' })
    const reversed = A.quickCreate(
      b,
      { nodeId: 'a', handleId: 'bottom', fromTarget: true, at: { x: 210, y: 400 } },
      { kind: 'shape', shape: 'rectangle' },
      { ids: { node: 's', edge: 'e' } },
    )
    expect(reversed.edges.e).toMatchObject({ source: 's', target: 'a', sourceHandle: 'top', targetHandle: 'bottom' })
    // A missing source changes nothing.
    expect(A.quickCreate(b, { nodeId: 'zz', at: { x: 0, y: 0 } }, { kind: 'none' })).toBe(b)
  })

  test('test quick create fills the typed link template', () => {
    expect(QUICK_CREATE_LINK_TYPED.text).toBe('Link {name}')
    expect(quickCreateLinkTyped('Person')).toBe('Link Person')
  })
})

describe('entity node View menu', () => {
  const entityBoard = (view?: WhiteboardEntityBlock['view']) =>
    board(
      [node({ id: 'en', position: { x: 0, y: 0 }, width: 360, height: 120, blockId: 'be' })],
      [],
      { be: { type: 'entity', link: '[[Alpha]]', ...(view ? { view } : {}), 'x-keep': 1 } as WhiteboardEntityBlock },
    )

  function renderToolbar(store: BoardStore) {
    const Toolbar = () => {
      const b = store.getState().doc.board
      return <SelectionToolbar nodes={[b.nodes.en]} edges={[]} blocks={b.blocks} actions={store.getState().actions} />
    }
    return render(<Toolbar />)
  }

  test('test entity view menu switches views', async () => {
    const store = createBoardStore({ doc: { board: entityBoard(), strokes: [] } })
    const { unmount } = renderToolbar(store)
    fireEvent.click(screen.getByRole('button', { name: 'View' }))
    const menu = await screen.findByRole('menu', { name: 'View' })
    const names = within(menu).getAllByRole('menuitem').map((el) => el.textContent)
    expect(names).toEqual(['Link block', 'Small card', 'Wide card', 'Embed'])
    expect(within(menu).getByRole('menuitem', { name: 'Small card' }).getAttribute('aria-current')).toBe('true')
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Wide card' }))
    expect(store.getState().doc.board.blocks.be).toEqual({ type: 'entity', link: '[[Alpha]]', view: 'wideCard', 'x-keep': 1 })
    unmount()

    // The node draws the chosen view.
    const h = nodeHost({
      resolve: vi.fn(async () => 'Pages/Alpha.md'),
      rows: vi.fn(async () => [fakeRow('Pages/Alpha.md', 'Alpha')]),
    })
    renderBoard(store.getState().doc.board, { host: h })
    const el = await screen.findByTestId('whiteboard-entity-node')
    expect(el.getAttribute('data-view')).toBe('wideCard')
    await screen.findByTestId('whiteboard-entity-view')

    // Not offered for anything but embedded objects.
    expect(A.setEntityView(sourceBoard(), 'a', 'embed')).toEqual(sourceBoard())
  })
})

describe('keyboard resize', () => {
  test('test keyboard resize: Ctrl+Arrow, 1 px, 30 px with Shift or snap to grid', async () => {
    expect(keyToCommand({ key: 'ArrowRight', ctrlKey: true }, { hasSelection: true })).toEqual({ type: 'resize', dw: 1, dh: 0 })
    expect(keyToCommand({ key: 'ArrowRight', ctrlKey: true }, { hasSelection: true, gridSnap: true })).toEqual({ type: 'resize', dw: GRID, dh: 0 })
    expect(keyToCommand({ key: 'ArrowUp', metaKey: true, shiftKey: true }, { hasSelection: true })).toEqual({ type: 'resize', dw: 0, dh: -GRID })
    // Without a selection Ctrl+Arrow is not the canvas's (back / forward).
    expect(keyToCommand({ key: 'ArrowRight', ctrlKey: true }, { hasSelection: false })).toBeNull()
    // The old Ctrl+Alt+Arrow and Alt+Arrow do nothing on the canvas.
    expect(keyToCommand({ key: 'ArrowRight', ctrlKey: true, altKey: true }, { hasSelection: true })).toBeNull()
    expect(keyToCommand({ key: 'ArrowLeft', altKey: true }, { hasSelection: true })).toBeNull()

    const b = board(
      [
        node({ id: 'r', kind: 'shape', shape: 'rectangle', position: { x: 30, y: 60 }, width: 120, height: 90 }),
        node({ id: 'en', position: { x: 0, y: 300 }, width: 360, height: 120, blockId: 'be' }),
      ],
      [],
      { be: { type: 'entity', link: '[[Alpha]]' } },
    )
    const { store, wrapper } = renderCanvas(b)
    await act(async () => {})
    act(() => store.getState().actions.select(['r', 'en']))
    // Snap to grid is on by default: 30 px steps.
    fireEvent.keyDown(wrapper, { key: 'ArrowRight', ctrlKey: true })
    let r = store.getState().doc.board.nodes.r
    expect(r).toMatchObject({ position: { x: 30, y: 60 }, width: 150, height: 90 })
    // Each press is one undo step.
    act(() => store.getState().actions.undo())
    expect(store.getState().doc.board.nodes.r.width).toBe(120)
    fireEvent.keyDown(wrapper, { key: 'ArrowRight', ctrlKey: true })
    fireEvent.keyDown(wrapper, { key: 'ArrowDown', ctrlKey: true, shiftKey: true })
    r = store.getState().doc.board.nodes.r
    expect(r).toMatchObject({ width: 150, height: 120 })
    // Shrinking stops at the floor: shapes 90, an embedded object 360 wide.
    for (let i = 0; i < 3; i++) fireEvent.keyDown(wrapper, { key: 'ArrowLeft', ctrlKey: true, shiftKey: true })
    expect(store.getState().doc.board.nodes.r.width).toBe(90)
    expect(store.getState().doc.board.nodes.en.width).toBe(LINK_BLOCK_MIN_WIDTH)
  })
})

describe('node lock', () => {
  test('test locked node refuses move resize delete', async () => {
    const store = createBoardStore({
      doc: {
        board: board([node({ id: 'k', kind: 'shape', shape: 'rectangle', position: { x: 0, y: 0 }, width: 90, height: 90 })]),
        strokes: [],
      },
    })
    // Lock through the selection toolbar.
    const Toolbar = () => {
      const b = store.getState().doc.board
      return <SelectionToolbar nodes={[b.nodes.k]} edges={[]} blocks={b.blocks} actions={store.getState().actions} />
    }
    const { rerender, unmount } = render(<Toolbar />)
    fireEvent.click(screen.getByRole('button', { name: WB.nodeLock.text }))
    expect(store.getState().doc.board.nodes.k.locked).toBe(true)
    rerender(<Toolbar />)
    // Locked: no Delete, an Unlock button.
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    expect(screen.getByRole('button', { name: WB.nodeUnlock.text })).toBeTruthy()
    unmount()

    const locked = store.getState().doc.board
    const a = store.getState().actions
    act(() => {
      a.nudge(30, 0, ['k'])
      a.removeSelection(['k'])
      a.apply('resize', (b) => A.resizeBy(b, ['k'], 30, 30))
    })
    const changes: NodeChange[] = [
      { type: 'position', id: 'k', position: { x: 300, y: 300 } },
      { type: 'dimensions', id: 'k', dimensions: { width: 300, height: 300 }, resizing: true },
    ]
    expect(fromFlowChange(locked, changes)).toBe(locked)
    act(() => store.getState().canvas.applyFlowChanges(changes))
    expect(store.getState().doc.board).toBe(locked)
    expect(toFlowNode(locked.nodes.k, locked.blocks)).toMatchObject({ draggable: false, deletable: false })

    // The lock icon shows on the node (CSS reveals it on hover).
    renderBoard(locked)
    expect(document.querySelector('[data-whiteboard-node-locked]')).not.toBeNull()

    // Unlocking removes the key; then it moves again.
    const unlocked = A.setNodesLocked(locked, ['k'], false)
    expect('locked' in unlocked.nodes.k).toBe(false)
    expect(A.nudge(unlocked, ['k'], 30, 0).nodes.k.position.x).toBe(30)
  })
})
