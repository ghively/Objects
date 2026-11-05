// Rows for a scope, kept fresh from change events. Events are batched in one 150 ms window:
// a create, delete, rename, type or collection event reloads everything (value shapes and
// collection-name resolution may have changed); otherwise the changed paths are fetched in ONE
// call and merged in. Other kinds (queries, views, ui) are ignored. M12: when the scope holds a
// type with a rollup, a change to an object that isn't a row of such a type (a related Member of
// a Project, say) reloads everything too, since any rollup may read it.
//
// Rows load without previews (`preview: false`; audit 2026-11-01 P2): the pipeline runs over
// every row, but only a card layout's visible page shows a preview, and `DataView` fetches those
// after (`api.rows({ paths, preview: true })`) and patches them in through `patchRow`.
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/api/client'
import type { ChangeEvent, Row, RowsScope } from '@/api/types'
import { typeOf } from '@/links/linkIndex'

const WINDOW_MS = 150
const RELOAD_KINDS = new Set(['created', 'deleted', 'renamed', 'types', 'collections'])

export interface UseRows {
  rows: Row[]
  loading: boolean
  reload(): Promise<void>
  patchRow(path: string, row: Row): void
}

function hasRollup(typeId: string | null | undefined): boolean {
  return !!typeOf(typeId)?.propertyDefinitions.some((d) => d.type === 'rollup')
}

/** Whether a change to `changed` may alter a rollup shown in `rows` (beyond those rows' own refetch). */
export function rollupsMayChange(scope: RowsScope, rows: Row[], changed: string[]): boolean {
  const rolled = new Set<string>()
  for (const t of scope.typeIds ?? []) if (hasRollup(t)) rolled.add(t)
  for (const r of rows) if (hasRollup(r.summary.type)) rolled.add(r.summary.type)
  if (rolled.size === 0) return false
  const rollupRows = new Set(rows.filter((r) => rolled.has(r.summary.type)).map((r) => r.summary.path))
  return changed.some((p) => !rollupRows.has(p))
}

export function useRows(scope: RowsScope): UseRows {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const key = JSON.stringify(scope)
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const seq = useRef(0)
  const rowsRef = useRef(rows)
  rowsRef.current = rows

  const reload = useCallback(async () => {
    const n = ++seq.current
    try {
      const next = await api.rows({ ...scopeRef.current, preview: false })
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
      if (rollupsMayChange(scopeRef.current, rowsRef.current, changed)) return reload()
      const inScope = scopeRef.current.paths
      const wanted = inScope ? changed.filter((p) => inScope.includes(p)) : changed
      if (wanted.length === 0) return
      const n = seq.current
      try {
        const fresh = await api.rows({ ...scopeRef.current, paths: wanted, preview: false })
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
