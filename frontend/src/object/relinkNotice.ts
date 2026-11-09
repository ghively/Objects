/**
 * After a rename: a short notice of how many other objects had their links updated (acceptance
 * M2#8). Nothing is shown when no other object linked to it.
 */
import type { RenameResult } from '@/api/types'
import { showToast } from '@/editor/media/upload'

const BOARD_SUFFIX = '.whiteboard.json'

/** The objects whose links a rename rewrote: a board file counts as its object, the renamed one not at all. */
export function relinkedObjectCount(res: Pick<RenameResult, 'path' | 'relinked'>): number {
  const objects = new Set(
    (res.relinked ?? []).map((p) => (p.endsWith(BOARD_SUFFIX) ? `${p.slice(0, -BOARD_SUFFIX.length)}.md` : p)),
  )
  objects.delete(res.path)
  return objects.size
}

/** "Updated links in 3 objects" (null for none). */
export function relinkedText(count: number): string | null {
  if (count <= 0) return null
  return `Updated links in ${count} ${count === 1 ? 'object' : 'objects'}`
}

/** Show the notice for a finished rename. */
export function announceRelinked(res: Pick<RenameResult, 'path' | 'relinked'>): void {
  const text = relinkedText(relinkedObjectCount(res))
  if (text) showToast(text)
}
