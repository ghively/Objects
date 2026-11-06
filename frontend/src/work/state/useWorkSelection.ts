// M23 Task 8: the Work page's keyboard selection (`j`/`k` move, Enter opens, `[`/`]` step items).
// The list is the paths the current view shows, in order; the selection follows its path.
import { create } from 'zustand'

export interface WorkSelectionState {
  list: string[]
  /** -1: nothing selected (an empty list). */
  index: number
  /** A new list: the selected path keeps its selection when it is still there, else the first row. */
  setList(paths: string[]): void
  /** Move by `delta`, kept inside the list. */
  move(delta: number): void
  selected(): string | null
}

export const useWorkSelection = create<WorkSelectionState>()((set, get) => ({
  list: [],
  index: -1,
  setList(paths) {
    const cur = get().selected()
    const at = cur === null ? -1 : paths.indexOf(cur)
    set({ list: [...paths], index: at >= 0 ? at : paths.length ? 0 : -1 })
  },
  move(delta) {
    const { list, index } = get()
    if (!list.length) return
    const next = Math.min(list.length - 1, Math.max(0, (index < 0 ? 0 : index) + delta))
    if (next !== index) set({ index: next })
  },
  selected() {
    const { list, index } = get()
    return index >= 0 && index < list.length ? list[index] : null
  },
}))
