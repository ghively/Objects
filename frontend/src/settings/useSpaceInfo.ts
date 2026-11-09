// The current space's `GET /api/space` info, shared by the Settings modal (Space Settings, Object
// Types, Task management), the Tasks dashboard (task lists left out while `hideTaskManagement`) and anything
// else that shows the space's name or icon. `patch` writes `space.json` through `PUT /api/space`:
// applied at once, saved after the patches before it with the latest revision; on a 409 the fresh
// info is fetched and the same patch re-applied once (never a blind overwrite).
import { create } from 'zustand'
import { api, ConflictError } from '@/api/client'
import type { SpaceInfo, SpacePatch } from '@/api/types'

export interface SpaceInfoState {
  space: SpaceInfo | null
  loaded: boolean
  load(): Promise<void>
  /** Load once (the first caller); later calls return the same promise. */
  ensure(): Promise<void>
  patch(patch: SpacePatch): Promise<void>
}

let loading: Promise<void> | null = null
let inFlight: Promise<SpaceInfo> | null = null
let queue: Promise<void> = Promise.resolve()

function titled(s: SpaceInfo): SpaceInfo {
  if (typeof document !== 'undefined' && s.name) document.title = `${s.name} · Object`
  return s
}

/**
 * `GET /api/space`, shared by everyone asking while one is in flight (App's start-up, the link
 * index, `ensure`), so a start makes one request instead of three. The answer updates the store.
 */
export function fetchSpace(): Promise<SpaceInfo> {
  if (inFlight) return inFlight
  const p = api
    .space()
    .then((s) => {
      if (s) useSpaceInfo.setState({ space: s, loaded: true })
      return s
    })
    .finally(() => {
      if (inFlight === p) inFlight = null
    })
  inFlight = p
  return p
}

export const useSpaceInfo = create<SpaceInfoState>()((set, get) => ({
  space: null,
  loaded: false,

  async load() {
    try {
      const s = await fetchSpace()
      if (!s) set({ loaded: true })
    } catch {
      set({ loaded: true })
    }
  },

  ensure() {
    if (get().loaded) return Promise.resolve()
    loading ??= get()
      .load()
      .finally(() => {
        loading = null
      })
    return loading
  },

  patch(patch) {
    const cur = get().space
    if (cur) set({ space: { ...cur, ...patch } })
    const send = async () => {
      const base = get().space?.revision ?? ''
      let res: SpaceInfo
      try {
        res = await api.patchSpace(patch, { baseRevision: base })
      } catch (e) {
        if (!(e instanceof ConflictError)) throw e
        const fresh = await api.space()
        set({ space: { ...fresh, ...patch } })
        res = await api.patchSpace(patch, { baseRevision: fresh?.revision ?? '' })
      }
      const prev = get().space
      // The server answers with the whole SpaceInfo; keep the types we had if it left them out.
      set({ space: titled({ ...(prev ?? res), ...res, types: res?.types ?? prev?.types ?? [] }), loaded: true })
    }
    const done = queue.then(send)
    queue = done.catch(() => undefined)
    return done.catch(async (e: unknown) => {
      // A refused patch (422, 423) shows the stored values again.
      await get().load()
      throw e
    })
  },
}))

/** Forget the loaded info (tests). */
export function resetSpaceInfo(): void {
  loading = null
  inFlight = null
  queue = Promise.resolve()
  useSpaceInfo.setState({ space: null, loaded: false })
}
