import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, ConflictError } from '@/api/client'
import { resetPinned, useUiStore } from '@/shell/usePinned'
import { resetGraphUi, SAVE_DELAY_MS, useGraphUi } from './useGraphUi'

const mocked = vi.mocked(api)

beforeEach(() => {
  vi.useFakeTimers()
  resetPinned()
  resetGraphUi()
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockClear()
  useUiStore.setState({
    ui: { pinned: [], sections: [], allNotesLayout: 'list', graph: { hideDates: true } },
    revision: 'r0',
    loaded: true,
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useGraphUi', () => {
  test('graph ui patch debounced and 409 refetches once', async () => {
    const { result } = renderHook(() => useGraphUi())
    expect(result.current.custom).toEqual({ hideDates: true })

    act(() => {
      result.current.patch({ showCompletedTasks: true })
      result.current.patch({ excludeStructureIds: ['person'] })
    })
    // Optimistic at once, saved once after the pause, as the whole merged value.
    expect(result.current.custom).toEqual({ hideDates: true, showCompletedTasks: true, excludeStructureIds: ['person'] })
    expect(mocked.patchUi).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)
    })
    expect(mocked.patchUi).toHaveBeenCalledTimes(1)
    expect(mocked.patchUi).toHaveBeenCalledWith(
      { graph: { hideDates: true, showCompletedTasks: true, excludeStructureIds: ['person'] } },
      { baseRevision: 'r0' },
    )
    expect(useUiStore.getState().revision).toBe('r1')

    // A stale revision: fetch once, re-apply the pending edit onto the fresh graph, save again.
    mocked.patchUi.mockClear()
    mocked.patchUi.mockRejectedValueOnce(new ConflictError('r9'))
    mocked.ui.mockResolvedValueOnce({
      ui: { pinned: [], sections: [], allNotesLayout: 'list', graph: { hideLargeNodes: true } },
      revision: 'r9',
    })
    act(() => result.current.patch({ hideIndirectLinks: true }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)
    })
    expect(mocked.ui).toHaveBeenCalledTimes(1)
    expect(mocked.patchUi).toHaveBeenCalledTimes(2)
    expect(mocked.patchUi).toHaveBeenLastCalledWith({ graph: { hideLargeNodes: true, hideIndirectLinks: true } }, { baseRevision: 'r9' })
    expect(result.current.custom).toEqual({ hideLargeNodes: true, hideIndirectLinks: true })
  })
})
