import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api } from '@/api/client'
import type { ChangeEvent } from '@/api/types'
import { agent } from '@/test/mockApi'
import { resetAgents, useAgents } from './useAgents'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

const mocked = vi.mocked(api)

describe('useAgents', () => {
  let emit: (e: ChangeEvent) => void = () => undefined

  beforeEach(() => {
    resetAgents()
    mocked.onChange.mockImplementation((cb) => {
      emit = cb
      return () => undefined
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    resetAgents()
  })

  test('test loads the list and finds an agent by id', async () => {
    mocked.agents.mockResolvedValue([agent({ id: 'assistant' }), agent({ id: '01JC7ZK3T9Q4M2X8B5N6R1V0WE' })])
    expect(useAgents.getState().loaded).toBe(false)
    await useAgents.getState().load()
    expect(useAgents.getState().loaded).toBe(true)
    expect(useAgents.getState().agents.map((a) => a.id)).toEqual(['assistant', '01JC7ZK3T9Q4M2X8B5N6R1V0WE'])
    expect(useAgents.getState().byId('01JC7ZK3T9Q4M2X8B5N6R1V0WE')?.name).toBe('Researcher')
    expect(useAgents.getState().byId('nope')).toBeUndefined()
  })

  test('test reloads on an agents event', async () => {
    vi.useFakeTimers()
    mocked.agents.mockResolvedValueOnce([agent({ id: 'assistant' })])
    await useAgents.getState().load()
    expect(mocked.agents).toHaveBeenCalledTimes(1)
    mocked.agents.mockResolvedValueOnce([agent({ id: 'assistant' }), agent({ id: '01JC7ZK3T9Q4M2X8B5N6R1V0WE' })])
    emit({ kind: 'changed', path: 'Pages/A.md', version: 'v1' })
    await vi.advanceTimersByTimeAsync(500)
    expect(mocked.agents).toHaveBeenCalledTimes(1)
    emit({ kind: 'agents', path: '01JC7ZK3T9Q4M2X8B5N6R1V0WE', version: 'r1' })
    await vi.advanceTimersByTimeAsync(500)
    expect(mocked.agents).toHaveBeenCalledTimes(2)
    expect(useAgents.getState().agents).toHaveLength(2)
  })
})
