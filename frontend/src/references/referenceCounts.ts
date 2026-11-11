// What a note's references section knows, for the quiet count beside the note's header (the M32
// walk's W10): how many backlinks and unlinked mentions it shows, published by path so the header
// reads the numbers the section already fetched (no second request), and the way back: the header
// asks the section to open a tab and bring itself into view.
import { create } from 'zustand'
import type { ReferencesTab } from '@/api/types'

/** The tabs the header counts. */
export type CountedTab = Extract<ReferencesTab, 'backlinks' | 'mentions'>

/** The numbers of one note's section; a tab the section does not show (hidden in Settings) is 0. */
export interface ReferenceCountsOf {
  backlinks: number
  mentions: number
}

interface State {
  byPath: Record<string, ReferenceCountsOf>
  /** The last tab asked for (`n` tells one ask from the next). */
  ask: { path: string; tab: CountedTab; n: number } | null
}

const useStore = create<State>(() => ({ byPath: {}, ask: null }))

/** Publish the counts of the note at `path` (its references section calls this). */
export function publishReferenceCounts(path: string, counts: ReferenceCountsOf): void {
  const now = useStore.getState().byPath[path]
  if (now && now.backlinks === counts.backlinks && now.mentions === counts.mentions) return
  useStore.setState((s) => ({ byPath: { ...s.byPath, [path]: counts } }))
}

/** Forget the counts of the note at `path` (its section went away). */
export function clearReferenceCounts(path: string): void {
  if (!(path in useStore.getState().byPath)) return
  useStore.setState((s) => {
    const next = { ...s.byPath }
    delete next[path]
    return { byPath: next }
  })
}

/** The counts of the note at `path`, or null while no section has published any. */
export function useReferenceCounts(path: string): ReferenceCountsOf | null {
  return useStore((s) => s.byPath[path] ?? null)
}

/** Ask the references section of the note at `path` to open `tab` and scroll into view. */
export function askForReferencesTab(path: string, tab: CountedTab): void {
  useStore.setState((s) => ({ ask: { path, tab, n: (s.ask?.n ?? 0) + 1 } }))
}

/** The tab last asked for on the note at `path` (a new object for each ask), or null. */
export function useReferencesTabAsk(path: string): { tab: CountedTab; n: number } | null {
  const ask = useStore((s) => s.ask)
  return ask && ask.path === path ? ask : null
}
