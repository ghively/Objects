/**
 * Recently opened objects, newest first (max 50). Fed by `useTabs.open` and `usePeek.peek` for
 * objects. A per-viewer convenience kept in localStorage; it never reaches the server.
 */
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

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
