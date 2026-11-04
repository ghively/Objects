/**
 * Lazily loaded chunks after a rebuild. When the app is rebuilt while a window is open, the old
 * chunk names are gone and a lazy `import()` fails (a 404, "Failed to fetch dynamically imported
 * module"). The window then reloads itself once, after every pending save is flushed. A second
 * failure within a minute (the marker in sessionStorage says a reload just happened) shows a toast
 * with a Reload button instead, so a broken build can never loop. So does a flush that fails or
 * takes longer than 5 s, so a reload never drops unsaved edits without the user choosing it.
 *
 * `guardImport` wraps a plain dynamic import, `lazyWithReload` a React.lazy one, and
 * `installChunkReload` (main.tsx) catches Vite's `vite:preloadError` and any chunk failure that
 * reaches the window unhandled.
 */
import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import { flushAll } from './flush'

export const CHUNK_RELOAD_MARK = 'object:chunk-reload'
/** At most one automatic reload per this many milliseconds. */
export const CHUNK_RELOAD_WINDOW_MS = 60_000
export const OBJECT_UPDATED_TEXT = 'Object was updated. Reload to continue.'
export const RELOAD_LABEL = 'Reload'
/** Shown when the Reload button's flush failed again; the next click reloads regardless. */
export const UNSAVED_MAY_BE_LOST_TEXT = 'Some changes could not be saved. Reloading now may lose them.'
/** How long a flush may take before the automatic reload gives way to the toast. */
export const FLUSH_TIMEOUT_MS = 5_000

/** Flush every pending save; true only when that finished without error within FLUSH_TIMEOUT_MS. */
function flushInTime(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), FLUSH_TIMEOUT_MS)
    flushAll().then(
      () => {
        clearTimeout(timer)
        resolve(true)
      },
      () => {
        clearTimeout(timer)
        resolve(false)
      },
    )
  })
}

/** Seams for tests (jsdom cannot reload). */
export const chunkReloadDeps = {
  reload: (): void => window.location.reload(),
  now: (): number => Date.now(),
}

// A reload is under way (or the toast is up): further failures in this page add nothing.
let handled = false

const CHUNK_ERROR =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|ChunkLoadError|Loading (CSS )?chunk \S+ failed/i

/** Whether `err` is a failed chunk load (as opposed to an error thrown by the module itself). */
export function isChunkLoadError(err: unknown): boolean {
  if (!err) return false
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
  return CHUNK_ERROR.test(text)
}

function readMark(): number | null {
  try {
    const v = sessionStorage.getItem(CHUNK_RELOAD_MARK)
    return v === null ? null : Number(v)
  } catch {
    return null
  }
}

/** False when there is no storage: then no automatic reload either, since nothing could stop a loop. */
function writeMark(at: number): boolean {
  try {
    sessionStorage.setItem(CHUNK_RELOAD_MARK, String(at))
    return sessionStorage.getItem(CHUNK_RELOAD_MARK) === String(at)
  } catch {
    return false
  }
}

/** The "Object was updated" toast, in the app's toast host, with a Reload button. Stays until used. */
function showUpdatedToast(): void {
  if (typeof document === 'undefined') return
  let host = document.querySelector<HTMLElement>('[data-editor-toasts]')
  if (!host) {
    host = document.createElement('div')
    host.setAttribute('data-editor-toasts', '')
    host.className = 'editor-toasts'
    document.body.appendChild(host)
  }
  if (host.querySelector('[data-chunk-reload-toast]')) return
  const el = document.createElement('div')
  el.className = 'editor-toast'
  el.setAttribute('role', 'status')
  el.setAttribute('data-chunk-reload-toast', '')
  el.style.pointerEvents = 'auto'
  el.style.display = 'flex'
  el.style.alignItems = 'center'
  el.style.gap = '12px'
  const text = document.createElement('span')
  text.textContent = OBJECT_UPDATED_TEXT
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = RELOAD_LABEL
  button.style.fontWeight = '500'
  button.style.color = 'var(--accent, inherit)'
  // The button flushes first. If that fails again, the toast says changes may be lost and the
  // next click reloads anyway: the user asked for the reload.
  let warned = false
  let busy = false
  button.addEventListener('click', () => {
    if (busy) return
    if (warned) {
      chunkReloadDeps.reload()
      return
    }
    busy = true
    void flushInTime().then((ok) => {
      busy = false
      if (ok) {
        chunkReloadDeps.reload()
        return
      }
      warned = true
      text.textContent = UNSAVED_MAY_BE_LOST_TEXT
    })
  })
  el.append(text, button)
  host.appendChild(el)
}

/** React to one failed chunk load: flush and reload once, or show the toast if a reload just happened. */
export async function handleChunkLoadError(): Promise<void> {
  if (handled) return
  handled = true
  const now = chunkReloadDeps.now()
  const last = readMark()
  const recent = last !== null && Number.isFinite(last) && now - last >= 0 && now - last < CHUNK_RELOAD_WINDOW_MS
  if (recent || !writeMark(now)) {
    showUpdatedToast()
    return
  }
  // Reload only when every pending save made it; otherwise let the user decide from the toast.
  if (await flushInTime()) chunkReloadDeps.reload()
  else showUpdatedToast()
}

const never = <T,>(): Promise<T> => new Promise<T>(() => {})

/**
 * Run a dynamic import; on a chunk failure, handle it (reload or toast) and never settle, so the
 * caller neither continues with a missing module nor shows a second error. Other errors pass through.
 */
export function guardImport<T>(load: () => Promise<T>): Promise<T> {
  return load().catch((err: unknown) => {
    if (!isChunkLoadError(err)) throw err
    void handleChunkLoadError()
    return never<T>()
  })
}

/** React.lazy with the same chunk-failure handling. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithReload<C extends ComponentType<any>>(
  factory: () => Promise<{ default: C }>,
): LazyExoticComponent<C> {
  return lazy(() => guardImport(factory))
}

/** Listen for Vite's preload failures and for chunk failures nothing else caught. Returns the uninstaller. */
export function installChunkReload(): () => void {
  const onPreload = (e: Event) => {
    e.preventDefault()
    void handleChunkLoadError()
  }
  const onRejection = (e: PromiseRejectionEvent) => {
    if (!isChunkLoadError(e.reason)) return
    e.preventDefault()
    void handleChunkLoadError()
  }
  const onError = (e: ErrorEvent) => {
    if (!isChunkLoadError(e.error ?? e.message)) return
    e.preventDefault()
    void handleChunkLoadError()
  }
  window.addEventListener('vite:preloadError', onPreload)
  window.addEventListener('unhandledrejection', onRejection)
  window.addEventListener('error', onError)
  return () => {
    window.removeEventListener('vite:preloadError', onPreload)
    window.removeEventListener('unhandledrejection', onRejection)
    window.removeEventListener('error', onError)
  }
}

export function __resetChunkReloadForTests(): void {
  handled = false
}
