/**
 * Focus mode ("Enter Focus Mode" / "Leave Focus Mode"; palette
 * "Toggle focus mode") and its timer.
 *
 * `on`, `toggle()`, `enter()` and `leave()` are Task 3's names. While `on`, `FocusMode.tsx` hides
 * the shell's chrome with one stylesheet (nothing else changes, so leaving restores each part
 * exactly as it was) and leaves again with "Focus mode is not available here" when the open tab
 * is not an object (our rule: objects only).
 *
 * The timer is a per-viewer convenience: it is kept in `localStorage` (so it survives a reload)
 * and never writes a file. Presets 15, 25, 45 and 60 minutes are our choice.
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

/** A finished session, shown as "Focus time completed". */
export interface FocusCompleted {
  /** Whole minutes focused; null when under a minute (then `seconds`). */
  minutes: number | null
  seconds: number
}

export interface FocusModeState {
  on: boolean
  toggle(): void
  enter(): void
  leave(): void
  timer: FocusTimer
  /** The last finished session until "Continue". */
  completed: FocusCompleted | null
  /** A transient message ("Focus mode is not available here"). */
  notice: string | null
  startTimer(minutes: number, now?: number): void
  pauseTimer(now?: number): void
  resumeTimer(now?: number): void
  /** Ends the session now and shows how long it ran. */
  stopTimer(now?: number): void
  /** Discards the session without a completion message. */
  cancelTimer(): void
  /** The timer reached zero. */
  finishTimer(): void
  dismissCompleted(): void
  setNotice(text: string | null): void
}

export const NO_TIMER: FocusTimer = Object.freeze({ minutes: null, endsAt: null, pausedLeft: null })

/** Preset durations in minutes (our choice). */
export const FOCUS_PRESETS: readonly number[] = [15, 25, 45, 60]
export const DEFAULT_FOCUS_MINUTES = 25

/** The `localStorage` key holding the running timer. */
export const FOCUS_TIMER_KEY = 'object.focusTimer'

export const FOCUS_TEXT = {
  enter: 'Enter Focus Mode',
  leave: 'Leave Focus Mode',
  unavailable: 'Focus mode is not available here',
  label: 'Focus',
  chooseDuration: 'Choose focus duration',
  preset: (m: number) => `${m} min`,
  idleDuration: (m: number) => `${m} min`,
  prompt: (m: number) => `Focus for ${m} minutes`,
  start: (m: number) => `Start a ${m} minute focus session`,
  running: (time: string) => `${time} remaining`,
  pause: 'Pause timer',
  resume: 'Resume timer',
  stop: 'Stop timer',
  cancel: 'Cancel timer',
  completeTitle: 'Focus time completed',
  completeBody: (m: number) => `You focused for ${m} minutes.`,
  completeBodySeconds: (s: number) => `You focused for ${s} seconds.`,
  continue: 'Continue',
} as const

function isTimer(v: unknown): v is FocusTimer {
  if (!v || typeof v !== 'object') return false
  const t = v as Record<string, unknown>
  const numOrNull = (x: unknown) => x === null || (typeof x === 'number' && Number.isFinite(x))
  return typeof t.minutes === 'number' && t.minutes > 0 && numOrNull(t.endsAt) && numOrNull(t.pausedLeft) && (t.endsAt !== null || t.pausedLeft !== null)
}

/** The stored timer, or `NO_TIMER` (bad, missing or blocked storage). */
export function readStoredTimer(): FocusTimer {
  try {
    const raw = localStorage.getItem(FOCUS_TIMER_KEY)
    if (!raw) return NO_TIMER
    const v: unknown = JSON.parse(raw)
    return isTimer(v) ? { minutes: v.minutes, endsAt: v.endsAt, pausedLeft: v.pausedLeft } : NO_TIMER
  } catch {
    return NO_TIMER
  }
}

function storeTimer(t: FocusTimer) {
  try {
    if (t.minutes === null) localStorage.removeItem(FOCUS_TIMER_KEY)
    else localStorage.setItem(FOCUS_TIMER_KEY, JSON.stringify(t))
  } catch {
    // Blocked storage: the timer still runs for this page.
  }
}

/** Milliseconds left on `t` at `now` (0 when none runs). */
export function timeLeft(t: FocusTimer, now = Date.now()): number {
  if (t.minutes === null) return 0
  if (t.pausedLeft !== null) return Math.max(0, t.pausedLeft)
  if (t.endsAt !== null) return Math.max(0, t.endsAt - now)
  return 0
}

/** `mm:ss` (or `h:mm:ss`) for a remaining time, rounded up to the second. */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const two = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`
}

function completedFor(ms: number): FocusCompleted {
  const seconds = Math.max(0, Math.round(ms / 1000))
  return seconds >= 60 ? { minutes: Math.floor(seconds / 60), seconds } : { minutes: null, seconds }
}

export const useFocusMode = create<FocusModeState>((set, get) => {
  const setTimer = (timer: FocusTimer, extra: Partial<FocusModeState> = {}) => {
    storeTimer(timer)
    set({ timer, ...extra })
  }
  return {
    on: false,
    toggle: () => (get().on ? get().leave() : get().enter()),
    enter: () => set({ on: true }),
    leave: () => set({ on: false }),
    timer: readStoredTimer(),
    completed: null,
    notice: null,

    startTimer(minutes, now = Date.now()) {
      if (!(minutes > 0)) return
      setTimer({ minutes, endsAt: now + minutes * 60_000, pausedLeft: null }, { completed: null })
    },
    pauseTimer(now = Date.now()) {
      const t = get().timer
      if (t.minutes === null || t.endsAt === null) return
      setTimer({ minutes: t.minutes, endsAt: null, pausedLeft: Math.max(0, t.endsAt - now) })
    },
    resumeTimer(now = Date.now()) {
      const t = get().timer
      if (t.minutes === null || t.pausedLeft === null) return
      setTimer({ minutes: t.minutes, endsAt: now + t.pausedLeft, pausedLeft: null })
    },
    stopTimer(now = Date.now()) {
      const t = get().timer
      if (t.minutes === null) return
      const focused = t.minutes * 60_000 - timeLeft(t, now)
      setTimer(NO_TIMER, { completed: completedFor(focused) })
    },
    cancelTimer() {
      setTimer(NO_TIMER)
    },
    finishTimer() {
      const t = get().timer
      if (t.minutes === null) return
      setTimer(NO_TIMER, { completed: { minutes: t.minutes, seconds: t.minutes * 60 } })
    },
    dismissCompleted: () => set({ completed: null }),
    setNotice: (notice) => set({ notice }),
  }
})
