/**
 * `objectEmbed`: an embedded object, a line that is exactly `![[Title]]` (or
 * `![[Title|label]]`) whose target is not a media file (rule 7). Its view
 * ("Link block", "Small card", "Wide card", "Embed") is the `view` option.
 * Drawn by `embed/ObjectEmbedView.tsx` (Task 11); `renderHTML` stays the plain
 * form for copy and HTML export.
 */
import { Node, mergeAttributes, type Editor } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { ObjectEmbedView } from '../embed/ObjectEmbedView'
import { insertBlockNode } from './containers'
import './objectEmbed.css'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    objectEmbed: {
      /** Insert an embed of the object titled `target` below the current block. */
      insertObjectEmbed: (target: string, label?: string | null) => ReturnType
      /** Pick an object to embed (the link picker in `embed` mode; `false` when none is installed). */
      pickObjectEmbed: () => ReturnType
    }
  }
}

type EmbedPicker = (editor: Editor, range: { from: number; to: number }) => void
let embedPicker: EmbedPicker | null = null

/** Route `pickObjectEmbed()` to the app's picker (`installLinkPicker` sets it; `null` clears). */
export function setObjectEmbedPicker(fn: EmbedPicker | null): void {
  embedPicker = fn
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

  addNodeView() {
    return ReactNodeViewRenderer(ObjectEmbedView)
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
      pickObjectEmbed:
        () =>
        ({ editor, state, dispatch }) => {
          if (!embedPicker) return false
          if (dispatch) embedPicker(editor, { from: state.selection.from, to: state.selection.to })
          return true
        },
    }
  },
})
