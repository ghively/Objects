/**
 * Moving blocks by their drag handle. A drag is ProseMirror's own drag of a
 * node selection (with M1's drop cursor): the block is selected as a node, set
 * as `view.dragging` with `move: true`, and ProseMirror's drop handler deletes
 * it and inserts it at the drop point. The node keeps its attributes, so
 * `BlockSource`'s keep rule leaves its bytes intact.
 */
import type { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { blocksSource, rangeBetween, setBlockSelectionIn } from '../extensions/blockSelection'

type Dragging = { slice: ReturnType<NodeSelection['content']>; move: boolean; node?: NodeSelection }

/** Start dragging the block at `pos` from its handle. */
export function startBlockDrag(editor: Editor, pos: number, event: DragEvent): boolean {
  const { view } = editor
  const node = view.state.doc.nodeAt(pos)
  if (!node) return false
  const selection = NodeSelection.create(view.state.doc, pos)
  view.dispatch(setBlockSelectionIn(view.state.tr.setSelection(selection), null))
  const range = rangeBetween(view.state.doc, pos, pos)
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'copyMove'
    event.dataTransfer.setData('text/plain', range ? blocksSource(editor, range) : node.textContent)
    const dom = view.nodeDOM(pos)
    if (dom instanceof HTMLElement && typeof event.dataTransfer.setDragImage === 'function') {
      event.dataTransfer.setDragImage(dom, 0, 0)
    }
  }
  ;(view as unknown as { dragging: Dragging | null }).dragging = { slice: selection.content(), move: true, node: selection }
  return true
}

/** Move the block at `pos` (with its bytes) so it starts at sibling boundary `target`. */
export function moveBlockTo(editor: Editor, pos: number, target: number): boolean {
  const node = editor.state.doc.nodeAt(pos)
  if (!node || target === pos || target === pos + node.nodeSize) return false
  const tr = editor.state.tr.delete(pos, pos + node.nodeSize)
  const at = tr.mapping.map(target)
  tr.insert(at, node)
  tr.setSelection(NodeSelection.create(tr.doc, at))
  editor.view.dispatch(setBlockSelectionIn(tr, null))
  return true
}
