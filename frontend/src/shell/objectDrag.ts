/**
 * Dragging an object out of a list onto a whiteboard (M6 Task 13). A row sets the board's
 * `OBJECT_DRAG_MIME` (the object's path) and a `[[Title]]` text on a native drag
 * (the path form for a duplicate title or one a wikilink can't hold, see `wikilinkFor`).
 *
 * The sidebar's pinned rows reorder with dnd-kit, whose pointer sensor cancels native drags, so
 * a pinned row released outside its list hands the object over with `dropObjectAt`: a synthetic
 * `dragover`/`drop` pair at the release point, delivered only when the element there accepts an
 * object (its `dragover` handler calls `preventDefault`, as the board canvas does).
 */
import { OBJECT_DRAG_MIME } from '@/whiteboard/dnd'
import { wikilinkFor } from '@/whiteboard/linkText'

interface WritableData {
  setData(format: string, data: string): void
  effectAllowed?: string
}

/** The drag data of one object: its path, and a wikilink as plain text for other drop targets. */
export function setObjectDragData(dt: WritableData | null | undefined, path: string, title: string): void {
  if (!dt) return
  try {
    dt.setData(OBJECT_DRAG_MIME, path)
    dt.setData('text/plain', wikilinkFor(path, title))
    dt.effectAllowed = 'copy'
  } catch {
    // A read-only DataTransfer (not a dragstart): nothing to carry.
  }
}

/** Drop the object at the client point `x, y` if what is there takes objects; true if it did. */
export function dropObjectAt(path: string, title: string, x: number, y: number): boolean {
  if (typeof document === 'undefined' || typeof DataTransfer === 'undefined' || typeof DragEvent === 'undefined') {
    return false
  }
  const el = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(x, y) : null
  if (!el) return false
  let dt: DataTransfer
  try {
    dt = new DataTransfer()
  } catch {
    return false
  }
  setObjectDragData(dt, path, title)
  const init: DragEventInit = { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }
  const over = new DragEvent('dragover', init)
  el.dispatchEvent(over)
  if (!over.defaultPrevented) return false
  el.dispatchEvent(new DragEvent('drop', init))
  return true
}
