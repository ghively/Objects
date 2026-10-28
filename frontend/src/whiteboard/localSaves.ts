/**
 * This window's own board and ink saves, announced to the other views of the same board in this
 * window (a page and a peek over it). The server's `whiteboard` events for them carry our
 * `CLIENT_ID` and are dropped as echoes, so without this those views would never hear of them.
 */
export interface LocalSave {
  /** The board's `.md` path. */
  path: string
  /** The new revision (of the board or of its ink file). */
  version: string
  /** The view that saved: it ignores its own announcement. */
  source: object
}

const listeners = new Set<(e: LocalSave) => void>()

/** Announce a save, on the next task (after the saving view has adopted the new revision). */
export function announceSave(e: LocalSave): void {
  setTimeout(() => {
    for (const cb of [...listeners]) cb(e)
  }, 0)
}

export function onLocalSave(cb: (e: LocalSave) => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}
