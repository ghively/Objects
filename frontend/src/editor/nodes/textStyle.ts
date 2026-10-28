/**
 * Inline text colour and highlight (M8), two marks:
 *
 *   <span data-color="text-red">…</span>     `textColor`, a text colour
 *   <mark data-color="bg-yellow">…</mark>    `highlight`, a background colour
 *   <mark>…</mark>                           read as `bg-amber` and written back bare
 *
 * `bg-amber` is Capacities' `FALLBACK_HIGHLIGHT_COLOR` (`colorThemes.ts`).
 * The `highlightText` shortcut does what Capacities' Mod-Shift-h does: a
 * selection that has a colour loses it, otherwise it gets the last-used
 * colour (`textHighlightColorLastUsed`, text or background), else `bg-amber`.
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

/** Capacities' `FALLBACK_HIGHLIGHT_COLOR`: a bare `<mark>`, and the highlight shortcut's first colour. */
export const FALLBACK_HIGHLIGHT_COLOR = 'bg-amber'
/** The theme colour name of `FALLBACK_HIGHLIGHT_COLOR`. */
export const FALLBACK_HIGHLIGHT = 'amber'

export function highlightOpen(color: string, bare: boolean): string {
  return bare && color === FALLBACK_HIGHLIGHT ? '<mark>' : `<mark data-color="bg-${color}">`
}

// ---- the last-used colour (`textHighlightColorLastUsed`) -------------------

/** Where the last-used colour is kept on this device (not in the space: no `.md` changes). */
const LAST_USED_KEY = 'object.textHighlightColorLastUsed'
let lastUsed: string | null = null

function validColor(value: string | null | undefined): string | null {
  if (!value) return null
  const m = /^(text|bg)-([a-z]+)$/.exec(value)
  return m && KNOWN.has(m[2]) ? value : null
}

/** The last colour chosen for selected text (`text-<c>` or `bg-<c>`), or `bg-amber`. */
export function lastUsedHighlightColor(): string {
  if (lastUsed === null) {
    try {
      lastUsed = validColor(globalThis.localStorage?.getItem(LAST_USED_KEY))
    } catch {
      lastUsed = null
    }
  }
  return lastUsed ?? FALLBACK_HIGHLIGHT_COLOR
}

/** Remember `value` (`text-<c>` / `bg-<c>`) as the last-used colour; `null` forgets it. */
export function setLastUsedHighlightColor(value: string | null): void {
  lastUsed = validColor(value)
  try {
    if (lastUsed) globalThis.localStorage?.setItem(LAST_USED_KEY, lastUsed)
    else globalThis.localStorage?.removeItem(LAST_USED_KEY)
  } catch {
    // No storage (private window, tests): the value lives for this session only.
  }
}

type HighlightHandler = (editor: Editor) => boolean
let highlightHandler: HighlightHandler | null = null

/** Replace the `highlightText` shortcut's action (tests; `null` restores the default). */
export function setHighlightTextHandler(fn: HighlightHandler | null): void {
  highlightHandler = fn
}

/**
 * Capacities' Mod-Shift-h on a text selection: `color: current ? null :
 * lastUsed || 'bg-amber'`. A run has one colour in Capacities, so a selection
 * with a text colour or a highlight loses both; otherwise it gets the
 * last-used colour.
 */
export function toggleLastUsedHighlight(editor: Editor): boolean {
  if (editor.state.selection.empty) return false
  if (editor.isActive('highlight') || editor.isActive('textColor')) {
    return editor.chain().unsetHighlight().setTextColor(null).run()
  }
  const value = lastUsedHighlightColor()
  return value.startsWith('text-')
    ? editor.chain().setTextColor(value).run()
    : editor.chain().setHighlight(value).run()
}

export function runHighlightText(editor: Editor): boolean {
  if (highlightHandler) return highlightHandler(editor)
  return toggleLastUsedHighlight(editor)
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    textStyle: {
      /** Colour the selected text (`red`, or `text-red`); `null` removes the colour. */
      setTextColor: (color: string | null) => ReturnType
    }
    highlight: {
      /** Highlight the selected text (`amber`, or `bg-amber`); `null` removes the highlight. */
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
        default: FALLBACK_HIGHLIGHT,
        parseHTML: (el: HTMLElement) => themeColorOf(el.getAttribute('data-color')) ?? FALLBACK_HIGHLIGHT,
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
        color: m[1] ?? FALLBACK_HIGHLIGHT,
        bare: m[1] === undefined,
        text: m[2],
        tokens: lexer.inlineTokens(m[2]),
      }
    },
  },

  parseMarkdown(token: MarkdownToken, helpers) {
    const t = token as MarkdownToken & { color?: string; bare?: boolean }
    return helpers.applyMark('highlight', helpers.parseInline(token.tokens || []), {
      color: t.color ?? FALLBACK_HIGHLIGHT,
      bare: Boolean(t.bare),
    })
  },

  renderMarkdown(node, h) {
    return `${highlightOpen(String(node.attrs?.color ?? FALLBACK_HIGHLIGHT), Boolean(node.attrs?.bare))}${h.renderChildren(node)}</mark>`
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
