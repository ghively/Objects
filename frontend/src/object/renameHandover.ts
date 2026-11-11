/**
 * M32: what a note's view leaves for the view that replaces it when its own rename moves the file.
 *
 * The page and the peek are keyed by the note's path, so a rename that changes the file name
 * replaces the view and its editor. Enter in the title puts the caret in the body at once, so by
 * the time the rename answers there may be a caret there and words typed meanwhile. The leaving
 * view hands over the note as it stands (nothing to load again: no moment without an editor), the
 * caret, and the text its editor had not saved.
 *
 * Every view that mounts on the new path in that same update may show the note (`peekHandover`,
 * read while rendering and safe to call twice). The caret and the unsaved text go to one view
 * only, the one in the place the leaving view was (`claimHandover`, from its mount effect), so
 * the text is saved once and the caret stays in the pane the user was typing in. The entry is
 * dropped once those views have mounted; one nobody took within a few seconds is ignored.
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
  /** The element the leaving view sat in (it outlives the view): the place of the view that takes over. */
  slot: Element | null
}

/** How long a handover waits for its view. */
const HANDOVER_MS = 5000

const handed = new Map<string, RenameHandover & { at: number; claimed: boolean }>()

function fresh(path: string) {
  const h = handed.get(path)
  return h && Date.now() - h.at <= HANDOVER_MS ? h : null
}

/** Leave `h` for the view that opens `path` next. */
export function handOver(path: string, h: RenameHandover): void {
  handed.set(path, { ...h, at: Date.now(), claimed: false })
}

/** The note handed over for `path`, or null (none, or too old to be for this view). */
export function peekHandover(path: string): ObjectDetail | null {
  return fresh(path)?.detail ?? null
}

/**
 * The caret and the unsaved text handed over for `path`, for the view sitting in `slot`: given
 * once, to the view in the leaving view's place (to the first that asks when that place is gone).
 */
export function claimHandover(path: string, slot: Element | null): Pick<RenameHandover, 'caret' | 'unsaved'> | null {
  const h = fresh(path)
  if (!h || h.claimed) return null
  if (h.slot && h.slot.isConnected && h.slot !== slot) return null
  h.claimed = true
  return { caret: h.caret, unsaved: h.unsaved }
}

/** The views on `path` have mounted: its handover is used up. */
export function dropHandover(path: string): void {
  handed.delete(path)
}
