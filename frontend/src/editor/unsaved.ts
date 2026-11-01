/**
 * Edits that could not be saved when their editor was left: a save was rejected
 * with a conflict or a read-only file (autosave was paused, e.g. with the
 * conflict dialog open), or a save sent on leaving failed. The text is kept here
 * by path and offered the next time the object opens (`RecoveryDialog`), so
 * nothing typed is lost and nothing is written over the other side's change
 * without asking. Kept in memory for the session (a space switch reloads the page).
 */
const kept = new Map<string, string>()

/** Keep `body` as the unsaved text of `path` (replacing any kept before). */
export function keepUnsaved(path: string, body: string): void {
  kept.set(path, body)
}

/** The unsaved text kept for `path`, or null. */
export function keptUnsaved(path: string): string | null {
  return kept.get(path) ?? null
}

/** Forget the text kept for `path` (saved or discarded). */
export function dropUnsaved(path: string): void {
  kept.delete(path)
}

/** Tests: forget everything. */
export function resetUnsaved(): void {
  kept.clear()
}
