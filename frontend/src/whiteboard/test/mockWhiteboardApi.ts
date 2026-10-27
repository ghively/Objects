import { vi } from 'vitest'
import type { WhiteboardApi } from '@/api/whiteboardClient'
import type { BoardResponse, WhiteboardData } from '@/api/whiteboardTypes'
import { emptyBoard } from '../model'

/** A `vi.fn()` per `whiteboardApi` function, with harmless defaults (an empty board, no file yet). */
export function mockWhiteboardApi(board: WhiteboardData = emptyBoard(), revision = '') {
  const res: BoardResponse = { path: 'Whiteboards/Board.md', board, revision }
  return {
    board: vi.fn(async (path: string): Promise<BoardResponse> => ({ ...res, path, board: structuredClone(res.board) })),
    saveBoard: vi.fn(async (_path: string, _board: WhiteboardData, _base: string) => ({ revision: 'rev-saved' })),
    createWhiteboard: vi.fn(async (_title?: string) => ({ path: 'Whiteboards/Untitled.md', version: 'v1', typeIds: [] as string[] })),
    settings: vi.fn(async () => ({ settings: {}, revision: 'ui-1' })),
    saveSettings: vi.fn(async (settings: Parameters<WhiteboardApi['saveSettings']>[0], _base: string) => ({ settings, revision: 'ui-2' })),
  } satisfies WhiteboardApi
}

export type MockWhiteboardApi = ReturnType<typeof mockWhiteboardApi>
