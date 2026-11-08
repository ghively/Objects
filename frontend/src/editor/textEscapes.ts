/**
 * Escapes for text that would read back as other Markdown.
 *
 * `@tiptap/markdown` backslash-escapes inline delimiters (`*`, `_`, `` ` ``,
 * `[`, `~`) in text, but not what only means something at the start of a line
 * or in a heading: `# x`, `- x`, `1. x`, `2024. was good`, `---`, a `===` line
 * after a hard break, `$$` (a math block), a `$b$` pair (inline math), a
 * heading's trailing ` #` (a closing sequence), a first line indented four
 * columns (an indented code block) and a `Key:: value` field line. Text typed
 * or pasted with any
 * of those came back as another block. These escapes are added to paragraphs
 * and headings, and only where the text would otherwise be read differently.
 */
import type { AnyExtension, JSONContent } from '@tiptap/core'
import { findInlineMath } from './annotations'
import { NO_BREAK, protectLinkText, protectReferences, restoreLinkText } from './extensions/linkForms'

/** Stands for a `$` typed in text while a block is rendered (private use). */
const DOLLAR = String.fromCharCode(0xe0f0)
/** Stands for a non-breaking space typed in text, written as `&nbsp;`. */
const NBSP = String.fromCharCode(0xe0f1)

const CODE_MARKS = new Set(['code'])

/**
 * `content` ready to render: short-form link text protected, and in other
 * plain (non-code) text the brackets of reference links protected, every `$`
 * replaced by `DOLLAR` and every non-breaking space by `NBSP` (`finish` puts
 * them back).
 */
function prepare(content: JSONContent[] | undefined): JSONContent[] | undefined {
  if (!content) return content
  return protectLinkText(content)!.map((n) => {
    if (n.type !== 'text' || !n.text || !/[$[]/.test(n.text) && !n.text.includes(NO_BREAK)) return n
    if ((n.marks ?? []).some((m) => CODE_MARKS.has(m.type))) return n
    return { ...n, text: protectReferences(n.text).replaceAll('$', DOLLAR).replaceAll(NO_BREAK, NBSP) }
  })
}

function finish(md: string): string {
  return restoreLinkText(restoreDollars(md).replaceAll(NBSP, '&nbsp;'))
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
      // A first line indented four columns (a tab, or four spaces) would be an
      // indented code block; a non-breaking space keeps the indent readable.
      let m = /^[ \t]+/.exec(line)
      if (m && i === 0 && (m[0].includes('\t') || m[0].length >= 4)) return '&nbsp;' + line.slice(1)
      // An ATX heading: `#` to `######` then a space or the end of the line.
      m = /^( {0,3})#{1,6}(?=[ \t]|$)/.exec(line)
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
      // A `Key:: value` field line (kept raw on load, `document.ts` `FIELD_LINE`).
      m = /^([^\s:][^:]*)::(?=[ \t]|$)/.exec(line)
      if (m) return m[1] + '\\' + line.slice(m[1].length)
      return line
    })
    .join('\n')
}

/** A heading's trailing `#` run reads as a closing sequence: escape its first `#`. */
export function escapeHeadingEnd(md: string): string {
  return md.replace(/(^|[ \t])(#+[ \t]*)$/, '$1\\$2')
}

/**
 * A heading is one line in Markdown: a line break in it (from a multi-line
 * paragraph turned into a heading, or Shift-Enter) would end the heading and
 * start a paragraph on reload, so it is saved as a space.
 */
function oneLine(content: JSONContent[] | undefined): JSONContent[] | undefined {
  if (!content) return content
  return content.map((n) => {
    if (n.type === 'hardBreak') return { type: 'text', text: ' ', marks: n.marks }
    if (n.type === 'text' && n.text?.includes('\n')) return { ...n, text: n.text.replace(/[ \t]*\n[ \t]*/g, ' ') }
    return n
  })
}

type Render = (node: JSONContent, h: unknown, ctx: unknown) => string

/**
 * An ordered item whose text starts with a box (`1. [ ] a`) is a GFM task item
 * that the editor shows as text: the serializer's escaped brackets (`\\[ \\]`)
 * would drop its checkbox for other Markdown readers, so they are written bare
 * (audit 2026-11-07 #18). The load keeps such a list editable only when the
 * source box was bare too (`document.ts`, `sameListShape`).
 */
export function unescapeOrderedBox(md: string): string {
  return md.replace(/^([ \t]*\d{1,9}[.)][ \t]+)\\\[([ xX])\\\](?= +\S)/, '$1[$2]')
}

/** `ext` (StarterKit's paragraph or heading) with these escapes in its Markdown. */
export function withTextEscapes<T extends AnyExtension>(ext: T): T {
  if (ext.name === 'paragraph') {
    return ext.extend({
      renderMarkdown(this: { parent: Render | null }, node: JSONContent, h: unknown, ctx: unknown) {
        const md = this.parent?.({ ...node, content: prepare(node.content) }, h, ctx) ?? ''
        return finish(escapeLineStarts(md))
      },
    }) as unknown as T
  }
  if (ext.name === 'heading') {
    return ext.extend({
      renderMarkdown(this: { parent: Render | null }, node: JSONContent, h: unknown, ctx: unknown) {
        const md = this.parent?.({ ...node, content: prepare(oneLine(node.content)) }, h, ctx) ?? ''
        if (!node.content?.length) return finish(md)
        const prefix = /^#+ /.exec(md)?.[0] ?? ''
        return prefix + finish(escapeHeadingEnd(md.slice(prefix.length)))
      },
    }) as unknown as T
  }
  if (ext.name === 'listItem') {
    return ext.extend({
      renderMarkdown(this: { parent: Render | null }, node: JSONContent, h: unknown, ctx: unknown) {
        const md = this.parent?.(node, h, ctx) ?? ''
        return (ctx as { parentType?: string } | undefined)?.parentType === 'orderedList' ? unescapeOrderedBox(md) : md
      },
    }) as unknown as T
  }
  return ext
}
