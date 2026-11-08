import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { BoardResponse, WhiteboardData } from '@/api/whiteboardTypes'
import { objectSummary, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, RevisionConflictError } from '@/api/client'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { ADD_TO_BOARD_GAP, rightOfContent } from './actions'
import { ADD_TO_WHITEBOARD, AddToWhiteboardCancelled, AddToWhiteboardDialog, NEW_WHITEBOARD, useAddToWhiteboard } from './AddToWhiteboardDialog'
import { GRID, emptyBoard } from './model'
import { board, node, textBlock } from './test/boards'
import { addObjectToWhiteboard, boardFromBlocks, embeddedLink, placeObjectOnBoard, TURN_INTO_FAILED, turnBlocksIntoWhiteboard } from './turnInto'

const mocked = vi.mocked(api)

const WHITEBOARD = typeDef({ id: 'whiteboard', name: 'Whiteboard', basic: true })
const PAGE = typeDef({ id: 'page', name: 'Page', basic: true })

/** An in-memory whiteboard server: boards by path, with revisions. */
function fakeClient(initial: Record<string, WhiteboardData> = {}) {
  const boards = new Map<string, { board: WhiteboardData; revision: number }>()
  for (const [p, b] of Object.entries(initial)) boards.set(p, { board: structuredClone(b), revision: 1 })
  const client = {
    boards,
    createWhiteboard: vi.fn(async (title?: string) => {
      const path = `Whiteboards/${title ?? 'Untitled'}.md`
      boards.set(path, { board: emptyBoard(), revision: 1 })
      return { path, version: '1', typeIds: ['whiteboard'] }
    }),
    board: vi.fn(async (path: string): Promise<BoardResponse> => {
      const b = boards.get(path)
      if (!b) throw new Error('not found')
      return { path, board: structuredClone(b.board), revision: String(b.revision) }
    }),
    saveBoard: vi.fn(async (path: string, data: WhiteboardData, base: string) => {
      const b = boards.get(path)!
      if (String(b.revision) !== base) throw new RevisionConflictError('stale')
      b.board = structuredClone(data)
      b.revision += 1
      return { revision: String(b.revision) }
    }),
  }
  return client
}

beforeEach(() => {
  // jsdom lacks scrollIntoView, which cmdk calls on the selected item.
  Element.prototype.scrollIntoView ??= function () {}
  resetLinkIndex()
  useLinkIndex.setState({ types: [WHITEBOARD, PAGE], objects: [], loaded: true })
})

afterEach(() => {
  act(() => useAddToWhiteboard.setState({ objectPath: null, pending: null }))
  vi.restoreAllMocks()
})

describe('turn blocks into whiteboard', () => {
  test('test turn blocks into whiteboard creates a board', async () => {
    const client = fakeClient()
    const blocks = ['# Plan', 'First paragraph\nsecond line', '', '![[Project Alpha]]', '<!-- block: view=wideCard -->\n![[Notes]]']
    const path = await turnBlocksIntoWhiteboard(blocks, 'Plan board', client)
    expect(path).toBe('Whiteboards/Plan board.md')
    expect(client.createWhiteboard).toHaveBeenCalledWith('Plan board')
    const saved = client.boards.get(path)!.board
    const nodes = Object.values(saved.nodes).sort((a, b) => a.position.y - b.position.y)
    // The blank block is skipped; the rest are one column, top to bottom, in order.
    expect(nodes).toHaveLength(4)
    expect(nodes.every((n) => n.position.x === 0)).toBe(true)
    const kinds = nodes.map((n) => saved.blocks[n.blockId!])
    expect(kinds).toEqual([
      { type: 'text', markdown: '# Plan' },
      { type: 'text', markdown: 'First paragraph\nsecond line' },
      { type: 'entity', link: '[[Project Alpha]]' },
      { type: 'entity', link: '[[Notes]]' },
    ])
    // No overlaps: each node starts below the previous one with a gap.
    for (let i = 1; i < nodes.length; i++) expect(nodes[i].position.y).toBeGreaterThan(nodes[i - 1].position.y)
    expect(new Set(nodes.map((n) => n.id)).size).toBe(4)

    expect(embeddedLink('Text with ![[X]] inline')).toBeNull()
    expect(embeddedLink('![[A]]\n![[B]]')).toBeNull()
    expect(Object.keys(boardFromBlocks([]).nodes)).toHaveLength(0)
  })

  test("a failure reads 'The whiteboard wasn't created'", async () => {
    const client = fakeClient()
    client.createWhiteboard.mockRejectedValueOnce(new Error('disk full'))
    await expect(turnBlocksIntoWhiteboard(['x'], 'T', client)).rejects.toThrow(TURN_INTO_FAILED)
  })
})

describe('add to whiteboard', () => {
  const existing = board(
    [
      node({ id: 'a', blockId: 'ba', position: { x: 0, y: 60 }, width: 420, height: 60 }),
      node({ id: 'b', kind: 'shape', shape: 'rectangle', position: { x: 600, y: 120 }, width: 90, height: 90 }),
    ],
    [],
    { ba: textBlock('Alpha') },
    { 'x-keep': true },
  )

  test('test add to whiteboard places an entity node', async () => {
    const client = fakeClient({ 'Whiteboards/Map.md': existing, 'Whiteboards/Other.md': emptyBoard() })
    mocked.objects.mockResolvedValue([
      objectSummary({ path: 'Whiteboards/Map.md', type: 'whiteboard', title: 'Map' }),
      objectSummary({ path: 'Whiteboards/Other.md', type: 'whiteboard', title: 'Other' }),
      objectSummary({ path: 'Pages/Alpha.md', type: 'page', title: 'Alpha' }),
    ])
    render(<AddToWhiteboardDialog client={client} />)
    let outcome: Promise<string> | undefined
    act(() => {
      outcome = addObjectToWhiteboard('Pages/Alpha.md')
    })
    expect(await screen.findByText(ADD_TO_WHITEBOARD)).toBeTruthy()
    expect(screen.getByText(NEW_WHITEBOARD)).toBeTruthy()
    // Only whiteboards are listed.
    await screen.findByText('Map')
    expect(screen.getByText('Other')).toBeTruthy()
    expect(screen.queryByText('Alpha')).toBeNull()

    fireEvent.click(screen.getByText('Map'))
    await expect(outcome).resolves.toBe('Whiteboards/Map.md')
    await waitFor(() => expect(useAddToWhiteboard.getState().objectPath).toBeNull())

    const saved = client.boards.get('Whiteboards/Map.md')!.board
    const added = Object.values(saved.nodes).filter((n) => !existing.nodes[n.id])
    expect(added).toHaveLength(1)
    expect(saved.blocks[added[0].blockId!]).toEqual({ type: 'entity', link: '[[Alpha]]' })
    // Right of the existing content (which ends at x = 690), level with its top, on the grid.
    expect(added[0].position.x).toBeGreaterThanOrEqual(690 + ADD_TO_BOARD_GAP - GRID)
    expect(added[0].position.x % GRID).toBe(0)
    expect(added[0].position.y).toBe(60)
    // Everything that was there stays, unknown keys included.
    expect(saved.nodes.a).toEqual(existing.nodes.a)
    expect(saved['x-keep']).toBe(true)
  })

  test('new whiteboard, stale retry, empty board and cancel', async () => {
    // "New whiteboard" creates a board and adds the object at the origin.
    const client = fakeClient()
    mocked.objects.mockResolvedValue([])
    render(<AddToWhiteboardDialog client={client} />)
    let outcome: Promise<string> | undefined
    act(() => {
      outcome = addObjectToWhiteboard('Pages/Alpha.md')
    })
    fireEvent.click(await screen.findByText(NEW_WHITEBOARD))
    const path = await outcome!
    expect(client.createWhiteboard).toHaveBeenCalled()
    const nodes = Object.values(client.boards.get(path)!.board.nodes)
    expect(nodes).toHaveLength(1)
    expect(rightOfContent(emptyBoard())).toEqual({ x: 0, y: 0 })

    // A failed create shows "The whiteboard wasn't created".
    client.createWhiteboard.mockRejectedValueOnce(new Error('nope'))
    act(() => {
      outcome = addObjectToWhiteboard('Pages/Alpha.md')
    })
    const settled = outcome!.catch((e: unknown) => e)
    fireEvent.click(await screen.findByText(NEW_WHITEBOARD))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', TURN_INTO_FAILED)
    // Closing rejects the waiting caller.
    act(() => useAddToWhiteboard.getState().close())
    expect(await settled).toBeInstanceOf(AddToWhiteboardCancelled)

    // A stale revision is re-read and saved once more.
    const c2 = fakeClient({ 'Whiteboards/Map.md': existing })
    const realSave = c2.saveBoard.getMockImplementation()!
    c2.saveBoard.mockImplementationOnce(async () => {
      c2.boards.get('Whiteboards/Map.md')!.revision += 1
      throw new RevisionConflictError('stale')
    })
    c2.saveBoard.mockImplementation(realSave)
    await placeObjectOnBoard('Whiteboards/Map.md', 'Pages/Alpha.md', c2)
    expect(c2.board).toHaveBeenCalledTimes(2)
    expect(Object.keys(c2.boards.get('Whiteboards/Map.md')!.board.nodes)).toHaveLength(3)
  })
})
