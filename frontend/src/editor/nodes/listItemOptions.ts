/**
 * Per-list-item options (M8): an inline comment at the end of the item's first
 * line, before a block id when both are present:
 *
 *   - Buy milk <!-- item: color=text-red -->
 *   - Call Ada <!-- item: small --> ^ab12cd
 *
 * (M7's option grammar inside an inline comment, our choice.) It loads as the
 * inline atom `listItemOptions` (attrs `options`, and `raw`, the comment as
 * read, written back while the options are unchanged), so a list keeps
 * round-tripping through `@tiptap/markdown` and an edit elsewhere in the list
 * never touches the comment.
 *
 * Plain rendering here: the atom draws nothing, and a decoration gives its list
 * item `data-item-<key>` attributes and the colour's inline style. Task 26 adds
 * the menu and the finer styles.
 */
import { Node, type MarkdownToken } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import {
  formatItemComment,
  isKnownValue,
  makeOption,
  optionsEqual,
  parseItemComment,
  type Option,
} from '../annotations'
import { BLOCK_ID_SUFFIX } from '../blocks'
import { colorStyle } from '../menus/colors'

export const LIST_ITEM_TYPES = new Set(['listItem', 'taskItem'])

export type ItemOptionsPatch = Partial<Record<'small' | 'color' | 'align' | 'icon', string | true | null>>

/** The comment the atom writes: as read while its options are unchanged, else canonical. */
export function itemCommentMarkdown(options: readonly Option[] | null | undefined, raw: string | null | undefined): string {
  const opts = options ?? []
  if (raw) {
    const parsed = parseItemComment(raw)
    if (parsed && optionsEqual(opts, parsed.options)) return raw
  }
  return formatItemComment(opts)
}

/** The list item around the selection (innermost), with its position. */
export function listItemAt(tr: Transaction): { node: PMNode; pos: number } | null {
  const $from = tr.selection.$from
  for (let d = $from.depth; d >= 1; d--) {
    const node = $from.node(d)
    if (LIST_ITEM_TYPES.has(node.type.name)) return { node, pos: $from.before(d) }
  }
  return null
}

/** The options atom in a list item's first text block, with its position. */
export function itemOptionsNode(item: PMNode, itemPos: number): { node: PMNode; pos: number } | null {
  const first = item.firstChild
  if (!first || !first.isTextblock) return null
  let found: { node: PMNode; pos: number } | null = null
  first.forEach((child, offset) => {
    if (!found && child.type.name === 'listItemOptions') found = { node: child, pos: itemPos + 2 + offset }
  })
  return found
}

/** The options of the list item around the selection (empty when it has none). */
export function currentItemOptions(tr: Transaction): Option[] {
  const item = listItemAt(tr)
  if (!item) return []
  return ((itemOptionsNode(item.node, item.pos)?.node.attrs.options as Option[] | null) ?? []).slice()
}

function patched(options: readonly Option[], patch: ItemOptionsPatch): Option[] {
  const list = [...options]
  for (const [key, value] of Object.entries(patch)) {
    const at = list.findIndex((o) => o.key === key)
    if (value === null || value === undefined) {
      if (at >= 0) list.splice(at, 1)
      continue
    }
    const opt = makeOption(key, value)
    if (at >= 0) list[at] = opt
    else list.push(opt)
  }
  return list
}

/** Apply `patch` to the item at `itemPos` in `tr` (insert, update or remove its comment). */
export function setItemOptionsAt(tr: Transaction, itemPos: number, patch: ItemOptionsPatch): boolean {
  const item = tr.doc.nodeAt(itemPos)
  if (!item || !LIST_ITEM_TYPES.has(item.type.name)) return false
  const first = item.firstChild
  if (!first || !first.isTextblock) return false
  const existing = itemOptionsNode(item, itemPos)
  const next = patched((existing?.node.attrs.options as Option[] | null) ?? [], patch)
  const type = tr.doc.type.schema.nodes.listItemOptions
  if (existing) {
    if (next.length === 0) {
      // Remove the comment and the one space before it.
      const before = tr.doc.textBetween(existing.pos - 1, existing.pos, '\0', '\0')
      const from = before === ' ' ? existing.pos - 1 : existing.pos
      tr.delete(from, existing.pos + existing.node.nodeSize)
    } else {
      tr.setNodeMarkup(existing.pos, undefined, { ...existing.node.attrs, options: next })
    }
    return true
  }
  if (next.length === 0) return true
  // At the end of the first line, before a trailing block id.
  const start = itemPos + 2
  const end = start + first.content.size
  let at = end
  const last = first.lastChild
  if (last?.isText) {
    const m = BLOCK_ID_SUFFIX.exec(last.text ?? '')
    if (m) at = end - m[0].length
  }
  const textBefore = at > start ? tr.doc.textBetween(at - 1, at, '\0', '\0') : ''
  const nodes = [type.create({ options: next, raw: null })]
  if (at > start && textBefore !== ' ') nodes.unshift(tr.doc.type.schema.text(' '))
  tr.insert(at, nodes)
  return true
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    listItemOptions: {
      /** Set (or with `null` remove) options on the list item at the selection. */
      setListItemOptions: (patch: ItemOptionsPatch) => ReturnType
    }
  }
}

/** The DOM attributes an item's options give its `<li>`. */
export function itemOptionAttrs(options: readonly Option[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const o of options) {
    if (!isKnownValue(o)) continue
    out[`data-item-${o.key}`] = o.value === true ? '' : o.value
    if (o.key === 'color') out.style = colorStyle(o.value)
  }
  return out
}

const itemDecoKey = new PluginKey<DecorationSet>('listItemOptions')

function itemDecorations(doc: PMNode): DecorationSet {
  const decos: Decoration[] = []
  doc.descendants((node, pos) => {
    if (LIST_ITEM_TYPES.has(node.type.name)) {
      const found = itemOptionsNode(node, pos)
      const attrs = found ? itemOptionAttrs((found.node.attrs.options as Option[] | null) ?? []) : {}
      if (Object.keys(attrs).length) decos.push(Decoration.node(pos, pos + node.nodeSize, attrs))
    }
    return !node.isTextblock
  })
  return DecorationSet.create(doc, decos)
}

export const ListItemOptions = Node.create({
  name: 'listItemOptions',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,

  addAttributes() {
    return {
      options: { default: [], rendered: false },
      raw: { default: null, rendered: false },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-item-options]' }]
  },

  renderHTML() {
    return ['span', { 'data-item-options': '', class: 'item-options', contenteditable: 'false' }]
  },

  renderText() {
    return ''
  },

  markdownTokenizer: {
    name: 'listItemOptions',
    level: 'inline',
    start: (src: string) => {
      const i = src.indexOf('<!--')
      return i >= 0 && parseItemComment(src.slice(i)) ? i : -1
    },
    tokenize(src: string) {
      const parsed = parseItemComment(src)
      if (!parsed) return undefined
      return { type: 'listItemOptions', raw: parsed.raw, options: parsed.options }
    },
  },

  parseMarkdown(token: MarkdownToken) {
    const t = token as MarkdownToken & { options?: Option[] }
    return { type: 'listItemOptions', attrs: { options: t.options ?? [], raw: t.raw ?? null } }
  },

  renderMarkdown(node: { attrs?: { options?: Option[]; raw?: string | null } }) {
    return itemCommentMarkdown(node.attrs?.options, node.attrs?.raw)
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: itemDecoKey,
        state: {
          init: (_, state) => itemDecorations(state.doc),
          apply: (tr, old) => (tr.docChanged ? itemDecorations(tr.doc) : old),
        },
        props: { decorations: (state) => itemDecoKey.getState(state) },
      }),
    ]
  },

  addCommands() {
    return {
      setListItemOptions:
        (patch) =>
        ({ tr, dispatch }) => {
          const item = listItemAt(tr)
          if (!item) return false
          if (!dispatch) return true
          return setItemOptionsAt(tr, item.pos, patch)
        },
    }
  },
})
