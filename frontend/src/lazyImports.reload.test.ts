// When the app is rebuilt while a window is open, a lazy import of an old chunk fails. The window
// then reloads once by itself (after the pending saves are flushed); a second failure within a
// minute shows a toast with a Reload button instead, so a broken build never loops.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { registerFlusher } from '@/lib/flush'
import {
  CHUNK_RELOAD_MARK,
  OBJECT_UPDATED_TEXT,
  __resetChunkReloadForTests,
  chunkReloadDeps,
  guardImport,
  installChunkReload,
} from '@/lib/lazyReload'

const chunkError = () => new TypeError('Failed to fetch dynamically imported module: http://127.0.0.1/assets/GraphPage-old.js')
const settle = () => new Promise((r) => setTimeout(r, 0))

let reload: ReturnType<typeof vi.fn>
let flusher: ReturnType<typeof vi.fn>
let unregister: () => void
let now = 1_000_000

beforeEach(() => {
  __resetChunkReloadForTests()
  sessionStorage.clear()
  document.body.innerHTML = ''
  reload = vi.fn()
  flusher = vi.fn(async () => {})
  unregister = registerFlusher(flusher as unknown as () => Promise<void>)
  now = 1_000_000
  chunkReloadDeps.reload = reload as unknown as () => void
  chunkReloadDeps.now = () => now
})

afterEach(() => {
  unregister()
})

describe('a lazily loaded chunk that fails', () => {
  test('flushes the pending saves once, then reloads the window once', async () => {
    let flushedBeforeReload = false
    reload.mockImplementation(() => {
      flushedBeforeReload = flusher.mock.calls.length === 1
    })
    void guardImport(() => Promise.reject(chunkError()))
    await settle()
    await settle()
    expect(flusher).toHaveBeenCalledTimes(1)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(flushedBeforeReload).toBe(true)
    expect(sessionStorage.getItem(CHUNK_RELOAD_MARK)).toBe(String(now))
    // A second failure in the same page while the reload is under way does nothing more.
    void guardImport(() => Promise.reject(chunkError()))
    await settle()
    expect(reload).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).not.toContain(OBJECT_UPDATED_TEXT)
  })

  test('a second failure within 60 s (after the reload) shows the toast and does not reload', async () => {
    sessionStorage.setItem(CHUNK_RELOAD_MARK, String(now - 30_000))
    void guardImport(() => Promise.reject(chunkError()))
    await settle()
    await settle()
    expect(reload).not.toHaveBeenCalled()
    const toast = document.querySelector('[role="status"]')
    expect(toast?.textContent).toContain(OBJECT_UPDATED_TEXT)
    const button = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Reload')
    expect(button).toBeDefined()
    // The button flushes the pending saves too, then reloads.
    expect(flusher).not.toHaveBeenCalled()
    button!.click()
    await settle()
    expect(flusher).toHaveBeenCalledTimes(1)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  test('a marker older than 60 s allows another automatic reload', async () => {
    sessionStorage.setItem(CHUNK_RELOAD_MARK, String(now - 61_000))
    void guardImport(() => Promise.reject(chunkError()))
    await settle()
    await settle()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  test("Vite's preload error event triggers the same reload", async () => {
    const uninstall = installChunkReload()
    try {
      const ev = new Event('vite:preloadError', { cancelable: true })
      window.dispatchEvent(ev)
      await settle()
      await settle()
      expect(ev.defaultPrevented).toBe(true)
      expect(flusher).toHaveBeenCalledTimes(1)
      expect(reload).toHaveBeenCalledTimes(1)
    } finally {
      uninstall()
    }
  })
})

describe('a lazy import that succeeds', () => {
  test('does nothing', async () => {
    const mod = { default: 42 }
    await expect(guardImport(() => Promise.resolve(mod))).resolves.toBe(mod)
    await settle()
    expect(flusher).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(CHUNK_RELOAD_MARK)).toBeNull()
    expect(document.body.textContent).toBe('')
  })

  test('another kind of error passes through untouched', async () => {
    const err = new Error('boom')
    await expect(guardImport(() => Promise.reject(err))).rejects.toBe(err)
    expect(reload).not.toHaveBeenCalled()
  })
})
