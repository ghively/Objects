/**
 * Which object's Version History dialog is open (M8). Task 3's store, used by the object's `…`
 * menu ("Version History"); Task 5 fills the dialog and may extend this store, keeping these names.
 */
import { create } from 'zustand'

export interface VersionHistoryState {
  /** The object (or board) whose history is shown; null when closed. */
  path: string | null
  open(path: string): void
  close(): void
}

export const useVersionHistory = create<VersionHistoryState>((set) => ({
  path: null,
  open: (path) => set({ path }),
  close: () => set({ path: null }),
}))
