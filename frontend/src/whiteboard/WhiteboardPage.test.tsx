import '@/whiteboard/test/flowEnv'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api } from '@/api/client'
import type { WhiteboardData } from '@/api/whiteboardTypes'
import { useVersionHistory } from '@/history/useVersionHistory'
import { useTabs } from '@/nav/tabs'
import { useDeleteRequest } from '@/object/DeleteObjectDialog'
import type { BoardMenuProps, ToolboxProps } from './canvasTypes'
import { OBJECT_DRAG_MIME } from './dnd'
import type { WhiteboardHost } from './host'
import type { InkDoc, InkLayerProps, InkPlugin, InkStroke } from './plugin'
import { board, node } from './test/boards'
import { mockWhiteboardApi } from './test/mockWhiteboardApi'
import { WhiteboardPage } from './WhiteboardPage'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

// The chrome is Task 12's; these stand-ins expose the callbacks the page wires.
vi.mock('./chrome', () => ({
  Toolbox: (p: ToolboxProps) => (
    <div data-testid="toolbox" data-readonly={String(!!p.readOnly)} data-locked={String(p.locked)}>
      <button type="button" disabled={!p.canUndo} onClick={p.onUndo}>
        undo
      </button>
      <button type="button" disabled={!p.canRedo} onClick={p.onRedo}>
        redo
      </button>
      <button type="button" onClick={() => p.onLock(!p.locked)}>
        lock
      </button>
      {p.inkSlot}
    </div>
  ),
  ZoomMenu: ({ zoom }: { zoom: number }) => <div data-testid="zoom">{Math.round(zoom * 100)}%</div>,
  SelectionToolbar: () => <div data-testid="selection-toolbar" />,
  BoardMenu: (p: BoardMenuProps) => (
    <div>
      <button type="button" disabled={p.disabled} onClick={p.onClear}>
        Clear Whiteboard
      </button>
      <button type="button" onClick={p.onDelete}>
        Delete board
      </button>
      {p.onVersionHistory && (
        <button type="button" onClick={p.onVersionHistory}>
          Version History
        </button>
      )}
    </div>
  ),
  ObjectPicker: () => null,
}))

const PATH = 'Whiteboards/Board.md'
const stroke = (id: string): InkStroke => ({ id, tool: 'pen', color: '#5c5959', width: 4, points: [[0, 0, 0.5]], d: 'M0 0Z' })

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

function fakeInk(initial: InkStroke[] = []) {
  const doc: InkDoc = { strokes: initial, readOnlyReason: null, save: vi.fn(), flush: vi.fn(async () => {}) }
  const layer: { props: InkLayerProps | null } = { props: null }
  const plugin: InkPlugin = {
    Layer: (p) => {
      layer.props = p
      return <div data-testid="ink-layer" data-strokes={p.strokes.length} />
    },
    Toolbar: ({ readOnly }) => <div data-testid="ink-toolbar" data-readonly={String(readOnly)} />,
    useInkDoc: () => doc,
  }
  return { plugin, doc, layer }
}

function drop(link: string) {
  const ev = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperties(ev, {
    clientX: { value: 300 },
    clientY: { value: 300 },
    dataTransfer: { value: { getData: (f: string) => (f === OBJECT_DRAG_MIME ? link : ''), types: [OBJECT_DRAG_MIME] } },
  })
  act(() => {
    screen.getByTestId('whiteboard-canvas').dispatchEvent(ev)
  })
}

async function renderPage(opts: { board?: WhiteboardData; ink?: InkPlugin; mode?: 'page' | 'peek'; readOnlyReason?: string } = {}) {
  const client = mockWhiteboardApi(opts.board ?? board(), 'rev-1')
  if (opts.readOnlyReason) {
    client.board.mockResolvedValue({ path: PATH, board: opts.board ?? board(), revision: 'rev-1', readOnlyReason: opts.readOnlyReason })
  }
  const host = fakeHost()
  const onExpand = vi.fn()
  const utils = render(
    <div style={{ width: 1280, height: 800 }}>
      <WhiteboardPage
        path={PATH}
        mode={opts.mode ?? 'page'}
        ink={opts.ink}
        host={host}
        client={client}
        onExpand={opts.mode === 'peek' ? onExpand : undefined}
        footer={opts.mode === 'peek' ? <div data-testid="pager" /> : undefined}
      />
    </div>,
  )
  await waitFor(() => expect(screen.getByTestId('whiteboard-canvas')).toBeInTheDocument())
  await waitFor(() => expect(screen.getByText('Board')).toBeInTheDocument())
  return { client, host, onExpand, ...utils }
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  useDeleteRequest.getState().clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('WhiteboardPage', () => {
  test('read-only board disables editing and shows the reason', async () => {
    const { plugin } = fakeInk()
    const { client } = await renderPage({ board: board([node({ id: 'a' })]), ink: plugin, readOnlyReason: 'This whiteboard was saved by a newer version of Object.' })
    expect(screen.getByText('This whiteboard was saved by a newer version of Object.')).toBeInTheDocument()
    expect(screen.getByTestId('toolbox').dataset.readonly).toBe('true')
    expect(screen.getByTestId('ink-toolbar').dataset.readonly).toBe('true')
    expect(screen.getByRole('button', { name: 'Clear Whiteboard' })).toBeDisabled()
    drop('Objects/Router A.md')
    await new Promise((r) => setTimeout(r, 450))
    expect(client.saveBoard).not.toHaveBeenCalled()
  })

  test('locked board is view only', async () => {
    const { client } = await renderPage({ board: board([node({ id: 'a' })], [], {}, { locked: true }) })
    expect(screen.getByTestId('whiteboard-canvas').dataset.tool).toBe('locked')
    expect(screen.getByTestId('toolbox').dataset.locked).toBe('true')
    expect(screen.getByRole('button', { name: 'Clear Whiteboard' })).toBeDisabled()
    drop('Objects/Router A.md')
    await new Promise((r) => setTimeout(r, 450))
    expect(client.saveBoard).not.toHaveBeenCalled()
    // Unlocking is the one edit a locked board takes.
    fireEvent.click(screen.getByRole('button', { name: 'lock' }))
    await waitFor(() => expect(client.saveBoard).toHaveBeenCalledTimes(1))
    expect(client.saveBoard.mock.calls[0][1].locked).toBeUndefined()
  })

  test('clear whiteboard clears board and ink in one undo step', async () => {
    const { plugin, doc } = fakeInk([stroke('s1')])
    const b = board([node({ id: 'a' })])
    const { client } = await renderPage({ board: b, ink: plugin })
    await waitFor(() => expect(screen.getByTestId('ink-layer').dataset.strokes).toBe('1'))
    fireEvent.click(screen.getByRole('button', { name: 'Clear Whiteboard' }))
    expect(doc.save).toHaveBeenCalledWith([])
    await waitFor(() => expect(client.saveBoard).toHaveBeenCalledTimes(1))
    expect(client.saveBoard.mock.calls[0][1].nodes).toEqual({})
    fireEvent.click(screen.getByRole('button', { name: 'undo' }))
    expect(doc.save).toHaveBeenLastCalledWith([stroke('s1')])
    await waitFor(() => expect(client.saveBoard).toHaveBeenCalledTimes(2))
    expect(Object.keys(client.saveBoard.mock.calls[1][1].nodes)).toEqual(['a'])
    expect(screen.getByRole('button', { name: 'undo' })).toBeDisabled()
  })

  test('stroke and node changes share one history', async () => {
    const { plugin, doc, layer } = fakeInk([])
    const { client } = await renderPage({ ink: plugin })
    act(() => layer.props!.onStrokesChange([stroke('s1')], 'draw'))
    expect(doc.save).toHaveBeenLastCalledWith([stroke('s1')])
    drop('Objects/Router A.md')
    fireEvent.click(screen.getByRole('button', { name: 'undo' })) // the drop
    fireEvent.click(screen.getByRole('button', { name: 'undo' })) // the stroke
    expect(doc.save).toHaveBeenLastCalledWith([])
    await waitFor(() => expect(client.saveBoard).toHaveBeenCalled())
    expect(client.saveBoard.mock.lastCall![1].nodes).toEqual({})
  })

  test('rename flushes pending saves first (and retargets the tab when the path changed)', async () => {
    const { plugin, doc } = fakeInk([])
    const retarget = vi.spyOn(useTabs.getState(), 'retarget')
    const { client } = await renderPage({ ink: plugin })
    drop('Objects/Router A.md')
    expect(client.saveBoard).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Board'))
    const input = screen.getByRole('textbox', { name: 'Title' })
    fireEvent.change(input, { target: { value: 'Network' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(api.renameObject).toHaveBeenCalledWith(PATH, 'Network', 'v1'))
    expect(client.saveBoard).toHaveBeenCalledTimes(1)
    expect(client.saveBoard.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(api.renameObject).mock.invocationCallOrder[0])
    expect(vi.mocked(doc.flush).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(api.renameObject).mock.invocationCallOrder[0])
    await waitFor(() => expect(retarget).toHaveBeenCalledWith(PATH, 'Whiteboards/Network.md'))
    expect(screen.getByText('Network')).toBeInTheDocument()
  })

  test('the board menu opens Version History on the board', async () => {
    useVersionHistory.getState().close()
    await renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Version History' }))
    expect(useVersionHistory.getState().path).toBe(PATH)
    useVersionHistory.getState().close()
  })

  test('delete request for this board opens the delete dialog and deletes with the version', async () => {
    const { host } = await renderPage()
    // The board menu's "Delete" goes through the host (App's delete request store by default).
    fireEvent.click(screen.getByRole('button', { name: 'Delete board' }))
    expect(host.requestDelete).toHaveBeenCalledWith(PATH, 'page')
    // A request for another board or the peek is not ours.
    act(() => useDeleteRequest.getState().requestDelete(PATH, 'peek'))
    expect(screen.queryByText('Delete this object?')).toBeNull()
    act(() => useDeleteRequest.getState().requestDelete(PATH, 'page'))
    expect(await screen.findByText('Delete this object?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete Object' }))
    await waitFor(() => expect(api.deleteObject).toHaveBeenCalledWith(PATH, { baseVersion: 'v1' }))
    expect(await screen.findByText('Deleted content')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Undo Delete' }))
    await waitFor(() => expect(api.restore).toHaveBeenCalledWith('trash-1'))
  })

  test('peek mode shows Open as page and the pager', async () => {
    const { onExpand } = await renderPage({ mode: 'peek' })
    fireEvent.click(screen.getByRole('button', { name: 'Open as page' }))
    expect(onExpand).toHaveBeenCalled()
    expect(screen.getByTestId('pager')).toBeInTheDocument()
    expect(screen.getByTestId('whiteboard-page').dataset.whiteboardPage).toBe('peek')
  })

  test('opening the page writes nothing', async () => {
    const { plugin, doc } = fakeInk([stroke('s1')])
    const { client } = await renderPage({ board: board([node({ id: 'a' })]), ink: plugin })
    await new Promise((r) => setTimeout(r, 450))
    expect(client.saveBoard).not.toHaveBeenCalled()
    expect(client.saveSettings).not.toHaveBeenCalled()
    expect(doc.save).not.toHaveBeenCalled()
    expect(api.renameObject).not.toHaveBeenCalled()
  })
})
