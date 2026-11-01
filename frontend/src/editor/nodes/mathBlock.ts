/**
 * `mathBlock`: a display formula (Object's `MathBlock`), plain Markdown as
 * GitHub and Obsidian read it:
 *
 *   $$
 *   E = mc^2
 *   $$
 *
 * Loaded from the `math` source block (rule 6); an edited block is written in
 * the form `$$⏎text⏎$$`. Rendered with KaTeX by `math/MathBlockView.tsx`
 * (Task 9); `renderHTML` stays the plain form for copy and HTML export.
 */
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { MathBlockView } from '../math/MathBlockView'
import { insertBlockNode } from './containers'
import './mathBlock.css'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mathBlock: {
      /** Insert a math block below the current block (replacing it when it is an empty paragraph). */
      insertMathBlock: (text?: string) => ReturnType
    }
  }
}

/**
 * The TeX inside a math source block: the delimiters and their line breaks
 * removed, LF line ends, and a `\$$` at a line end read back as the `$$` it
 * stands for (`blocks.ts` `MATH_CLOSE`: an unescaped one would close the block).
 */
export function mathBlockText(raw: string): string {
  let s = raw.replace(/\r\n?/g, '\n').replace(/\n$/, '')
  s = s.replace(/^ {0,3}\$\$/, '').replace(/\$\$[ \t]*$/, '')
  if (s.startsWith('\n')) s = s.slice(1)
  if (s.endsWith('\n')) s = s.slice(0, -1)
  return s.replace(/\\(\$\$[ \t]*)$/gm, '$1')
}

/** The block's Markdown; a `$$` ending a line of the formula is written `\$$` so it does not close the block. */
export function mathBlockMarkdown(text: string): string {
  return `$$\n${text.replace(/(?<!\\)(\$\$[ \t]*)$/gm, '\\$1')}\n$$`
}

export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      text: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-text') ?? el.textContent ?? '',
        renderHTML: (attrs: { text: string }) => ({ 'data-text': attrs.text }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-math-block]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-math-block': '', class: 'math-block' }), node.attrs.text || '']
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathBlockView)
  },

  renderText({ node }) {
    return mathBlockMarkdown(node.attrs.text)
  },

  renderMarkdown(node: { attrs?: { text?: string } }) {
    return mathBlockMarkdown(node.attrs?.text ?? '')
  },

  addCommands() {
    return {
      insertMathBlock:
        (text = '') =>
        ({ tr, state, dispatch }) => {
          if (!dispatch) return true
          insertBlockNode(tr, state.schema.nodes.mathBlock.create({ text }))
          return true
        },
    }
  },
})
