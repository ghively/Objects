/**
 * `wikilink`: an inline atom for `[[Target]]` / `[[Target|Label]]`.
 * Attributes: `target` (the link text resolved by the back end) and `label`
 * (display text, or null when the link has none).
 */
import { Node, mergeAttributes, type Editor, type MarkdownToken } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

export const WIKILINK_RE = /^\[\[([^[\]\n|]+?)(?:\|([^[\]\n]+?))?\]\]/

/** Characters that end a wikilink's target early (`[[A|B]]` reads as target A, label B). */
const TARGET_BREAKING = /[[\]|#\n]/

/** Can `title` be written as a wikilink target as it is? */
export function isWikilinkTarget(title: string): boolean {
  return title.trim() !== '' && !TARGET_BREAKING.test(title)
}

/**
 * `target` as a wikilink can hold it. A title with `[`, `]`, `|`, `#` or a line
 * break cannot be a target (the back end links such objects by their path,
 * `space.py` `_link_text`, which the pickers should pass instead); written as
 * is it would be an ambiguous link to another object, so those characters are
 * dropped, as `safe_filename` drops them from the file stem (`|` and a line
 * break end the stem, so the text is cut there).
 */
export function wikilinkTarget(target: string): string {
  if (isWikilinkTarget(target)) return target
  const cut = target.split(/[|\n]/, 1)[0]
  return cut.replace(/[[\]#]/g, '').replace(/\s+/g, ' ').trim()
}

/**
 * The target a link to `object` is written with: its title, or, when the title
 * cannot be a target, its path without `.md` (the back end's `_link_text` does
 * the same, and resolves a path target).
 */
export function wikilinkTargetFor(object: { title: string; path: string }): string {
  return isWikilinkTarget(object.title) ? object.title : object.path.replace(/\.md$/i, '')
}

export function wikilinkMarkdown(target: string, label: string | null): string {
  const t = wikilinkTarget(target)
  return label ? `[[${t}|${label}]]` : `[[${t}]]`
}

export type WikilinkAttrs = { target: string; label: string | null }

/**
 * Decorates a rendered chip (resolution state, type colour, click handling).
 * Returns a cleanup run when the chip is destroyed or re-rendered.
 */
export type WikilinkPresenter = (dom: HTMLElement, attrs: WikilinkAttrs) => (() => void) | void

/** Called after `[[` is typed; `range` covers the two brackets. */
export type WikilinkTrigger = (editor: Editor, range: { from: number; to: number }) => void

let presenter: WikilinkPresenter | null = null
let trigger: WikilinkTrigger | null = null

/** The app layer installs these; the editor works without them (plain chips, no picker). */
export function setWikilinkPresenter(p: WikilinkPresenter | null): void {
  presenter = p
}
export function setWikilinkTrigger(t: WikilinkTrigger | null): void {
  trigger = t
}

const triggerKey = new PluginKey('wikilinkTrigger')

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

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('span')
      dom.className = 'wikilink'
      dom.setAttribute('data-wikilink', '')
      let current = node
      let cleanup: (() => void) | void = undefined

      const paint = () => {
        cleanup?.()
        const attrs = current.attrs as WikilinkAttrs
        dom.setAttribute('data-target', attrs.target)
        if (attrs.label) dom.setAttribute('data-label', attrs.label)
        else dom.removeAttribute('data-label')
        dom.textContent = attrs.label || attrs.target
        cleanup = presenter?.(dom, { target: attrs.target, label: attrs.label ?? null })
      }
      paint()

      return {
        dom,
        update(next) {
          if (next.type !== current.type) return false
          const changed = next.attrs.target !== current.attrs.target || next.attrs.label !== current.attrs.label
          current = next
          if (changed) paint()
          return true
        },
        destroy() {
          cleanup?.()
        },
        // The presenter edits the chip's attributes; that is not a document change.
        ignoreMutation: () => true,
      }
    }
  },

  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        key: triggerKey,
        props: {
          handleTextInput(view, from, to, text) {
            if (!trigger || text !== '[' || from !== to || from < 1) return false
            const before = view.state.doc.textBetween(from - 1, from, '\0', '\0')
            if (before !== '[') return false
            const fire = trigger
            // Let the bracket land first, then hand the `[[` range to the picker.
            setTimeout(() => {
              if (!editor.isDestroyed) fire(editor, { from: from - 1, to: from + 1 })
            }, 0)
            return false
          },
        },
      }),
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
