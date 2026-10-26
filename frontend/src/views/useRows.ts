// Rows for a scope, kept fresh from change events. Events are batched in one 150 ms window:
// a create, delete, rename, type or collection event reloads everything (value shapes and
// collection-name resolution may have changed); otherwise the changed paths are fetched in ONE
// call and merged in. Other kinds (queries, views, ui) are ignored.
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/api/client'
import type { ChangeEvent, Row, RowsScope } from '@/api/types'

const WINDOW_MS = 150
const RELOAD_KINDS = new Set(['created', 'deleted', 'renamed', 'types', 'collections'])

export interface UseRows {
  rows: Row[]
  loading: boolean
  reload(): Promise<void>
  patchRow(path: string, row: Row): void
}

export function useRows(scope: RowsScope): UseRows {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const key = JSON.stringify(scope)
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const seq = useRef(0)

  const reload = useCallback(async () => {
    const n = ++seq.current
    try {
      const next = await api.rows(scopeRef.current)
      if (n === seq.current) setRows(next)
    } catch (e) {
      console.warn('Could not load rows:', e)
    } finally {
      if (n === seq.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the scope's identity
  }, [key, reload])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let full = false
    const paths = new Set<string>()
    const flush = async () => {
      timer = null
      const everything = full
      const changed = [...paths]
      full = false
      paths.clear()
      if (everything) return reload()
      if (changed.length === 0) return
      const inScope = scopeRef.current.paths
      const wanted = inScope ? changed.filter((p) => inScope.includes(p)) : changed
      if (wanted.length === 0) return
      const n = seq.current
      try {
        const fresh = await api.rows({ ...scopeRef.current, paths: wanted })
        if (n !== seq.current) return
        const byPath = new Map(fresh.map((r) => [r.summary.path, r]))
        setRows((cur) => {
          const next = cur.flatMap((r) => {
            if (!wanted.includes(r.summary.path)) return [r]
            const f = byPath.get(r.summary.path)
            return f ? [f] : []
          })
          const have = new Set(next.map((r) => r.summary.path))
          for (const r of fresh) if (!have.has(r.summary.path)) next.push(r)
          return next
        })
      } catch (e) {
        console.warn('Could not refresh rows:', e)
      }
    }
    const off = api.onChange((e: ChangeEvent) => {
      if (RELOAD_KINDS.has(e.kind)) full = true
      else if (e.kind === 'changed') paths.add(e.path)
      else return
      timer ??= setTimeout(() => void flush(), WINDOW_MS)
    })
    return () => {
      off()
      if (timer) clearTimeout(timer)
    }
  }, [reload])

  const patchRow = useCallback((path: string, row: Row) => {
    setRows((cur) => cur.map((r) => (r.summary.path === path ? row : r)))
  }, [])

  return { rows, loading, reload, patchRow }
}
