// M23 Task 8: the Work section's toasts. Toasts are for problems only (success just happens); the
// one exception is the 5-second Undo toast for Done, Decline and Approve. `WorkToasts.tsx` draws them.
// M32: while Work is off for the space nothing draws them (App mounts `WorkToasts` only when on),
// so none is queued either.
import { create } from 'zustand'
import { isWorkOn } from '../useWorkOn'

/** How long an Undo toast stays (Global Constraints: 5 s). */
export const UNDO_MS = 5000
/** How long a problem toast stays (ours). */
export const PROBLEM_MS = 6000

export interface WorkToastEntry {
  id: number
  text: string
  /** Present on an Undo toast. */
  undo: (() => Promise<unknown>) | null
}

interface WorkToastState {
  toasts: WorkToastEntry[]
}

export const useWorkToasts = create<WorkToastState>()(() => ({ toasts: [] }))

let seq = 0
const timers = new Map<number, ReturnType<typeof setTimeout>>()

function push(text: string, undo: (() => Promise<unknown>) | null, ms: number): number {
  // M32: Work is off for this space: no toast (and no timer) is made.
  if (!isWorkOn()) return 0
  seq += 1
  const id = seq
  useWorkToasts.setState((s) => ({ toasts: [...s.toasts, { id, text, undo }] }))
  timers.set(
    id,
    setTimeout(() => dismissWorkToast(id), ms),
  )
  return id
}

/** Remove one toast (its timer ran out, or its Undo was pressed). */
export function dismissWorkToast(id: number): void {
  const t = timers.get(id)
  if (t !== undefined) clearTimeout(t)
  timers.delete(id)
  useWorkToasts.setState((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }))
}

/** A problem toast. */
export function workToast(text: string): void {
  push(text, null, PROBLEM_MS)
}

/** The Undo toast (`Marked done`, `Declined`, `Approved`) for `UNDO_MS`; Undo runs `undo` once. */
export function undoToast(text: string, undo: () => Promise<unknown>): void {
  push(text, undo, UNDO_MS)
}

/** Press Undo on toast `id`: the toast goes, `undo` runs, a failure becomes a problem toast. */
export async function runUndo(id: number): Promise<void> {
  const entry = useWorkToasts.getState().toasts.find((t) => t.id === id)
  if (!entry?.undo) return
  dismissWorkToast(id)
  try {
    await entry.undo()
  } catch (e) {
    workToast(e instanceof Error && e.message ? e.message : String(e))
  }
}

/** Tests: drop every toast and timer. */
export function resetWorkToasts(): void {
  for (const t of timers.values()) clearTimeout(t)
  timers.clear()
  useWorkToasts.setState({ toasts: [] })
}
