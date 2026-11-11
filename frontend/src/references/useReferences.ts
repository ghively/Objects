/**
 * Loads an object's references (`GET /api/references`) and keeps them current: any `created`,
 * `deleted`, `renamed`, `changed` or `types` event while mounted reloads once, 300 ms after the
 * last event of a burst. Stale responses (an older path or limit) are dropped.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/api/client'
import type { ChangeEvent, References } from '@/api/types'

export const RELOAD_DEBOUNCE_MS = 300

const RELOAD_KINDS = new Set<ChangeEvent['kind']>(['created', 'deleted', 'renamed', 'changed', 'types'])

/** How long a `reload({absorb})` waits for the change event of the write it follows. */
const ABSORB_MS = 2000

export interface ReloadOptions {
  /**
   * The path of a write this reload already covers: its next `changed` event (announced right
   * after the write) is absorbed instead of reloading a second time.
   */
  absorb?: string
}

export interface UseReferences {
  data: References | null
  loading: boolean
  reload(opts?: ReloadOptions): void
}

export function useReferences(path: string, relatedLimit: number): UseReferences {
  const [data, setData] = useState<References | null>(null)
  const [loading, setLoading] = useState(true)
  const seq = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const absorb = useRef<{ path: string; until: number } | null>(null)

  const fetchNow = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    const mine = ++seq.current
    setLoading(true)
    api
      .references(path, { relatedLimit })
      .then((res) => {
        if (mine === seq.current) setData(res)
      })
      .catch((err: unknown) => {
        if (mine === seq.current) console.warn('Could not load references:', err)
      })
      .finally(() => {
        if (mine === seq.current) setLoading(false)
      })
  }, [path, relatedLimit])

  // A different object starts empty; a different limit keeps what is shown until the reply.
  useEffect(() => {
    setData(null)
  }, [path])

  useEffect(() => {
    fetchNow()
  }, [fetchNow])

  // The note itself was deleted (it stays on screen with "Undo Delete"): there is nothing to ask
  // the server for, which would answer 404, until the note is back.
  const gone = useRef(false)
  useEffect(() => {
    gone.current = false
  }, [path])

  useEffect(() => {
    const off = api.onChange((e) => {
      if (!RELOAD_KINDS.has(e.kind)) return
      if (e.path === path && e.kind === 'deleted') {
        gone.current = true
        if (timer.current) clearTimeout(timer.current)
        timer.current = null
        return
      }
      if (gone.current) {
        if (e.path !== path || e.kind !== 'created') return
        gone.current = false
      }
      const a = absorb.current
      if (a && e.kind === 'changed' && e.path === a.path) {
        absorb.current = null
        if (Date.now() <= a.until) return
      }
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        timer.current = null
        fetchNow()
      }, RELOAD_DEBOUNCE_MS)
    })
    return () => {
      off()
      if (timer.current) {
        clearTimeout(timer.current)
        timer.current = null
      }
    }
  }, [fetchNow, path])

  // Unmounting drops any reply still in flight.
  useEffect(
    () => () => {
      seq.current++
    },
    [],
  )

  const reload = useCallback(
    (opts: ReloadOptions = {}) => {
      absorb.current = opts.absorb ? { path: opts.absorb, until: Date.now() + ABSORB_MS } : null
      fetchNow()
    },
    [fetchNow],
  )

  return { data, loading, reload }
}
