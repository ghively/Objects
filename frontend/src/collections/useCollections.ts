// The space's collections for the collection UI: lookups, and saves that carry the revision a
// save was based on. Reloaded on `collections` events (through the shared definitions store).
import { useCallback, useMemo } from 'react'
import { api, ConflictError } from '@/api/client'
import type { Collection, SaveCollectionResult, Views } from '@/api/types'
import { reloadDefinitions, useDefinitions, useDefs } from '@/types/useDefinitions'

export interface UseCollections {
  collections: Collection[]
  loaded: boolean
  byId(id: string): Collection | undefined
  /** By name, then by former name, case-insensitively (as the server resolves `collections:`). */
  byName(name: string): Collection | undefined
  reload(): Promise<void>
}

export function findByName(collections: Collection[], name: string): Collection | undefined {
  const n = name.trim().toLowerCase()
  return (
    collections.find((c) => c.name.toLowerCase() === n) ??
    collections.find((c) => c.formerNames.some((f) => f.toLowerCase() === n))
  )
}

export function useCollections(): UseCollections {
  const { collections, loaded } = useDefinitions()
  const byId = useCallback((id: string) => collections.find((c) => c.id === id), [collections])
  const byName = useCallback((name: string) => findByName(collections, name), [collections])
  return useMemo(() => ({ collections, loaded, byId, byName, reload: reloadDefinitions }), [collections, loaded, byId, byName])
}

const latest = (id: string): Collection | undefined => useDefs.getState().collections.find((c) => c.id === id)

function adopt(next: Collection): void {
  useDefs.setState((s) => ({ collections: s.collections.map((c) => (c.id === next.id ? next : c)) }))
}

// Saves of the same collection run one after the other, each on the revision the last one returned.
let chain: Promise<unknown> = Promise.resolve()

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = chain.then(job, job)
  chain = run.catch(() => undefined)
  return run
}

/**
 * Save `edit(collection)` on the stored collection. On a 409 the fresh collection is fetched, the
 * edit is applied to it once, and the save is tried again. Resolves with the server's result.
 */
export function saveCollectionEdit(id: string, edit: (c: Collection) => Collection): Promise<SaveCollectionResult> {
  return enqueue(async () => {
    const cur = latest(id)
    if (!cur) throw new Error('Unknown collection')
    let res: SaveCollectionResult
    try {
      res = await api.saveCollection(edit(cur), { baseRevision: cur.revision })
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e
      const fresh = (await api.collections()).find((c) => c.id === id)
      if (!fresh) throw e
      res = await api.saveCollection(edit(fresh), { baseRevision: fresh.revision })
    }
    adopt(res.collection)
    return res
  })
}

type ViewsEdit = (v: Views) => Views
const pending = new Map<string, ViewsEdit[]>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const SAVE_DELAY_MS = 300

async function flushViews(id: string): Promise<void> {
  timers.delete(id)
  const edits = pending.get(id) ?? []
  pending.delete(id)
  if (edits.length === 0) return
  try {
    await saveCollectionEdit(id, (c) => ({ ...c, views: edits.reduce((v, e) => e(v), c.views) }))
  } catch (e) {
    console.warn('Could not save the collection views:', e)
  }
}

/** Change a collection's views: applied at once, saved after a short pause (edits are re-applied on a conflict). */
export function editCollectionViews(id: string, edit: ViewsEdit): void {
  const cur = latest(id)
  if (!cur) return
  adopt({ ...cur, views: edit(cur.views) })
  pending.set(id, [...(pending.get(id) ?? []), edit])
  const t = timers.get(id)
  if (t) clearTimeout(t)
  timers.set(id, setTimeout(() => void flushViews(id), SAVE_DELAY_MS))
}

/** Save pending view edits now (before navigating away). */
export function flushCollectionViews(id: string): Promise<void> {
  const t = timers.get(id)
  if (t) clearTimeout(t)
  return flushViews(id)
}
