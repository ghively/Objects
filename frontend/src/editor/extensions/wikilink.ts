/**
 * `wikilink`: an inline atom for `[[Target]]` / `[[Target|Label]]`.
 * Attributes: `target` (the link text resolved by the back end) and `label`
 * (display text, or null when the link has none).
 */
import { Node, mergeAttributes, type MarkdownToken } from '@tiptap/core'

export const WIKILINK_RE = /^\[\[([^[\]\n|]+?)(?:\|([^[\]\n]+?))?\]\]/

export function wikilinkMarkdown(target: string, label: string | null): string {
  return label ? `[[${target}|${label}]]` : `[[${target}]]`
}

export const Wikilink = Node.create({
  name: 'wikilink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

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
        renderHTML: (attrs: { label: string | null }) =>
          attrs.label ? { 'data-label': attrs.label } : {},
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-wikilink]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-wikilink': '', class: 'wikilink' }),
      node.attrs.label || node.attrs.target,
    ]
  },

  renderText({ node }) {
    return wikilinkMarkdown(node.attrs.target, node.attrs.label)
  },

  markdownTokenizer: {
    name: 'wikilink',
    level: 'inline',
    start: (src: string) => src.indexOf('[['),
    tokenize(src: string) {
      const m = WIKILINK_RE.exec(src)
      if (!m) return undefined
      return { type: 'wikilink', raw: m[0], target: m[1], label: m[2] ?? null }
    },
  },

  parseMarkdown(token: MarkdownToken) {
    const t = token as MarkdownToken & { target?: string; label?: string | null }
    return { type: 'wikilink', attrs: { target: t.target ?? '', label: t.label ?? null } }
  },

  renderMarkdown(node: { attrs?: { target?: string; label?: string | null } }) {
    return wikilinkMarkdown(node.attrs?.target ?? '', node.attrs?.label ?? null)
  },
})
