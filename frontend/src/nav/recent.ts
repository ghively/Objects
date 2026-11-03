/**
 * Recently opened objects, newest first (max 50). Fed by `useTabs.open` and `usePeek.peek` for
 * objects. A per-viewer convenience kept in localStorage, one list per space; it never reaches the server.
 * `openedAt` holds when each was last opened (ms), for the search palette's Today / Earlier groups;
 * entries stored before it existed have no time.
 */
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { followStorage, switchStoreSpace } from './spaceStorage'

export const RECENT_LIMIT = 50

export interface RecentState {
  paths: string[]
  /** When each path in `paths` was last opened (epoch ms); missing for older entries. */
  openedAt: Record<string, number>
  add(path: string): void
  /** An object moved: keep its place in the list. */
  retarget(oldPath: string, newPath: string): void
  clear(): void
}

export const useRecent = create<RecentState>()(
  persist(
    (set, get) => ({
      paths: [],
      openedAt: {},
      add(path) {
        const cur = get().paths
        const paths = cur[0] === path ? cur : [path, ...cur.filter((p) => p !== path)].slice(0, RECENT_LIMIT)
        set({ paths, openedAt: keepTimes({ ...get().openedAt, [path]: Date.now() }, paths) })
      },
      retarget(oldPath, newPath) {
        if (oldPath === newPath) return
        const cur = get().paths
        if (!cur.includes(oldPath)) return
        const moved = cur.map((p) => (p === oldPath ? newPath : p))
        const paths = moved.filter((p, i) => moved.indexOf(p) === i)
        const at = { ...get().openedAt }
        const t = at[oldPath]
        delete at[oldPath]
        if (t !== undefined) at[newPath] = Math.max(t, at[newPath] ?? 0)
        set({ paths, openedAt: keepTimes(at, paths) })
      },
      clear() {
        set({ paths: [], openedAt: {} })
      },
    }),
    {
      name: 'object.recent',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ paths: s.paths, openedAt: s.openedAt }),
      merge: (persisted, current) => {
        const p = persisted as Partial<RecentState> | undefined
        const paths = (Array.isArray(p?.paths) ? p.paths.filter((x): x is string => typeof x === 'string') : []).slice(0, RECENT_LIMIT)
        return { ...current, paths, openedAt: keepTimes(times(p?.openedAt), paths) }
      },
    },
  ),
)

/**
 * Keep this space's recent list under `object.recent:<root>` (the old global `object.recent` is
 * migrated into the first space once and deleted). `null` goes back to the global key (tests).
 */
export function setRecentSpace(root: string | null): Promise<void> {
  return switchStoreSpace(useRecent, 'object.recent', root, { paths: [], openedAt: {} })
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/** The valid `path -> ms` entries of a stored `openedAt`. */
function times(v: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (!v || typeof v !== 'object') return out
  for (const [k, t] of Object.entries(v as Record<string, unknown>)) if (typeof t === 'number' && Number.isFinite(t)) out[k] = t
  return out
}

/** `t` cut down to the paths still listed. */
function keepTimes(t: Record<string, number>, paths: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const p of paths) if (t[p] !== undefined) out[p] = t[p]
  return out
}

/**
 * Another window of this space wrote its recent list: what it opened since its last read (in
 * `incoming`, not in `previous`) goes in front of ours, the rest of its list after ours, with no
 * duplicates. Each window writes the whole list, so without this the other window's opens were lost.
 */
export function mergeRecentFromStorage(
  incoming: unknown,
  previous: unknown,
  current: Pick<RecentState, 'paths'> & Partial<Pick<RecentState, 'openedAt'>>,
): Pick<RecentState, 'paths' | 'openedAt'> | null {
  const inc = incoming as Partial<RecentState> | null
  if (!inc || !Array.isArray(inc.paths)) return null
  const theirs = strings(inc.paths)
  const before = new Set(strings((previous as Partial<RecentState> | null)?.paths))
  const fresh = theirs.filter((p) => !before.has(p))
  const paths = [...fresh, ...current.paths, ...theirs].filter((p, i, all) => all.indexOf(p) === i).slice(0, RECENT_LIMIT)
  // Open times: the later of the two windows' for each path.
  const ours = keepTimes(current.openedAt ?? {}, paths)
  const merged = { ...(current.openedAt ?? {}) }
  for (const [p, t] of Object.entries(times(inc.openedAt))) merged[p] = Math.max(t, merged[p] ?? 0)
  const openedAt = keepTimes(merged, paths)
  const samePaths = paths.length === current.paths.length && paths.every((p, i) => p === current.paths[i])
  if (samePaths && JSON.stringify(openedAt) === JSON.stringify(ours)) return null
  return { paths, openedAt }
}

followStorage(useRecent, mergeRecentFromStorage)
