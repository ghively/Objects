/** Test helper: a `BoardActions` of `vi.fn()`s whose `apply` runs over a board you hold. */
import { vi } from 'vitest'
import type { WhiteboardData } from '@/api/whiteboardTypes'
import type { BoardActions } from '../canvasTypes'

export function fakeActions(start: WhiteboardData) {
  const state = { board: start, labels: [] as string[] }
  const actions = {
    apply: vi.fn((label: string, fn: (b: WhiteboardData) => WhiteboardData) => {
      state.board = fn(state.board)
      state.labels.push(label)
    }),
    undo: vi.fn(),
    redo: vi.fn(),
    select: vi.fn(),
    setTool: vi.fn(),
    beginEdit: vi.fn(),
    endEdit: vi.fn(),
    remember: vi.fn(),
    createFromTool: vi.fn(() => null),
    createEntity: vi.fn(() => null),
    connect: vi.fn(() => null),
    updateNode: vi.fn(),
    updateEdge: vi.fn(),
    setBlock: vi.fn(),
    removeSelection: vi.fn(),
    duplicate: vi.fn(),
    nudge: vi.fn(),
    order: vi.fn(),
    place: vi.fn(),
    flip: vi.fn(),
    wrapInFrame: vi.fn(),
    clearBoard: vi.fn(),
    setLocked: vi.fn(),
    addEdgeLabel: vi.fn(),
    removeEdgeLabel: vi.fn(),
    addFrameTitle: vi.fn(),
    removeFrameTitle: vi.fn(),
    setStrokes: vi.fn(),
  } satisfies BoardActions
  return { actions, state }
}
