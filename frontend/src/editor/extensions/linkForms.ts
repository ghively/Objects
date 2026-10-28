/**
 * Links and entities written the short way keep that form.
 *
 * - A bare URL (`https://a.b`, `www.a.b`, `me@a.b`; GFM autolinks) or an
 *   `<https://a.b>` autolink is a link mark with `autolink` set to `bare` or
 *   `angle`. While its text is still its address it is written back that way,
 *   not as `[https://a.b](https://a.b)`; once the text changes it is written
 *   in full. Paragraphs and headings (`withTextEscapes`) protect such text
 *   from backslash and entity escaping, which an autolink would keep literally.
 * - `&nbsp;` reads as a non-breaking space (the Markdown parser only decodes
 *   `&amp;`, `&lt;`, `&gt;` and `&quot;`), and is written back as `&nbsp;`.
 *
 * Without these, such paragraphs did not round-trip and loaded as raw blocks.
 */
import { Extension, type AnyExtension, type JSONContent, type MarkdownToken } from '@tiptap/core'

/** A non-breaking space (U+00A0). */
export const NO_BREAK = String.fromCharCode(0xa0)

type LinkForm = 'bare' | 'angle'
type LinkAttrs = { href?: string; title?: string | null; autolink?: LinkForm | null }

/** Characters the text serializer would escape or encode. */
const ESCAPED = '\\`*_[]~&<>$'
/** Private-use stand-ins for them while a block renders (clear of Tiptap's U+E000/U+E001). */
const STAND_IN = [...ESCAPED].map((_, i) => String.fromCharCode(0xe100 + i))
const STAND_IN_RE = new RegExp(`[${STAND_IN.join('')}]`, 'g')

/** True when `text` is what an autolink of `href` shows. */
function showsAddress(text: string, href: string): boolean {
  return text === href || 'mailto:' + text === href || 'http://' + text === href
}

function isShortLink(attrs: LinkAttrs, text: string): boolean {
  return !!attrs.autolink && !attrs.title && showsAddress(text, attrs.href ?? '')
}

/** `content` with the text of short-form links protected from escaping (`restoreLinkText` undoes it). */
export function protectLinkText(content: JSONContent[] | undefined): JSONContent[] | undefined {
  if (!content) return content
  return content.map((n) => {
    if (n.type !== 'text' || !n.text || n.marks?.length !== 1 || n.marks[0].type !== 'link') return n
    if (!isShortLink((n.marks[0].attrs ?? {}) as LinkAttrs, n.text)) return n
    return { ...n, text: [...n.text].map((ch) => STAND_IN[ESCAPED.indexOf(ch)] ?? ch).join('') }
  })
}

export function restoreLinkText(md: string): string {
  return md.replace(STAND_IN_RE, (ch) => ESCAPED[STAND_IN.indexOf(ch)])
}

type ParseHelpers = {
  applyMark: (name: string, content: JSONContent[], attrs: Record<string, unknown>) => JSONContent[]
  parseInline: (tokens: MarkdownToken[]) => JSONContent[]
}

function formOf(token: MarkdownToken): LinkForm | null {
  const raw = (token as { raw?: string }).raw ?? ''
  if (raw.startsWith('<')) return 'angle'
  if (raw !== '' && !raw.startsWith('[')) return 'bare'
  return null
}

type Render = (node: JSONContent, h: unknown, ctx: { meta?: { markText?: string } } | undefined) => string

/** StarterKit's `link` with the `autolink` form attribute (other extensions unchanged). */
export function withLinkForms<T extends AnyExtension>(ext: T): T {
  if (ext.name !== 'link') return ext
  return ext.extend({
    addAttributes(this: { parent?: () => Record<string, unknown> }) {
      return { ...this.parent?.(), autolink: { default: null, rendered: false } }
    },
    parseMarkdown: (token: MarkdownToken, helpers: ParseHelpers) => {
      const t = token as MarkdownToken & { href?: string; title?: string | null; tokens?: MarkdownToken[] }
      return helpers.applyMark('link', helpers.parseInline(t.tokens || []), {
        href: t.href,
        title: t.title || null,
        autolink: formOf(token),
      })
    },
    renderMarkdown(this: { parent: Render | null }, node: JSONContent, h: unknown, ctx: Parameters<Render>[2]) {
      const attrs = (node.attrs ?? {}) as LinkAttrs
      const text = ctx?.meta?.markText
      // Only text that was protected (or needs no escaping) can be written as is.
      if (text !== undefined && ![...text].some((ch) => ESCAPED.includes(ch))) {
        if (isShortLink(attrs, restoreLinkText(text))) {
          const children = (h as { renderChildren: (n: JSONContent) => string }).renderChildren(node)
          return attrs.autolink === 'angle' ? `<${children}>` : children
        }
      }
      return this.parent?.(node, h, ctx) ?? ''
    },
  }) as unknown as T
}

/** `&nbsp;` in Markdown text: a non-breaking space in the editor. */
export const NbspEntity = Extension.create({
  name: 'nbspEntity',
  markdownTokenName: 'nbspEntity',
  markdownTokenizer: {
    name: 'nbspEntity',
    level: 'inline',
    start: (src: string) => src.indexOf('&nbsp;'),
    tokenize(src: string) {
      if (!src.startsWith('&nbsp;')) return undefined
      return { type: 'nbspEntity', raw: '&nbsp;', text: NO_BREAK }
    },
  },
  parseMarkdown: () => ({ type: 'text', text: NO_BREAK }),
})
