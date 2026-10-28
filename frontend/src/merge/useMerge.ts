/**
 * Which object's (or tag's) "Merge into" dialog is open (M8). Task 3's store, used by the object's
 * `…` menu ("Merge into object" / "Merge into tag"); Task 6 fills the dialog.
 */
import { create } from 'zustand'

export interface MergeState {
  /** The object to merge into another; null when closed. */
  source: string | null
  open(path: string): void
  close(): void
}

export const useMerge = create<MergeState>((set) => ({
  source: null,
  open: (path) => set({ source: path }),
  close: () => set({ source: null }),
}))
