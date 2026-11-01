import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ConflictError, isResync, ReadOnlyError } from '@/api/client'
import type { MdStamp } from '@/api/whiteboardTypes'
import { announceSave, onLocalSave } from '../localSaves'
import { inkClient, type InkClient } from './inkClient'
import { mergeStrokes } from './inkModel'
import { INK_STRINGS } from './inkStrings'
import type { InkDoc, InkStroke } from './types'

/** Saves wait this long after the last change. */
export const INK_SAVE_DELAY_MS = 400
/** First retry delay after a failed save; it doubles up to `INK_RETRY_MAX_MS` (as the board's saves). */
export const INK_RETRY_MS = 2000
export const INK_RETRY_MAX_MS = 30000
/** Automatic retries after a run of failed saves; then only the next change (or a flush) tries again. */
export const INK_RETRY_LIMIT = 5

type Client = Pick<InkClient, 'load' | 'save'>

/**
 * The ink file of one board. Loads once (never writes on open); `save(next)` shows `next` at once
 * and writes it 400 ms after the last change, one save in flight at a time (the latest queued).
 * A 409 reloads, merges the local additions and removals by stroke id onto the server copy and
 * saves once with the new revision; a second 409 reloads and keeps the server copy. Any other
 * failure keeps the strokes pending, reports `saveError` and retries after a growing delay, at
 * most `INK_RETRY_LIMIT` times; the next change tries again. A first load that fails is retried
 * the same way (strokes drawn meanwhile stay pending and are merged onto the file when it loads);
 * only after the retries does the ink open read-only with the reason. An external
 * `whiteboard` event for this path reloads when nothing is pending. `flush()` sends a pending save
 * now (also on unmount and `pagehide`). `onMdStamp` receives each landed save's stamp of the
 * board `.md` (M9), so the board's Notes can save on top of it.
 */
export function useInkDoc(
  path: string,
  client: Client = inkClient,
  onMdStamp?: (stamp: MdStamp) => void,
): InkDoc {
  const [strokes, setStrokes] = useState<InkStroke[] | null>(null)
  const [readOnlyReason, setReadOnlyReason] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const s = useRef({
    path,
    client,
    onMdStamp,
    alive: true,
    loaded: false,
    readOnly: false,
    revision: '',
    lastSaved: [] as InkStroke[],
    pending: null as InkStroke[] | null,
    timer: null as ReturnType<typeof setTimeout> | null,
    inFlight: null as Promise<void> | null,
    /** Failed saves in a row (reset by a save that lands). */
    failures: 0,
    /** Failed first loads in a row, and the retry waiting. */
    loadFailures: 0,
    loadTimer: null as ReturnType<typeof setTimeout> | null,
    generation: 0,
  })
  s.current.client = client
  s.current.onMdStamp = onMdStamp

  const show = useCallback((next: InkStroke[]) => {
    if (s.current.alive) setStrokes(next)
  }, [])

  const applyLoad = useCallback(
    (res: { strokes: InkStroke[]; revision: string; readOnlyReason?: string }) => {
      const st = s.current
      st.revision = res.revision
      st.lastSaved = res.strokes
      st.loaded = true
      st.readOnly = !!res.readOnlyReason
      if (st.alive) {
        setStrokes(res.strokes)
        setReadOnlyReason(res.readOnlyReason ?? null)
      }
    },
    [],
  )

  const markReadOnly = useCallback((reason: string) => {
    const st = s.current
    st.readOnly = true
    st.pending = null
    if (st.alive) setReadOnlyReason(reason)
  }, [])

  const landed = useCallback(() => {
    const st = s.current
    st.failures = 0
    if (st.alive) setSaveError(null)
  }, [])

  /**
   * A save that failed for any reason but 409/423: `local` stays pending (unless a newer change
   * already is), the failure is told, and a retry waits `INK_RETRY_MS` doubling, while under the cap.
   */
  const failed = useCallback((local: InkStroke[], err: unknown) => {
    const st = s.current
    console.error('ink save failed', err)
    st.failures += 1
    if (!st.pending) st.pending = local
    const reason = err instanceof Error && err.message ? ` ${err.message}` : ''
    if (st.alive) setSaveError(`${INK_STRINGS.saveFailed}${reason}`)
    if (st.timer || st.failures > INK_RETRY_LIMIT) return
    const delay = Math.min(INK_RETRY_MS * 2 ** (st.failures - 1), INK_RETRY_MAX_MS)
    st.timer = setTimeout(() => {
      st.timer = null
      void runRef.current()
    }, delay)
  }, [])
  const runRef = useRef<() => Promise<void>>(async () => undefined)
  const reloadRef = useRef<() => Promise<void>>(async () => undefined)

  const saveOnce = useCallback(
    async (local: InkStroke[]) => {
      const st = s.current
      const gen = st.generation
      const { client: c, path: p } = st
      try {
        const r = await c.save(p, local, st.revision)
        if (gen !== st.generation) return
        st.revision = r.revision
        st.lastSaved = local
        st.onMdStamp?.(r)
        announceSave({ path: p, version: r.revision, source: st })
        landed()
        return
      } catch (err) {
        if (gen !== st.generation) return
        if (err instanceof ReadOnlyError) return markReadOnly(err.message)
        if (!(err instanceof ConflictError)) return failed(local, err)
      }
      // 409: merge onto the server copy and save once.
      try {
        const remote = await c.load(p)
        if (gen !== st.generation) return
        if (remote.readOnlyReason) return applyLoad(remote)
        const merged = mergeStrokes(st.lastSaved, local, remote.strokes)
        try {
          const r = await c.save(p, merged, remote.revision)
          if (gen !== st.generation) return
          st.revision = r.revision
          st.lastSaved = merged
          st.onMdStamp?.(r)
          announceSave({ path: p, version: r.revision, source: st })
          landed()
          if (st.pending) {
            st.pending = mergeStrokes(local, st.pending, merged)
            show(st.pending)
          } else {
            show(merged)
          }
        } catch (err) {
          if (gen !== st.generation) return
          if (err instanceof ReadOnlyError) return markReadOnly(err.message)
          if (!(err instanceof ConflictError)) {
            // Keep the merge pending against the server copy it was made on.
            st.revision = remote.revision
            st.lastSaved = remote.strokes
            const next = st.pending ? mergeStrokes(local, st.pending, merged) : merged
            st.pending = null
            show(next)
            return failed(next, err)
          }
          // A second 409: keep the server copy.
          const again = await c.load(p)
          if (gen !== st.generation) return
          st.pending = null
          if (st.timer) {
            clearTimeout(st.timer)
            st.timer = null
          }
          applyLoad(again)
        }
      } catch (err) {
        if (gen !== st.generation) return
        failed(local, err)
      }
    },
    [applyLoad, failed, landed, markReadOnly, show],
  )

  /** Start the queued save unless one is in flight; chains until nothing is pending. */
  const run = useCallback((): Promise<void> => {
    const st = s.current
    if (st.inFlight) return st.inFlight
    if (!st.pending || st.readOnly) return Promise.resolve()
    const local = st.pending
    st.pending = null
    const p = saveOnce(local).finally(() => {
      st.inFlight = null
      if (st.pending && !st.timer && st.failures === 0) void run()
    })
    st.inFlight = p
    return p
  }, [saveOnce])
  runRef.current = run

  const save = useCallback(
    (next: InkStroke[]) => {
      const st = s.current
      if (st.readOnly) return
      st.pending = next
      show(next)
      if (!st.loaded) return // saved once the file has loaded (merged onto it)
      if (st.timer) clearTimeout(st.timer)
      st.timer = setTimeout(() => {
        st.timer = null
        void run()
      }, INK_SAVE_DELAY_MS)
    },
    [run, show],
  )

  const flush = useCallback(async () => {
    const st = s.current
    if (st.timer) {
      clearTimeout(st.timer)
      st.timer = null
    }
    // Wait for the save in flight, then send what is still pending. One failed attempt ends it
    // (its retry timer, or the next change, tries again): no burst of PUTs at a server that is down.
    for (let i = 0; i < 5 && (st.inFlight || (st.pending && !st.readOnly)); i++) {
      await run()
      if (st.failures > 0) return
      if (st.timer) {
        clearTimeout(st.timer)
        st.timer = null
      }
    }
  }, [run])

  const reload = useCallback(async () => {
    const st = s.current
    const gen = st.generation
    try {
      const res = await st.client.load(st.path)
      if (gen !== st.generation) return
      // Strokes drawn before the file loaded: add them to it and save.
      if (!st.loaded && st.pending && !res.readOnlyReason) {
        const early = st.pending
        applyLoad(res)
        const merged = mergeStrokes([], early, res.strokes)
        st.pending = merged
        show(merged)
        st.timer = setTimeout(() => {
          st.timer = null
          void run()
        }, INK_SAVE_DELAY_MS)
        return
      }
      if (!st.loaded) st.pending = null
      // A change made while loading wins; the next save sees the new revision.
      if (st.pending || st.inFlight || st.timer) {
        st.revision = res.revision
        return
      }
      // Unchanged (e.g. the event was for a board-only save): keep the strokes, so the page
      // doesn't reload them into the store, which would reset its undo history.
      if (st.loaded && res.revision === st.revision) return
      applyLoad(res)
    } catch (err) {
      if (gen !== st.generation) return
      if (!st.loaded && st.loadFailures < INK_RETRY_LIMIT) {
        // The first load failed (the server down, a transient error): retry with a growing delay.
        // Marking the ink read-only here would drop what is drawn meanwhile; it stays pending.
        console.error('ink load failed', err)
        st.loadFailures += 1
        const delay = Math.min(INK_RETRY_MS * 2 ** (st.loadFailures - 1), INK_RETRY_MAX_MS)
        st.loadTimer = setTimeout(() => {
          st.loadTimer = null
          void reloadRef.current()
        }, delay)
        return
      }
      st.loaded = true
      st.readOnly = true
      if (st.alive) {
        setStrokes((cur) => cur ?? [])
        setReadOnlyReason(err instanceof Error ? err.message : String(err))
      }
    }
  }, [applyLoad, run, show])
  reloadRef.current = reload

  const clearLoadRetry = useCallback(() => {
    const st = s.current
    if (st.loadTimer) {
      clearTimeout(st.loadTimer)
      st.loadTimer = null
    }
    st.loadFailures = 0
  }, [])

  // Load once per path.
  useEffect(() => {
    const st = s.current
    st.path = path
    st.generation += 1
    st.loaded = false
    st.readOnly = false
    st.revision = ''
    st.lastSaved = []
    st.pending = null
    st.failures = 0
    clearLoadRetry()
    setStrokes(null)
    setReadOnlyReason(null)
    setSaveError(null)
    void reload()
    // Moving to another board sends this one's pending save first (it captures the old path).
    return () => {
      clearLoadRetry()
      void flush()
    }
  }, [path, reload, flush, clearLoadRetry])

  // External changes to this board's files, and saves by another view of it in this window.
  useEffect(() => {
    const changed = (path: string, version: string | null) => {
      const st = s.current
      if (path !== st.path) return
      if (!st.loaded || st.pending || st.inFlight || st.timer) return
      if (version && version === st.revision) return
      void reload()
    }
    const offChange = api.onChange((e) => {
      if ((e.kind as string) === 'whiteboard') changed(e.path, e.version)
      // The stream reconnected: the ink may have changed meanwhile; the revision check decides.
      else if (isResync(e, 'types')) changed(s.current.path, null)
    })
    const offLocal = onLocalSave((e) => {
      if (e.source !== s.current) changed(e.path, e.version)
    })
    return () => {
      offChange()
      offLocal()
    }
  }, [reload])

  // Flush on pagehide and unmount.
  useEffect(() => {
    const st = s.current
    st.alive = true
    const onHide = () => void flush()
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      void flush()
      st.alive = false
    }
  }, [flush])

  return useMemo(
    () => ({ strokes, readOnlyReason, saveError, save, flush }),
    [strokes, readOnlyReason, saveError, save, flush],
  )
}
