/**
 * `group`: a box around its blocks (Object's `GroupBlock`). In the file:
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
 * (`blocks.GroupBlock.placeholder`) on an empty first child, and `toggleGroup`
 * (`shortcuts.groupBlocks`: "Group selected blocks or ungroup selected group
 * block").
 */
import { Node, mergeAttributes } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { GroupView } from '../layout/GroupView'
import { ancestorOfType, containerSourceAttributes, unwrapAt, wrapBlocks } from './containers'
import './group.css'

export const GROUP_PLACEHOLDER = 'Box heading...'

/**
 * Replace the group at `pos` by its blocks, keeping the blank line that
 * followed the group after its last block (so that block never runs into the
 * next one in the file).
 */
export function ungroupAt(tr: Transaction, pos: number): boolean {
  const node = tr.doc.nodeAt(pos)
  if (!node || node.type.name !== 'group') return false
  const trailing = node.attrs.blockTrailing as string | null | undefined
  const last = node.lastChild
  if (!unwrapAt(tr, pos)) return false
  if (trailing && last && 'blockTrailing' in last.attrs && !last.attrs.blockTrailing) {
    const lastPos = pos + node.content.size - last.nodeSize
    // A container's last block keeps its own line end in its source; the
    // container's trailing starts with the close line's, so drop that one.
    const origin = String(last.attrs.blockOrigin ?? '')
    const eol = /\r\n$/.exec(origin)?.[0] ?? /\n$/.exec(origin)?.[0] ?? ''
    const rest = eol && trailing.startsWith(eol) ? trailing.slice(eol.length) : trailing
    if (origin && rest && tr.doc.nodeAt(lastPos)?.type === last.type) tr.setNodeAttribute(lastPos, 'blockTrailing', rest)
  }
  return true
}

const groupPlaceholderKey = new PluginKey<DecorationSet>('groupPlaceholder')

/** The placeholder on each group's first child while it is an empty text block. */
function groupPlaceholders(doc: PMNode): DecorationSet {
  const decos: Decoration[] = []
  doc.descendants((node, pos) => {
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
  })
  return DecorationSet.create(doc, decos)
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
          init: (_, state) => groupPlaceholders(state.doc),
          apply: (tr, old) => (tr.docChanged ? groupPlaceholders(tr.doc) : old),
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
