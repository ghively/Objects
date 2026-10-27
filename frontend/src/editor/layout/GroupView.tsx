/**
 * The group block's node view (Object's `GroupBlock`): a box around its
 * blocks with Object's block radius, its `color` (none by default: the
 * neutral `--bg-raised-2` fill) and `align`. On hover an "Ungroup" button
 * (`ActionItems.ungroupBlocks.title`) replaces the group by its blocks
 * (`ungroupAt`, as `unwrapGroup`). The
 * placeholder "Box heading..." (`blocks.GroupBlock.placeholder`) on an empty
 * first child comes from a decoration in `nodes/group.ts`.
 */
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { Ungroup } from 'lucide-react'
import type { Option } from '../annotations'
import { ungroupAt } from '../nodes/group'
import { optionAttributes } from './ColumnsView'

export function GroupView({ node, editor, getPos }: NodeViewProps) {
  const { attrs, style } = optionAttributes(node.attrs.blockOptions as Option[] | null)

  const ungroup = () => {
    const pos = getPos()
    if (typeof pos !== 'number') return
    editor
      .chain()
      .command(({ tr }) => ungroupAt(tr, pos))
      .run()
  }

  return (
    <NodeViewWrapper {...attrs} className="block-group" data-group="" style={style}>
      {editor.isEditable && (
        <div className="block-group-bar" contentEditable={false}>
          <button
            type="button"
            className="block-layout-btn"
            aria-label="Ungroup"
            title="Ungroup"
            onMouseDown={(e) => e.preventDefault()}
            onClick={ungroup}
          >
            <Ungroup size={14} aria-hidden="true" />
          </button>
        </div>
      )}
      <NodeViewContent className="block-group-content" />
    </NodeViewWrapper>
  )
}
