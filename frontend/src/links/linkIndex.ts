/**
 * A small client-side index of the space's types and object summaries, used to
 * label tabs, colour wikilink chips by their target's type and feed the link
 * picker. Link resolution itself stays on the back end (`api.resolve`), which
 * owns the deterministic tie-break rules; results are cached per (from, link).
 *
 * A `changed` event refreshes only that object's summary (`refreshLinkIndex`, one `/api/rows`
 * call for the paths); the whole list is fetched again only when objects are created, deleted,
 * renamed or a type changes (`invalidateLinkIndex`).
 */
import { create } from 'zustand'
import { api } from '@/api/client'
import type { ObjectSummary, TypeDef } from '@/api/types'
import { fetchSpace } from '@/settings/useSpaceInfo'

export interface LinkIndexState {
  types: TypeDef[]
  objects: ObjectSummary[]
  /** Bumped whenever the index or the resolution cache changes. */
  revision: number
  loaded: boolean
  load(): Promise<void>
}

let loading: Promise<void> | null = null
/** Bumped by each full fetch and by a reset: only the latest fetch's answer is applied. */
let generation = 0
const resolutions = new Map<string, Promise<string | null>>()

interface Lookup {
  byPath: Map<string, ObjectSummary>
  byId: Map<string, ObjectSummary>
}

/** Per `objects` array (built once, kept with it), so lookups by path or id are O(1). */
const lookups = new WeakMap<ObjectSummary[], Lookup>()

function lookup(objects: ObjectSummary[]): Lookup {
  let l = lookups.get(objects)
  if (!l) {
    l = { byPath: new Map(), byId: new Map() }
    for (const o of objects) {
      l.byPath.set(o.path, o)
      if (o.id) l.byId.set(o.id, o)
    }
    lookups.set(objects, l)
  }
  return l
}

/** `objects` by path; the same Map for the same array (use as a selector: `useLinkIndex((s) => byPathOf(s.objects))`). */
export const byPathOf = (objects: ObjectSummary[]): ReadonlyMap<string, ObjectSummary> => lookup(objects).byPath

/** `objects` by id (pins), the same Map for the same array. */
export const byIdOf = (objects: ObjectSummary[]): ReadonlyMap<string, ObjectSummary> => lookup(objects).byId

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/** A fresh fetch of types and summaries; a superseded one waits for the newer fetch instead. */
function fetchIndex(): Promise<void> {
  const gen = ++generation
  const p: Promise<void> = Promise.all([fetchSpace(), api.objects()])
    .then(([space, objects]): Promise<void> | void => {
      if (gen !== generation) return loading ?? undefined
      resolutions.clear()
      const s = useLinkIndex.getState()
      // Unchanged types keep their array, so what is memoised on it (the graph's colours) holds.
      const types = sameJson(s.types, space.types) ? s.types : space.types
      useLinkIndex.setState({ types, objects, loaded: true, revision: s.revision + 1 })
    })
    .catch(() => {
      // Leave the index empty; links render unresolved and the next load retries.
    })
    .finally(() => {
      if (loading === p) loading = null
    })
  loading = p
  return p
}

export const useLinkIndex = create<LinkIndexState>()(() => ({
  types: [],
  objects: [],
  revision: 0,
  loaded: false,
  load() {
    return loading ?? fetchIndex()
  },
}))

/** Forget everything (tests; or after the space changes wholesale). */
export function resetLinkIndex(): void {
  resolutions.clear()
  loading = null
  generation++
  useLinkIndex.setState({ types: [], objects: [], loaded: false, revision: 0 })
}

/** Drop cached resolutions and reload summaries and types (objects created, renamed or deleted; a type changed). */
export function invalidateLinkIndex(): Promise<void> {
  resolutions.clear()
  // A load already in flight may predate the change: fetch again rather than join it. What is
  // shown stays until the answer (`loaded` is not flipped: nothing must blank or refetch meanwhile).
  return fetchIndex()
}

/**
 * Objects changed in place (a body or property save, a title edit): fetch just their summaries
 * and splice them in. A full fetch started since covers them and wins.
 */
export function refreshLinkIndex(paths: string[]): Promise<void> {
  if (paths.length === 0) return Promise.resolve()
  resolutions.clear()
  const gen = generation
  return api
    .rows({ paths, preview: false })
    .then((rows) => {
      if (gen !== generation || rows.length === 0) return
      const s = useLinkIndex.getState()
      const fresh = new Map(rows.map((r) => [r.summary.path, r.summary]))
      let changed = false
      const objects = s.objects.map((o) => {
        const n = fresh.get(o.path)
        if (!n || sameJson(o, n)) return o
        changed = true
        return n
      })
      // An object the index has not seen (its `created` was missed) joins it.
      const known = byPathOf(s.objects)
      for (const [path, summary] of fresh) {
        if (known.has(path)) continue
        objects.push(summary)
        changed = true
      }
      if (!changed) return
      useLinkIndex.setState({ objects, revision: s.revision + 1 })
    })
    .catch(() => {
      // The next event or full fetch brings the summary.
    })
}

export async function ensureLinkIndex(): Promise<void> {
  if (!useLinkIndex.getState().loaded) await useLinkIndex.getState().load()
}

/** The path a `[[link]]` written in `from` points at, or null when nothing matches. */
export function resolveLink(link: string, from?: string): Promise<string | null> {
  const key = `${from ?? ''}\u0000${link}`
  let p = resolutions.get(key)
  if (!p) {
    p = api.resolve(link, from).catch(() => null)
    resolutions.set(key, p)
  }
  return p
}

export function summaryOf(path: string): ObjectSummary | undefined {
  return byPathOf(useLinkIndex.getState().objects).get(path)
}

export function typeOf(typeId: string | undefined | null): TypeDef | undefined {
  if (!typeId) return undefined
  return useLinkIndex.getState().types.find((t) => t.id === typeId)
}

/** A display title for a path when its summary isn't loaded: the file stem. */
export function stemOf(path: string): string {
  const name = path.split('/').pop() ?? path
  return name.replace(/\.md$/i, '')
}
