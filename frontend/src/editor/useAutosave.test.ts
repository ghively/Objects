import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { useAutosave } from './useAutosave'

type Call = [path: string, body: string, version: string]

/** `saveBody` that records each call and resolves only when released. */
function deferredSaves() {
  const calls: Call[] = []
  const releases: (() => void)[] = []
  vi.mocked(api.saveBody).mockImplementation((path: string, body: string, version: string) => {
    calls.push([path, body, version])
    const n = calls.length
    return new Promise((res) => releases.push(() => res({ version: 'v' + n } as never)))
  })
  return { calls, release: (i: number) => releases[i]() }
}

const settleMicrotasks = () => act(async () => new Promise((r) => setTimeout(r, 10)))

beforeEach(() => {
  vi.mocked(api.saveBody).mockReset()
})

describe('edits made while a save is in flight', () => {
  test('are saved to the old object after switching to another one', async () => {
    const saves = deferredSaves()
    let body: string | null = 'A1'
    const { result, rerender } = renderHook(
      (p: { path: string }) =>
        useAutosave({ path: p.path, version: 'v0', readOnly: false, getBody: () => body, onSaved: () => {} }),
      { initialProps: { path: 'a.md' } },
    )
    act(() => result.current.markLoaded('A0', 'v0'))
    let first!: Promise<void>
    await act(async () => {
      first = result.current.flush()
    })
    body = 'A2' // more typing while A1 is being saved
    await act(async () => {
      void result.current.flush('a.md') // the editor's cleanup when leaving a.md
    })
    rerender({ path: 'b.md' })
    body = 'B0'
    act(() => result.current.markLoaded('B0', 'w0'))
    await act(async () => {
      saves.release(0)
    })
    await settleMicrotasks()
    expect(saves.calls).toEqual([
      ['a.md', 'A1', 'v0'],
      ['a.md', 'A2', 'v1'],
    ])
    await act(async () => {
      saves.release(1)
      await first
    })
  })

  test('are saved after the editor unmounts', async () => {
    const saves = deferredSaves()
    let body: string | null = 'A1'
    const { result, unmount } = renderHook(() =>
      useAutosave({ path: 'a.md', version: 'v0', readOnly: false, getBody: () => body, onSaved: () => {} }),
    )
    act(() => result.current.markLoaded('A0', 'v0'))
    let first!: Promise<void>
    await act(async () => {
      first = result.current.flush()
    })
    body = 'A2'
    await act(async () => {
      void result.current.flush('a.md')
    })
    unmount()
    body = null // the editor is destroyed
    await act(async () => {
      saves.release(0)
    })
    await settleMicrotasks()
    expect(saves.calls).toEqual([
      ['a.md', 'A1', 'v0'],
      ['a.md', 'A2', 'v1'],
    ])
    await act(async () => {
      saves.release(1)
      await first
    })
  })

  test('on the same object are saved once the first save ends', async () => {
    const saves = deferredSaves()
    let body: string | null = 'A1'
    const { result } = renderHook(() =>
      useAutosave({ path: 'a.md', version: 'v0', readOnly: false, getBody: () => body, onSaved: () => {} }),
    )
    act(() => result.current.markLoaded('A0', 'v0'))
    let first!: Promise<void>
    await act(async () => {
      first = result.current.flush()
    })
    body = 'A2'
    await act(async () => {
      void result.current.flush()
    })
    body = 'A3' // typed after the queued flush: the latest text is what gets saved
    await act(async () => {
      saves.release(0)
    })
    await settleMicrotasks()
    expect(saves.calls).toEqual([
      ['a.md', 'A1', 'v0'],
      ['a.md', 'A3', 'v1'],
    ])
    await act(async () => {
      saves.release(1)
      await first
    })
  })
})

describe('a save that fails after the editor left', () => {
  test('keeps the text queued while it was in flight, not the older in-flight text', async () => {
    const { keptUnsaved, resetUnsaved } = await import('./unsaved')
    resetUnsaved()
    let reject!: (e: unknown) => void
    vi.mocked(api.saveBody).mockImplementation(() => new Promise((_res, rej) => (reject = rej)))
    let body: string | null = 'A1'
    const { result, rerender } = renderHook(
      (p: { path: string }) =>
        useAutosave({ path: p.path, version: 'v0', readOnly: false, getBody: () => body, onSaved: () => {} }),
      { initialProps: { path: 'a.md' } },
    )
    act(() => result.current.markLoaded('A0', 'v0'))
    let first!: Promise<void>
    await act(async () => {
      first = result.current.flush()
    })
    body = 'A2'
    await act(async () => {
      void result.current.leave('a.md')
    })
    rerender({ path: 'b.md' })
    body = 'B0'
    await act(async () => {
      reject(new Error('server gone'))
      await first
    })
    expect(keptUnsaved('a.md')).toBe('A2')
    resetUnsaved()
  })
})

describe('saveState (M32 contract)', () => {
  test('test saveState goes saved, unsaved, saving, saved', async () => {
    const saves = deferredSaves()
    let body: string | null = 'A0'
    const { result } = renderHook(() =>
      useAutosave({ path: 'a.md', version: 'v0', readOnly: false, getBody: () => body, onSaved: () => {} }),
    )
    act(() => result.current.markLoaded('A0', 'v0'))
    expect(result.current.saveState).toBe('saved')

    body = 'A1'
    act(() => result.current.schedule())
    expect(result.current.saveState).toBe('unsaved')

    let first!: Promise<void>
    await act(async () => {
      first = result.current.flush()
    })
    expect(result.current.saveState).toBe('saving')

    await act(async () => {
      saves.release(0)
      await first
    })
    expect(result.current.saveState).toBe('saved')
    expect(result.current.saveError).toBeNull()
  })

  test('test saveState stays unsaved when more was typed while the save ran', async () => {
    const saves = deferredSaves()
    let body: string | null = 'A1'
    const { result } = renderHook(() =>
      useAutosave({ path: 'a.md', version: 'v0', readOnly: false, getBody: () => body, onSaved: () => {} }),
    )
    act(() => result.current.markLoaded('A0', 'v0'))
    let first!: Promise<void>
    await act(async () => {
      first = result.current.flush()
    })
    body = 'A2'
    act(() => result.current.schedule()) // a key during the save: the 1 s wait starts again
    expect(result.current.saveState).toBe('saving')
    await act(async () => {
      saves.release(0)
      await first
    })
    expect(result.current.saveState).toBe('unsaved')
    act(() => result.current.cancel())
  })

  test('test saveState is error while a save has failed, and saved after a load', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(api.saveBody).mockRejectedValue(new Error('server gone'))
    const body: string | null = 'A1'
    const { result } = renderHook(() =>
      useAutosave({ path: 'a.md', version: 'v0', readOnly: false, getBody: () => body, onSaved: () => {} }),
    )
    act(() => result.current.markLoaded('A0', 'v0'))
    await act(async () => {
      await result.current.flush()
    })
    expect(result.current.saveError).not.toBeNull()
    expect(result.current.saveState).toBe('error')
    // A reload from disk: the retry is dropped and what shows is what is saved.
    act(() => result.current.markLoaded('A1', 'v1'))
    expect(result.current.saveState).toBe('saved')
    quiet.mockRestore()
  })
})

