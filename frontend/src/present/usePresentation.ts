/**
 * Object presentation mode ("Present", `EntityMenu.presentationMode.text`). Task 3's store, used by
 * the object's `…` menu; Task 9 fills the slides, keeping these names.
 */
import { create } from 'zustand'

export interface PresentationState {
  /** The object being presented; null when not presenting. */
  path: string | null
  start(path: string): void
  stop(): void
}

export const usePresentation = create<PresentationState>((set) => ({
  path: null,
  start: (path) => set({ path }),
  stop: () => set({ path: null }),
}))
