// The save state of each open note, by path, published by the editor (M32) so the note page can
// show "Saving…" / "Saved" without reaching into the editor. Lane A sets it; lane E reads it.
import { create } from 'zustand'
import type { SaveState } from './useAutosave'

interface SaveStates {
  byPath: Record<string, SaveState>
  /** M32 (W1): the same for each note's title: typed and waiting, being renamed, refused. */
  titleByPath: Record<string, SaveState>
}

const useStore = create<SaveStates>(() => ({ byPath: {}, titleByPath: {} }))

/** The busier of two states says more: a save running, then one waiting, then a failure. */
const RANK: Record<SaveState, number> = { saved: 0, error: 1, unsaved: 2, saving: 3 }

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

/** Publish the save state of the title of the note at `path` (its view calls this). */
export function setTitleSaveState(path: string, state: SaveState): void {
  if (useStore.getState().titleByPath[path] === state) return
  useStore.setState((s) => ({ titleByPath: { ...s.titleByPath, [path]: state } }))
}

/** Forget the title state of the note at `path` (its view went away, or the note moved). */
export function clearTitleSaveState(path: string): void {
  if (!(path in useStore.getState().titleByPath)) return
  useStore.setState((s) => {
    const next = { ...s.titleByPath }
    delete next[path]
    return { titleByPath: next }
  })
}

/** The title state published for `path`, or undefined. */
export function titleSaveState(path: string): SaveState | undefined {
  return useStore.getState().titleByPath[path]
}

/**
 * The save state of the note at `path`, its text and its title together (the busier of the two);
 * 'saved' when nothing has been published.
 */
export function useSaveState(path: string): SaveState {
  return useStore((s) => {
    const body = s.byPath[path] ?? 'saved'
    const title = s.titleByPath[path] ?? 'saved'
    return RANK[title] > RANK[body] ? title : body
  })
}
