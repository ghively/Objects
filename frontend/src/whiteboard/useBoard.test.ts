import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api, ReadOnlyError, RevisionConflictError } from '@/api/client'
import type { ChangeEvent } from '@/api/types'
import { board, node, textBlock } from './test/boards'
import { mockWhiteboardApi } from './test/mockWhiteboardApi'
import { SAVE_DELAY_MS, useBoard } from './useBoard'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

const PATH = 'Whiteboards/Board.md'
let listeners: Set<(e: ChangeEvent) => void>

beforeEach(() => {
  listeners = new Set()
  vi.mocked(api).onChange.mockImplementation((cb) => {
    listeners.add(cb)
    return () => listeners.delete(cb)
  })
})

afterEach(() => {
  vi.useRealTimers()
})

function emit(e: Partial<ChangeEvent>) {
  for (const l of [...listeners]) l({ kind: 'changed', path: PATH, version: null, ...e } as ChangeEvent)
}

async function setup(client = mockWhiteboardApi(board([node({ id: 'a', position: { x: 0, y: 0 } })]), 'rev-1')) {
  const hook = renderHook(() => useBoard(PATH, client))
  await waitFor(() => expect(hook.result.current.status).toBe('ready'))
  return { client, hook, store: hook.result.current.store }
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe('useBoard', () => {
  test('open, pan, zoom and select save nothing', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { client, store, hook } = await setup()
    expect(client.board).toHaveBeenCalledWith(PATH)
    act(() => {
      store.getState().actions.select(['a'])
      store.getState().actions.setTool('hand')
    })
    await advance(SAVE_DELAY_MS * 3)
    hook.unmount()
    await advance(10)
    expect(client.saveBoard).not.toHaveBeenCalled()
  })

  test('edit saves once after 400 ms with the loaded revision; no save during a drag', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { client, store } = await setup()
    act(() => store.getState().actions.nudge(30, 0, ['a']))
    act(() => store.getState().actions.nudge(30, 0, ['a']))
    await advance(SAVE_DELAY_MS - 50)
    expect(client.saveBoard).not.toHaveBeenCalled()
    await advance(60)
    expect(client.saveBoard).toHaveBeenCalledTimes(1)
    const [path, saved, base] = client.saveBoard.mock.calls[0]
    expect(path).toBe(PATH)
    expect(base).toBe('rev-1')
    expect(saved.nodes.a.position).toEqual({ x: 60, y: 0 })

    // A drag: nothing is saved until it ends, then once with the new revision.
    act(() => {
      store.getState().canvas.beginDrag(['a'])
      store.getState().canvas.applyFlowChanges([{ type: 'position', id: 'a', position: { x: 90, y: 0 }, dragging: true }])
    })
    await advance(SAVE_DELAY_MS * 3)
    expect(client.saveBoard).toHaveBeenCalledTimes(1)
    act(() => store.getState().canvas.endDrag())
    await advance(SAVE_DELAY_MS + 10)
    expect(client.saveBoard).toHaveBeenCalledTimes(2)
    expect(client.saveBoard.mock.calls[1][2]).toBe('rev-saved')
    expect(client.saveBoard.mock.calls[1][1].nodes.a.position).toEqual({ x: 90, y: 0 })
  })

  test('409 merges local changes onto the server copy and saves once', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const client = mockWhiteboardApi(board([node({ id: 'a', position: { x: 0, y: 0 } })]), 'rev-1')
    const { store } = await setup(client)
    // Someone else added node b meanwhile.
    const remote = board([node({ id: 'a', position: { x: 0, y: 0 } }), node({ id: 'b', position: { x: 600, y: 0 } })])
    client.board.mockResolvedValue({ path: PATH, board: remote, revision: 'rev-2' })
    client.saveBoard.mockRejectedValueOnce(new RevisionConflictError('rev-2'))
    act(() => store.getState().actions.nudge(30, 0, ['a']))
    await advance(SAVE_DELAY_MS + 10)
    await waitFor(() => expect(client.saveBoard).toHaveBeenCalledTimes(2))
    const [, merged, base] = client.saveBoard.mock.calls[1]
    expect(base).toBe('rev-2')
    expect(merged.nodes.a.position).toEqual({ x: 30, y: 0 })
    expect(merged.nodes.b).toBeDefined()
    expect(store.getState().doc.board.nodes.b).toBeDefined()
    await advance(SAVE_DELAY_MS * 2)
    expect(client.saveBoard).toHaveBeenCalledTimes(2)
  })

  test('undo after a 409 merge never drops the merged remote change', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const client = mockWhiteboardApi(board([node({ id: 'a', position: { x: 0, y: 0 } })]), 'rev-1')
    const { store } = await setup(client)
    const remote = board([node({ id: 'a', position: { x: 0, y: 0 } }), node({ id: 'b', position: { x: 600, y: 0 } })])
    client.board.mockResolvedValue({ path: PATH, board: remote, revision: 'rev-2' })
    client.saveBoard.mockRejectedValueOnce(new RevisionConflictError('rev-2'))
    act(() => store.getState().actions.nudge(30, 0, ['a']))
    await advance(SAVE_DELAY_MS + 10)
    await waitFor(() => expect(client.saveBoard).toHaveBeenCalledTimes(2))
    // The merge restarts the history: nothing older (without b) can be undone to.
    expect(store.getState().canUndo).toBe(false)
    act(() => store.getState().actions.nudge(10, 0, ['a']))
    await advance(SAVE_DELAY_MS + 10)
    await waitFor(() => expect(client.saveBoard).toHaveBeenCalledTimes(3))
    act(() => store.getState().actions.undo())
    expect(store.getState().canUndo).toBe(false)
    await advance(SAVE_DELAY_MS + 10)
    await waitFor(() => expect(client.saveBoard).toHaveBeenCalledTimes(4))
    const saved = client.saveBoard.mock.calls[3][1]
    expect(saved.nodes.b).toBeDefined()
    expect(saved.nodes.a.position).toEqual({ x: 30, y: 0 })
  })

  test('a refused save (422) shows a toast', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const client = mockWhiteboardApi(board([node({ id: 'a' })]), 'rev-1')
    const { store, hook } = await setup(client)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    client.saveBoard.mockRejectedValueOnce(new Error("Block b has a link that isn't a [[wikilink]]."))
    act(() => store.getState().actions.nudge(30, 0, ['a']))
    await advance(SAVE_DELAY_MS + 10)
    await waitFor(() =>
      expect(hook.result.current.toast).toBe("Could not save the whiteboard. Block b has a link that isn't a [[wikilink]]."),
    )
    warn.mockRestore()
  })

  test('second 409 reloads with the toast', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const client = mockWhiteboardApi(board([node({ id: 'a' })]), 'rev-1')
    const { store, hook } = await setup(client)
    const remote = board([node({ id: 'z' })])
    client.board.mockResolvedValue({ path: PATH, board: remote, revision: 'rev-3' })
    client.saveBoard.mockRejectedValue(new RevisionConflictError('rev-3'))
    act(() => store.getState().actions.nudge(30, 0, ['a']))
    await advance(SAVE_DELAY_MS + 10)
    await waitFor(() => expect(hook.result.current.toast).toBe('Changed elsewhere. Reloaded.'))
    expect(client.saveBoard).toHaveBeenCalledTimes(2)
    expect(Object.keys(store.getState().doc.board.nodes)).toEqual(['z'])
    expect(store.getState().canUndo).toBe(false)
  })

  test('read-only board disables editing and shows the reason', async () => {
    const client = mockWhiteboardApi(board([node({ id: 'a' })]), 'rev-1')
    client.board.mockResolvedValue({ path: PATH, board: board(), revision: 'rev-1', readOnlyReason: 'This file is broken.' })
    const { store } = await setup(client)
    expect(store.getState().readOnlyReason).toBe('This file is broken.')
    act(() => store.getState().actions.createFromTool('text', { x: 0, y: 0 }))
    expect(store.getState().boardSeq).toBe(0)
  })

  test('a 423 on save switches to read-only', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const client = mockWhiteboardApi(board([node({ id: 'a' })]), 'rev-1')
    client.saveBoard.mockRejectedValue(new ReadOnlyError('Unreadable now.'))
    const { store } = await setup(client)
    act(() => store.getState().actions.nudge(30, 0, ['a']))
    await advance(SAVE_DELAY_MS + 10)
    await waitFor(() => expect(store.getState().readOnlyReason).toBe('Unreadable now.'))
  })

  test('external whiteboard event reloads and clears history when nothing is pending', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const client = mockWhiteboardApi(board([node({ id: 'a' })]), 'rev-1')
    const { store } = await setup(client)
    act(() => store.getState().actions.nudge(30, 0, ['a']))
    await advance(SAVE_DELAY_MS + 10)
    await waitFor(() => expect(client.saveBoard).toHaveBeenCalledTimes(1))
    expect(store.getState().canUndo).toBe(true)

    const remote = board([node({ id: 'a' }), node({ id: 'n2', blockId: 'b' })], [], { b: textBlock('from disk') })
    client.board.mockResolvedValue({ path: PATH, board: remote, revision: 'rev-ext' })
    await act(async () => emit({ kind: 'whiteboard' as ChangeEvent['kind'], version: 'rev-ext' }))
    await waitFor(() => expect(store.getState().doc.board.nodes.n2).toBeDefined())
    expect(store.getState().canUndo).toBe(false)

    // Pending local edits: the event is left for the next save's 409 to merge.
    act(() => store.getState().actions.nudge(30, 0, ['a']))
    client.board.mockClear()
    await act(async () => emit({ kind: 'whiteboard' as ChangeEvent['kind'], version: 'rev-ext-2' }))
    expect(client.board).not.toHaveBeenCalled()
    // Another board's event is ignored.
    await act(async () => emit({ kind: 'whiteboard' as ChangeEvent['kind'], path: 'Whiteboards/Other.md', version: 'x' }))
    expect(client.board).not.toHaveBeenCalled()
  })

  test('undo after save saves the earlier state', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { client, store } = await setup()
    act(() => store.getState().actions.nudge(30, 0, ['a']))
    await advance(SAVE_DELAY_MS + 10)
    await waitFor(() => expect(client.saveBoard).toHaveBeenCalledTimes(1))
    act(() => store.getState().actions.undo())
    await advance(SAVE_DELAY_MS + 10)
    await waitFor(() => expect(client.saveBoard).toHaveBeenCalledTimes(2))
    expect(client.saveBoard.mock.calls[1][1].nodes.a.position).toEqual({ x: 0, y: 0 })
    expect(client.saveBoard.mock.calls[1][2]).toBe('rev-saved')
  })

  test('flush saves pending changes now; unmount flushes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { client, store, hook } = await setup()
    act(() => store.getState().actions.nudge(30, 0, ['a']))
    await act(async () => hook.result.current.flush())
    expect(client.saveBoard).toHaveBeenCalledTimes(1)
    act(() => store.getState().actions.nudge(30, 0, ['a']))
    hook.unmount()
    await advance(10)
    expect(client.saveBoard).toHaveBeenCalledTimes(2)
  })
})
