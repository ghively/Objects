/**
 * Object presentation mode ("Present", `EntityMenu.presentationMode.text`). `path`, `start(path)`
 * and `stop()` are Task 3's names, used by the object's `…` menu. The slide index lives here too;
 * the last slide shown is remembered in `localStorage` (a per-viewer convenience) and starting the
 * same object again opens on it (our choice). Nothing here writes a file.
 */
import { create } from 'zustand'

export interface PresentationState {
  /** The object being presented; null when not presenting. */
  path: string | null
  /** The slide shown (0 = the title slide). */
  slide: number
  /** How many slides the presented object has (set by the view once it has loaded). */
  count: number
  start(path: string): void
  stop(): void
  go(index: number): void
  next(): void
  previous(): void
  setCount(count: number): void
}

/** The `localStorage` key holding `{path, slide}` of the last presentation. */
export const LAST_SLIDE_KEY = 'object.presentation.lastSlide'

function readLast(path: string): number {
  try {
    const raw = localStorage.getItem(LAST_SLIDE_KEY)
    if (!raw) return 0
    const v = JSON.parse(raw) as { path?: unknown; slide?: unknown }
    return v.path === path && typeof v.slide === 'number' && Number.isInteger(v.slide) && v.slide > 0 ? v.slide : 0
  } catch {
    return 0
  }
}

function storeLast(path: string, slide: number) {
  try {
    localStorage.setItem(LAST_SLIDE_KEY, JSON.stringify({ path, slide }))
  } catch {
    // Blocked storage: nothing to remember.
  }
}

const clamp = (i: number, count: number) => Math.max(0, Math.min(i, Math.max(0, count - 1)))

export const usePresentation = create<PresentationState>((set, get) => {
  const show = (slide: number) => {
    const { path } = get()
    set({ slide })
    if (path) storeLast(path, slide)
  }
  return {
    path: null,
    slide: 0,
    count: 0,
    start: (path) => set({ path, slide: readLast(path), count: 0 }),
    stop: () => set({ path: null, slide: 0, count: 0 }),
    go: (index) => {
      const { count } = get()
      show(count > 0 ? clamp(index, count) : Math.max(0, index))
    },
    next: () => get().go(get().slide + 1),
    previous: () => get().go(get().slide - 1),
    setCount: (count) => {
      const slide = clamp(get().slide, count)
      set({ count, slide })
    },
  }
})
