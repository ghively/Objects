/**
 * `dateToken` (M8): an inline atom for a date, written as
 *
 *   <time datetime="2026-10-27">2026-10-27</time>
 *
 * (inline HTML, our choice). A new token's element text is the ISO day, so the
 * file reads cleanly; any text found inside on read is kept (`text`) and
 * written back as it was.
 *
 * Plain rendering here: the element's text. Task 26 adds the chip (the day in
 * the user's date format; a click opens that daily note).
 */
import { Node, mergeAttributes, type MarkdownToken } from '@tiptap/core'

const TIME_RE = /^<time datetime="(\d{4}-\d{2}-\d{2})">([^<\r\n]*)<\/time>/

export const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

export function dateTokenMarkdown(date: string, text?: string | null): string {
  return `<time datetime="${date}">${text ?? date}</time>`
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    dateToken: {
      /** Insert a date token for `day` (`YYYY-MM-DD`) at the selection. */
      insertDateToken: (day: string) => ReturnType
    }
  }
}

export const DateToken = Node.create({
  name: 'dateToken',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      date: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('datetime') ?? '',
        renderHTML: (attrs: { date: string }) => ({ datetime: attrs.date }),
      },
      /** The element text as read; `null` writes the ISO day. */
      text: {
        default: null,
        rendered: false,
        parseHTML: (el: HTMLElement) => {
          const t = el.textContent ?? ''
          return t === el.getAttribute('datetime') ? null : t
        },
      },
    }
  },

  parseHTML() {
    // Only a day: any other `<time>` is not a token (its block stays raw).
    return [{ tag: 'time[datetime]', getAttrs: (el) => (ISO_DAY.test(el.getAttribute('datetime') ?? '') ? null : false) }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'time',
      mergeAttributes(HTMLAttributes, { class: 'date-token', 'data-date-token': '' }),
      (node.attrs.text as string | null) ?? node.attrs.date,
    ]
  },

  renderText({ node }) {
    return (node.attrs.text as string | null) ?? node.attrs.date
  },

  markdownTokenizer: {
    name: 'dateToken',
    level: 'inline',
    start: (src: string) => src.indexOf('<time datetime="'),
    tokenize(src: string) {
      const m = TIME_RE.exec(src)
      if (!m) return undefined
      return { type: 'dateToken', raw: m[0], date: m[1], text: m[2] }
    },
  },

  parseMarkdown(token: MarkdownToken) {
    const t = token as MarkdownToken & { date?: string; text?: string }
    const date = t.date ?? ''
    return { type: 'dateToken', attrs: { date, text: t.text === date ? null : (t.text ?? null) } }
  },

  renderMarkdown(node: { attrs?: { date?: string; text?: string | null } }) {
    return dateTokenMarkdown(node.attrs?.date ?? '', node.attrs?.text)
  },

  addCommands() {
    return {
      insertDateToken:
        (day) =>
        ({ commands }) => {
          if (!ISO_DAY.test(day)) return false
          return commands.insertContent({ type: 'dateToken', attrs: { date: day, text: null } })
        },
    }
  },
})
