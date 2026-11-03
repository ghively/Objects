/**
 * The block-selection bar's "Move" (`EditorPanel.shortLabels.addTo`, `ActionItems.addTo.title`
 * "Move blocks to..."): the selected blocks' Markdown is added to the target, then removed here.
 * - "Today" / "Tomorrow" (`ActionItems.addToDailyNoteToday` / `…Tomorrow`): appended to that
 *   day's daily note, created when there is none (the action palette's `addToDailyNote`, with its
 *   "Added content to daily note" toast).
 * - "New page" (`ActionItems.addToNewPage`): a new page (the Page type) holding the blocks, opened
 *   after the blocks leave this page.
 * The blocks are removed only after the target was written; a failed write keeps them and shows
 * the error (our choice).
 */
import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { api } from '@/api/client'
import { addDays, todayYmd } from '@/calendar/dates'
import { openObject } from '@/create/createAndOpen'
import { invalidateLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { addToDailyNote, pageType } from '@/palette/paste'
import { blockSelectionRange, blocksSource, deleteBlocks, selectBlocks } from '../extensions/blockSelection'
import { showToast } from '../media/upload'

export type MoveTarget = 'today' | 'tomorrow' | 'newPage'

/** Where the sibling `nodes` (by identity) sit in `doc` now: the first's and the last's positions. */
function findSiblings(doc: PMNode, nodes: PMNode[]): { first: number; last: number } | null {
  let first = -1
  let last = -1
  doc.descendants((n, pos) => {
    if (n === nodes[0]) first = pos
    if (n === nodes[nodes.length - 1]) last = pos
    return first < 0 || last < 0
  })
  return first >= 0 && last >= 0 ? { first, last } : null
}

/** Remove the blocks `nodes` from the editor (wherever edits since have moved them). */
function removeBlocks(editor: Editor, nodes: PMNode[]): boolean {
  if (editor.isDestroyed) return false
  const at = findSiblings(editor.state.doc, nodes)
  if (!at || !selectBlocks(editor, at.first, at.last)) return false
  return deleteBlocks(editor)
}

/** Move the selected blocks to `target`. Resolves true when they moved. */
export async function moveBlocks(editor: Editor, target: MoveTarget): Promise<boolean> {
  const range = blockSelectionRange(editor.state)
  if (!range || !editor.isEditable) return false
  const text = blocksSource(editor, range)
  if (!text.trim()) return false
  const nodes = range.blocks.map((b) => b.node)
  try {
    if (target === 'newPage') {
      const type = pageType(useLinkIndex.getState().types)
      const typeId = type?.id ?? 'Page'
      const created = await api.createObject(typeId, { templateId: 'none' })
      await api.saveBody(created.path, text.endsWith('\n') ? text : `${text}\n`, created.version)
      void invalidateLinkIndex()
      removeBlocks(editor, nodes)
      openObject(created.path, {}, typeId)
      return true
    }
    const today = todayYmd()
    await addToDailyNote(text, target === 'today' ? today : addDays(today, 1))
    return removeBlocks(editor, nodes)
  } catch (err) {
    showToast(err instanceof Error ? err.message : String(err))
    throw err
  }
}
