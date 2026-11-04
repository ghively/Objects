/**
 * `group`: a box around its blocks. In the file:
 *
 *   <!-- group color=bg-gray -->
 *   Box heading
 *   Body of the box.
 *   <!-- /group -->
 *
 * Container options: `color`, `align`.
 *
 * Task 10: the node view (`layout/GroupView.tsx`: the box, its colour and
 * alignment, "Ungroup"), the placeholder "Box heading..."
 * on an empty first child, and `toggleGroup`
 * ("Group selected blocks or ungroup selected group
 * block").
 */
import { Node, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'
import { Decoration, type DecorationSet } from '@tiptap/pm/view'
import { buildDecorations, updateDecorations, type DecorationVisitor } from '../extensions/incrementalDecorations'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { GroupView } from '../layout/GroupView'
import { ancestorOfType, containerSourceAttributes, unwrapAt, wrapBlocks } from './containers'
import './group.css'

export const GROUP_PLACEHOLDER = 'Box heading...'

/**
 * Replace the group at `pos` by its blocks; `unwrapAt` keeps the blank line
 * that followed the group after its last block.
 */
export function ungroupAt(tr: Transaction, pos: number): boolean {
  const node = tr.doc.nodeAt(pos)
  if (!node || node.type.name !== 'group') return false
  return unwrapAt(tr, pos)
}

const groupPlaceholderKey = new PluginKey<DecorationSet>('groupPlaceholder')

/** The placeholder on each group's first child while it is an empty text block. */
const groupPlaceholderVisitor: DecorationVisitor = (node, pos, decos) => {
  if (node.type.name === 'group') {
    const first = node.firstChild
    if (first && first.isTextblock && first.content.size === 0) {
      decos.push(
        Decoration.node(pos + 1, pos + 1 + first.nodeSize, {
          class: 'group-placeholder',
          'data-placeholder': GROUP_PLACEHOLDER,
        }),
      )
    }
  }
  return !node.isTextblock && !node.isAtom
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    group: {
      /** Wrap the selected blocks in a group. */
      wrapInGroup: () => ReturnType
      /** Replace the group around the selection by its blocks. */
      unwrapGroup: () => ReturnType
      /** Ungroup when the selection is in a group, else group the selected blocks. */
      toggleGroup: () => ReturnType
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

  addNodeView() {
    return ReactNodeViewRenderer(GroupView)
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: groupPlaceholderKey,
        state: {
          init: (_, state) => buildDecorations(state.doc, groupPlaceholderVisitor),
          apply: (tr, old) => updateDecorations(old, tr, groupPlaceholderVisitor),
        },
        props: {
          decorations: (state) => groupPlaceholderKey.getState(state),
        },
      }),
    ]
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
          return ungroupAt(tr, found.pos)
        },
      toggleGroup:
        () =>
        ({ commands, tr }) =>
          ancestorOfType(tr, 'group') ? commands.unwrapGroup() : commands.wrapInGroup(),
    }
  },
})
