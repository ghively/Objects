// The save state of each open note, by path, published by the editor (M32) so the note page can
// show "Saving…" / "Saved" without reaching into the editor. Lane A sets it; lane E reads it.
import { create } from 'zustand'
import type { SaveState } from './useAutosave'

interface SaveStates {
  byPath: Record<string, SaveState>
}

const useStore = create<SaveStates>(() => ({ byPath: {} }))

/** Publish `state` for the note at `path` (the editor calls this as its autosave state changes). */
export function setSaveState(path: string, state: SaveState): void {
  if (useStore.getState().byPath[path] === state) return
  useStore.setState((s) => ({ byPath: { ...s.byPath, [path]: state } }))
}

/** Forget the note at `path` (its editor went away). */
export function clearSaveState(path: string): void {
  if (!(path in useStore.getState().byPath)) return
  useStore.setState((s) => {
    const next = { ...s.byPath }
    delete next[path]
    return { byPath: next }
  })
}

/** The save state of the note at `path`; 'saved' when no editor has published one. */
export function useSaveState(path: string): SaveState {
  return useStore((s) => s.byPath[path] ?? 'saved')
}
