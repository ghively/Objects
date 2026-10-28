import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import type { SpaceInfo } from '@/api/types'
import { registerFlusher } from '@/lib/flush'
import { resetSpaceSwitch, samePath, SWITCH_TEXT, switchDeps, switchSpace, useSpaceSwitch } from './switchSpace'

const mocked = vi.mocked(api)
const info = (root: string): SpaceInfo => ({ name: 'x', root, types: [], icon: null, description: null, hideTaskManagement: false, revision: '' })

let unregister: Array<() => void> = []
let clock = 0
const reload = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  resetSpaceSwitch()
  clock = 0
  vi.spyOn(switchDeps, 'reload').mockImplementation(reload)
  vi.spyOn(switchDeps, 'now').mockImplementation(() => clock)
  vi.spyOn(switchDeps, 'sleep').mockImplementation(async (ms: number) => {
    clock += ms
  })
})

afterEach(() => {
  unregister.forEach((u) => u())
  unregister = []
  vi.restoreAllMocks()
})

describe('switchSpace', () => {
  test('test switch flushes editors, posts switch, waits for the new root and reloads', async () => {
    const order: string[] = []
    unregister.push(
      registerFlusher(async () => {
        order.push('flush')
      }),
    )
    mocked.switchSpace.mockImplementation(async (path: string) => {
      order.push('switch')
      return { path }
    })
    // The old server answers twice, then the restart drops one request, then the new space answers.
    let calls = 0
    mocked.space.mockImplementation(async () => {
      calls += 1
      if (calls <= 2) return info('/spaces/Old')
      if (calls === 3) throw new Error('connection refused')
      return info('/spaces/New/')
    })

    const states: string[] = []
    const unsub = useSpaceSwitch.subscribe((s) => states.push(s.phase))
    await expect(switchSpace('/spaces/New')).resolves.toBe(true)
    unsub()

    expect(order).toEqual(['flush', 'switch'])
    expect(mocked.switchSpace).toHaveBeenCalledWith('/spaces/New')
    expect(states).toContain('switching')
    expect(mocked.space).toHaveBeenCalledTimes(4)
    expect(switchDeps.sleep).toHaveBeenCalledWith(200)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  test('test switch stops when a flush fails', async () => {
    unregister.push(registerFlusher(async () => Promise.reject(new Error('Save failed: disk full'))))
    await expect(switchSpace('/spaces/New')).resolves.toBe(false)
    expect(mocked.switchSpace).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
    expect(useSpaceSwitch.getState()).toMatchObject({ phase: 'error', error: 'Save failed: disk full' })
  })

  test('test switch timeout message', async () => {
    mocked.space.mockResolvedValue(info('/spaces/Old'))
    await expect(switchSpace('/spaces/New')).resolves.toBe(false)
    expect(reload).not.toHaveBeenCalled()
    // 15 s of 200 ms polls.
    expect(mocked.space).toHaveBeenCalledTimes(75)
    expect(useSpaceSwitch.getState()).toMatchObject({ phase: 'error', error: SWITCH_TEXT.timeout })
    expect(SWITCH_TEXT.timeout).toBe("The space didn't open. Try again.")
    useSpaceSwitch.getState().dismiss()
    expect(useSpaceSwitch.getState().phase).toBe('idle')
  })

  test('test switch refused by the server shows its message and never polls', async () => {
    mocked.switchSpace.mockRejectedValue(new Error('Switching spaces needs the Object launcher.'))
    await expect(switchSpace('/spaces/New')).resolves.toBe(false)
    expect(mocked.space).not.toHaveBeenCalled()
    expect(useSpaceSwitch.getState().error).toBe('Switching spaces needs the Object launcher.')
  })

  test('test paths compare without trailing separators and with either separator', () => {
    expect(samePath('/a/b/', '/a/b')).toBe(true)
    expect(samePath('C:\\Spaces\\Work', 'c:/spaces/work/')).toBe(true)
    expect(samePath('/a/b', '/a/c')).toBe(false)
    expect(samePath('/', '/')).toBe(true)
  })
})
