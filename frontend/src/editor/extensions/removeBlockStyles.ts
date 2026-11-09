/**
 * Remove block styles (`removeBlockStyles`, Ctrl+Shift+X; the catalog's Block editing group).
 * Clears the style options the block menu writes (`STYLE_OPTIONS`: small, color, align, icon,
 * quote layout, list type) on the block selection, else on the block holding the cursor,
 * through the menu's own "remove" path (`removeStyle`), so each block's options line changes and
 * nothing else does. With the caret in a list item (and no block selection) it clears that
 * item's own options comment instead, as the block menu's item rows write them (M8). Bound from
 * the registry by `editor/shortcuts.ts`.
 */
import type { Editor } from '@tiptap/core'
import { listItemAt, setItemOptionsAt } from '../nodes/listItemOptions'
import { blockSelectionRange, removeStyle, targetRange } from './blockSelection'

/**
 * Clear the target blocks' style options. Consumes the key whenever there is a target block in
 * an editable editor; false otherwise, so the key is left to the browser.
 */
export function removeBlockStyles(editor: Editor): boolean {
  if (!editor.isEditable) return false
  const item = blockSelectionRange(editor.state) ? null : listItemAt(editor.state.tr)
  if (item) {
    const tr = editor.state.tr
    setItemOptionsAt(tr, item.pos, { small: null, color: null, align: null, icon: null })
    if (tr.docChanged) editor.view.dispatch(tr)
    return true
  }
  if (!targetRange(editor.state)) return false
  return removeStyle(editor)
}
