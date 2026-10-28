/**
 * Escapes for text that would read back as other Markdown.
 *
 * `@tiptap/markdown` backslash-escapes inline delimiters (`*`, `_`, `` ` ``,
 * `[`, `~`) in text, but not what only means something at the start of a line
 * or in a heading: `# x`, `- x`, `1. x`, `2024. was good`, `---`, a `===` line
 * after a hard break, `$$` (a math block), a `$b$` pair (inline math) and a
 * heading's trailing ` #` (a closing sequence). Text typed or pasted with any
 * of those came back as another block. These escapes are added to paragraphs
 * and headings, and only where the text would otherwise be read differently.
 */
import type { AnyExtension, JSONContent } from '@tiptap/core'
import { findInlineMath } from './annotations'

/** Stands for a `$` typed in text while a block is rendered (private use). */
const DOLLAR = String.fromCharCode(0xe000)

const CODE_MARKS = new Set(['code'])

/** `content` with every `$` in plain (non-code) text replaced by `DOLLAR`. */
function markDollars(content: JSONContent[] | undefined): JSONContent[] | undefined {
  if (!content) return content
  return content.map((n) => {
    if (n.type !== 'text' || !n.text?.includes('$')) return n
    if ((n.marks ?? []).some((m) => CODE_MARKS.has(m.type))) return n
    return { ...n, text: n.text.replaceAll('$', DOLLAR) }
  })
}

/**
 * Turn `DOLLAR`s back into `$`, escaping the ones that would start or end
 * inline math with another dollar, and any `$$` that starts a line.
 */
function restoreDollars(md: string): string {
  if (!md.includes(DOLLAR)) return md
  let s = md.replace(new RegExp(`^( {0,3})${DOLLAR}(?=${DOLLAR})`, 'gm'), '$1\\$')
  for (;;) {
    const plain = s.replaceAll(DOLLAR, '$')
    const hit = findInlineMath(plain).find((m) => s[m.start] === DOLLAR || s[m.end - 1] === DOLLAR)
    if (!hit) return plain
    const at = s[hit.start] === DOLLAR ? hit.start : hit.end - 1
    s = s.slice(0, at) + '\\$' + s.slice(at + 1)
  }
}

/** Escape what would start another block at the start of each line of a paragraph. */
export function escapeLineStarts(md: string): string {
  return md
    .split('\n')
    .map((line, i) => {
      // An ATX heading: `#` to `######` then a space or the end of the line.
      let m = /^( {0,3})#{1,6}(?=[ \t]|$)/.exec(line)
      if (m) return m[1] + '\\' + line.slice(m[1].length)
      // A bullet item (`*` is escaped already).
      m = /^( {0,3})[-+](?=[ \t]|$)/.exec(line)
      if (m) return m[1] + '\\' + line.slice(m[1].length)
      // An ordered item: `1.` / `1)`, as in `2024. was good`.
      m = /^( {0,3}\d{1,9})([.)])(?=[ \t]|$)/.exec(line)
      if (m) return m[1] + '\\' + line.slice(m[1].length)
      // A thematic break (`---`), or a setext underline after a hard break.
      m = /^( {0,3})(-+)[ \t-]*$/.exec(line)
      if (m && (i > 0 || (line.match(/-/g) ?? []).length >= 3)) return m[1] + '\\' + line.slice(m[1].length)
      m = /^( {0,3})=+[ \t]*$/.exec(line)
      if (m && i > 0) return m[1] + '\\' + line.slice(m[1].length)
      return line
    })
    .join('\n')
}

/** A heading's trailing `#` run reads as a closing sequence: escape its first `#`. */
export function escapeHeadingEnd(md: string): string {
  return md.replace(/(^|[ \t])(#+[ \t]*)$/, '$1\\$2')
}

type Render = (node: JSONContent, h: unknown, ctx: unknown) => string

/** `ext` (StarterKit's paragraph or heading) with these escapes in its Markdown. */
export function withTextEscapes<T extends AnyExtension>(ext: T): T {
  if (ext.name === 'paragraph') {
    return ext.extend({
      renderMarkdown(this: { parent: Render | null }, node: JSONContent, h: unknown, ctx: unknown) {
        const md = this.parent?.({ ...node, content: markDollars(node.content) }, h, ctx) ?? ''
        return restoreDollars(escapeLineStarts(md))
      },
    }) as unknown as T
  }
  if (ext.name === 'heading') {
    return ext.extend({
      renderMarkdown(this: { parent: Render | null }, node: JSONContent, h: unknown, ctx: unknown) {
        const md = this.parent?.({ ...node, content: markDollars(node.content) }, h, ctx) ?? ''
        if (!node.content?.length) return restoreDollars(md)
        const prefix = /^#+ /.exec(md)?.[0] ?? ''
        return prefix + restoreDollars(escapeHeadingEnd(md.slice(prefix.length)))
      },
    }) as unknown as T
  }
  return ext
}
