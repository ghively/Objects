/**
 * M32: what a note's view leaves for the view that replaces it when its own rename moves the file.
 *
 * The page and the peek are keyed by the note's path, so a rename that changes the file name
 * replaces the view and its editor. Enter in the title puts the caret in the body at once, so by
 * the time the rename answers there may be a caret there and words typed meanwhile. The leaving
 * view hands over the note as it stands (nothing to load again: no moment without an editor), the
 * caret, and the text its editor had not saved; the view that mounts on the new path shows it all
 * in its first render and saves the text itself.
 *
 * Kept by the new path, read while rendering (`peek`, safe to call twice) and dropped once the
 * new view has mounted; an entry nobody took within a few seconds is ignored.
 */
import type { ObjectDetail } from '@/api/types'
import type { BodyCaret } from './bodyCaret'

export interface RenameHandover {
  /** The note under its new path, at the rename's version, with the body as it is on disk. */
  detail: ObjectDetail
  /** Where the caret was, when the body had the focus. */
  caret: BodyCaret | null
  /** The editor's text when it differs from the file (typed while the rename ran). */
  unsaved: string | null
}

/** How long a handover waits for its view. */
const HANDOVER_MS = 5000

const handed = new Map<string, RenameHandover & { at: number }>()

/** Leave `h` for the view that opens `path` next. */
export function handOver(path: string, h: RenameHandover): void {
  handed.set(path, { ...h, at: Date.now() })
}

/** The handover waiting for `path`, or null (none, or too old to be for this view). */
export function peekHandover(path: string): RenameHandover | null {
  const h = handed.get(path)
  return h && Date.now() - h.at <= HANDOVER_MS ? h : null
}

/** The view on `path` has mounted: its handover is used up. */
export function dropHandover(path: string): void {
  handed.delete(path)
}
