/**
 * Edits that could not be saved when their editor was left: a save was rejected
 * with a conflict or a read-only file (autosave was paused, e.g. with the
 * conflict dialog open), or a save sent on leaving failed. The text is kept here
 * by path and offered the next time the object opens (`RecoveryDialog`), so
 * nothing typed is lost and nothing is written over the other side's change
 * without asking.
 *
 * Kept per space, in memory and in the tab's session storage: a space switch
 * reloads the page, and the text must still be there when that space opens again.
 * Session storage that can't be read or written leaves the in-memory copy.
 */
const KEY = 'object.unsaved:'

let space: string | null = null
let kept = new Map<string, string>()

function load(root: string): Map<string, string> {
  try {
    const raw = sessionStorage.getItem(KEY + root)
    const data: unknown = raw ? JSON.parse(raw) : null
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      return new Map(Object.entries(data).filter((e): e is [string, string] => typeof e[1] === 'string'))
    }
  } catch {
    // unreadable: start empty
  }
  return new Map()
}

function save(): void {
  if (space === null) return
  try {
    if (kept.size === 0) sessionStorage.removeItem(KEY + space)
    else sessionStorage.setItem(KEY + space, JSON.stringify(Object.fromEntries(kept)))
  } catch {
    // full or blocked: the in-memory copy still holds it for this page
  }
}

/** The open space (its root); kept text is read and written under it. */
export function setUnsavedSpace(root: string | null): void {
  if (root === space) return
  space = root
  kept = root === null ? new Map() : load(root)
}

/** Keep `body` as the unsaved text of `path` (replacing any kept before). */
export function keepUnsaved(path: string, body: string): void {
  kept.set(path, body)
  save()
}

/** The unsaved text kept for `path`, or null. */
export function keptUnsaved(path: string): string | null {
  return kept.get(path) ?? null
}

/** Forget the text kept for `path` (saved or discarded). */
export function dropUnsaved(path: string): void {
  if (kept.delete(path)) save()
}

/** Tests: forget everything. */
export function resetUnsaved(): void {
  kept.clear()
  save()
}
