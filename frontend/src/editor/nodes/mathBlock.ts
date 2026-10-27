/**
 * `mathBlock`: a display formula (Capacities' `MathBlock`), plain Markdown as
 * GitHub and Obsidian read it:
 *
 *   $$
 *   E = mc^2
 *   $$
 *
 * Loaded from the `math` source block (rule 6); an edited block is written in
 * the form `$$⏎text⏎$$`. Rendering is plain text here; Task 9 adds KaTeX.
 */
import { Node, mergeAttributes } from '@tiptap/core'
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

/** The TeX inside a math source block: the delimiters and their line breaks removed, LF line ends. */
export function mathBlockText(raw: string): string {
  let s = raw.replace(/\r\n?/g, '\n').replace(/\n$/, '')
  s = s.replace(/^ {0,3}\$\$/, '').replace(/\$\$[ \t]*$/, '')
  if (s.startsWith('\n')) s = s.slice(1)
  if (s.endsWith('\n')) s = s.slice(0, -1)
  return s
}

export function mathBlockMarkdown(text: string): string {
  return `$$\n${text}\n$$`
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
