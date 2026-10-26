// A type page's saved views (`.capacities/views/<typeId>.json`): optimistic updates with a
// debounced save. A save carries the revision it was based on; on a 409 the stored views are
// fetched, the pending edits are re-applied to them once, and the save is tried again.
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ConflictError } from '@/api/client'
import type { Views } from '@/api/types'

const SAVE_DELAY_MS = 300

export type ViewsEdit = (v: Views) => Views

export function useTypeViews(typeId: string): { views: Views | null; update(edit: ViewsEdit): void } {
  const [views, setViews] = useState<Views | null>(null)
  const viewsRef = useRef<Views | null>(null)
  const revision = useRef('')
  const pending = useRef<ViewsEdit[]>([])
  const saving = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const idRef = useRef(typeId)
  idRef.current = typeId

  const adopt = useCallback((v: Views, rev: string) => {
    viewsRef.current = v
    revision.current = rev
    setViews(v)
  }, [])

  const load = useCallback(async () => {
    const id = idRef.current
    try {
      const res = await api.views(id)
      if (idRef.current === id && pending.current.length === 0) adopt(res.views, res.revision)
    } catch (e) {
      console.warn('Could not load the views:', e)
    }
  }, [adopt])

  useEffect(() => {
    viewsRef.current = null
    pending.current = []
    setViews(null)
    void load()
    // Another window's save (or an external edit) of this type's views replaces ours.
    const off = api.onChange((e) => {
      if (e.kind !== 'views' || e.path !== idRef.current) return
      if (saving.current || pending.current.length > 0 || e.version === revision.current) return
      void load()
    })
    return off
  }, [typeId, load])

  const flush = useCallback(async () => {
    timer.current = null
    const edits = pending.current
    const current = viewsRef.current
    if (edits.length === 0 || !current) return
    pending.current = []
    const id = idRef.current
    saving.current = true
    try {
      try {
        const res = await api.saveViews(id, current, revision.current)
        revision.current = res.revision
      } catch (e) {
        if (!(e instanceof ConflictError)) throw e
        const fresh = await api.views(id)
        const next = edits.reduce((v, edit) => edit(v), fresh.views)
        const res = await api.saveViews(id, next, fresh.revision)
        // Edits made while this save was in flight stay on top of what was stored.
        if (idRef.current === id) adopt(pending.current.reduce((v, edit) => edit(v), next), res.revision)
      }
    } catch (e) {
      console.warn('Could not save the views:', e)
    } finally {
      saving.current = false
    }
  }, [adopt])

  const update = useCallback(
    (edit: ViewsEdit) => {
      const cur = viewsRef.current
      if (!cur) return
      const next = edit(cur)
      viewsRef.current = next
      setViews(next)
      pending.current.push(edit)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS)
    },
    [flush],
  )

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current)
        void flush()
      }
    },
    [flush],
  )

  return { views, update }
}
