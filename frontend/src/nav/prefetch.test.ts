import { describe, expect, test, vi } from 'vitest'
import { prefetchOnIdle } from './prefetch'

describe('prefetchOnIdle', () => {
  test('test loaders run when the browser is idle, not before', () => {
    let idle: (() => void) | null = null
    const win = { requestIdleCallback: (cb: () => void) => ((idle = cb), 1), cancelIdleCallback: vi.fn() }
    const a = vi.fn(() => Promise.resolve())
    const b = vi.fn(() => Promise.reject(new Error('offline')))
    prefetchOnIdle([a, b], win as never)
    expect(a).not.toHaveBeenCalled()
    idle!()
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1) // a failing loader doesn't stop the others
  })

  test('test cancel before idle loads nothing', () => {
    let idle: (() => void) | null = null
    const cancelIdleCallback = vi.fn()
    const win = { requestIdleCallback: (cb: () => void) => ((idle = cb), 7), cancelIdleCallback }
    const a = vi.fn(() => Promise.resolve())
    const cancel = prefetchOnIdle([a], win as never)
    cancel()
    expect(cancelIdleCallback).toHaveBeenCalledWith(7)
    idle!()
    expect(a).not.toHaveBeenCalled()
  })

  test('test without requestIdleCallback a timer runs the loaders', () => {
    vi.useFakeTimers()
    const a = vi.fn(() => Promise.resolve())
    prefetchOnIdle([a], {} as never)
    vi.advanceTimersByTime(1_600)
    expect(a).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})
