/**
 * Recently opened objects, newest first (max 50). Fed by `useTabs.open` and `usePeek.peek` for
 * objects. A per-viewer convenience kept in localStorage, one list per space; it never reaches the server.
 */
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { followStorage, switchStoreSpace } from './spaceStorage'

export const RECENT_LIMIT = 50

export interface RecentState {
  paths: string[]
  add(path: string): void
  /** An object moved: keep its place in the list. */
  retarget(oldPath: string, newPath: string): void
  clear(): void
}

export const useRecent = create<RecentState>()(
  persist(
    (set, get) => ({
      paths: [],
      add(path) {
        const cur = get().paths
        if (cur[0] === path) return
        set({ paths: [path, ...cur.filter((p) => p !== path)].slice(0, RECENT_LIMIT) })
      },
      retarget(oldPath, newPath) {
        if (oldPath === newPath) return
        const cur = get().paths
        if (!cur.includes(oldPath)) return
        const moved = cur.map((p) => (p === oldPath ? newPath : p))
        set({ paths: moved.filter((p, i) => moved.indexOf(p) === i) })
      },
      clear() {
        set({ paths: [] })
      },
    }),
    {
      name: 'object.recent',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ paths: s.paths }),
      merge: (persisted, current) => {
        const p = persisted as Partial<RecentState> | undefined
        const paths = Array.isArray(p?.paths) ? p.paths.filter((x): x is string => typeof x === 'string') : []
        return { ...current, paths: paths.slice(0, RECENT_LIMIT) }
      },
    },
  ),
)

/**
 * Keep this space's recent list under `object.recent:<root>` (the old global `object.recent` is
 * migrated into the first space once and deleted). `null` goes back to the global key (tests).
 */
export function setRecentSpace(root: string | null): Promise<void> {
  return switchStoreSpace(useRecent, 'object.recent', root, { paths: [] })
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/**
 * Another window of this space wrote its recent list: what it opened since its last read (in
 * `incoming`, not in `previous`) goes in front of ours, the rest of its list after ours, with no
 * duplicates. Each window writes the whole list, so without this the other window's opens were lost.
 */
export function mergeRecentFromStorage(incoming: unknown, previous: unknown, current: Pick<RecentState, 'paths'>): Pick<RecentState, 'paths'> | null {
  const inc = incoming as Partial<RecentState> | null
  if (!inc || !Array.isArray(inc.paths)) return null
  const theirs = strings(inc.paths)
  const before = new Set(strings((previous as Partial<RecentState> | null)?.paths))
  const fresh = theirs.filter((p) => !before.has(p))
  const paths = [...fresh, ...current.paths, ...theirs].filter((p, i, all) => all.indexOf(p) === i).slice(0, RECENT_LIMIT)
  if (paths.length === current.paths.length && paths.every((p, i) => p === current.paths[i])) return null
  return { paths }
}

followStorage(useRecent, mergeRecentFromStorage)
