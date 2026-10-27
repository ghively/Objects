/**
 * `objectEmbed`: an embedded object, a line that is exactly `![[Title]]` (or
 * `![[Title|label]]`) whose target is not a media file (rule 7). Its view
 * ("Link block", "Small card", "Wide card", "Embed") is the `view` option.
 * Rendering is minimal here; Task 11 adds the card view.
 */
import { Node, mergeAttributes } from '@tiptap/core'
import { insertBlockNode } from './containers'
import './objectEmbed.css'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    objectEmbed: {
      /** Insert an embed of the object titled `target` below the current block. */
      insertObjectEmbed: (target: string, label?: string | null) => ReturnType
      /** Pick an object to embed (Task 11; `false` until then). */
      pickObjectEmbed: () => ReturnType
    }
  }
}

export function objectEmbedMarkdown(target: string, label: string | null | undefined): string {
  return label ? `![[${target}|${label}]]` : `![[${target}]]`
}

export const ObjectEmbed = Node.create({
  name: 'objectEmbed',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      target: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-target') ?? '',
        renderHTML: (attrs: { target: string }) => ({ 'data-target': attrs.target }),
      },
      label: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-label'),
        renderHTML: (attrs: { label: string | null }) => (attrs.label ? { 'data-label': attrs.label } : {}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-object-embed]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-object-embed': '', class: 'object-embed' }),
      node.attrs.label || node.attrs.target || '',
    ]
  },

  renderText({ node }) {
    return objectEmbedMarkdown(node.attrs.target, node.attrs.label)
  },

  renderMarkdown(node: { attrs?: { target?: string; label?: string | null } }) {
    return objectEmbedMarkdown(node.attrs?.target ?? '', node.attrs?.label)
  },

  addCommands() {
    return {
      insertObjectEmbed:
        (target, label = null) =>
        ({ tr, state, dispatch }) => {
          if (!dispatch) return true
          insertBlockNode(tr, state.schema.nodes.objectEmbed.create({ target, label }))
          return true
        },
      pickObjectEmbed: () => () => false,
    }
  },
})
