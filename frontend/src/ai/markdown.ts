/**
 * The AI chat's Markdown renderer (M16, spec section 10): a reply or a user message as HTML that
 * is safe to set as `innerHTML`. Pure, no React; `ChatMarkdown` brings the result to life.
 *
 * A private `marked` instance (the approach `TextBlockCell` uses for inline Markdown, extended to
 * blocks), so nothing leaks into other users of `marked`:
 *
 * - raw HTML (block or inline) is shown as its source text, never parsed;
 * - links keep only `http`, `https`, `mailto` and relative hrefs (`safeHref`), open in a new
 *   window with `rel="noopener noreferrer"`; a relative link ending in `.md`, and `[[Target]]` /
 *   `[[Target|label]]`, become wikilink chips that open in Object;
 * - images show as their alt text (no fetch);
 * - fenced code is highlighted with the editor's lazy highlight.js (plain until the grammar loads);
 * - task list boxes are disabled checkboxes;
 * - `$…$` (Pandoc's dollar rules, `findInlineMath`) and `$$` blocks (the editor's rule) render
 *   with the editor's KaTeX (`trust: false`).
 *
 * Text longer than `MAX_RENDER_CHARS` is shown as escaped plain paragraphs instead.
 */
import { Marked, type Tokens, type TokenizerAndRendererExtension } from 'marked'
import { highlightTokens } from '@/editor/code/highlight'
import { findInlineMath } from '@/editor/annotations'
import { WIKILINK_RE } from '@/editor/extensions/wikilink'
import { renderDisplayMath, renderMath } from '@/editor/math/renderMath'
import { safeHref } from '@/properties/cells/TextBlockCell'

/** Longer text renders as escaped plain paragraphs (our number). */
export const MAX_RENDER_CHARS = 200_000

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function chip(target: string, label: string | null): string {
  const data = `data-wikilink="" data-target="${escapeHtml(target)}"` + (label ? ` data-label="${escapeHtml(label)}"` : '')
  return `<span class="wikilink" ${data}>${escapeHtml(label || target)}</span>`
}

/** `[[Target]]` and `[[Target|label]]` as a link chip (as `TextBlockCell`'s). */
const wikilink: TokenizerAndRendererExtension = {
  name: 'wikilink',
  level: 'inline',
  start: (src) => {
    const at = src.indexOf('[[')
    return at < 0 ? undefined : at
  },
  tokenizer(src) {
    const m = WIKILINK_RE.exec(src)
    if (!m) return undefined
    return { type: 'wikilink', raw: m[0], target: m[1], label: m[2] ?? null }
  },
  renderer(token) {
    return chip(String(token.target), token.label ? String(token.label) : null)
  },
}

/** The first inline formula in `src`, Pandoc's rule (the editor's `findInlineMath`). */
function firstMath(src: string) {
  if (!src.includes('$')) return undefined
  return findInlineMath(src)[0]
}

/** `\$` is a literal dollar (Pandoc): kept whole so the `$` after it never opens a formula. */
const dollarEscape: TokenizerAndRendererExtension = {
  name: 'dollarEscape',
  level: 'inline',
  start: (src) => {
    const at = src.indexOf('\\$')
    return at < 0 ? undefined : at
  },
  tokenizer(src) {
    return src.startsWith('\\$') ? { type: 'dollarEscape', raw: '\\$' } : undefined
  },
  renderer() {
    return '$'
  },
}

const inlineMath: TokenizerAndRendererExtension = {
  name: 'inlineMath',
  level: 'inline',
  start: (src) => firstMath(src)?.start,
  tokenizer(src) {
    if (src[0] !== '$') return undefined
    const hit = firstMath(src)
    if (!hit || hit.start !== 0) return undefined
    return { type: 'inlineMath', raw: src.slice(0, hit.end), tex: hit.text }
  },
  renderer(token) {
    return renderMath(String(token.tex), { display: false })
  },
}

// The editor's math block rule (`editor/blocks.ts`): a line that begins with `$$` (up to 3 spaces
// of indent) opens; the block ends at the next line ending in `$$` (not `\$$`); `$$x$$` alone on
// a line is a one-line block; without a closing line it is not a math block.
const MATH_OPEN = /^ {0,3}\$\$/
const MATH_CLOSE = /(?<!\\)\$\$[ \t]*$/
const MATH_OPEN_LINE = /(^|\n) {0,3}\$\$/

/** Length of the math block at the start of `src` (no final line break), or 0. */
function matchMath(src: string): number {
  if (!MATH_OPEN.test(src)) return 0
  let eol = src.indexOf('\n')
  if (eol < 0) eol = src.length
  const first = src.slice(0, eol).replace(/^ +/, '').replace(/[ \t]+$/, '')
  if (first.length >= 4 && first.endsWith('$$')) return eol
  let start = eol + 1
  while (start <= src.length && eol < src.length) {
    eol = src.indexOf('\n', start)
    if (eol < 0) eol = src.length
    if (MATH_CLOSE.test(src.slice(start, eol))) return eol
    start = eol + 1
  }
  return 0
}

/** The TeX inside a math block: the delimiters and their line breaks removed (as `mathBlockText`). */
function mathText(raw: string): string {
  let s = raw.replace(/\r\n?/g, '\n').replace(/\n$/, '')
  s = s.replace(/^ {0,3}\$\$/, '').replace(/\$\$[ \t]*$/, '')
  if (s.startsWith('\n')) s = s.slice(1)
  if (s.endsWith('\n')) s = s.slice(0, -1)
  return s.replace(/\\(\$\$[ \t]*)$/gm, '$1')
}

const mathBlock: TokenizerAndRendererExtension = {
  name: 'mathBlock',
  level: 'block',
  start: (src) => {
    const m = MATH_OPEN_LINE.exec(src)
    return m ? m.index + m[1].length : undefined
  },
  tokenizer(src) {
    const len = matchMath(src)
    if (!len) return undefined
    const raw = src.slice(0, len) + (src[len] === '\n' ? '\n' : '')
    return { type: 'mathBlock', raw, tex: mathText(src.slice(0, len)) }
  },
  renderer(token) {
    return `<div class="chat-math">${renderDisplayMath(String(token.tex))}</div>\n`
  },
}

/** The fence's language: the info string's first word. */
function fenceLanguage(lang: string | undefined): string {
  return (lang ?? '').trim().split(/\s+/, 1)[0] ?? ''
}

/** Code text as HTML: escaped slices, the highlighted runs wrapped in `hljs-*` spans. */
function highlighted(text: string, language: string): string {
  const tokens = language ? highlightTokens(text, language) : []
  let out = ''
  let at = 0
  for (const t of tokens) {
    if (t.from > at) out += escapeHtml(text.slice(at, t.from))
    out += `<span class="${escapeHtml(t.className)}">${escapeHtml(text.slice(t.from, t.to))}</span>`
    at = t.to
  }
  return out + escapeHtml(text.slice(at))
}

/** A relative link to a Markdown file: the object path it names (decoded, `.md` removed), else null. */
function objectTarget(href: string): string | null {
  if (/^(https?|mailto):/i.test(href) || href.startsWith('#') || href.startsWith('//')) return null
  const path = href.split(/[?#]/, 1)[0]
  if (!/\.md$/i.test(path)) return null
  let decoded = path
  try {
    decoded = decodeURIComponent(path)
  } catch {
    // A malformed escape: keep the text as written.
  }
  const target = decoded.replace(/\.md$/i, '').replace(/^\.\//, '')
  return target ? target : null
}

// A private instance so the overrides do not leak into other users of the global `marked`.
const md = new Marked({
  async: false,
  gfm: true,
  breaks: true,
  extensions: [mathBlock, wikilink, dollarEscape, inlineMath],
  renderer: {
    html(token) {
      const text = escapeHtml(token.text)
      return 'block' in token && token.block ? `<p class="chat-raw">${text}</p>\n` : text
    },
    link({ href, title, tokens, text }) {
      const inner = this.parser.parseInline(tokens)
      const safe = safeHref(href)
      if (safe === null) return inner
      const target = objectTarget(safe)
      if (target !== null) return chip(target, text || null)
      const t = title ? ` title="${escapeHtml(title)}"` : ''
      return `<a href="${escapeHtml(safe)}"${t} target="_blank" rel="noopener noreferrer">${inner}</a>`
    },
    image({ text }) {
      return escapeHtml(text)
    },
    code({ text, lang }: Tokens.Code) {
      const language = fenceLanguage(lang)
      const code = text.replace(/\n$/, '')
      return `<pre class="chat-code" data-language="${escapeHtml(language)}"><code>${highlighted(code, language)}</code></pre>\n`
    },
    checkbox({ checked }: Tokens.Checkbox) {
      return `<input type="checkbox" disabled${checked ? ' checked' : ''}> `
    },
  },
})

/** Too long to parse while streaming: escaped paragraphs split on blank lines. */
function plain(source: string): string {
  return source
    .split(/\r?\n[ \t]*\r?\n/)
    .filter((p) => p.length > 0)
    .map((p) => `<p class="chat-plain">${escapeHtml(p)}</p>`)
    .join('\n')
}

/** The message as inert HTML (see the module comment). */
export function renderChatMarkdown(source: string): string {
  if (source.length > MAX_RENDER_CHARS) return plain(source)
  try {
    return md.parse(source, { async: false }) as string
  } catch {
    return plain(source)
  }
}

/** The fenced code languages in `source` (first appearance, no repeats), for `loadGrammar`. */
export function fenceLanguages(source: string): string[] {
  if (source.length > MAX_RENDER_CHARS || !/```|~~~/.test(source)) return []
  const found: string[] = []
  try {
    md.walkTokens(md.lexer(source), (token) => {
      if (token.type !== 'code' || (token as Tokens.Code).codeBlockStyle === 'indented') return
      const lang = fenceLanguage((token as Tokens.Code).lang)
      if (lang && !found.includes(lang)) found.push(lang)
    })
  } catch {
    return found
  }
  return found
}

const BANNED_TAGS = new Set(['script', 'iframe', 'object', 'embed', 'style', 'img', 'form', 'link', 'meta', 'frame', 'frameset', 'base', 'video', 'audio', 'source', 'picture', 'svg:script'])
const URL_ATTRS = new Set(['href', 'xlink:href', 'src', 'srcset', 'action', 'formaction', 'poster', 'data', 'background'])

/**
 * Test helper (exported for the panel's tests): throws when `html` holds anything that could run
 * or fetch: an `on*` attribute; a `script`, `iframe`, `object`, `embed`, `style`, `img`, `form`,
 * `link` or `meta` element (and their kin); an `input` that is not disabled; an `href` outside
 * http/https/mailto/relative; any other URL attribute; or a `url(` in a style attribute.
 */
export function assertInert(html: string): void {
  const template = document.createElement('template')
  template.innerHTML = html
  for (const el of template.content.querySelectorAll('*')) {
    const tag = el.tagName.toLowerCase()
    if (BANNED_TAGS.has(tag)) throw new Error(`live element <${tag}> in: ${html.slice(0, 200)}`)
    if (tag === 'input' && !el.hasAttribute('disabled')) throw new Error(`enabled <input> in: ${html.slice(0, 200)}`)
    for (const attr of el.attributes) {
      const name = attr.name.toLowerCase()
      if (name.startsWith('on')) throw new Error(`event attribute ${name} on <${tag}>`)
      if (name === 'href' || name === 'xlink:href') {
        if (safeHref(attr.value) === null) throw new Error(`unsafe href ${attr.value} on <${tag}>`)
      } else if (URL_ATTRS.has(name)) {
        throw new Error(`URL attribute ${name} on <${tag}>`)
      }
      if (name === 'style' && /url\s*\(|expression\s*\(/i.test(attr.value)) throw new Error(`style that fetches on <${tag}>`)
    }
  }
}
