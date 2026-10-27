/**
 * "Add to whiteboard" (`Whiteboard.addTo.action`): pick a board and add the object to it (M8 Task 22
 * fills the dialog). `useAddToWhiteboard` is real; Task 3's dialog stub renders nothing. Mounted
 * once in `shell/GlobalOverlays.tsx`.
 */
import { create } from 'zustand'

export interface AddToWhiteboardState {
  /** The object to add; null when closed. */
  objectPath: string | null
  open(path: string): void
  close(): void
}

export const useAddToWhiteboard = create<AddToWhiteboardState>((set) => ({
  objectPath: null,
  open: (path) => set({ objectPath: path }),
  close: () => set({ objectPath: null }),
}))

export function AddToWhiteboardDialog() {
  useAddToWhiteboard((s) => s.objectPath)
  return null
}

export default AddToWhiteboardDialog
