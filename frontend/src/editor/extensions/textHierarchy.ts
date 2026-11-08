/**
 * Increase / decrease text hierarchy (`increaseTextHierarchy` Ctrl+Plus, `decreaseTextHierarchy`
 * Ctrl+Minus; the catalog's Block editing group). The ladder, from the bottom up, is Small,
 * Standard text, heading 4, 3, 2, 1: increase moves text to heading 4 and heading 2 to heading 1
 * (heading 1 stays), decrease moves heading 1 to heading 2 and heading 4 to text (Small stays).
 * It acts on the block selection, else on the block holding the cursor, text blocks only (a
 * list, a quote or a code block in the selection is left alone), in one transaction that changes
 * each block's own line and nothing else. Bound from the registry by `editor/shortcuts.ts`.
 */
import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { Option } from '../annotations'
import { withOption, type Hierarchy } from '../nodes/blockOptions'
import { getBlockSelection, setBlockSelectionIn, targetRange } from './blockSelection'

/** The text hierarchy from the bottom up. */
export const HIERARCHY_LADDER: readonly Hierarchy[] = ['S', 'Base', 'H4', 'H3', 'H2', 'H1']

/** The hierarchy of a text block (a paragraph, small or not, or a heading); null for any other block. */
export function hierarchyOf(node: PMNode): Hierarchy | null {
  if (node.type.name === 'heading') return `H${node.attrs.level}` as Hierarchy
  if (node.type.name !== 'paragraph') return null
  const options = (node.attrs.blockOptions as Option[] | null) ?? []
  return options.some((o) => o.key === 'small' && o.value === true) ? 'S' : 'Base'
}

/**
 * Step the target text blocks one level up (`1`) or down (`-1`) the ladder. Consumes the key
 * whenever there is a target block in an editable editor (a block at the top of the ladder, or
 * one that is not text, stays as it is); false otherwise, so the key is left to the browser.
 */
export function stepHierarchy(editor: Editor, dir: 1 | -1): boolean {
  if (!editor.isEditable) return false
  const range = targetRange(editor.state)
  if (!range) return false
  const { schema } = editor
  const tr = editor.state.tr
  for (const { node, pos } of range.blocks) {
    const current = hierarchyOf(node)
    const at = current ? HIERARCHY_LADDER.indexOf(current) : -1
    const next = at < 0 ? undefined : HIERARCHY_LADDER[at + dir]
    if (!next) continue
    const heading = /^H([1-4])$/.exec(next)
    const options = withOption(node.attrs.blockOptions as Option[] | null, 'small', next === 'S' ? true : null)
    const attrs: Record<string, unknown> = { ...node.attrs, blockOptions: options.length ? options : null }
    if (heading) attrs.level = Number(heading[1])
    else delete attrs.level
    tr.setNodeMarkup(pos, heading ? schema.nodes.heading : schema.nodes.paragraph, attrs)
  }
  if (!tr.docChanged) return true
  // A block's size does not change, so the selected blocks are where they were.
  if (getBlockSelection(editor.state)) setBlockSelectionIn(tr, { anchor: range.blocks[0].pos, head: range.blocks[range.blocks.length - 1].pos })
  editor.view.dispatch(tr)
  return true
}
