/**
 * Inline text colour and highlight (M8), two marks:
 *
 *   <span data-color="text-red">…</span>     `textColor`, a text colour
 *   <mark data-color="bg-yellow">…</mark>    `highlight`, a background colour
 *   <mark>…</mark>                           read as `bg-yellow` and written back bare
 *
 * `<c>` is one of the 18 theme colours (`THEME_COLORS`). Anything else (an
 * unknown colour, an unclosed or nested tag, other attributes) is not matched,
 * so its block stays raw and keeps its bytes (inline HTML, our choice).
 *
 * Attributes: `color` (the theme colour name) and, on `highlight`, `bare`
 * (written as a bare `<mark>`; cleared when the colour is set from the editor).
 *
 * Plain rendering here (the colour through the theme tokens of
 * `menus/colors.ts`); the tokens menu (Task 26) adds the pickers.
 */
import { Mark, mergeAttributes, type MarkdownToken } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import { THEME_COLORS, type ThemeColor } from '@/theme/palette'
import { bgColorToken, bgTextToken, textColorToken } from '../menus/colors'

const KNOWN = new Set<string>(THEME_COLORS)
const COLORS = THEME_COLORS.join('|')

/** `<span data-color="text-c">inner</span>`, inner without another span tag. */
const SPAN_RE = new RegExp(`^<span data-color="text-(${COLORS})">((?:(?!</?span[\\s>])[\\s\\S])*?)</span>`)
/** `<mark data-color="bg-c">inner</mark>` or `<mark>inner</mark>`, inner without another mark tag. */
const MARK_RE = new RegExp(`^<mark(?: data-color="bg-(${COLORS})")?>((?:(?!</?mark[\\s>])[\\s\\S])*?)</mark>`)

/** A theme colour from `red`, `text-red` or `bg-red`; `null` for anything else. */
export function themeColorOf(value: string | null | undefined): ThemeColor | null {
  if (!value) return null
  const c = value.replace(/^(?:text|bg)-/, '')
  return KNOWN.has(c) ? (c as ThemeColor) : null
}

/** The colour attribute of `el` when it has the expected prefix, else `null`. */
function colorAttr(el: HTMLElement, prefix: 'text-' | 'bg-'): string | null {
  const v = el.getAttribute('data-color')
  return v && v.startsWith(prefix) ? v : null
}

export function textColorOpen(color: string): string {
  return `<span data-color="text-${color}">`
}

export function highlightOpen(color: string, bare: boolean): string {
  return bare && color === 'yellow' ? '<mark>' : `<mark data-color="bg-${color}">`
}

type HighlightHandler = (editor: Editor) => boolean
let highlightHandler: HighlightHandler | null = null

/**
 * The `highlightText` shortcut's action. The tokens menu (Task 26) installs its
 * own (opening "Highlight text"); without one the shortcut toggles a yellow
 * highlight on the selection (our choice).
 */
export function setHighlightTextHandler(fn: HighlightHandler | null): void {
  highlightHandler = fn
}

export function runHighlightText(editor: Editor): boolean {
  if (highlightHandler) return highlightHandler(editor)
  const { empty } = editor.state.selection
  if (empty) return false
  if (editor.isActive('highlight')) return editor.chain().unsetHighlight().run()
  return editor.chain().setHighlight('yellow').run()
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    textStyle: {
      /** Colour the selected text (`red`, or `text-red`); `null` removes the colour. */
      setTextColor: (color: string | null) => ReturnType
    }
    highlight: {
      /** Highlight the selected text (`yellow`, or `bg-yellow`); `null` removes the highlight. */
      setHighlight: (color: string | null) => ReturnType
      unsetHighlight: () => ReturnType
    }
  }
}

export const TextColor = Mark.create({
  name: 'textColor',
  // Outside the other marks, so `<span>` wraps `**bold**` rather than splitting it.
  priority: 1100,
  excludes: 'textColor',

  addAttributes() {
    return {
      color: {
        default: 'gray',
        parseHTML: (el: HTMLElement) => themeColorOf(el.getAttribute('data-color')) ?? 'gray',
        renderHTML: (attrs: { color: string }) => ({
          'data-color': `text-${attrs.color}`,
          style: `color: ${textColorToken(attrs.color as ThemeColor)};`,
        }),
      },
    }
  },

  parseHTML() {
    // Only a known colour: anything else is not this mark (its block stays raw).
    return [{ tag: 'span[data-color^="text-"]', getAttrs: (el) => (themeColorOf(colorAttr(el, 'text-')) ? null : false) }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'text-color' }), 0]
  },

  markdownTokenizer: {
    name: 'textColor',
    level: 'inline',
    start: (src: string) => src.indexOf('<span data-color="text-'),
    tokenize(src: string, _tokens: unknown, lexer: { inlineTokens: (s: string) => MarkdownToken[] }) {
      const m = SPAN_RE.exec(src)
      if (!m || m[2] === '') return undefined
      return { type: 'textColor', raw: m[0], color: m[1], text: m[2], tokens: lexer.inlineTokens(m[2]) }
    },
  },

  parseMarkdown(token: MarkdownToken, helpers) {
    const t = token as MarkdownToken & { color?: string }
    return helpers.applyMark('textColor', helpers.parseInline(token.tokens || []), { color: t.color ?? 'gray' })
  },

  renderMarkdown(node, h) {
    return `${textColorOpen(String(node.attrs?.color ?? 'gray'))}${h.renderChildren(node)}</span>`
  },

  addCommands() {
    return {
      setTextColor:
        (color) =>
        ({ commands }) => {
          if (color === null) return commands.unsetMark('textColor')
          const c = themeColorOf(color)
          if (!c) return false
          return commands.setMark('textColor', { color: c })
        },
    }
  },
})

export const Highlight = Mark.create({
  name: 'highlight',
  priority: 1100,
  excludes: 'highlight',

  addAttributes() {
    return {
      color: {
        default: 'yellow',
        parseHTML: (el: HTMLElement) => themeColorOf(el.getAttribute('data-color')) ?? 'yellow',
        renderHTML: (attrs: { color: string }) => ({
          'data-color': `bg-${attrs.color}`,
          style: `background-color: ${bgColorToken(attrs.color as ThemeColor)}; color: ${bgTextToken(attrs.color as ThemeColor)};`,
        }),
      },
      bare: {
        default: false,
        rendered: false,
        parseHTML: (el: HTMLElement) => !el.hasAttribute('data-color'),
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'mark',
        getAttrs: (el) => (!el.hasAttribute('data-color') || themeColorOf(colorAttr(el, 'bg-')) ? null : false),
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['mark', mergeAttributes(HTMLAttributes, { class: 'text-highlight' }), 0]
  },

  markdownTokenizer: {
    name: 'highlight',
    level: 'inline',
    start: (src: string) => src.indexOf('<mark'),
    tokenize(src: string, _tokens: unknown, lexer: { inlineTokens: (s: string) => MarkdownToken[] }) {
      const m = MARK_RE.exec(src)
      if (!m || m[2] === '') return undefined
      return {
        type: 'highlight',
        raw: m[0],
        color: m[1] ?? 'yellow',
        bare: m[1] === undefined,
        text: m[2],
        tokens: lexer.inlineTokens(m[2]),
      }
    },
  },

  parseMarkdown(token: MarkdownToken, helpers) {
    const t = token as MarkdownToken & { color?: string; bare?: boolean }
    return helpers.applyMark('highlight', helpers.parseInline(token.tokens || []), {
      color: t.color ?? 'yellow',
      bare: Boolean(t.bare),
    })
  },

  renderMarkdown(node, h) {
    return `${highlightOpen(String(node.attrs?.color ?? 'yellow'), Boolean(node.attrs?.bare))}${h.renderChildren(node)}</mark>`
  },

  addCommands() {
    return {
      setHighlight:
        (color) =>
        ({ commands }) => {
          if (color === null) return commands.unsetMark('highlight')
          const c = themeColorOf(color)
          if (!c) return false
          return commands.setMark('highlight', { color: c, bare: false })
        },
      unsetHighlight:
        () =>
        ({ commands }) =>
          commands.unsetMark('highlight'),
    }
  },
})
