/** Find in page: which object's find bar is open (not persisted). */
import { create } from 'zustand'

export interface FindState {
  /** The object whose find bar is open, or null. */
  path: string | null
  open(path: string): void
  close(): void
}

export const useFind = create<FindState>()((set) => ({
  path: null,
  open(path) {
    set({ path })
  },
  close() {
    set({ path: null })
  },
}))
