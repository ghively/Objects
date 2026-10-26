// The space's queries for the query UI: lookups, saves that carry the revision they were based
// on, and the pins of a query to a type page or a collection's Overview.
import { useCallback, useMemo } from 'react'
import { api, ConflictError } from '@/api/client'
import type { Collection, DashboardSectionKey, Query, TypeDef, Views } from '@/api/types'
import { saveCollectionEdit } from '@/collections/useCollections'
import { appendSection, buildSections } from '@/types/dashboardSections'
import { reloadDefinitions, useDefinitions, useDefs } from '@/types/useDefinitions'

export interface UseQueries {
  queries: Query[]
  loaded: boolean
  byId(id: string): Query | undefined
  reload(): Promise<void>
}

export function useQueries(): UseQueries {
  const { queries, loaded } = useDefinitions()
  const byId = useCallback((id: string) => queries.find((q) => q.id === id), [queries])
  return useMemo(() => ({ queries, loaded, byId, reload: reloadDefinitions }), [queries, loaded, byId])
}

const latest = (id: string): Query | undefined => useDefs.getState().queries.find((q) => q.id === id)

function adopt(next: Query): void {
  useDefs.setState((s) => ({ queries: s.queries.map((q) => (q.id === next.id ? next : q)) }))
}

// Saves run one after the other, each on the revision the last one returned.
let chain: Promise<unknown> = Promise.resolve()

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = chain.then(job, job)
  chain = run.catch(() => undefined)
  return run
}

/**
 * Save `edit(query)` on the stored query. On a 409 the fresh query is fetched, the edit is
 * applied to it once, and the save is tried again.
 */
export function saveQueryEdit(id: string, edit: (q: Query) => Query): Promise<Query> {
  return enqueue(async () => {
    const cur = latest(id)
    if (!cur) throw new Error('Unknown query')
    let res: { query: Query }
    try {
      res = await api.saveQuery(edit(cur), { baseRevision: cur.revision })
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e
      const fresh = (await api.queries()).find((q) => q.id === id)
      if (!fresh) throw e
      res = await api.saveQuery(edit(fresh), { baseRevision: fresh.revision })
    }
    adopt(res.query)
    return res.query
  })
}

type QueryEdit = (q: Query) => Query
const pending = new Map<string, QueryEdit[]>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const SAVE_DELAY_MS = 300

async function flush(id: string): Promise<void> {
  timers.delete(id)
  const edits = pending.get(id) ?? []
  pending.delete(id)
  if (edits.length === 0) return
  try {
    await saveQueryEdit(id, (q) => edits.reduce((x, e) => e(x), q))
  } catch (e) {
    console.warn('Could not save the query:', e)
  }
}

/** Change a query: applied at once, saved after a short pause (edits are re-applied on a conflict). */
export function editQuery(id: string, edit: QueryEdit): void {
  const cur = latest(id)
  if (!cur || cur.readOnlyReason) return
  adopt(edit(cur))
  pending.set(id, [...(pending.get(id) ?? []), edit])
  const t = timers.get(id)
  if (t) clearTimeout(t)
  timers.set(id, setTimeout(() => void flush(id), SAVE_DELAY_MS))
}

/** Save pending edits now (before navigating away). */
export function flushQuery(id: string): Promise<void> {
  const t = timers.get(id)
  if (t) clearTimeout(t)
  return flush(id)
}

// ---- pins to a type page and to a collection's Overview ----

const sectionKey = (queryId: string): DashboardSectionKey => `query:${queryId}`

/** Whether `views` shows the query as a section. */
export function viewsHaveQuery(views: Views, queryId: string): boolean {
  const key = sectionKey(queryId)
  return views.dashboard.sections.some((s) => s.key === key) && !views.dashboard.removedSections.includes(key)
}

function withQuery(type: TypeDef, views: Views, queryId: string, on: boolean): Views {
  const key = sectionKey(queryId)
  if (on) {
    if (viewsHaveQuery(views, queryId)) return views
    const { collections, queries } = useDefs.getState()
    return appendSection(views, buildSections(type, views, { collections, queries }), key)
  }
  return {
    ...views,
    dashboard: {
      sections: views.dashboard.sections.filter((s) => s.key !== key),
      removedSections: views.dashboard.removedSections.filter((k) => k !== key),
    },
  }
}

/** "Pin to object type" / "Unpin from object type": add or drop the query's section in the type's views. */
export async function setQueryOnType(type: TypeDef, queryId: string, on: boolean): Promise<void> {
  const cur = await api.views(type.id)
  try {
    await api.saveViews(type.id, withQuery(type, cur.views, queryId, on), cur.revision)
  } catch (e) {
    if (!(e instanceof ConflictError)) throw e
    const fresh = await api.views(type.id)
    await api.saveViews(type.id, withQuery(type, fresh.views, queryId, on), fresh.revision)
  }
}

/** The collection's Overview shows the query as a section. */
export const collectionHasQuery = (c: Collection, queryId: string): boolean => viewsHaveQuery(c.views, queryId)

/** "Pin to dashboard" / "Unpin from dashboard": add or drop the query's section in a collection's views. */
export async function setQueryOnCollection(collectionId: string, queryId: string, on: boolean): Promise<void> {
  const key = sectionKey(queryId)
  await saveCollectionEdit(collectionId, (c) => {
    const d = c.views.dashboard
    const sections = d.sections.filter((s) => s.key !== key)
    const removed = d.removedSections.filter((k) => k !== key)
    return {
      ...c,
      views: { ...c.views, dashboard: { ...d, removedSections: removed, sections: on ? [...sections, { key, collapsed: false }] : sections } },
    }
  })
}

/** Delete a query (to the Trash, restorable). Pending edits are dropped, not saved first. */
export async function removeQuery(id: string): Promise<void> {
  const t = timers.get(id)
  if (t) clearTimeout(t)
  timers.delete(id)
  pending.delete(id)
  await api.deleteQuery(id)
}
