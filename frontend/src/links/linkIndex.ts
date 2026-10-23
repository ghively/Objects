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
const resolutions = new Map<string, Promise<string | null>>()

export const useLinkIndex = create<LinkIndexState>()((set, get) => ({
  types: [],
  objects: [],
  revision: 0,
  loaded: false,
  load() {
    loading ??= Promise.all([api.space(), api.objects()])
      .then(([space, objects]) => {
        resolutions.clear()
        set({ types: space.types, objects, loaded: true, revision: get().revision + 1 })
      })
      .catch(() => {
        // Leave the index empty; links render unresolved and the next load retries.
      })
      .finally(() => {
        loading = null
      })
    return loading
  },
}))

/** Forget everything (tests; or after the space changes wholesale). */
export function resetLinkIndex(): void {
  resolutions.clear()
  loading = null
  useLinkIndex.setState({ types: [], objects: [], loaded: false, revision: 0 })
}

/** Drop cached resolutions and reload summaries (call after objects are created, renamed or deleted). */
export function invalidateLinkIndex(): Promise<void> {
  resolutions.clear()
  useLinkIndex.setState((s) => ({ loaded: false, revision: s.revision + 1 }))
  return useLinkIndex.getState().load()
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
