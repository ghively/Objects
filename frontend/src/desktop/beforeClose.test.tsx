import { act, render, renderHook } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { clearSaveState, clearTitleSaveState, setSaveState, setTitleSaveState } from '@/editor/saveStateStore'
import { useAutosave } from '@/editor/useAutosave'
import { usePeek, useTabs } from '@/nav/tabs'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import {
  BEFORE_CLOSE_LIMIT_MS,
  registerBeforeClose,
  reportSaveState,
  resetBeforeClose,
  saveEverything,
  savesPending,
  SETTLE_QUIET_MS,
} from './beforeClose'
import { DesktopChrome } from './DesktopChrome'
import { notePaths } from './SaveWatch'
import { fakeDesktop } from './testBridge'
import { resetChrome } from './useWindowChrome'
import { trackWrites, untrackWrites, writesInFlight } from './writesInFlight'

/** A request the test answers when it chooses. */
function deferredFetch() {
  const calls: { url: string; method: string; resolve(): void; reject(): void }[] = []
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    return new Promise<Response>((resolve, reject) => {
      calls.push({
        url: String(input),
        method: init?.method ?? 'GET',
        resolve: () => resolve(new Response('{}')),
        reject: () => reject(new TypeError('Failed to fetch')),
      })
    })
  })
  return { calls, fetchMock }
}

/** Whether `p` has settled, without waiting for it. */
function settled(p: Promise<void>): () => boolean {
  let done = false
  void p.then(() => (done = true))
  return () => done
}

const realFetch = globalThis.fetch

beforeEach(() => {
  vi.useFakeTimers()
  resetBeforeClose()
  resetChrome()
  useSettings.setState({ settings: settingsDefaults, revision: 'r0', loaded: true })
  useTabs.setState({ tabs: [], activeId: null })
  usePeek.setState({ path: null, list: [], index: 0 })
})

afterEach(() => {
  untrackWrites()
  globalThis.fetch = realFetch
  delete window.objectDesktop
  vi.useRealTimers()
  for (const p of ['Notes/A.md', 'Notes/B.md']) {
    clearSaveState(p)
    clearTitleSaveState(p)
  }
})

describe('saveEverything', () => {
  test('test it tells every editor the window is going, as a closing browser window does', async () => {
    const onPageHide = vi.fn()
    window.addEventListener('pagehide', onPageHide)
    const p = saveEverything()
    expect(onPageHide).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(0)
    await p
    window.removeEventListener('pagehide', onPageHide)
  })

  test('test a field still being typed in saves as it does when focus leaves it, and that save is waited for', async () => {
    // The system's own close button (and Alt+F4) takes no focus: a property field that saves on
    // blur would keep what was typed to itself.
    const { calls, fetchMock } = deferredFetch()
    globalThis.fetch = fetchMock as unknown as typeof fetch
    trackWrites()
    const field = document.createElement('textarea')
    field.addEventListener('blur', () => void fetch('/api/object/properties', { method: 'PATCH', body: '{}' }))
    document.body.appendChild(field)
    field.focus()
    expect(document.activeElement).toBe(field)
    const order: string[] = []
    const onPageHide = () => order.push(`pagehide ${calls.length}`)
    window.addEventListener('pagehide', onPageHide)
    const done = settled(saveEverything())
    window.removeEventListener('pagehide', onPageHide)
    // The field gave up focus first, so its save was on its way when the editors were told.
    expect(document.activeElement).not.toBe(field)
    expect(order).toEqual(['pagehide 1'])
    expect(calls.map((c) => c.method)).toEqual(['PATCH'])
    await vi.advanceTimersByTimeAsync(1000)
    expect(done()).toBe(false)
    await act(async () => calls[0].resolve())
    await vi.advanceTimersByTimeAsync(SETTLE_QUIET_MS + 50)
    expect(done()).toBe(true)
    field.remove()
  })

  test('test a field that cannot give up focus does not keep the window open', async () => {
    const field = document.createElement('input')
    field.blur = () => {
      throw new Error('boom')
    }
    document.body.appendChild(field)
    field.focus()
    const onPageHide = vi.fn()
    window.addEventListener('pagehide', onPageHide)
    const done = settled(saveEverything())
    window.removeEventListener('pagehide', onPageHide)
    expect(onPageHide).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(done()).toBe(true)
    field.remove()
  })

  test('test nothing pending: it resolves at once', async () => {
    const done = settled(saveEverything())
    await vi.advanceTimersByTimeAsync(0)
    expect(done()).toBe(true)
  })

  test('test a note still saving: it waits for the save, then resolves', async () => {
    reportSaveState('Notes/A.md', 'saving')
    const done = settled(saveEverything())
    await vi.advanceTimersByTimeAsync(1000)
    expect(done()).toBe(false)
    reportSaveState('Notes/A.md', 'saved')
    await vi.advanceTimersByTimeAsync(SETTLE_QUIET_MS + 50)
    expect(done()).toBe(true)
  })

  test('test text typed and not sent yet (unsaved) is waited for too, and a title', async () => {
    reportSaveState('Notes/A.md', 'unsaved')
    const done = settled(saveEverything())
    await vi.advanceTimersByTimeAsync(300)
    expect(done()).toBe(false)
    // The text is on its way, then lands; the title's rename follows it.
    reportSaveState('Notes/A.md', 'saving')
    await vi.advanceTimersByTimeAsync(300)
    expect(done()).toBe(false)
    reportSaveState('Notes/A.md', 'saved')
    await vi.advanceTimersByTimeAsync(SETTLE_QUIET_MS + 50)
    expect(done()).toBe(true)
  })

  test('test a save the closing starts is waited for: the request in flight', async () => {
    const { calls, fetchMock } = deferredFetch()
    globalThis.fetch = fetchMock as unknown as typeof fetch
    trackWrites()
    // What an editor does on `pagehide`: send what is unsaved.
    const flush = () => void fetch('/api/object/body', { method: 'PUT', body: '{}' })
    window.addEventListener('pagehide', flush)
    const done = settled(saveEverything())
    window.removeEventListener('pagehide', flush)
    expect(calls).toHaveLength(1)
    expect(writesInFlight()).toBe(1)
    await vi.advanceTimersByTimeAsync(1500)
    expect(done()).toBe(false)
    await act(async () => calls[0].resolve())
    expect(writesInFlight()).toBe(0)
    await vi.advanceTimersByTimeAsync(SETTLE_QUIET_MS + 50)
    expect(done()).toBe(true)
  })

  test('test a save queued behind the one in flight is waited for too', async () => {
    const { calls, fetchMock } = deferredFetch()
    globalThis.fetch = fetchMock as unknown as typeof fetch
    trackWrites()
    void fetch('/api/object/body', { method: 'PUT' })
    const done = settled(saveEverything())
    await vi.advanceTimersByTimeAsync(200)
    // The first lands; the editor sends the newer text right after (and the title's rename after that).
    await act(async () => calls[0].resolve())
    void fetch('/api/object/rename', { method: 'POST' })
    await vi.advanceTimersByTimeAsync(SETTLE_QUIET_MS + 50)
    expect(done()).toBe(false)
    await act(async () => calls[1].resolve())
    await vi.advanceTimersByTimeAsync(SETTLE_QUIET_MS + 50)
    expect(done()).toBe(true)
  })

  test('test a stuck save: it resolves at the limit, 2.5 seconds, never later', async () => {
    expect(BEFORE_CLOSE_LIMIT_MS).toBe(2500)
    reportSaveState('Notes/A.md', 'saving')
    const done = settled(saveEverything())
    await vi.advanceTimersByTimeAsync(BEFORE_CLOSE_LIMIT_MS - 100)
    expect(done()).toBe(false)
    await vi.advanceTimersByTimeAsync(100)
    expect(done()).toBe(true)
  })

  test('test a stuck request resolves at the limit too', async () => {
    const { fetchMock } = deferredFetch()
    globalThis.fetch = fetchMock as unknown as typeof fetch
    trackWrites()
    void fetch('/api/whiteboard', { method: 'PUT' })
    const done = settled(saveEverything())
    await vi.advanceTimersByTimeAsync(BEFORE_CLOSE_LIMIT_MS - 100)
    expect(done()).toBe(false)
    await vi.advanceTimersByTimeAsync(100)
    expect(done()).toBe(true)
  })

  test('test a failed save resolves: the state error, a request refused', async () => {
    reportSaveState('Notes/A.md', 'saving')
    let done = settled(saveEverything())
    await vi.advanceTimersByTimeAsync(100)
    reportSaveState('Notes/A.md', 'error')
    await vi.advanceTimersByTimeAsync(SETTLE_QUIET_MS + 50)
    expect(done()).toBe(true)
    // An error from the start is nothing to wait for.
    done = settled(saveEverything())
    await vi.advanceTimersByTimeAsync(0)
    expect(done()).toBe(true)
    reportSaveState('Notes/A.md', null)

    const { calls, fetchMock } = deferredFetch()
    globalThis.fetch = fetchMock as unknown as typeof fetch
    trackWrites()
    void fetch('/api/object/body', { method: 'PUT' }).catch(() => undefined)
    done = settled(saveEverything())
    await vi.advanceTimersByTimeAsync(100)
    expect(done()).toBe(false)
    await act(async () => calls[0].reject())
    await vi.advanceTimersByTimeAsync(SETTLE_QUIET_MS + 50)
    expect(done()).toBe(true)
  })
})

describe('writesInFlight', () => {
  test('test only writes are counted, and the page gets the very same promise', async () => {
    const { calls, fetchMock } = deferredFetch()
    globalThis.fetch = fetchMock as unknown as typeof fetch
    trackWrites()
    trackWrites() // once is once
    void fetch('/api/objects')
    void fetch('/api/space', { method: 'GET' })
    expect(writesInFlight()).toBe(0)
    const put = fetch('/api/object/body', { method: 'put' })
    void fetch(new Request('http://127.0.0.1/api/object/rename', { method: 'POST' }))
    void fetch('/api/object', { method: 'DELETE' })
    expect(writesInFlight()).toBe(3)
    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(put).toBe(fetchMock.mock.results[2].value)
    await act(async () => calls[2].resolve())
    expect(writesInFlight()).toBe(2)
    expect((await put).ok).toBe(true)
    untrackWrites()
    expect(globalThis.fetch).toBe(fetchMock)
  })
})

describe('registerBeforeClose', () => {
  test('test in a browser nothing is registered and fetch is left alone', () => {
    const before = globalThis.fetch
    const off = registerBeforeClose()
    expect(globalThis.fetch).toBe(before)
    off()
  })

  test('test in the shell the handler is registered once and saves before it answers', async () => {
    const { fetchMock } = deferredFetch()
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const fake = fakeDesktop({ platform: 'linux' })
    window.objectDesktop = fake.bridge
    registerBeforeClose()
    registerBeforeClose()
    expect(fake.bridge.onBeforeClose).toHaveBeenCalledTimes(1)
    expect(fake.hasBeforeClose()).toBe(true)
    expect(globalThis.fetch).not.toBe(fetchMock)

    reportSaveState('Notes/A.md', 'saving')
    const done = settled(fake.beforeClose())
    await vi.advanceTimersByTimeAsync(500)
    expect(done()).toBe(false)
    reportSaveState('Notes/A.md', 'saved')
    await vi.advanceTimersByTimeAsync(SETTLE_QUIET_MS + 50)
    expect(done()).toBe(true)
  })

  test('test the handler never rejects: the window must close', async () => {
    const fake = fakeDesktop({ platform: 'linux' })
    window.objectDesktop = fake.bridge
    registerBeforeClose()
    const dispatch = vi.spyOn(window, 'dispatchEvent').mockImplementationOnce(() => {
      throw new Error('a listener broke')
    })
    const p = fake.beforeClose()
    dispatch.mockRestore()
    await vi.advanceTimersByTimeAsync(0)
    await expect(p).resolves.toBeUndefined()
  })
})

describe('SaveWatch (the save states of the open notes)', () => {
  const tab = (id: string, path: string, sidepanel?: string) => ({
    id,
    history: [{ kind: 'object' as const, path }],
    index: 0,
    crumbs: [[]],
    ...(sidepanel
      ? { sidepanel: [{ id: `${id}-s`, target: { kind: 'object' as const, path: sidepanel }, isOpen: true, panelArea: 'area1' as const }] }
      : {}),
  })

  test('test notePaths: every tab, its side panel entries, and the peek', () => {
    const tabs = [tab('t1', 'Notes/A.md', 'Notes/C.md'), tab('t2', 'Notes/B.md'), { id: 't3', history: [{ kind: 'tasks' as const }], index: 0, crumbs: [[]] }]
    expect(notePaths(tabs, 'Notes/D.md')).toEqual(['Notes/A.md', 'Notes/B.md', 'Notes/C.md', 'Notes/D.md'])
    expect(notePaths(tabs, 'Notes/A.md')).toEqual(['Notes/A.md', 'Notes/B.md', 'Notes/C.md'])
    expect(notePaths([], null)).toEqual([])
  })

  test('test the handler waits for what the editor and the title publish for an open note', async () => {
    const fake = fakeDesktop({ platform: 'linux' })
    window.objectDesktop = fake.bridge
    registerBeforeClose()
    useTabs.setState({ tabs: [tab('t1', 'Notes/A.md')], activeId: 't1' })
    render(<DesktopChrome />)
    expect(savesPending()).toBe(false)

    act(() => setSaveState('Notes/A.md', 'saving'))
    expect(savesPending()).toBe(true)
    const done = settled(fake.beforeClose())
    await vi.advanceTimersByTimeAsync(400)
    expect(done()).toBe(false)
    // The text landed; the title typed with it is still being renamed.
    act(() => {
      setTitleSaveState('Notes/A.md', 'saving')
      setSaveState('Notes/A.md', 'saved')
    })
    await vi.advanceTimersByTimeAsync(400)
    expect(done()).toBe(false)
    act(() => setTitleSaveState('Notes/A.md', 'saved'))
    expect(savesPending()).toBe(false)
    await vi.advanceTimersByTimeAsync(SETTLE_QUIET_MS + 50)
    expect(done()).toBe(true)
  })

  test('test the peek is watched, and a note no longer open is forgotten', () => {
    window.objectDesktop = fakeDesktop({ platform: 'linux' }).bridge
    render(<DesktopChrome />)
    act(() => setSaveState('Notes/B.md', 'unsaved'))
    expect(savesPending()).toBe(false)
    act(() => usePeek.setState({ path: 'Notes/B.md', list: ['Notes/B.md'], index: 0 }))
    expect(savesPending()).toBe(true)
    act(() => usePeek.setState({ path: null, list: [], index: 0 }))
    expect(savesPending()).toBe(false)
  })

  test('test in a browser nothing is watched', () => {
    useTabs.setState({ tabs: [tab('t1', 'Notes/A.md')], activeId: 't1' })
    render(<DesktopChrome />)
    act(() => setSaveState('Notes/A.md', 'saving'))
    expect(savesPending()).toBe(false)
  })

  test('test typed text not yet sent: closing sends it at once and waits until it has landed', async () => {
    // The editor's own autosave (the real hook) with the server's answer held back.
    const calls: string[][] = []
    let land: () => void = () => {}
    vi.mocked(api.saveBody).mockImplementation((path: string, body: string, version: string) => {
      calls.push([path, body, version])
      return new Promise((res) => (land = () => res({ version: 'v1' } as never)))
    })
    const fake = fakeDesktop({ platform: 'linux' })
    window.objectDesktop = fake.bridge
    registerBeforeClose()
    useTabs.setState({ tabs: [tab('t1', 'Notes/A.md')], activeId: 't1' })
    render(<DesktopChrome />)
    let body = 'A0'
    const { result } = renderHook(() => {
      const autosave = useAutosave({ path: 'Notes/A.md', version: 'v0', readOnly: false, getBody: () => body, onSaved: () => {} })
      // As `editor/Editor.tsx` publishes it.
      const { saveState } = autosave
      useEffect(() => setSaveState('Notes/A.md', saveState), [saveState])
      return autosave
    })
    act(() => result.current.markLoaded('A0', 'v0'))
    body = 'A1 typed just before the window was closed'
    act(() => result.current.schedule())
    expect(calls).toEqual([])

    let done: () => boolean = () => false
    await act(async () => {
      done = settled(fake.beforeClose())
    })
    expect(calls).toEqual([['Notes/A.md', body, 'v0']])
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200)
    })
    expect(done()).toBe(false)
    await act(async () => land())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SETTLE_QUIET_MS + 50)
    })
    expect(done()).toBe(true)
    expect(calls).toHaveLength(1)
    vi.mocked(api.saveBody).mockReset()
  })
})
