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

/**
 * A full or collapsed reference link (`[a][r]`, `[a][]`) or a footnote
 * reference (`[^1]`), but not a footnote definition (`[^1]:` at a line start,
 * which stays escaped unless the body refers to it: `protectReferences`).
 */
const REFERENCE = /(?<![^\n])\[\^[^\]\s]+\](?!:)|(?<=[^\n])\[\^[^\]\s]+\]|\[[^[\]\n]+\]\[[^[\]\n]*\]/g

/**
 * The link definitions and footnote references of the body being saved
 * (`withReferences`): a shortcut reference `[foo]` is a link only when the
 * body defines `[foo]:`, and a footnote definition line `[^1]: …` is one only
 * when the body refers to `[^1]` (audit 2026-11-07 #37).
 */
export type BodyReferences = { labels: Set<string>; footnotes: Set<string> }
let bodyReferences: BodyReferences | null = null

/** A link label as Markdown matches it: case-folded, inner blanks collapsed. */
const labelKey = (label: string) => label.trim().replace(/\s+/g, ' ').toLowerCase()

/** The link definitions (`[foo]: …` at a line start) and footnote references (`[^1]`) in `text`. */
export function referencesIn(text: string): BodyReferences {
  const labels = new Set<string>()
  const footnotes = new Set<string>()
  if (!text.includes('[')) return { labels, footnotes }
  for (const m of text.matchAll(/^ {0,3}\[([^\]\n^][^\]\n]*)\]:/gm)) labels.add(labelKey(m[1]))
  for (const m of text.matchAll(/\[\^([^\]\s]+)\]/g)) {
    const at = m.index ?? 0
    const lineStart = text.lastIndexOf('\n', at - 1) + 1
    const definition = /^ {0,3}$/.test(text.slice(lineStart, at)) && text[at + m[0].length] === ':'
    if (!definition) footnotes.add(m[1])
  }
  return { labels, footnotes }
}

/** Run `fn` (a serialize) with the body's references known to `protectReferences`. */
export function withReferences<T>(refs: BodyReferences | null, fn: () => T): T {
  const previous = bodyReferences
  bodyReferences = refs
  try {
    return fn()
  } finally {
    bodyReferences = previous
  }
}

/** A shortcut reference `[foo]` (not followed by a link's `(` or `[`). */
const SHORTCUT = /\[([^[\]\n^][^[\]\n]*)\](?![[(])/g
/** What follows a label when its line is a link definition: one destination, maybe a title. */
const LINK_DEFINITION_REST = /^:[ \t]*\S+[ \t]*(?:(?:"[^"]*"|'[^']*'|\([^)]*\))[ \t]*)?$/
/** A footnote definition's label at a line start. */
const FOOTNOTE_DEFINITION = /(?<![^\n])( {0,3})\[\^([^\]\s]+)\](?=:)/g

/**
 * `text` with the brackets of reference links and footnote references
 * protected from escaping: their definitions live in other blocks, and
 * escaped brackets would turn them into plain text for other Markdown readers.
 * With the body's references known (`withReferences`), a shortcut reference
 * whose label the body defines and a footnote definition the body refers to
 * are protected too.
 */
export function protectReferences(text: string): string {
  if (!text.includes('[')) return text
  const open = STAND_IN[ESCAPED.indexOf('[')]
  const close = STAND_IN[ESCAPED.indexOf(']')]
  const protect = (m: string) => m.replaceAll('[', open).replaceAll(']', close)
  let out = text.replace(REFERENCE, protect)
  const refs = bodyReferences
  if (refs && refs.labels.size)
    out = out.replace(SHORTCUT, (m, label: string, at: number, s: string) => {
      // `[foo]:` at a line start would be a definition: it stays escaped (a paragraph).
      const lineStart = s.lastIndexOf('\n', at - 1) + 1
      if (s[at + m.length] === ':' && /^ {0,3}$/.test(s.slice(lineStart, at))) return m
      return refs.labels.has(labelKey(label)) ? protect(m) : m
    })
  if (refs && refs.footnotes.size)
    out = out.replace(FOOTNOTE_DEFINITION, (m, indent: string, label: string, at: number, s: string) => {
      // `[^1]: word` (or `word "title"`) would read back as a link definition: it stays escaped.
      const rest = s.slice(at + m.length).split('\n')[0]
      if (LINK_DEFINITION_REST.test(rest)) return m
      return refs.footnotes.has(label) ? indent + protect(m.slice(indent.length)) : m
    })
  return out
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
