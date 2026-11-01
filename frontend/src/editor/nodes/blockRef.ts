/**
 * Block references (M8).
 *
 * - A block id is ` ^<id>` at the end of a block's last line (`<id>` six
 *   characters `[a-z0-9]`, the Obsidian convention), written only when the user
 *   copies a block reference. It stays ordinary text in the editor (so every
 *   edit and the byte rules treat it as the line's own text); a decoration
 *   draws it muted.
 * - A block reference is a line that is exactly `![[<Title>#^<id>]]`
 *   (optionally `|label`), loaded as the block atom `blockRef`.
 *
 * `copyBlockReference()` (`BlockMenu.copyBlockReference.*`): ensures the block
 * at the cursor has an id (a fresh, collision-free one is written onto it),
 * copies `![[<Title>#^<id>]]` and toasts "Block reference copied". It works on
 * text blocks: a paragraph, a heading, a list item (the id ends the item's first
 * line, after an item comment) and a quote (its last line); other blocks have
 * no line of their own to carry an id (our choice).
 *
 * Drawn by `blockref/BlockRefView.tsx` (Task 27: the referenced block, live and
 * read-only); `renderHTML` stays the plain line for copy and HTML export. A
 * block whose id other objects reference shows "Referenced in" after its text
 * (`blockref/ReferencedIn.tsx`, a widget, in editable editors only).
 */
import { Node, mergeAttributes, type Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'
import { Decoration, type DecorationSet } from '@tiptap/pm/view'
import { buildDecorations, updateDecorations, type DecorationVisitor } from '../extensions/incrementalDecorations'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { stemOf, summaryOf } from '@/links/linkIndex'
import { BLOCK_ID_SUFFIX, blockIdsIn, blockRefMarkdown, newBlockId } from '../blocks'
import { serializeBody } from '../document'
import { showToast } from '../media/upload'
import { insertBlockNode } from './containers'
import { leafBlockAt } from './blockOptions'
import { BlockRefView } from '../blockref/BlockRefView'
import { mountReferencedIn } from '../blockref/ReferencedIn'

/** `BlockMenu.copyBlockReference.copied` */
export const BLOCK_REFERENCE_COPIED = 'Block reference copied'

/** The object an editor shows, for the reference it copies (`Editor.tsx` sets it). */
const editorObjects = new WeakMap<Editor, { path: string; title?: string | null }>()

export function setEditorObject(editor: Editor, object: { path: string; title?: string | null } | null): void {
  if (object) editorObjects.set(editor, object)
  else editorObjects.delete(editor)
}

/** The title a reference to this editor's object uses: the given title, the index's, else the file stem. */
export function editorObjectTitle(editor: Editor): string | null {
  const obj = editorObjects.get(editor)
  if (!obj) return null
  return obj.title || summaryOf(obj.path)?.title || stemOf(obj.path)
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    blockRef: {
      /** Insert a reference to block `id` of the object titled `title` below the current block. */
      insertBlockRef: (title: string, id: string, label?: string | null) => ReturnType
      /**
       * Copy `![[<Title>#^<id>]]` for the block at the cursor, writing a fresh id onto it when it
       * has none, and toast "Block reference copied" (`random` is injectable for tests).
       */
      copyBlockReference: (random?: () => number) => ReturnType
    }
  }
}

/** The text block that carries the id of the block at the selection of `tr`, or `null`. */
export function idCarrier(tr: Transaction): { node: PMNode; pos: number } | null {
  const $from = tr.selection.$from
  // A list item: its first text block.
  for (let d = $from.depth; d >= 1; d--) {
    const node = $from.node(d)
    if (node.type.name === 'listItem' || node.type.name === 'taskItem') {
      const first = node.firstChild
      return first?.isTextblock ? { node: first, pos: $from.before(d) + 1 } : null
    }
  }
  const leaf = leafBlockAt($from)
  if (!leaf) return null
  const name = leaf.node.type.name
  if (name === 'paragraph' || name === 'heading') return leaf
  if (name === 'blockquote') {
    let last: { node: PMNode; pos: number } | null = null
    leaf.node.descendants((child, offset) => {
      if (child.isTextblock) last = { node: child, pos: leaf.pos + 1 + offset }
      return !child.isTextblock
    })
    return last
  }
  return null
}

/** The id already at the end of a text block, or `null`. */
export function textblockId(node: PMNode): string | null {
  const last = node.lastChild
  if (!last?.isText) return null
  return BLOCK_ID_SUFFIX.exec(last.text ?? '')?.[1] ?? null
}

/**
 * The id of the block at the selection of `tr`: the one it has, or a fresh one
 * written onto it in `tr` (with `write`); `null` when the block cannot carry one.
 */
export function blockIdIn(editor: Editor, tr: Transaction, write: boolean, random?: () => number): string | null {
  const carrier = idCarrier(tr)
  if (!carrier) return null
  const existing = textblockId(carrier.node)
  if (existing) return existing
  if (!editor.isEditable) return null
  const id = newBlockId(blockIdsIn(serializeBody(editor)), random)
  if (write) tr.insertText(` ^${id}`, carrier.pos + 1 + carrier.node.content.size)
  return id
}

/** Ensure the block at the cursor has an id; returns it (written in one transaction), or `null`. */
export function ensureBlockId(editor: Editor, random?: () => number): string | null {
  const tr = editor.state.tr
  const id = blockIdIn(editor, tr, true, random)
  if (id && tr.docChanged) editor.view.dispatch(tr)
  return id
}

async function writeClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard?.writeText(text)
  } catch {
    // No clipboard access (tests, or a denied permission).
  }
}

/** Copy a reference to the block at the cursor (writing its id first when it has none). */
export function copyBlockReference(editor: Editor, random?: () => number): boolean {
  return editor.commands.copyBlockReference(random)
}

const blockIdKey = new PluginKey<DecorationSet>('blockIds')

/** "Referenced in" widgets: one at the end of each block carrying an id (`referencedInFor`). */
function referencedInWidgets(editor: Editor, state: { doc: PMNode }, ids: DecorationSet): DecorationSet {
  const obj = editorObjects.get(editor)
  if (!obj || !editor.isEditable) return ids
  const widgets: Decoration[] = []
  for (const d of ids.find()) {
    const id = (d.spec as { blockId?: string }).blockId
    if (!id) continue
    const path = obj.path
    widgets.push(
      Decoration.widget(
        d.to,
        () => {
          const el = document.createElement('span')
          el.className = 'block-referenced-in-host'
          el.contentEditable = 'false'
          ;(el as HTMLElement & { unmountReferencedIn?: () => void }).unmountReferencedIn = mountReferencedIn(el, path, id)
          return el
        },
        {
          side: 1,
          key: `referenced-in:${path}:${id}`,
          ignoreSelection: true,
          destroy: (node: globalThis.Node) => (node as HTMLElement & { unmountReferencedIn?: () => void }).unmountReferencedIn?.(),
        },
      ),
    )
  }
  return widgets.length ? ids.add(state.doc, widgets) : ids
}

/** The trailing ` ^id` of each text block, drawn muted. */
const blockIdVisitor: DecorationVisitor = (node, pos, decos) => {
  if (!node.isTextblock) return true
  if (node.type.name === 'codeBlock' || node.type.name === 'rawBlock') return false
  const last = node.lastChild
  const m = last?.isText ? BLOCK_ID_SUFFIX.exec(last.text ?? '') : null
  if (m) {
    const end = pos + 1 + node.content.size
    decos.push(Decoration.inline(end - m[0].length + 1, end, { class: 'block-id', 'data-block-id': m[1] }, { blockId: m[1] }))
  }
  return false
}

export const BlockRef = Node.create({
  name: 'blockRef',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      target: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-target') ?? '',
        renderHTML: (attrs: { target: string }) => ({ 'data-target': attrs.target }),
      },
      id: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-block-ref') ?? '',
        renderHTML: (attrs: { id: string }) => ({ 'data-block-ref': attrs.id }),
      },
      label: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-label'),
        renderHTML: (attrs: { label: string | null }) => (attrs.label ? { 'data-label': attrs.label } : {}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-block-ref]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { class: 'block-ref', contenteditable: 'false' }),
      node.attrs.label || `${node.attrs.target} › ^${node.attrs.id}`,
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(BlockRefView)
  },

  renderText({ node }) {
    return blockRefMarkdown(node.attrs.target, node.attrs.id, node.attrs.label)
  },

  renderMarkdown(node: { attrs?: { target?: string; id?: string; label?: string | null } }) {
    return blockRefMarkdown(node.attrs?.target ?? '', node.attrs?.id ?? '', node.attrs?.label)
  },

  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin<DecorationSet>({
        key: blockIdKey,
        state: {
          init: (_, state) => buildDecorations(state.doc, blockIdVisitor),
          apply: (tr, old) => updateDecorations(old, tr, blockIdVisitor),
        },
        props: {
          decorations: (state) => {
            const ids = blockIdKey.getState(state)
            return ids ? referencedInWidgets(editor, state, ids) : ids
          },
        },
      }),
    ]
  },

  addCommands() {
    return {
      insertBlockRef:
        (target, id, label = null) =>
        ({ tr, state, dispatch }) => {
          if (!dispatch) return true
          insertBlockNode(tr, state.schema.nodes.blockRef.create({ target, id, label }))
          return true
        },
      copyBlockReference:
        (random) =>
        ({ editor, tr, dispatch }) => {
          const title = editorObjectTitle(editor)
          if (!title) return false
          const id = blockIdIn(editor, tr, Boolean(dispatch), random)
          if (!id) return false
          if (dispatch) {
            void writeClipboard(blockRefMarkdown(title, id))
            showToast(BLOCK_REFERENCE_COPIED)
          }
          return true
        },
    }
  },
})
