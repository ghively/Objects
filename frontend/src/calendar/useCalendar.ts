// The calendar's view and active day. The view is a per-viewer convenience kept in localStorage;
// the anchor is not restored: the calendar always opens on today.
import { useEffect } from 'react'
import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import { reloadUi, useUiStore } from '@/shell/usePinned'
import { addDays, addMonths, addYears, todayYmd, type CalendarView, type Day, type WeekStart } from './dates'

export type StepKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'

export const VIEWS: CalendarView[] = ['month', 'week', 'rolling', 'day']

export interface CalendarState {
  view: CalendarView
  anchor: Day
  setView(view: CalendarView): void
  setAnchor(day: Day): void
  /** The pager: one month (Month), 7 days (Week), one day (Three days, Day). */
  previous(): void
  next(): void
  /** The arrow keys: left/up earlier, right/down later, by the view's unit and higher unit. */
  step(key: StepKey): void
  /** Set the anchor to the viewer's local day. */
  today(): void
}

/** One pager step from `anchor` in `view`, `dir` = ±1. */
export function pagerStep(view: CalendarView, anchor: Day, dir: number): Day {
  if (view === 'month') return addMonths(anchor, dir)
  if (view === 'week') return addDays(anchor, 7 * dir)
  return addDays(anchor, dir)
}

/** The arrow-key step: left/right the view's unit, up/down the next higher unit. */
export function arrowStep(view: CalendarView, anchor: Day, key: StepKey): Day {
  const dir = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1
  const higher = key === 'ArrowUp' || key === 'ArrowDown'
  if (view === 'month') return higher ? addYears(anchor, dir) : addMonths(anchor, dir)
  if (view === 'week') return higher ? addMonths(anchor, dir) : addDays(anchor, 7 * dir)
  return higher ? addDays(anchor, 7 * dir) : addDays(anchor, dir)
}

/** localStorage that never throws (private windows, blocked storage). */
const safeStorage: StateStorage = {
  getItem: (k) => {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  setItem: (k, v) => {
    try {
      localStorage.setItem(k, v)
    } catch {
      /* not saved: a convenience only */
    }
  },
  removeItem: (k) => {
    try {
      localStorage.removeItem(k)
    } catch {
      /* ignore */
    }
  },
}

export const useCalendar = create<CalendarState>()(
  persist(
    (set, get) => ({
      view: 'day',
      anchor: todayYmd(),
      setView: (view) => set({ view }),
      setAnchor: (anchor) => set({ anchor }),
      previous: () => set({ anchor: pagerStep(get().view, get().anchor, -1) }),
      next: () => set({ anchor: pagerStep(get().view, get().anchor, 1) }),
      step: (key) => set({ anchor: arrowStep(get().view, get().anchor, key) }),
      today: () => set({ anchor: todayYmd() }),
    }),
    {
      name: 'object.calendar',
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ view: s.view }),
      merge: (persisted, current) => {
        const p = persisted as Partial<CalendarState> | undefined
        const view = p && VIEWS.includes(p.view as CalendarView) ? (p.view as CalendarView) : current.view
        return { ...current, view, anchor: todayYmd() }
      },
    },
  ),
)

let uiRequested = false

/** `ui.calendar.weekStart` (default Sunday, as the screenshots); loads `ui.json` if nobody has. */
export function useWeekStart(): WeekStart {
  const loaded = useUiStore((s) => s.loaded)
  const ws = useUiStore((s) => s.ui.calendar?.weekStart)
  useEffect(() => {
    if (!loaded && !uiRequested) {
      uiRequested = true
      void reloadUi().finally(() => {
        uiRequested = false
      })
    }
  }, [loaded])
  return ws === 'monday' ? 'monday' : 'sunday'
}
