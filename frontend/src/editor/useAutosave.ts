/**
 * Debounced, conflict-safe autosave shared by the formatted editor and raw mode.
 *
 * - `schedule()` saves 1000 ms after the last call; `flush()` saves now (on blur);
 *   `settle()` saves now and waits until no save is in flight or queued.
 * - Nothing is sent when the body equals the last loaded or saved body.
 * - One save in flight at a time; edits made meanwhile are saved right after.
 * - A 409 calls `onConflict` and pauses saving until a new version arrives.
 * - `hold()` / `resume()` let the owner pause saving while it resolves an external change.
 * - Any other failure (a file locked by another program, the server gone) sets
 *   `saveError` and retries with a growing delay until a save succeeds.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api, ConflictError, ReadOnlyError } from '@/api/client'

export const AUTOSAVE_DELAY_MS = 1000
/** First retry delay after a failed save; it doubles up to `AUTOSAVE_RETRY_MAX_MS`. */
export const AUTOSAVE_RETRY_MS = 2000
export const AUTOSAVE_RETRY_MAX_MS = 30000
export const AUTOSAVE_ERROR_TEXT = 'Changes not saved. Retrying…'

export type AutosaveOptions = {
  path: string
  version: string
  readOnly: boolean
  /** The current body, or null when it cannot be read (no editor yet). */
  getBody: () => string | null
  onSaved: (version: string) => void
  onConflict?: (currentVersion: string) => void
}

export function useAutosave(opts: AutosaveOptions) {
  const optsRef = useRef(opts)
  useLayoutEffect(() => {
    optsRef.current = opts
  })

  const versionRef = useRef(opts.version)
  const savedBodyRef = useRef<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlightRef = useRef(false)
  const againRef = useRef(false)
  const pausedRef = useRef(false)
  /** The save running now (including any save queued behind it), if any. */
  const runningRef = useRef<Promise<void> | null>(null)
  const flushRef = useRef<(pathOverride?: string) => Promise<void>>(async () => {})
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryDelayRef = useRef(AUTOSAVE_RETRY_MS)
  const [saveError, setSaveError] = useState<string | null>(null)

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
  }, [])

  /** Save now. `pathOverride` saves under a previous path (the editor is switching objects). */
  const flush = useCallback(async (pathOverride?: string): Promise<void> => {
    cancel()
    const o = optsRef.current
    if (o.readOnly || pausedRef.current) return
    if (inFlightRef.current) {
      againRef.current = true
      return
    }
    const body = o.getBody()
    if (body === null || body === savedBodyRef.current) return

    const path = pathOverride ?? o.path
    inFlightRef.current = true
    const run = (async () => {
      try {
        const res = await api.saveBody(path, body, versionRef.current)
        if (optsRef.current.path !== path) return
        versionRef.current = res.version
        savedBodyRef.current = body
        retryDelayRef.current = AUTOSAVE_RETRY_MS
        setSaveError(null)
        optsRef.current.onSaved(res.version)
      } catch (err) {
        if (err instanceof ConflictError) {
          pausedRef.current = true
          setSaveError(null)
          optsRef.current.onConflict?.(err.currentVersion)
        } else if (err instanceof ReadOnlyError) {
          pausedRef.current = true
          setSaveError(null)
        } else {
          console.error('autosave failed', err)
          setSaveError(AUTOSAVE_ERROR_TEXT)
          clearRetry()
          const delay = retryDelayRef.current
          retryDelayRef.current = Math.min(delay * 2, AUTOSAVE_RETRY_MAX_MS)
          retryTimerRef.current = setTimeout(() => {
            retryTimerRef.current = null
            if (optsRef.current.path === path) void flushRef.current()
          }, delay)
        }
      } finally {
        inFlightRef.current = false
      }
      if (againRef.current) {
        againRef.current = false
        await flushRef.current()
      }
    })()
    runningRef.current = run
    try {
      await run
    } finally {
      if (runningRef.current === run) runningRef.current = null
    }
  }, [cancel, clearRetry])

  /**
   * Save now and resolve only once nothing is left to save: any save already in
   * flight, and any save queued behind it, has finished.
   */
  const settle = useCallback(async (): Promise<void> => {
    await flush()
    while (runningRef.current) await runningRef.current
  }, [flush])
  useLayoutEffect(() => {
    flushRef.current = flush
  }, [flush])

  const schedule = useCallback(() => {
    if (optsRef.current.readOnly) return
    cancel()
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      void flush()
    }, AUTOSAVE_DELAY_MS)
  }, [cancel, flush])

  /** Record `body` as what is on disk (after a load), so saving it again is a no-op. */
  const markLoaded = useCallback(
    (body: string, version?: string) => {
      cancel()
      clearRetry()
      setSaveError(null)
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

  useEffect(
    () => () => {
      cancel()
      clearRetry()
    },
    [cancel, clearRetry],
  )

  return {
    schedule,
    flush,
    settle,
    markLoaded,
    cancel,
    hold,
    resume,
    isDirty,
    isPending,
    savedBody: () => savedBodyRef.current,
    /** Set while the last save failed for a reason other than a conflict or read-only file. */
    saveError,
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
}
