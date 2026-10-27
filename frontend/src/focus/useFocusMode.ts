/**
 * Focus mode ("Enter Focus Mode" / "Leave Focus Mode", `ComponentHeader.focusMode.*`; palette
 * "Toggle focus mode"). Task 3's store: `on` and `toggle()` are real; Task 9 hides and restores the
 * chrome and fills the timer, keeping these names.
 */
import { create } from 'zustand'

export interface FocusTimer {
  /** The chosen duration in minutes, or null when no timer runs. */
  minutes: number | null
  /** `Date.now()` at which the timer ends (null when none runs or it is paused). */
  endsAt: number | null
  /** Milliseconds left while paused. */
  pausedLeft: number | null
}

export interface FocusModeState {
  on: boolean
  toggle(): void
  enter(): void
  leave(): void
  timer: FocusTimer
}

export const NO_TIMER: FocusTimer = Object.freeze({ minutes: null, endsAt: null, pausedLeft: null })

export const useFocusMode = create<FocusModeState>((set, get) => ({
  on: false,
  toggle: () => (get().on ? get().leave() : get().enter()),
  enter: () => set({ on: true }),
  leave: () => set({ on: false }),
  timer: NO_TIMER,
}))
