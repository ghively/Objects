/**
 * `group`: a box around its blocks (Capacities' `GroupBlock`). In the file:
 *
 *   <!-- group color=bg-gray -->
 *   Box heading
 *   Body of the box.
 *   <!-- /group -->
 *
 * Container options: `color`, `align`. Rendering is a plain `div` here; Task 10
 * adds the node view.
 */
import { Node, mergeAttributes } from '@tiptap/core'
import { ancestorOfType, containerSourceAttributes, unwrapAt, wrapBlocks } from './containers'
import './group.css'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    group: {
      /** Wrap the selected blocks in a group. */
      wrapInGroup: () => ReturnType
      /** Replace the group around the selection by its blocks. */
      unwrapGroup: () => ReturnType
    }
  }
}

export const Group = Node.create({
  name: 'group',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return containerSourceAttributes()
  },

  parseHTML() {
    return [{ tag: 'div[data-group]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-group': '', class: 'block-group' }), 0]
  },

  renderMarkdown(node: { content?: unknown[] }, h: { renderChildren: (c: unknown[], sep: string) => string }) {
    return node.content ? h.renderChildren(node.content, '\n\n') : ''
  },

  addCommands() {
    return {
      wrapInGroup:
        () =>
        ({ tr, state, dispatch }) => {
          if (!dispatch) return true
          return wrapBlocks(tr, state.schema.nodes.group, [])
        },
      unwrapGroup:
        () =>
        ({ tr, dispatch }) => {
          const found = ancestorOfType(tr, 'group')
          if (!found) return false
          if (!dispatch) return true
          return unwrapAt(tr, found.pos)
        },
    }
  },
})
