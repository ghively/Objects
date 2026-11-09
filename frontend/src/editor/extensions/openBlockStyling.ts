/**
 * Open block styling (`openBlockStyling`, Ctrl+Shift+E; the catalog's Block editing group): the
 * block menu a click on a block's drag handle opens, for the block selection or else the block
 * holding the cursor. The menu is React state of the handles overlay (`handles/BlockHandles.tsx`),
 * so the key asks for it with a DOM event on the editor's element, which the overlay listens
 * for; the event carries the first target block's position. Bound from the registry by
 * `editor/shortcuts.ts`.
 */
import type { Editor } from '@tiptap/core'
import { targetRange } from './blockSelection'

/** The event `openBlockStyling` sends on `editor.view.dom`; `detail.pos` is the first target block's start. */
export const OPEN_BLOCK_MENU_EVENT = 'object:open-block-menu'

export interface OpenBlockMenuDetail {
  pos: number
}

/**
 * Ask the handles overlay to open the block menu for the target blocks. Consumes the key whenever
 * there is a target block in an editable editor; false otherwise, so the key is left to the browser.
 */
export function openBlockStyling(editor: Editor): boolean {
  if (!editor.isEditable) return false
  const range = targetRange(editor.state)
  if (!range) return false
  const detail: OpenBlockMenuDetail = { pos: range.from }
  editor.view.dom.dispatchEvent(new CustomEvent<OpenBlockMenuDetail>(OPEN_BLOCK_MENU_EVENT, { detail }))
  return true
}
