/**
 * Debounced, conflict-safe autosave shared by the formatted editor and raw mode.
 *
 * - `schedule()` saves 1000 ms after the last call; `flush()` saves now (on blur).
 * - Nothing is sent when the body equals the last loaded or saved body.
 * - One save in flight at a time; edits made meanwhile are saved right after.
 * - A 409 calls `onConflict` and pauses saving until a new version arrives.
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

  const isPending = useCallback(() => timerRef.current !== null, [])

  useEffect(() => cancel, [cancel])

  return { schedule, flush, markLoaded, cancel, isPending, savedBody: () => savedBodyRef.current }
}
