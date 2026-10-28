/** Find in page: which object's find bar is open, and its query and options (not persisted). */
import { create } from 'zustand'

export interface FindState {
  /** The object whose find bar is open, or null. */
  path: string | null
  /** The text being searched for; kept between openings, like a browser's find. */
  query: string
  /** "Match case". */
  matchCase: boolean
  /** "Match whole word". */
  wholeWord: boolean
  /** The replace row is shown ("Toggle replace"). */
  replaceOpen: boolean
  /** Bumped by every `open`, so opening an already open bar focuses its input again. */
  focusTick: number
  open(path: string): void
  close(): void
  setQuery(query: string): void
  setOptions(opts: Partial<Pick<FindState, 'matchCase' | 'wholeWord'>>): void
  toggleReplace(): void
}

export const useFind = create<FindState>()((set) => ({
  path: null,
  query: '',
  matchCase: false,
  wholeWord: false,
  replaceOpen: false,
  focusTick: 0,
  open(path) {
    set((s) => ({ path, focusTick: s.focusTick + 1 }))
  },
  close() {
    set({ path: null })
  },
  setQuery(query) {
    set({ query })
  },
  setOptions(opts) {
    set(opts)
  },
  toggleReplace() {
    set((s) => ({ replaceOpen: !s.replaceOpen }))
  },
}))
