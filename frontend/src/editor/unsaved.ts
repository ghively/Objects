/**
 * Edits that could not be saved when their editor was left: a save was rejected
 * with a conflict or a read-only file (autosave was paused, e.g. with the
 * conflict dialog open), a save sent on leaving failed, or the window was going
 * with text not yet on disk (M32: kept until a save of it lands). The text is
 * kept here by path and offered the next time the object opens (`RecoveryDialog`,
 * which shows it beside the version on disk and writes only on the user's word),
 * so nothing typed is lost and nothing is written over the other side's change
 * without asking.
 *
 * The object's id is kept with the text when known: the entry follows a rename
 * (`moveUnsaved`), and after a delete it is not offered to another object created
 * later at the same path.
 *
 * Kept per space in the browser's local storage (M32 fix pass; it was the tab's
 * session storage): it must outlive the window, since a note too long for a
 * keepalive request can be cut off by the very close that left it unsaved. One
 * storage entry per note, read each time it is asked for, so the windows of one
 * space see each other's entries and never write over them. Storage that can't
 * be read or written leaves an in-memory copy for this page.
 *
 * A window that closed with a save still in flight never read the answer, so its
 * entry stays although the file holds the text. `forgetSaved` clears those when
 * the space next opens (and opening the note clears its own): text the file
 * already holds is never offered as unsaved.
 */
const KEY = 'object.unsaved:'

type Entry = { body: string; id: string | null }

let space: string | null = null
/** Entries that are not in storage (a write failed, or no space is open): this page's only copy. */
let unstored = new Map<string, Entry>()

function entryOf(v: unknown): Entry | null {
  // Before the id was kept, an entry was the text alone.
  if (typeof v === 'string') return { body: v, id: null }
  if (v && typeof v === 'object' && typeof (v as Entry).body === 'string') {
    const id = (v as Entry).id
    return { body: (v as Entry).body, id: typeof id === 'string' ? id : null }
  }
  return null
}

/** The storage key of `path` in `root` (a path holds no line break). */
const keyOf = (root: string, path: string) => `${KEY}${root}\n${path}`

function read(path: string): Entry | null {
  const own = unstored.get(path)
  if (own || space === null) return own ?? null
  try {
    const raw = localStorage.getItem(keyOf(space, path))
    return raw ? entryOf(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

function write(path: string, e: Entry): void {
  // No space open yet: this page's memory is all there is.
  if (space === null) {
    unstored.set(path, e)
    return
  }
  try {
    localStorage.setItem(keyOf(space, path), JSON.stringify(e))
    unstored.delete(path)
  } catch {
    // full or blocked: the in-memory copy still holds it for this page
    unstored.set(path, e)
  }
}

function remove(path: string): void {
  unstored.delete(path)
  if (space === null) return
  try {
    localStorage.removeItem(keyOf(space, path))
  } catch {
    // unreadable storage holds nothing to remove
  }
}

/**
 * Text kept before the store moved (one session-storage entry per space, a map by path): taken
 * over once, so a page that reloads onto this version still offers it.
 */
function adoptSessionStore(root: string): void {
  try {
    const raw = sessionStorage.getItem(KEY + root)
    if (!raw) return
    sessionStorage.removeItem(KEY + root)
    const data: unknown = JSON.parse(raw)
    if (!data || typeof data !== 'object' || Array.isArray(data)) return
    for (const [path, v] of Object.entries(data)) {
      const e = entryOf(v)
      if (e && read(path) === null) write(path, e)
    }
  } catch {
    // unreadable: nothing to take over
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
  unstored = new Map()
  if (root !== null) adoptSessionStore(root)
}

/** Keep `body` as the unsaved text of `path` (replacing any kept before); `id` is the object's, when known. */
export function keepUnsaved(path: string, body: string, id: string | null = null): void {
  write(path, { body, id })
}

/** The unsaved text kept for `path`, or null; with `id`, only text kept for that object (or for one of unknown id). */
export function keptUnsaved(path: string, id?: string | null): string | null {
  const e = read(path)
  return e && sameObject(e, id) ? e.body : null
}

/** Forget the text kept for `path` (saved or discarded); with `id`, only when it is that object's. */
export function dropUnsaved(path: string, id?: string | null): void {
  const e = read(path)
  if (e && sameObject(e, id)) remove(path)
}

/** The object at `oldPath` moved to `path` (renamed here or elsewhere): its kept text follows it. */
export function moveUnsaved(oldPath: string, path: string): void {
  const e = read(oldPath)
  if (!e || oldPath === path) return
  remove(oldPath)
  write(path, e)
}

/** The paths of the open space that have text kept. */
export function keptPaths(): string[] {
  const out = new Set(unstored.keys())
  if (space === null) return [...out]
  const prefix = keyOf(space, '')
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith(prefix)) out.add(k.slice(prefix.length))
    }
  } catch {
    // unreadable: only this page's own entries
  }
  return [...out]
}

/**
 * Forget the kept text the file already holds: `readNote(path)` reads the note as it is on disk
 * (rejecting when it is gone or unreadable, which leaves its entry alone). Run when a space
 * opens: a window that closed with its save in flight could not clear the entry itself, and left
 * there it would be offered as unsaved once the file is changed by something else.
 */
export async function forgetSaved(readNote: (path: string) => Promise<{ body: string; id: string | null }>): Promise<void> {
  const root = space
  for (const path of keptPaths()) {
    try {
      const note = await readNote(path)
      if (space !== root) return
      if (keptUnsaved(path, note.id) === note.body) dropUnsaved(path, note.id)
    } catch {
      // gone or unreadable: nothing to compare with
    }
  }
}

// ---- a rename sent while the window was going (M32, the walk's W1) ----
//
// A title typed just before the window closes is committed on `pagehide`. The rename moves the
// file, and the page is gone before the answer says where to: its tabs still name the old path.
// So the note's id is left here with the path it had, and the next page looks the note up by its
// id and moves the tabs along (`takeRenamedAway`). A page that lives to read the answer clears it.
const RENAMING = 'object.renaming:'

/** A rename of the note `id` at `path` was sent as the window was going. */
export function keepRenaming(path: string, id: string): void {
  if (space === null) return
  try {
    localStorage.setItem(`${RENAMING}${space}\n${path}`, id)
  } catch {
    // blocked: the next page shows the old path as gone, as before
  }
}

/** The rename of the note at `path` was answered here (its tabs have followed), or was not sent. */
export function dropRenaming(path: string): void {
  if (space === null) return
  try {
    localStorage.removeItem(`${RENAMING}${space}\n${path}`)
  } catch {
    // nothing to remove
  }
}

/**
 * The notes of the open space that were renamed as an earlier window went: `[oldPath, path]` for
 * each one `notes` (the space's notes, with their ids) now lists under another path. Every record
 * is used up, also one whose rename never landed.
 */
export function takeRenamedAway(notes: readonly { id?: string | null; path: string }[]): [string, string][] {
  const out: [string, string][] = []
  if (space === null) return out
  const prefix = `${RENAMING}${space}\n`
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith(prefix)) keys.push(k)
    }
    for (const k of keys) {
      const oldPath = k.slice(prefix.length)
      const id = localStorage.getItem(k)
      localStorage.removeItem(k)
      const now = id ? notes.find((n) => n.id === id) : undefined
      if (now && now.path !== oldPath) out.push([oldPath, now.path])
    }
  } catch {
    // unreadable: nothing to follow
  }
  return out
}

/** Tests: forget everything. */
export function resetUnsaved(): void {
  unstored.clear()
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (k?.startsWith(KEY) || k?.startsWith(RENAMING)) localStorage.removeItem(k)
    }
  } catch {
    // unreadable storage holds nothing
  }
}
