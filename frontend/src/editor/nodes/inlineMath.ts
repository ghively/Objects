/**
 * `inlineMath`: an inline formula, `$…$` with Pandoc's dollar rules (rule 6,
 * `findInlineMath`). Rendering is plain text here; Task 9 adds KaTeX.
 */
import { Node, mergeAttributes, type MarkdownToken } from '@tiptap/core'
import { findInlineMath } from '../annotations'
import './inlineMath.css'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    inlineMath: {
      /** Insert an inline formula at the selection. */
      insertInlineMath: (text: string) => ReturnType
    }
  }
}

export function inlineMathMarkdown(text: string): string {
  return `$${text}$`
}

export const InlineMath = Node.create({
  name: 'inlineMath',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

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
    return [{ tag: 'span[data-inline-math]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-inline-math': '', class: 'inline-math' }), node.attrs.text || '']
  },

  renderText({ node }) {
    return inlineMathMarkdown(node.attrs.text)
  },

  markdownTokenizer: {
    name: 'inlineMath',
    level: 'inline',
    start: (src: string) => {
      if (!src.includes('$')) return -1
      const first = findInlineMath(src)[0]
      return first ? first.start : -1
    },
    tokenize(src: string) {
      if (src[0] !== '$') return undefined
      const first = findInlineMath(src)[0]
      if (!first || first.start !== 0) return undefined
      return { type: 'inlineMath', raw: src.slice(0, first.end), text: first.text }
    },
  },

  parseMarkdown(token: MarkdownToken) {
    const t = token as MarkdownToken & { text?: string }
    return { type: 'inlineMath', attrs: { text: t.text ?? '' } }
  },

  renderMarkdown(node: { attrs?: { text?: string } }) {
    return inlineMathMarkdown(node.attrs?.text ?? '')
  },

  addCommands() {
    return {
      insertInlineMath:
        (text) =>
        ({ commands }) =>
          commands.insertContent({ type: 'inlineMath', attrs: { text } }),
    }
  },
})
