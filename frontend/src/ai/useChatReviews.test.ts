// M18: a chat's background reviews, reloaded on `agentLearning` events.
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import type { ChangeEvent } from '@/api/types'
import { reviewStatus } from '@/test/mockApi'
import { useChatReviews } from './useChatReviews'

const mocked = vi.mocked(api)
const CHAT = '01JCHAT0000000000000000000'

describe('useChatReviews', () => {
  let listener: ((e: ChangeEvent) => void) | null = null
  beforeEach(() => {
    vi.clearAllMocks()
    mocked.chatReviews.mockReset()
    listener = null
    mocked.onChange.mockImplementation((cb) => {
      listener = cb
      return () => {
        listener = null
      }
    })
  })

  test('test loads on mount and on agentLearning events for the agent', async () => {
    mocked.chatReviews.mockResolvedValueOnce([])
    const { result } = renderHook(() => useChatReviews('assistant', CHAT))
    await waitFor(() => expect(mocked.chatReviews).toHaveBeenCalledWith('assistant', CHAT))
    expect(result.current).toEqual([])
    mocked.chatReviews.mockResolvedValue([reviewStatus({ id: 'r1', state: 'running' })])
    act(() => listener?.({ kind: 'agentLearning', path: 'other', version: null, origin: null }))
    expect(mocked.chatReviews).toHaveBeenCalledTimes(1)
    act(() => listener?.({ kind: 'agentLearning', path: 'assistant', version: 'r1', origin: null }))
    await waitFor(() => expect(result.current.map((r) => r.id)).toEqual(['r1']))
  })

  test('test no chat means no reviews and no call', () => {
    const { result } = renderHook(() => useChatReviews('assistant', null))
    expect(result.current).toEqual([])
    expect(mocked.chatReviews).not.toHaveBeenCalled()
  })

  test("test another chat's reviews don't show while the new one loads", async () => {
    mocked.chatReviews.mockResolvedValueOnce([reviewStatus({ id: 'r1' })])
    const { result, rerender } = renderHook(({ chat }) => useChatReviews('assistant', chat), { initialProps: { chat: CHAT } })
    await waitFor(() => expect(result.current).toHaveLength(1))
    mocked.chatReviews.mockReturnValueOnce(new Promise(() => {}))
    rerender({ chat: '01JCHAT0000000000000000009' })
    expect(result.current).toEqual([])
  })
})
