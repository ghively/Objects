import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ConflictError } from '@/api/client'
import type { ViewState } from '@/api/types'
import { useViewState } from './useViewState'

const base = (): ViewState =>
  ({ filterGroup: null, sorts: [], groupBy: null, viewDefinition: { dataViewLayout: 'table' } }) as unknown as ViewState

const settle = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve()
}

describe('useViewState', () => {
  it('keeps a patch made while a conflicting save is in flight', async () => {
    vi.useFakeTimers()
    try {
      let failFirst: ((e: unknown) => void) | null = null
      const saved: ViewState[] = []
      let calls = 0
      const save = vi.fn((s: ViewState) => {
        calls++
        if (calls === 1)
          return new Promise<void>((_, reject) => {
            failFirst = reject
          })
        saved.push(s)
        return Promise.resolve()
      })
      const fresh = { ...base(), viewDefinition: { dataViewLayout: 'list' } } as ViewState
      const refetch = vi.fn(async () => fresh)
      const { result } = renderHook(() => useViewState(base(), save, refetch))

      // P1 goes out.
      act(() => result.current[1]({ sorts: [{ propertyId: 'a', option: 'ascending' }] } as Partial<ViewState>))
      await act(async () => {
        vi.advanceTimersByTime(400)
        await settle()
      })
      expect(calls).toBe(1)

      // P2 arrives while save 1 is in flight.
      act(() =>
        result.current[1]({ groupBy: { groups: [{ propertyId: 'g', option: 'default' }] } } as Partial<ViewState>),
      )
      expect(result.current[0].groupBy).not.toBeNull()

      // Save 1 answers 409: the state is rebuilt from the fresh copy plus every pending patch.
      await act(async () => {
        failFirst!(new ConflictError('v2'))
        await settle()
      })
      expect(result.current[0].viewDefinition.dataViewLayout).toBe('list')
      expect(result.current[0].sorts).toHaveLength(1)
      expect(result.current[0].groupBy).not.toBeNull()
      expect(saved[saved.length - 1]?.groupBy).not.toBeNull()

      // P2's own flush still saves, with both patches present.
      await act(async () => {
        vi.advanceTimersByTime(400)
        await settle()
      })
      const last = saved[saved.length - 1]
      expect(last.groupBy).not.toBeNull()
      expect(last.sorts).toHaveLength(1)
      expect(last.viewDefinition.dataViewLayout).toBe('list')
    } finally {
      vi.useRealTimers()
    }
  })
})
