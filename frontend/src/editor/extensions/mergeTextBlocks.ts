/**
 * Merge the selected text blocks (`mergeTextBlocks`, Ctrl+Shift+G; the catalog's Block editing
 * group). With a block selection of two or more paragraphs, they become one paragraph, their
 * texts joined by a space, with the first block's options and the blank lines that followed the
 * last. A selection holding anything that is not a plain paragraph (a heading, a list, a quote)
 * is left alone. Bound from the registry by `editor/shortcuts.ts`.
 */
import type { Editor } from '@tiptap/core'
import { Fragment, type Node as PMNode } from '@tiptap/pm/model'
import { BLOCK_ID_SUFFIX } from '../blocks'
import { blockSelectionRange, setBlockSelectionIn } from './blockSelection'

/** A paragraph's content without its ` ^id` block id (a merged block keeps the last one's only). */
function withoutBlockId(node: PMNode): Fragment {
  const m = BLOCK_ID_SUFFIX.exec(node.textContent)
  return m ? node.content.cut(0, node.content.size - m[0].length) : node.content
}

/**
 * Merge the selected paragraphs into one. Consumes the key whenever two or more blocks are
 * selected in an editable editor (and changes nothing unless they are all paragraphs); false
 * otherwise, so the key is left to the browser.
 */
export function mergeTextBlocks(editor: Editor): boolean {
  if (!editor.isEditable) return false
  const range = blockSelectionRange(editor.state)
  if (!range || range.blocks.length < 2) return false
  const { schema } = editor
  if (!range.blocks.every((b) => b.node.type.name === 'paragraph')) return true
  const first = range.blocks[0].node
  const last = range.blocks[range.blocks.length - 1].node
  let content = Fragment.empty
  range.blocks.forEach((b, i) => {
    const part = i === range.blocks.length - 1 ? b.node.content : withoutBlockId(b.node)
    if (part.size === 0) return
    if (content.size > 0) content = content.append(Fragment.from(schema.text(' ')))
    content = content.append(part)
  })
  // The first block's options and origin (its line endings), what followed the last block.
  const attrs = { ...first.attrs, blockSource: null, blockTrailing: last.attrs.blockTrailing ?? null }
  const merged = schema.nodes.paragraph.create(attrs, content)
  const tr = editor.state.tr.replaceWith(range.from, range.to, merged)
  editor.view.dispatch(setBlockSelectionIn(tr, { anchor: range.from, head: range.from }))
  return true
}
