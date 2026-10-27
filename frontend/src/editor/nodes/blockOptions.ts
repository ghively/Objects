/**
 * Block options (M7 annotation syntax): the `blockOptions` and
 * `blockAnnotation` global attributes, and the data-level commands that set
 * them (`setBlockOption`, `setListType`, `setHierarchy`).
 *
 * - `blockOptions: Option[] | null`: the options parsed from the block's
 *   `<!-- block: ... -->` line (or a container's open line), unknown ones kept.
 * - `blockAnnotation: string | null`: that original line with its EOL, re-emitted
 *   verbatim while the options are unchanged (`serializeBody`).
 *
 * Rendering: one `data-block-<key>` attribute per known option, styled by
 * `blockOptions.css`; a colour also paints inline with its theme tokens
 * (`menus/colors.ts`), and an icon is drawn before the block's text by a widget
 * decoration. Neither attribute is kept on split.
 */
import { Extension } from '@tiptap/core'
import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model'
import { NodeSelection, Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { Icon, isIconifyId } from '@/components/Icon'
import { colorStyle } from '../menus/colors'
import { isKnownValue, knownOption, makeOption, type Option, type OptionTarget } from '../annotations'
import { attachmentKind } from '../annotations'
import './blockOptions.css'

/** Node types that carry block options (leaves, plus the containers' own options). */
export const BLOCK_OPTION_TYPES = [
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'taskList',
  'blockquote',
  'codeBlock',
  'table',
  'mathBlock',
  'media',
  'objectEmbed',
  'bookmark',
  'horizontalRule',
  'rawBlock',
  'toggle',
  'group',
  'columns',
]

/** Parents whose children are blocks that serialize on their own (with an annotation). */
export const BLOCK_PARENTS = new Set(['doc', 'toggle', 'group', 'column'])
const CONTAINER_NODES = new Set(['toggle', 'group', 'columns'])

/** What a node is, for the option table's "Applies to" column. */
export function nodeTargets(node: PMNode): OptionTarget[] {
  switch (node.type.name) {
    case 'paragraph':
      return ['paragraph']
    case 'heading':
      return ['heading']
    case 'bulletList':
    case 'taskList':
      return ['list']
    case 'orderedList':
      return ['list', 'orderedList']
    case 'blockquote':
      return ['blockquote']
    case 'codeBlock':
      return ['code']
    case 'table':
      return ['table']
    case 'mathBlock':
      return ['math']
    case 'media':
      return [(node.attrs.kind as OptionTarget) ?? attachmentKind(String(node.attrs.src ?? node.attrs.target ?? ''))]
    case 'objectEmbed':
      return ['objectEmbed']
    case 'bookmark':
      return ['bookmark']
    case 'toggle':
      return ['toggle']
    case 'group':
      return ['group']
    case 'columns':
      return ['columns']
    default:
      return []
  }
}

export type BlockRef = { node: PMNode; pos: number }

/** The block at `$pos`: the deepest ancestor whose parent is the doc, a toggle, a group or a column. */
export function leafBlockAt($pos: ResolvedPos): BlockRef | null {
  for (let d = $pos.depth; d >= 1; d--) {
    if (BLOCK_PARENTS.has($pos.node(d - 1).type.name)) return { node: $pos.node(d), pos: $pos.before(d) }
  }
  return null
}

/** The block the selection is in (a selected atom block counts), then each enclosing container, outward. */
export function blockChain(tr: Transaction): BlockRef[] {
  const sel = tr.selection
  const chain: BlockRef[] = []
  let $pos = sel.$from
  if (sel instanceof NodeSelection && BLOCK_PARENTS.has(sel.$from.parent.type.name)) {
    chain.push({ node: sel.node, pos: sel.from })
  } else {
    const leaf = leafBlockAt($pos)
    if (!leaf) return chain
    chain.push(leaf)
    $pos = tr.doc.resolve(leaf.pos)
  }
  for (let d = $pos.depth; d >= 1; d--) {
    const node = $pos.node(d)
    if (CONTAINER_NODES.has(node.type.name)) chain.push({ node, pos: $pos.before(d) })
  }
  return chain
}

/** Whether a known option applies to `node` (unknown keys apply anywhere). */
export function optionApplies(key: string, node: PMNode): boolean {
  const known = knownOption(key)
  if (!known) return BLOCK_OPTION_TYPES.includes(node.type.name)
  const targets = nodeTargets(node)
  return known.appliesTo.some((t) => targets.includes(t))
}

/** `options` with `key` set to `value` (in place when present), or removed for `null`. */
export function withOption(options: readonly Option[] | null | undefined, key: string, value: string | true | null): Option[] {
  const list = [...(options ?? [])]
  const at = list.findIndex((o) => o.key === key)
  if (value === null) {
    if (at >= 0) list.splice(at, 1)
    return list
  }
  const opt = makeOption(key, value)
  if (at >= 0) list[at] = opt
  else list.push(opt)
  return list
}

export function optionValue(node: PMNode, key: string): string | true | undefined {
  const opts = (node.attrs.blockOptions as Option[] | null) ?? []
  return opts.find((o) => o.key === key)?.value
}

/** Set (or remove) one option on the node at `pos`, in `tr`. */
export function setOptionAt(tr: Transaction, pos: number, key: string, value: string | true | null): boolean {
  const node = tr.doc.nodeAt(pos)
  if (!node || !BLOCK_OPTION_TYPES.includes(node.type.name)) return false
  const next = withOption(node.attrs.blockOptions as Option[] | null, key, value)
  const keepEmpty = CONTAINER_NODES.has(node.type.name)
  tr.setNodeAttribute(pos, 'blockOptions', next.length || keepEmpty ? next : null)
  return true
}

/** The DOM attributes of a block's options (`data-block-<key>`, and the colour's inline style). */
export function renderOptions(options: Option[] | null | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const o of options ?? []) {
    if (!isKnownValue(o)) continue
    out[`data-block-${o.key}`] = o.value === true ? '' : o.value
    if (o.key === 'color') out.style = colorStyle(o.value)
  }
  return out
}

/** Node types whose `icon` option draws an icon before their text. */
const ICON_TYPES = new Set(['paragraph', 'heading'])

/** The icon widget: an emoji as text, an Iconify id through M2's `Icon`. */
function iconWidget(value: string): HTMLElement {
  const el = document.createElement('span')
  el.className = 'block-icon'
  el.setAttribute('contenteditable', 'false')
  el.setAttribute('data-icon-value', value)
  el.setAttribute('aria-hidden', 'true')
  if (isIconifyId(value)) {
    const root = createRoot(el)
    root.render(createElement(Icon, { name: value, size: 18 }))
    ;(el as HTMLElement & { _root?: { unmount(): void } })._root = root
  } else {
    el.textContent = value
  }
  return el
}

function iconDecorations(doc: PMNode): DecorationSet {
  const decos: Decoration[] = []
  doc.descendants((node, pos) => {
    if (!ICON_TYPES.has(node.type.name)) return true
    const icon = ((node.attrs.blockOptions as Option[] | null) ?? []).find((o) => o.key === 'icon')
    if (icon && isKnownValue(icon) && typeof icon.value === 'string') {
      const value = icon.value
      decos.push(
        Decoration.widget(pos + 1, () => iconWidget(value), {
          side: -1,
          key: `block-icon:${value}`,
          ignoreSelection: true,
          destroy: (dom) => {
            const root = (dom as HTMLElement & { _root?: { unmount(): void } })._root
            // Unmount outside React's render phase (a widget can go mid-render).
            if (root) queueMicrotask(() => root.unmount())
          },
        }),
      )
    }
    return false
  })
  return DecorationSet.create(doc, decos)
}

export const blockIconKey = new PluginKey<DecorationSet>('blockIcons')

function parseOptions(el: HTMLElement): Option[] | null {
  const out: Option[] = []
  for (const attr of Array.from(el.attributes)) {
    if (!attr.name.startsWith('data-block-')) continue
    const key = attr.name.slice('data-block-'.length)
    const known = knownOption(key)
    if (!known) continue
    out.push(makeOption(key, known.value === 'flag' ? true : attr.value))
  }
  return out.length ? out : null
}

export type ListType = 'bullet' | 'numerical' | 'alphabetical' | 'roman' | 'todo'
export type Hierarchy = 'Base' | 'S' | 'H1' | 'H2' | 'H3' | 'H4'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    blockOptions: {
      /**
       * Set (or with `null` remove) a block option: on the block at the
       * selection, or the nearest enclosing container it applies to (`open`,
       * `widths`, `layout`); `pos` names the node directly.
       */
      setBlockOption: (key: string, value: string | true | null, pos?: number) => ReturnType
      /** Make the block at the selection a list of `type`, or no list (`null`). */
      setListType: (type: ListType | null) => ReturnType
      /** Object's text hierarchy: Standard, Small or Heading 1-4. */
      setHierarchy: (level: Hierarchy) => ReturnType
    }
  }
}

const LIST_TYPES: Record<string, ListType | 'ordered'> = { bulletList: 'bullet', orderedList: 'ordered', taskList: 'todo' }

function currentList(tr: Transaction): { name: string; pos: number } | null {
  const $from = tr.selection.$from
  for (let d = $from.depth; d >= 1; d--) {
    const node = $from.node(d)
    if (LIST_TYPES[node.type.name]) return { name: node.type.name, pos: $from.before(d) }
  }
  return null
}

export const BlockOptions = Extension.create({
  name: 'blockOptions',

  addGlobalAttributes() {
    return [
      {
        types: BLOCK_OPTION_TYPES,
        attributes: {
          blockOptions: {
            default: null,
            keepOnSplit: false,
            renderHTML: (attrs: Record<string, unknown>) => renderOptions(attrs.blockOptions as Option[] | null),
            parseHTML: (el: HTMLElement) => parseOptions(el),
          },
          blockAnnotation: { default: null, rendered: false, keepOnSplit: false },
        },
      },
    ]
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: blockIconKey,
        state: {
          init: (_, state) => iconDecorations(state.doc),
          apply: (tr, old) => (tr.docChanged ? iconDecorations(tr.doc) : old),
        },
        props: {
          decorations: (state) => blockIconKey.getState(state),
        },
      }),
    ]
  },

  addCommands() {
    return {
      setBlockOption:
        (key, value, pos) =>
        ({ tr, dispatch }) => {
          let target: number | null = null
          if (pos != null) {
            target = pos
          } else {
            const chain = blockChain(tr)
            const found = chain.find((b) => optionApplies(key, b.node))
            target = found ? found.pos : null
          }
          if (target == null) return false
          const node = tr.doc.nodeAt(target)
          if (!node || !BLOCK_OPTION_TYPES.includes(node.type.name)) return false
          if (dispatch) setOptionAt(tr, target, key, value)
          return true
        },

      setListType:
        (type) =>
        ({ tr, chain }) => {
          const list = currentList(tr)
          const current = list ? LIST_TYPES[list.name] : null
          if (type === null) {
            if (!list) return false
            if (list.name === 'bulletList') return chain().toggleBulletList().run()
            if (list.name === 'orderedList') return chain().toggleOrderedList().run()
            return chain().toggleTaskList().run()
          }
          if (type === 'bullet') return current === 'bullet' ? true : chain().toggleBulletList().run()
          if (type === 'todo') return current === 'todo' ? true : chain().toggleTaskList().run()
          const listOpt = type === 'numerical' ? null : type
          let c = chain()
          if (current !== 'ordered') c = c.toggleOrderedList()
          return c
            .command(({ tr: t }) => {
              const l = currentList(t)
              if (!l || l.name !== 'orderedList') return false
              setOptionAt(t, l.pos, 'list', listOpt)
              return true
            })
            .run()
        },

      setHierarchy:
        (level) =>
        ({ tr, state, dispatch, chain }) => {
          const leaf = blockChain(tr)[0]
          if (!leaf) return false
          const { node, pos } = leaf
          const heading = /^H([1-4])$/.exec(level)
          const name = node.type.name
          if (name === 'paragraph' || name === 'heading') {
            if (!dispatch) return true
            const type = heading ? state.schema.nodes.heading : state.schema.nodes.paragraph
            const options = withOption(node.attrs.blockOptions as Option[] | null, 'small', level === 'S' ? true : null)
            const attrs: Record<string, unknown> = { ...node.attrs, blockOptions: options.length ? options : null }
            if (heading) attrs.level = Number(heading[1])
            else delete attrs.level
            tr.setNodeMarkup(pos, type, attrs)
            return true
          }
          // Any other block: turn it into text first, then set the size.
          const ok = heading
            ? chain().setNode('heading', { level: Number(heading[1]) }).run()
            : chain().setNode('paragraph').run()
          if (!ok) return false
          if (level === 'S') return chain().setBlockOption('small', true).run()
          return true
        },
    }
  },
})
