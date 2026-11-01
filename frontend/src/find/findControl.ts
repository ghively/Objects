/**
 * Which `FindControl`s are raw mode's. Kept apart from `rawFind.ts` so the find bar (in the
 * entry chunk) can ask without pulling CodeMirror in: raw mode and its adapter load on demand
 * (audit 2026-11-01 F1).
 */
import type { FindControl } from '@/editor/extensions/findInPage'

/** Registered by `createRawFind` for each raw-mode control it makes. */
export const RAW_CONTROLS = new WeakSet<FindControl>()

/** Whether `control` is raw mode's (the find bar re-binds when the editor switches mode). */
export function isRawFindControl(control: FindControl | undefined): boolean {
  return !!control && RAW_CONTROLS.has(control)
}
