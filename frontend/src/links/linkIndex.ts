/**
 * A small client-side index of the space's types and object summaries, used to
 * label tabs, colour wikilink chips by their target's type and feed the link
 * picker. Link resolution itself stays on the back end (`api.resolve`), which
 * owns the deterministic tie-break rules; results are cached per (from, link).
 */
import { create } from 'zustand'
import { api } from '@/api/client'
import type { ObjectSummary, TypeDef } from '@/api/types'

export interface LinkIndexState {
  types: TypeDef[]
  objects: ObjectSummary[]
  /** Bumped whenever the index or the resolution cache changes. */
  revision: number
  loaded: boolean
  load(): Promise<void>
}

let loading: Promise<void> | null = null
/** Bumped by each fetch and by a reset: only the latest fetch's answer is applied. */
let generation = 0
const resolutions = new Map<string, Promise<string | null>>()

/** A fresh fetch of types and summaries; a superseded one waits for the newer fetch instead. */
function fetchIndex(): Promise<void> {
  const gen = ++generation
  const p: Promise<void> = Promise.all([api.space(), api.objects()])
    .then(([space, objects]): Promise<void> | void => {
      if (gen !== generation) return loading ?? undefined
      resolutions.clear()
      const s = useLinkIndex.getState()
      useLinkIndex.setState({ types: space.types, objects, loaded: true, revision: s.revision + 1 })
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

/** Drop cached resolutions and reload summaries (call after objects are created, renamed or deleted). */
export function invalidateLinkIndex(): Promise<void> {
  resolutions.clear()
  useLinkIndex.setState((s) => ({ loaded: false, revision: s.revision + 1 }))
  // A load already in flight may predate the change: fetch again rather than join it.
  return fetchIndex()
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
  return useLinkIndex.getState().objects.find((o) => o.path === path)
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
