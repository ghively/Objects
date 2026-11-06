// M23 Task 8: which Work overlay is open: the focus session (an item) or Make it smaller (a step).
// `WorkOverlays` (T15) draws them; one at a time.
import { create } from 'zustand'

export interface WorkOverlayState {
  session: { path: string } | null
  smaller: { path: string; stepId: string } | null
  openSession(path: string): void
  openSmaller(path: string, stepId: string): void
  close(): void
}

export const useWorkOverlay = create<WorkOverlayState>()((set) => ({
  session: null,
  smaller: null,
  openSession: (path) => set({ session: { path }, smaller: null }),
  openSmaller: (path, stepId) => set({ smaller: { path, stepId }, session: null }),
  close: () => set({ session: null, smaller: null }),
}))
