/**
 * The block-selection bar's "Move" ("Move blocks
 * to..."): the selected blocks' Markdown is added to the target, then removed here.
 * - "Today" / "Tomorrow": appended to that
 *   day's daily note, created when there is none (the action palette's `addToDailyNote`, with its
 *   "Added content to daily note" toast).
 * - "New page": a new page (the Page type) holding the blocks, opened
 *   after the blocks leave this page.
 * The blocks are removed only after the target was written; a failed write keeps them and shows
 * the error (our choice). This note's pending edits are saved first. When the target daily note
 * is the note open here, the blocks move to its end inside this editor and nothing is written
 * from here (the editor's autosave saves it), so disk never gets them twice.
 */
import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { api } from '@/api/client'
import { addDays, todayYmd } from '@/calendar/dates'
import { openObject } from '@/create/createAndOpen'
import { invalidateLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { appendToDailyNote, ensureDailyNote, pageType } from '@/palette/paste'
import { parseBody } from '../document'
import { blockSelectionRange, blocksSource, deleteBlocks, selectBlocks } from '../extensions/blockSelection'
import { editorObjectPath, flushEditorObject } from '../nodes/blockRef'
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

/**
 * Move the blocks `nodes` (whose source is `text`) to the end of this editor's own document,
 * as an append to the open note would place them. Blocks already at the very end stay put.
 */
function moveToEnd(editor: Editor, nodes: PMNode[], text: string): boolean {
  if (editor.isDestroyed) return false
  const at = findSiblings(editor.state.doc, nodes)
  if (!at) return false
  const last = nodes[nodes.length - 1]
  const end = at.last + last.nodeSize
  const $end = editor.state.doc.resolve(end)
  // Nothing follows but the closing tokens of the blocks' ancestors: already last.
  if (editor.state.doc.content.size - end === $end.depth) return true
  // Top-level blocks move as they are; nested ones (list items) come back as parsed top-level blocks.
  const moved =
    $end.depth === 0
      ? nodes
      : parseBody(editor, text).content.map((json) => editor.schema.nodeFromJSON(json))
  if (!removeBlocks(editor, nodes)) return false
  const { state } = editor
  editor.view.dispatch(state.tr.insert(state.doc.content.size, moved))
  return true
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
    // This editor's pending edits reach disk before another note is written.
    await flushEditorObject(editor)
    const path = await ensureDailyNote(target === 'today' ? today : addDays(today, 1))
    // The target is the note open here: a disk append would race this editor's own save.
    if (path === editorObjectPath(editor)) return moveToEnd(editor, nodes, text)
    await appendToDailyNote(path, text)
    return removeBlocks(editor, nodes)
  } catch (err) {
    showToast(err instanceof Error ? err.message : String(err))
    throw err
  }
}
