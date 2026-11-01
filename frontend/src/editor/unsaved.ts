/**
 * Edits that could not be saved when their editor was left: a save was rejected
 * with a conflict or a read-only file (autosave was paused, e.g. with the
 * conflict dialog open), or a save sent on leaving failed. The text is kept here
 * by path and offered the next time the object opens (`RecoveryDialog`), so
 * nothing typed is lost and nothing is written over the other side's change
 * without asking.
 *
 * The object's id is kept with the text when known: the entry follows a rename
 * (`moveUnsaved`), and after a delete it is not offered to another object created
 * later at the same path.
 *
 * Kept per space, in memory and in the tab's session storage: a space switch
 * reloads the page, and the text must still be there when that space opens again.
 * Session storage that can't be read or written leaves the in-memory copy.
 */
const KEY = 'object.unsaved:'

type Entry = { body: string; id: string | null }

let space: string | null = null
let kept = new Map<string, Entry>()

function entryOf(v: unknown): Entry | null {
  // Before the id was kept, an entry was the text alone.
  if (typeof v === 'string') return { body: v, id: null }
  if (v && typeof v === 'object' && typeof (v as Entry).body === 'string') {
    const id = (v as Entry).id
    return { body: (v as Entry).body, id: typeof id === 'string' ? id : null }
  }
  return null
}

function load(root: string): Map<string, Entry> {
  const out = new Map<string, Entry>()
  try {
    const raw = sessionStorage.getItem(KEY + root)
    const data: unknown = raw ? JSON.parse(raw) : null
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      for (const [path, v] of Object.entries(data)) {
        const e = entryOf(v)
        if (e) out.set(path, e)
      }
    }
  } catch {
    // unreadable: start empty
  }
  return out
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

/** True when the entry may belong to the object `id` (either id unknown, or the same). */
function sameObject(e: Entry, id: string | null | undefined): boolean {
  return !e.id || !id || e.id === id
}

/** The open space (its root); kept text is read and written under it. */
export function setUnsavedSpace(root: string | null): void {
  if (root === space) return
  space = root
  kept = root === null ? new Map() : load(root)
}

/** Keep `body` as the unsaved text of `path` (replacing any kept before); `id` is the object's, when known. */
export function keepUnsaved(path: string, body: string, id: string | null = null): void {
  kept.set(path, { body, id })
  save()
}

/** The unsaved text kept for `path`, or null; with `id`, only text kept for that object (or for one of unknown id). */
export function keptUnsaved(path: string, id?: string | null): string | null {
  const e = kept.get(path)
  return e && sameObject(e, id) ? e.body : null
}

/** Forget the text kept for `path` (saved or discarded); with `id`, only when it is that object's. */
export function dropUnsaved(path: string, id?: string | null): void {
  const e = kept.get(path)
  if (e && sameObject(e, id) && kept.delete(path)) save()
}

/** The object at `oldPath` moved to `path` (renamed here or elsewhere): its kept text follows it. */
export function moveUnsaved(oldPath: string, path: string): void {
  const e = kept.get(oldPath)
  if (!e || oldPath === path) return
  kept.delete(oldPath)
  kept.set(path, e)
  save()
}

/** Tests: forget everything. */
export function resetUnsaved(): void {
  kept.clear()
  save()
}
