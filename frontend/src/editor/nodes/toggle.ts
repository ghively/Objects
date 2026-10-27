/**
 * `toggle`: a container whose first child is the toggle's own line and the
 * rest its children. In the file:
 *
 *   <!-- toggle open -->
 *   ### Server checklist
 *   - [ ] Patch the hosts
 *   <!-- /toggle -->
 *
 * `open` is a container option (`toggle.isOpen`; absent = closed). Rendering is
 * a plain `div` here; Task 8 adds the caret node view.
 */
import { Node, mergeAttributes } from '@tiptap/core'
import type { Option } from '../annotations'
import { ancestorOfType, containerSourceAttributes, flag, unwrapAt, wrapBlocks } from './containers'
import { setOptionAt } from './blockOptions'
import './toggle.css'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    toggle: {
      /** Wrap the selected blocks in a toggle (open, so its children stay visible). */
      wrapInToggle: () => ReturnType
      /** Replace the toggle around the selection by its blocks. */
      unwrapToggle: () => ReturnType
      /** Open or close the toggle at `pos` (writes or removes its `open` option). */
      setToggleOpen: (pos: number, open: boolean) => ReturnType
    }
  }
}

export function isToggleOpen(options: Option[] | null | undefined): boolean {
  return (options ?? []).some((o) => o.key === 'open' && o.value === true)
}

export const Toggle = Node.create({
  name: 'toggle',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return containerSourceAttributes()
  },

  parseHTML() {
    return [{ tag: 'div[data-toggle]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const open = isToggleOpen(node.attrs.blockOptions as Option[] | null)
    return ['div', mergeAttributes(HTMLAttributes, { 'data-toggle': '', 'data-open': open ? 'true' : 'false', class: 'block-toggle' }), 0]
  },

  renderMarkdown(node: { content?: unknown[] }, h: { renderChildren: (c: unknown[], sep: string) => string }) {
    return node.content ? h.renderChildren(node.content, '\n\n') : ''
  },

  addCommands() {
    return {
      wrapInToggle:
        () =>
        ({ tr, state, dispatch }) => {
          if (!dispatch) return true
          return wrapBlocks(tr, state.schema.nodes.toggle, [flag('open')])
        },
      unwrapToggle:
        () =>
        ({ tr, dispatch }) => {
          const found = ancestorOfType(tr, 'toggle')
          if (!found) return false
          if (!dispatch) return true
          return unwrapAt(tr, found.pos)
        },
      setToggleOpen:
        (pos, open) =>
        ({ tr, dispatch }) => {
          const node = tr.doc.nodeAt(pos)
          if (!node || node.type.name !== 'toggle') return false
          if (dispatch) setOptionAt(tr, pos, 'open', open ? true : null)
          return true
        },
    }
  },
})
