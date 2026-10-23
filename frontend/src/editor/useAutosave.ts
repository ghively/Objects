/**
 * Debounced, conflict-safe autosave shared by the formatted editor and raw mode.
 *
 * - `schedule()` saves 1000 ms after the last call; `flush()` saves now (on blur).
 * - Nothing is sent when the body equals the last loaded or saved body.
 * - One save in flight at a time; edits made meanwhile are saved right after.
 * - A 409 calls `onConflict` and pauses saving until a new version arrives.
 * - `hold()` / `resume()` let the owner pause saving while it resolves an external change.
 */
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { api, ConflictError, ReadOnlyError } from '@/api/client'

export const AUTOSAVE_DELAY_MS = 1000

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
  const flushRef = useRef<(pathOverride?: string) => Promise<void>>(async () => {})

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
    try {
      const res = await api.saveBody(path, body, versionRef.current)
      if (optsRef.current.path !== path) return
      versionRef.current = res.version
      savedBodyRef.current = body
      optsRef.current.onSaved(res.version)
    } catch (err) {
      if (err instanceof ConflictError) {
        pausedRef.current = true
        optsRef.current.onConflict?.(err.currentVersion)
      } else if (err instanceof ReadOnlyError) {
        pausedRef.current = true
      } else {
        console.error('autosave failed', err)
      }
    } finally {
      inFlightRef.current = false
    }
    if (againRef.current) {
      againRef.current = false
      await flushRef.current()
    }
  }, [cancel])
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
      savedBodyRef.current = body
      if (version !== undefined) versionRef.current = version
      pausedRef.current = false
    },
    [cancel],
  )

  /** Stop saving (drop any pending save) until `resume()` or a reload. Used while a conflict is resolved. */
  const hold = useCallback(() => {
    cancel()
    pausedRef.current = true
  }, [cancel])

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

  useEffect(() => cancel, [cancel])

  return {
    schedule,
    flush,
    markLoaded,
    cancel,
    hold,
    resume,
    isDirty,
    isPending,
    savedBody: () => savedBodyRef.current,
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
  /** Stop autosaving until `resume()` or `reload()`. */
  hold(): void
  /** Adopt `version` and resume autosave; `saveNow` saves pending edits against it at once. */
  resume(version: string, saveNow?: boolean): Promise<void>
  /** Replace the content with `body` (discarding local edits) and mark it saved at `version`. */
  reload(body: string, version: string): void
}
