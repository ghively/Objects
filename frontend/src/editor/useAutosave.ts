/**
 * Debounced, conflict-safe autosave shared by the formatted editor and raw mode.
 *
 * - `schedule()` saves 1000 ms after the last call, and at most 3000 ms after the first
 *   call since the last save (M32: typing that never pauses is still saved); `flush()`
 *   saves now (on blur); `settle()` saves now and waits until no save is in flight or queued.
 * - M32: it also saves now when the window loses focus, when the document becomes hidden
 *   and on `pagehide`. The last two send a `keepalive` request, which the browser finishes
 *   after the page is gone, and keep the text in `unsaved.ts` until the save lands.
 * - Nothing is sent when the body equals the last loaded or saved body.
 * - One save in flight at a time; edits made meanwhile are saved right after.
 * - A 409 calls `onConflict` and pauses saving until a new version arrives.
 * - `hold()` / `resume()` let the owner pause saving while it resolves an external change.
 * - Any other failure (a file locked by another program, the server gone) sets
 *   `saveError` and retries with a growing delay until a save succeeds.
 * - `leave()` (the editor leaving an object or unmounting) saves pending edits; edits
 *   that can't be saved (saving is paused, or the save fails after the object was
 *   left) are kept in `unsaved.ts` and offered when the object opens again.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { announceLocalChange, api, ApiError, CLIENT_ID, ConflictError, ReadOnlyError } from '@/api/client'
import type { FindControl } from './extensions/findInPage'
import { dropUnsaved, keepUnsaved } from './unsaved'

export const AUTOSAVE_DELAY_MS = 1000
/** M32: while typing continues, the longest a key waits for its save. */
export const AUTOSAVE_MAX_WAIT_MS = 3000
/** First retry delay after a failed save; it doubles up to `AUTOSAVE_RETRY_MAX_MS`. */
export const AUTOSAVE_RETRY_MS = 2000
export const AUTOSAVE_RETRY_MAX_MS = 30000
export const AUTOSAVE_ERROR_TEXT = 'Changes not saved. Retrying…'
/**
 * M32: the largest request body sent with `keepalive`. Browsers allow 64 KiB over all the
 * keepalive requests in flight; a longer note goes as a normal request, which a closing page
 * may cut off (its text is kept in `unsaved.ts` for a reload either way).
 */
export const KEEPALIVE_MAX_BYTES = 60 * 1024

/**
 * M32: where the shown text stands against the file. `saved`: nothing to write; `unsaved`: edits
 * wait for the next save (or saving is paused); `saving`: a save is in flight; `error`: the last
 * save failed and is being retried (`saveError` holds the text).
 */
export type SaveState = 'saved' | 'unsaved' | 'saving' | 'error'

export type AutosaveOptions = {
  path: string
  version: string
  readOnly: boolean
  /** The current body, or null when it cannot be read (no editor yet). */
  getBody: () => string | null
  onSaved: (version: string) => void
  onConflict?: (currentVersion: string) => void
  /** The id of the object at `path`, when known: kept unsaved text is tied to it (`unsaved.ts`). */
  objectId?: string | null
}

/** How a save is sent. `keepalive`: as a request that outlives the page (M32, `pagehide`). */
type SaveHow = { keepalive?: boolean }

/** One save: `body` to `path` against `version`. */
type Job = { path: string; body: string; version: string; keepalive: boolean }

/**
 * The save `api.saveBody` sends (`PUT /api/object/body`, the same headers and payload), as a
 * `keepalive` request: the browser completes it even when the page is closed or reloaded right
 * after. The launch key travels in the window's cookie, as on every same-origin request. Null
 * when the payload is over `KEEPALIVE_MAX_BYTES` (the caller then sends the normal request).
 */
function saveBodyKeepalive(path: string, body: string, baseVersion: string): Promise<{ version: string }> | null {
  const payload = JSON.stringify({ path, body, baseVersion, clientId: CLIENT_ID })
  if (new TextEncoder().encode(payload).length > KEEPALIVE_MAX_BYTES) return null
  return (async () => {
    const res = await fetch('/api/object/body', {
      method: 'PUT',
      keepalive: true,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: payload,
    })
    let data: unknown = null
    try {
      data = await res.json()
    } catch {
      // an empty or non-JSON answer
    }
    // FastAPI wraps an error's payload in {detail: ...}; accept both shapes (as the client does).
    let d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
    if (d.detail && typeof d.detail === 'object') d = d.detail as Record<string, unknown>
    if (res.ok) {
      const version = String(d.version ?? '')
      // As `api.saveBody`: other views of this note in the window hear of the save.
      if (version && version !== baseVersion) announceLocalChange(path, version)
      return { version }
    }
    if (res.status === 409) throw new ConflictError(String(d.currentVersion ?? ''))
    if (res.status === 423) throw new ReadOnlyError(String(d.reason ?? (typeof d.detail === 'string' ? d.detail : 'read-only')))
    throw new ApiError(res.status, typeof d.detail === 'string' ? d.detail : res.statusText)
  })()
}

export function useAutosave(opts: AutosaveOptions) {
  const optsRef = useRef(opts)
  /** The object id last seen at each path this editor showed (kept text is tied to it). */
  const idsRef = useRef(new Map<string, string | null>())
  useLayoutEffect(() => {
    optsRef.current = opts
    if (opts.objectId !== undefined) idsRef.current.set(opts.path, opts.objectId)
  })

  const versionRef = useRef(opts.version)
  const savedBodyRef = useRef<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** M32: the max wait, running from the first `schedule()` since the last save. */
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlightRef = useRef(false)
  /** The path of the save in flight (set while `inFlightRef` is). */
  const inFlightPathRef = useRef<string | null>(null)
  /**
   * Saves asked for while one was in flight, by path: the text at that moment and the version
   * it stood on. One per path, so a flush on the next note never drops the note before it.
   */
  const queuedRef = useRef(new Map<string, { body: string | null; version: string }>())
  const pausedRef = useRef(false)
  /** The saves running now (the one in flight and every save queued behind it), if any. */
  const runningRef = useRef<Promise<void> | null>(null)
  const flushRef = useRef<(pathOverride?: string, how?: SaveHow) => Promise<void>>(async () => {})
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryDelayRef = useRef(AUTOSAVE_RETRY_MS)
  const [saveError, setSaveError] = useState<string | null>(null)
  /** M32: `saveState` without the failure (that is `saveError`). */
  const [phase, setPhase] = useState<Exclude<SaveState, 'error'>>('saved')
  /** False once the editor using this hook has unmounted. */
  const aliveRef = useRef(true)

  const clearRetry = useCallback(() => {
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
  }, [])

  // A new version from the parent (a reload, or a conflict resolved) resumes saving.
  useEffect(() => {
    if (opts.version !== versionRef.current) {
      versionRef.current = opts.version
      pausedRef.current = false
    }
  }, [opts.version])

  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (maxTimerRef.current !== null) {
      clearTimeout(maxTimerRef.current)
      maxTimerRef.current = null
    }
  }, [])

  /** Send one save and take its answer. Resolves with the new version, or null when it failed. */
  const saveOnce = useCallback(
    async (job: Job): Promise<string | null> => {
      const { path, body, version } = job
      inFlightPathRef.current = path
      if (optsRef.current.path === path) setPhase('saving')
      try {
        const res = await ((job.keepalive ? saveBodyKeepalive(path, body, version) : null) ?? api.saveBody(path, body, version))
        if (optsRef.current.path === path) {
          versionRef.current = res.version
          savedBodyRef.current = body
          retryDelayRef.current = AUTOSAVE_RETRY_MS
          setSaveError(null)
          // Keys pressed while this save ran wait for their own save.
          const now = optsRef.current.getBody()
          setPhase(now !== null && now !== body ? 'unsaved' : 'saved')
          // What is on disk is now newer than any text kept for this object
          // earlier (e.g. by a settle while saving was paused): offering that
          // again would revert these edits.
          dropUnsaved(path, idsRef.current.get(path))
          optsRef.current.onSaved(res.version)
        }
        return res.version
      } catch (err) {
        if (!aliveRef.current || optsRef.current.path !== path) {
          // The editor has left this object: nobody is there to resolve a conflict
          // or see a retry, so keep the text to offer when the object opens again:
          // the text asked for on leaving, when it is newer than this save's.
          const q = queuedRef.current.get(path)
          keepUnsaved(path, q && q.body !== null ? q.body : body, idsRef.current.get(path))
        } else if (err instanceof ConflictError) {
          pausedRef.current = true
          setSaveError(null)
          setPhase('unsaved')
          optsRef.current.onConflict?.(err.currentVersion)
        } else if (err instanceof ReadOnlyError) {
          pausedRef.current = true
          setSaveError(null)
          setPhase('unsaved')
        } else {
          console.error('autosave failed', err)
          setSaveError(AUTOSAVE_ERROR_TEXT)
          setPhase('unsaved')
          clearRetry()
          const delay = retryDelayRef.current
          retryDelayRef.current = Math.min(delay * 2, AUTOSAVE_RETRY_MAX_MS)
          retryTimerRef.current = setTimeout(() => {
            retryTimerRef.current = null
            if (optsRef.current.path === path) void flushRef.current()
          }, delay)
        }
        return null
      }
    },
    [clearRetry],
  )

  /**
   * The next save queued while `last` ran, or null when nothing is left. On the object still
   * shown that is its latest text; on one the editor has left (or after it was destroyed), the
   * text it had when the save was asked for.
   */
  const nextQueued = useCallback((last: Job, savedVersion: string | null): Job | null => {
    const queued = queuedRef.current
    const o = optsRef.current
    // The object just saved first (its save stands on the version just returned), the one shown last.
    const order = [...queued.keys()].sort(
      (a, b) => Number(a === o.path) - Number(b === o.path) || Number(b === last.path) - Number(a === last.path),
    )
    for (const path of order) {
      const q = queued.get(path)!
      queued.delete(path)
      if (path === o.path) {
        if (o.readOnly || pausedRef.current) continue
        const latest = o.getBody() ?? q.body
        if (latest === null || latest === savedBodyRef.current) continue
        return { path, body: latest, version: versionRef.current, keepalive: false }
      }
      if (q.body === null) continue
      if (path === last.path) {
        // Left while its save ran. A failed save kept this text already (`saveOnce`).
        if (savedVersion === null || q.body === last.body) continue
        return { path, body: q.body, version: savedVersion, keepalive: false }
      }
      // Another object left meanwhile: its text against the version it stood on.
      return { path, body: q.body, version: q.version, keepalive: false }
    }
    return null
  }, [])

  /** Save `body` to `path` against `version`, then every save queued meanwhile. */
  const start = useCallback(
    async (path: string, body: string, version: string, how?: SaveHow): Promise<void> => {
      inFlightRef.current = true
      const run = (async () => {
        let job: Job | null = { path, body, version, keepalive: how?.keepalive === true }
        try {
          while (job) {
            const savedVersion: string | null = await saveOnce(job)
            job = nextQueued(job, savedVersion)
          }
        } finally {
          inFlightRef.current = false
          inFlightPathRef.current = null
        }
      })()
      runningRef.current = run
      try {
        await run
      } finally {
        if (runningRef.current === run) runningRef.current = null
      }
    },
    [nextQueued, saveOnce],
  )

  /** Save now. `pathOverride` saves under a previous path (the editor is switching objects). */
  const flush = useCallback(
    async (pathOverride?: string, how?: SaveHow): Promise<void> => {
      cancel()
      const o = optsRef.current
      if (o.readOnly || pausedRef.current) return
      const path = pathOverride ?? o.path
      if (inFlightRef.current) {
        queuedRef.current.set(path, { body: o.getBody(), version: versionRef.current })
        return
      }
      const body = o.getBody()
      if (body === null || body === savedBodyRef.current) {
        // Nothing to write (the edit was undone): what shows is what is saved.
        if (body !== null && path === o.path && aliveRef.current) setPhase('saved')
        return
      }
      await start(path, body, versionRef.current, how)
    },
    [cancel, start],
  )

  /**
   * While saving is paused (a conflict being resolved, a read-only file), unsaved edits
   * can't be written; keep them for the next open. `settle` runs this too: a space switch
   * settles every editor and then reloads the page, which never runs an unmount.
   */
  const keepIfPaused = useCallback((path?: string): boolean => {
    const o = optsRef.current
    if (!pausedRef.current || o.readOnly) return false
    const body = o.getBody()
    if (body !== null && savedBodyRef.current !== null && body !== savedBodyRef.current) {
      keepUnsaved(path ?? o.path, body, idsRef.current.get(path ?? o.path))
    }
    return true
  }, [])

  /**
   * Save now and resolve only once nothing is left to save: any save already in
   * flight, and any save queued behind it, has finished.
   */
  const settle = useCallback(async (): Promise<void> => {
    keepIfPaused()
    await flush()
    while (runningRef.current) await runningRef.current
  }, [flush, keepIfPaused])
  useLayoutEffect(() => {
    flushRef.current = flush
  }, [flush])

  const schedule = useCallback(() => {
    const o = optsRef.current
    if (o.readOnly) return
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    // During this object's save the state stays `saving`; the save's end says `unsaved`.
    if (!(inFlightRef.current && inFlightPathRef.current === o.path)) setPhase('unsaved')
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      void flush()
    }, AUTOSAVE_DELAY_MS)
    // M32: keys that keep coming restart the wait above; this one runs from the first of them.
    if (maxTimerRef.current === null) {
      maxTimerRef.current = setTimeout(() => {
        maxTimerRef.current = null
        void flush()
      }, AUTOSAVE_MAX_WAIT_MS)
    }
  }, [flush])

  /** Record `body` as what is on disk (after a load), so saving it again is a no-op. */
  const markLoaded = useCallback(
    (body: string, version?: string) => {
      cancel()
      clearRetry()
      setSaveError(null)
      setPhase('saved')
      savedBodyRef.current = body
      if (version !== undefined) versionRef.current = version
      pausedRef.current = false
    },
    [cancel, clearRetry],
  )

  /** Stop saving (drop any pending save) until `resume()` or a reload. Used while a conflict is resolved. */
  const hold = useCallback(() => {
    cancel()
    clearRetry()
    pausedRef.current = true
  }, [cancel, clearRetry])

  /**
   * Adopt `version` as the base for the next save and resume saving. With
   * `saveNow`, unsaved edits are saved against it immediately ("keep mine").
   */
  const resume = useCallback(
    (version: string, saveNow = false): Promise<void> => {
      versionRef.current = version
      pausedRef.current = false
      if (saveNow) return flush()
      if (optsRef.current.getBody() !== savedBodyRef.current) schedule()
      else if (!inFlightRef.current) setPhase('saved')
      return Promise.resolve()
    },
    [flush, schedule],
  )

  /** True when the current body differs from the last loaded or saved body. */
  const isDirty = useCallback(() => {
    const body = optsRef.current.getBody()
    return body !== null && savedBodyRef.current !== null && body !== savedBodyRef.current
  }, [])

  const isPending = useCallback(() => timerRef.current !== null, [])

  /**
   * The editor is leaving `path` (switching objects or unmounting): save pending
   * edits under it. While saving is paused (a conflict being resolved, a read-only
   * file) they can't be saved, so they are kept to be offered on the next open.
   */
  const leave = useCallback(
    (path?: string): Promise<void> => {
      if (keepIfPaused(path)) {
        cancel()
        return Promise.resolve()
      }
      return flush(path)
    },
    [cancel, flush, keepIfPaused],
  )

  // M32: save at once when the window loses focus, when the document becomes hidden and on
  // `pagehide` (the window closing, a reload, a space switch). Nothing is sent when nothing is
  // unsaved, and a save already in flight is followed by one more, never doubled.
  useEffect(() => {
    /** True when a note is loaded and may be written (an editor not loaded yet reads as empty). */
    const ready = () => savedBodyRef.current !== null && !optsRef.current.readOnly
    const onBlur = () => {
      if (ready()) void flushRef.current()
    }
    /** The page may not come back: send a request that outlives it, and keep the text until it lands. */
    const onGoing = () => {
      if (!ready()) return
      const o = optsRef.current
      const body = o.getBody()
      if (body === null || body === savedBodyRef.current) return
      // A conflict, a save still in flight (the queued one can't run on a closed page) or a
      // request cut off would lose it: a reload offers it again, and a save that lands drops it.
      keepUnsaved(o.path, body, idsRef.current.get(o.path))
      void flushRef.current(undefined, { keepalive: true })
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') onGoing()
    }
    window.addEventListener('blur', onBlur)
    window.addEventListener('pagehide', onGoing)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('pagehide', onGoing)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      cancel()
      clearRetry()
    }
  }, [cancel, clearRetry])

  return {
    schedule,
    flush,
    settle,
    leave,
    markLoaded,
    cancel,
    hold,
    resume,
    isDirty,
    isPending,
    savedBody: () => savedBodyRef.current,
    /** Set while the last save failed for a reason other than a conflict or read-only file. */
    saveError,
    /** M32: `error` while `saveError` is set, else saved / unsaved / saving (`SaveState`). */
    saveState: (saveError !== null ? 'error' : phase) as SaveState,
  }
}

/**
 * What the object view needs from a body editor (formatted or raw) to handle
 * external changes and conflicts.
 */
export interface BodyEditorHandle {
  /** The current body text, or null before the editor is ready. */
  getBody(): string | null
  /** The body last loaded or saved (what is on disk as far as the editor knows). */
  savedBody(): string | null
  /** True when there are edits not yet saved. */
  isDirty(): boolean
  /**
   * Save pending edits now; resolves once every save (in flight, or queued
   * behind one) has finished, so what is on disk is what the editor shows.
   */
  flush(): Promise<void>
  /** Stop autosaving until `resume()` or `reload()`. */
  hold(): void
  /** Adopt `version` and resume autosave; `saveNow` saves pending edits against it at once. */
  resume(version: string, saveNow?: boolean): Promise<void>
  /** Replace the content with `body` (discarding local edits) and mark it saved at `version`. */
  reload(body: string, version: string): void
  /** Find in page; only the formatted editor offers it (raw mode leaves it unset). */
  find?: FindControl
  /** M31 "Select all top-level blocks": focus the editor and select its top-level blocks (formatted editor only). */
  selectTopLevelBlocks?: () => boolean
}
