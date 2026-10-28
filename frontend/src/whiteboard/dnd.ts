/**
 * Dragging objects onto a board: the sidebar's pinned objects and M5's search results set
 * `OBJECT_DRAG_MIME` to the object's path (wired by Task 13); any source may instead drop
 * plain text holding exactly one wikilink.
 */
export const OBJECT_DRAG_MIME = 'application/x-object-path'

export type DroppedObject = { path: string } | { link: string } | null

const ONE_WIKILINK = /^\s*(\[\[[^[\]\n]+\]\])\s*$/

interface DataLike {
  getData(format: string): string
  types?: readonly string[] | DOMStringList
}

/** The object a drop carries: a path from `OBJECT_DRAG_MIME`, else a single `[[…]]` in `text/plain`. */
export function readDroppedObject(dt: DataLike | null | undefined): DroppedObject {
  if (!dt) return null
  const path = safeGet(dt, OBJECT_DRAG_MIME).trim()
  if (path) return { path }
  const m = ONE_WIKILINK.exec(safeGet(dt, 'text/plain'))
  return m ? { link: m[1] } : null
}

/** Whether a drag may carry an object (types are readable during dragover; data is not). */
export function mayCarryObject(dt: DataLike | null | undefined): boolean {
  if (!dt?.types) return false
  const types = Array.from(dt.types as ArrayLike<string>)
  return types.includes(OBJECT_DRAG_MIME) || types.includes('text/plain')
}

function safeGet(dt: DataLike, format: string): string {
  try {
    return dt.getData(format) ?? ''
  } catch {
    return ''
  }
}
