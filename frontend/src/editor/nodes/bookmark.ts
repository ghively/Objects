/**
 * `bookmark`: the web link block, an annotated paragraph holding exactly one
 * link:
 *
 *   <!-- block: bookmark -->
 *   [Proxmox docs](https://pve.proxmox.com/wiki)
 *
 * Loaded only with the `bookmark` option and a one-link paragraph. Nothing is
 * fetched. Rendering is minimal here; Task 11 adds the card.
 */
import { Node, mergeAttributes } from '@tiptap/core'
import { makeOption } from '../annotations'
import { insertBlockNode } from './containers'
import './bookmark.css'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    bookmark: {
      /** Insert a web link block below the current block. */
      insertBookmark: (href: string, title?: string) => ReturnType
    }
  }
}

export function bookmarkMarkdown(href: string, title: string | null | undefined): string {
  return `[${title ?? ''}](${href})`
}

export const Bookmark = Node.create({
  name: 'bookmark',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      href: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-href') ?? '',
        renderHTML: (attrs: { href: string }) => ({ 'data-href': attrs.href }),
      },
      title: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-title') ?? '',
        renderHTML: (attrs: { title: string }) => ({ 'data-title': attrs.title }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-bookmark]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-bookmark': '', class: 'bookmark-block' }),
      node.attrs.title || node.attrs.href || '',
    ]
  },

  renderText({ node }) {
    return bookmarkMarkdown(node.attrs.href, node.attrs.title)
  },

  renderMarkdown(node: { attrs?: { href?: string; title?: string } }) {
    return bookmarkMarkdown(node.attrs?.href ?? '', node.attrs?.title)
  },

  addCommands() {
    return {
      insertBookmark:
        (href, title) =>
        ({ tr, state, dispatch }) => {
          if (!dispatch) return true
          const node = state.schema.nodes.bookmark.create({
            href,
            title: title ?? href,
            blockOptions: [makeOption('bookmark', true)],
          })
          insertBlockNode(tr, node)
          return true
        },
    }
  },
})
