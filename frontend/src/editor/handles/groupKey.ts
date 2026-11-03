/**
 * Ctrl+G / ⌘G (`shortcuts.groupBlocks`: "Group selected blocks or ungroup
 * selected group block"): with blocks selected, group them, or ungroup the
 * group they are in. The key is the one Object shows next to the block
 * menu's "Group" row (catalog section 6); without a block selection it is left
 * to the browser. The key comes from the registry (`lib/shortcuts.ts`).
 */
import { Extension } from '@tiptap/core'
import { getBlockSelection } from '../extensions/blockSelection'
import { toggleGroupBlocks } from '../menus/BlockStyleMenu'
import { keymapFor } from '../shortcuts'

export const GroupBlocksKey = Extension.create({
  name: 'groupBlocksKey',
  // With the other block keys: after `BlockSelection` (900), before the built-in keymaps.
  priority: 850,

  addKeyboardShortcuts() {
    const editor = this.editor
    return keymapFor({
      groupBlocks: () => !!getBlockSelection(editor.state) && toggleGroupBlocks(editor),
    })
  },
})
