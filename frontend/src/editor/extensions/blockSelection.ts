/**
 * Block selection (Task 12): a selection of sibling blocks, drawn with
 * `--block-selection-bg` / `--block-selection-border`, plus the block-level
 * operations the block menu, the handles and the editor shortcuts share.
 *
 * Plugin state `{anchor, head}`: the start positions of two sibling blocks
 * (children of the doc, a toggle, a group or a column). While it is set, the
 * editor's own selection spans the same blocks (so Tiptap's range commands
 * apply to all of them) and the native highlight is hidden.
 *
 * Escape selects the block holding the cursor; Shift+Up/Down extend; Mod-a
 * selects the block's siblings, again the top level; Backspace/Delete delete;
 * Mod-c copies the blocks' serialized source (their original bytes when
 * unedited) as text/plain, Mod-x cuts; Mod-d duplicates; Mod-Shift-Up/Down
 * move; Tab/Shift-Tab indent and unindent list items; typing replaces the
 * blocks with a paragraph; a click (any selection change of its own) clears it.
 *
 * The keys come from the registry (`editor/shortcuts.ts`, `keysFor(id)`).
 */
import { Extension, type Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection, Plugin, PluginKey, Selection, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { serializeBody } from '../document'
import { BLOCK_PARENTS, blockChain, optionApplies, setOptionAt, type BlockRef, type Hierarchy, type ListType } from '../nodes/blockOptions'
import { isToggleOpen } from '../nodes/toggle'
import type { Option } from '../annotations'
import { keymapFor } from '../shortcuts'

export type BlockSelectionState = { anchor: number; head: number } | null

export const blockSelectionKey = new PluginKey<BlockSelectionState>('blockSelection')

type Meta = { set: BlockSelectionState }

// ---------------------------------------------------------------------------
// Ranges

/** The parent and index of the block starting at `pos`, when it is a child of a block parent. */
function siblingInfo(doc: PMNode, pos: number): { parentStart: number; depth: number; index: number; node: PMNode } | null {
  if (pos < 0 || pos > doc.content.size) return null
  const $pos = doc.resolve(pos)
  const node = $pos.nodeAfter
  if (!node || !BLOCK_PARENTS.has($pos.parent.type.name)) return null
  return { parentStart: $pos.start(), depth: $pos.depth, index: $pos.index(), node }
}

export interface BlockRange {
  /** Start of the first block, end of the last. */
  from: number
  to: number
  /** Start of the parent's content and its depth. */
  parentStart: number
  depth: number
  /** Child indexes of the first and last block in the parent. */
  first: number
  last: number
  blocks: BlockRef[]
}

/** The range between two sibling blocks (in either order), or null when they are not siblings. */
export function rangeBetween(doc: PMNode, anchor: number, head: number): BlockRange | null {
  const a = siblingInfo(doc, anchor)
  const h = siblingInfo(doc, head)
  if (!a || !h || a.parentStart !== h.parentStart) return null
  const parent = a.depth === 0 ? doc : doc.resolve(anchor).parent
  const first = Math.min(a.index, h.index)
  const last = Math.max(a.index, h.index)
  const blocks: BlockRef[] = []
  let pos = a.parentStart
  for (let i = 0; i < parent.childCount; i++) {
    const child = parent.child(i)
    if (i >= first && i <= last) blocks.push({ node: child, pos })
    pos += child.nodeSize
  }
  const lastBlock = blocks[blocks.length - 1]
  return {
    from: blocks[0].pos,
    to: lastBlock.pos + lastBlock.node.nodeSize,
    parentStart: a.parentStart,
    depth: a.depth,
    first,
    last,
    blocks,
  }
}

/** The range of the parent's children `first..last` (indexes), or null. */
function rangeByIndex(doc: PMNode, parentStart: number, first: number, last: number): BlockRange | null {
  const parent = parentStart === 0 ? doc : doc.resolve(parentStart).parent
  if (first < 0 || last >= parent.childCount || first > last) return null
  let pos = parentStart
  let a = -1
  let h = -1
  for (let i = 0; i <= last; i++) {
    if (i === first) a = pos
    if (i === last) h = pos
    pos += parent.child(i).nodeSize
  }
  return rangeBetween(doc, a, h)
}

export function getBlockSelection(state: EditorState): BlockSelectionState {
  return blockSelectionKey.getState(state) ?? null
}

/** The selected blocks' range, or null when no blocks are selected. */
export function blockSelectionRange(state: EditorState): BlockRange | null {
  const sel = getBlockSelection(state)
  return sel ? rangeBetween(state.doc, sel.anchor, sel.head) : null
}

/** The block holding the cursor (or a selected atom block), as a one-block range. */
export function cursorBlockRange(state: EditorState): BlockRange | null {
  const leaf = blockChain(state.tr)[0]
  return leaf ? rangeBetween(state.doc, leaf.pos, leaf.pos) : null
}

/** The blocks an operation applies to: the block selection, else the block with the cursor. */
export function targetRange(state: EditorState): BlockRange | null {
  return blockSelectionRange(state) ?? cursorBlockRange(state)
}

/** An editor selection covering `from..to`: text from the first text position to the last, else the node. */
export function selectionCovering(doc: PMNode, from: number, to: number): Selection {
  const start = Selection.findFrom(doc.resolve(from), 1, true)
  const end = Selection.findFrom(doc.resolve(to), -1, true)
  if (start && end && start.from >= from && end.to <= to && start.from <= end.to) {
    return TextSelection.between(start.$from, end.$to)
  }
  const node = doc.nodeAt(from)
  if (node && from + node.nodeSize === to) return NodeSelection.create(doc, from)
  return Selection.near(doc.resolve(from))
}

/** Set (or with `null` clear) the block selection in `tr`; the editor selection follows. */
export function setBlockSelectionIn(tr: Transaction, value: BlockSelectionState): Transaction {
  if (value) {
    const range = rangeBetween(tr.doc, value.anchor, value.head)
    if (!range) return tr.setMeta(blockSelectionKey, { set: null } satisfies Meta)
    tr.setSelection(selectionCovering(tr.doc, range.from, range.to))
  }
  return tr.setMeta(blockSelectionKey, { set: value } satisfies Meta)
}

export function selectBlocks(editor: Editor, anchor: number, head: number = anchor): boolean {
  if (!rangeBetween(editor.state.doc, anchor, head)) return false
  editor.view.dispatch(setBlockSelectionIn(editor.state.tr, { anchor, head }))
  return true
}

export function clearBlockSelection(editor: Editor): boolean {
  if (!getBlockSelection(editor.state)) return false
  editor.view.dispatch(editor.state.tr.setMeta(blockSelectionKey, { set: null } satisfies Meta))
  return true
}

function selectRange(tr: Transaction, range: BlockRange | null): Transaction {
  if (!range) return setBlockSelectionIn(tr, null)
  return setBlockSelectionIn(tr, { anchor: range.blocks[0].pos, head: range.blocks[range.blocks.length - 1].pos })
}

// ---------------------------------------------------------------------------
// Selection commands

/** Escape: select the block holding the cursor (again: clear). */
export function selectActiveBlock(editor: Editor): boolean {
  if (getBlockSelection(editor.state)) return clearBlockSelection(editor)
  const range = cursorBlockRange(editor.state)
  if (!range) return false
  return selectBlocks(editor, range.from)
}

/** Shift+Up / Shift+Down while blocks are selected: move the head one sibling. */
export function expandBlockSelection(editor: Editor, dir: -1 | 1): boolean {
  const sel = getBlockSelection(editor.state)
  if (!sel) return false
  const { doc } = editor.state
  const head = siblingInfo(doc, sel.head)
  if (!head) return false
  const parent = head.depth === 0 ? doc : doc.resolve(sel.head).parent
  const index = head.index + dir
  if (index < 0 || index >= parent.childCount) return true
  const target = rangeByIndex(doc, head.parentStart, index, index)
  if (!target) return true
  editor.view.dispatch(setBlockSelectionIn(editor.state.tr, { anchor: sel.anchor, head: target.from }))
  return true
}

/** Mod-a: select the block's siblings; when they already are, the top level. */
export function selectAllBlocks(editor: Editor): boolean {
  const { doc } = editor.state
  const current = blockSelectionRange(editor.state)
  const base = current ?? cursorBlockRange(editor.state)
  if (!base) return false
  const parent = base.depth === 0 ? doc : doc.resolve(base.from).parent
  const allSiblings = current && current.first === 0 && current.last === parent.childCount - 1
  const range = allSiblings
    ? rangeByIndex(doc, 0, 0, doc.childCount - 1)
    : rangeByIndex(doc, base.parentStart, 0, parent.childCount - 1)
  if (!range) return false
  editor.view.dispatch(selectRange(editor.state.tr, range))
  return true
}

// ---------------------------------------------------------------------------
// Block operations (on the block selection, else the block with the cursor)

const BREAK = /(?:\r\n|\n|\r)$/

/** The line ending a block's source uses (for a blank line after it). */
function eolOf(node: PMNode): string {
  const raw = (node.attrs.blockOrigin as string | null) ?? ''
  return raw.includes('\r\n') ? '\r\n' : '\n'
}

/** The line break the block's own source ends with ('' for a new block or a block read without one). */
function endBreak(node: PMNode): string {
  const origin = node.attrs.blockOrigin as string | null | undefined
  return typeof origin === 'string' ? (BREAK.exec(origin)?.[0] ?? '') : ''
}

/** What separates the block from the next one: its own final line break and the blank lines after it. */
function separatorOf(node: PMNode): string {
  return endBreak(node) + ((node.attrs.blockTrailing as string | null) ?? '')
}

function withTrailing(node: PMNode, trailing: string | null): PMNode {
  if ((node.attrs.blockTrailing ?? null) === trailing || !('blockTrailing' in node.attrs)) return node
  return node.type.create({ ...node.attrs, blockTrailing: trailing }, node.content, node.marks)
}

/** `node` with the blank lines after it set so that it is followed by `separator`. */
function fitTo(node: PMNode, separator: string): PMNode {
  const own = endBreak(node)
  const rest = separator.startsWith(own) ? separator.slice(own.length) : separator
  return withTrailing(node, rest || null)
}

/** Delete the target blocks. */
export function deleteBlocks(editor: Editor): boolean {
  const range = targetRange(editor.state)
  if (!range) return false
  const tr = editor.state.tr.delete(range.from, range.to)
  tr.setSelection(Selection.near(tr.doc.resolve(Math.min(range.from, tr.doc.content.size))))
  editor.view.dispatch(setBlockSelectionIn(tr, null))
  return true
}

/** Duplicate the target blocks below themselves; the copies become the block selection. */
export function duplicateBlocks(editor: Editor): boolean {
  const range = targetRange(editor.state)
  if (!range) return false
  const nodes = range.blocks.map((b) => b.node)
  const last = nodes[nodes.length - 1]
  const lastPos = range.blocks[range.blocks.length - 1].pos
  const tr = editor.state.tr
  // The copies go right after the last block, with a blank line between; the last
  // copy takes over what followed the last block.
  const eol = eolOf(last)
  const blank = endBreak(last) ? eol : eol + eol
  const copies = nodes.map((n, i) => (i === nodes.length - 1 ? fitTo(n, separatorOf(last)) : n))
  if ('blockTrailing' in last.attrs) tr.setNodeAttribute(lastPos, 'blockTrailing', blank)
  const at = tr.mapping.map(range.to)
  tr.insert(at, copies)
  const size = copies.reduce((sum, n) => sum + n.nodeSize, 0)
  const copyRange = rangeBetween(tr.doc, at, at + size - copies[copies.length - 1].nodeSize)
  editor.view.dispatch(selectRange(tr, copyRange))
  return true
}

/**
 * Move the target blocks one sibling up (`-1`) or down (`1`). The blank lines
 * between blocks stay where they are; the blocks move between them, each keeping
 * its bytes.
 */
export function moveBlocks(editor: Editor, dir: -1 | 1): boolean {
  const range = targetRange(editor.state)
  if (!range) return false
  const { doc } = editor.state
  const parent = range.depth === 0 ? doc : doc.resolve(range.from).parent
  const keepSelection = !!getBlockSelection(editor.state)
  if (dir === -1 ? range.first === 0 : range.last === parent.childCount - 1) return true
  const window = rangeByIndex(doc, range.parentStart, dir === -1 ? range.first - 1 : range.first, dir === -1 ? range.last : range.last + 1)
  if (!window) return false
  const nodes = window.blocks.map((b) => b.node)
  const order = dir === -1 ? [...nodes.slice(1), nodes[0]] : [nodes[nodes.length - 1], ...nodes.slice(0, -1)]
  const separators = nodes.map(separatorOf)
  const placed = order.map((n, i) => fitTo(n, separators[i]))
  const tr = editor.state.tr.replaceWith(window.from, window.to, placed)
  const first = range.first + dir
  const moved = rangeByIndex(tr.doc, range.parentStart, first, first + (range.last - range.first))
  if (keepSelection) selectRange(tr, moved)
  else if (moved) {
    // Keep the cursor in the moved block, at the same offset.
    const offset = editor.state.selection.from - range.from
    tr.setSelection(Selection.near(tr.doc.resolve(Math.min(moved.from + offset, tr.doc.content.size))))
  }
  editor.view.dispatch(tr)
  return true
}

/** Insert an empty paragraph above or below the target block(s) and put the cursor in it. */
export function insertBlock(editor: Editor, where: 'above' | 'below'): boolean {
  const range = targetRange(editor.state)
  const tr = editor.state.tr
  const at = range ? (where === 'above' ? range.from : range.to) : tr.doc.content.size
  tr.insert(at, editor.schema.nodes.paragraph.create())
  tr.setSelection(TextSelection.create(tr.doc, at + 1))
  editor.view.dispatch(setBlockSelectionIn(tr, null))
  editor.view.focus()
  return true
}

/** Style options "Remove style" clears (structure and view settings stay: `open`, `widths`, `view`, …). */
export const STYLE_OPTIONS = ['small', 'color', 'align', 'icon', 'quote', 'list']

/** Remove every style option of the target blocks. */
export function removeStyle(editor: Editor): boolean {
  const range = targetRange(editor.state)
  if (!range) return false
  const tr = editor.state.tr
  for (const b of range.blocks) {
    for (const key of STYLE_OPTIONS) {
      const options = (tr.doc.nodeAt(b.pos)?.attrs.blockOptions as Option[] | null) ?? []
      if (options.some((o) => o.key === key)) setOptionAt(tr, b.pos, key, null)
    }
  }
  editor.view.dispatch(tr)
  return true
}

/** Set (or with `null` remove) one option on every target block it applies to. */
export function setOptionOnBlocks(editor: Editor, key: string, value: string | true | null): boolean {
  const range = targetRange(editor.state)
  if (!range) return false
  const tr = editor.state.tr
  let any = false
  for (const b of range.blocks) {
    if (!optionApplies(key, b.node)) continue
    setOptionAt(tr, b.pos, key, value)
    any = true
  }
  if (!any) return false
  editor.view.dispatch(tr)
  return true
}

/**
 * Run `fn` once per target block, with the editor selection inside that block,
 * then select the same blocks again (when they were a block selection).
 */
export function forEachTargetBlock(editor: Editor, fn: (editor: Editor) => boolean): boolean {
  const range = targetRange(editor.state)
  if (!range) return false
  const wasSelection = !!getBlockSelection(editor.state)
  let ok = false
  for (let i = range.first; i <= range.last; i++) {
    const r = rangeByIndex(editor.state.doc, range.parentStart, i, i)
    if (!r) continue
    editor.view.dispatch(
      editor.state.tr
        .setSelection(selectionCovering(editor.state.doc, r.from, r.to))
        .setMeta(blockSelectionKey, { set: null } satisfies Meta),
    )
    ok = fn(editor) || ok
  }
  if (wasSelection) {
    const again = rangeByIndex(editor.state.doc, range.parentStart, range.first, range.last)
    if (again) editor.view.dispatch(selectRange(editor.state.tr, again))
  }
  return ok
}

/** Run a range command over the target blocks (the editor selection spans them while it runs). */
export function withTargetSelection(editor: Editor, fn: (editor: Editor) => boolean): boolean {
  const range = blockSelectionRange(editor.state)
  if (range) {
    editor.view.dispatch(
      editor.state.tr
        .setSelection(selectionCovering(editor.state.doc, range.from, range.to))
        .setMeta(blockSelectionKey, { set: null } satisfies Meta),
    )
  }
  return fn(editor)
}

export type TurnIntoKind = 'text' | Exclude<Hierarchy, 'Base'> | ListType | 'toggle' | 'quote' | 'code'

function inAncestor(editor: Editor, names: string[]): boolean {
  const $from = editor.state.selection.$from
  for (let d = $from.depth; d >= 1; d--) if (names.includes($from.node(d).type.name)) return true
  const sel = editor.state.selection
  return sel instanceof NodeSelection && names.includes(sel.node.type.name)
}

/** Turn the current block into plain text: no list, no quote, no code, no heading or small size. */
function toText(editor: Editor): boolean {
  if (inAncestor(editor, ['bulletList', 'orderedList', 'taskList'])) editor.commands.setListType(null)
  if (inAncestor(editor, ['blockquote'])) editor.commands.lift('blockquote')
  if (inAncestor(editor, ['codeBlock'])) editor.commands.setNode('paragraph')
  return editor.commands.setHierarchy('Base')
}

/** "Turn Into" (`tokensMenu.turnInto.name`): one of Text, Heading 1-4, Small, a list, To-do, Toggle, Quote block, Code. */
export function turnInto(editor: Editor, kind: TurnIntoKind): boolean {
  switch (kind) {
    case 'text':
      return forEachTargetBlock(editor, toText)
    case 'H1':
    case 'H2':
    case 'H3':
    case 'H4':
    case 'S':
      return forEachTargetBlock(editor, (e) => e.commands.setHierarchy(kind))
    case 'bullet':
    case 'numerical':
    case 'alphabetical':
    case 'roman':
    case 'todo':
      return withTargetSelection(editor, (e) => e.commands.setListType(kind))
    case 'toggle':
      return withTargetSelection(editor, (e) => e.commands.wrapInToggle())
    case 'quote':
      return withTargetSelection(editor, (e) => (inAncestor(e, ['blockquote']) ? true : e.commands.toggleBlockquote()))
    case 'code':
      return withTargetSelection(editor, (e) => (inAncestor(e, ['codeBlock']) ? true : e.commands.setNode('codeBlock')))
  }
}

/** Mod-Alt-m: turn the target text block into a math block with its text (a math block back into text). */
export function toggleMathBlock(editor: Editor): boolean {
  const range = targetRange(editor.state)
  if (!range || range.blocks.length !== 1) return false
  const { node, pos } = range.blocks[0]
  const { schema } = editor
  const tr = editor.state.tr
  if (node.type.name === 'mathBlock') {
    const text = String(node.attrs.text ?? '')
    tr.replaceWith(pos, pos + node.nodeSize, schema.nodes.paragraph.create(null, text ? schema.text(text) : null))
  } else if (node.isTextblock) {
    tr.replaceWith(pos, pos + node.nodeSize, schema.nodes.mathBlock.create({ text: node.textContent }))
  } else return false
  editor.view.dispatch(setBlockSelectionIn(tr, null))
  return true
}

/** Mod-Enter: check or uncheck the to-do holding the cursor. */
export function toggleTodoInBlock(editor: Editor): boolean {
  const $from = editor.state.selection.$from
  for (let d = $from.depth; d >= 1; d--) {
    const node = $from.node(d)
    if (node.type.name === 'taskItem') {
      editor.view.dispatch(editor.state.tr.setNodeAttribute($from.before(d), 'checked', !node.attrs.checked))
      return true
    }
  }
  return false
}

/**
 * Mod-Shift-Enter: open or close the toggle whose line holds the cursor; a toggle
 * with no children gets an empty child block, opened and focused.
 */
export function toggleToggleInBlock(editor: Editor): boolean {
  const $from = editor.state.selection.$from
  for (let d = $from.depth; d >= 1; d--) {
    const node = $from.node(d)
    if (node.type.name !== 'toggle') continue
    if ($from.index(d) !== 0) return false
    const pos = $from.before(d)
    if (node.childCount === 1) {
      const at = pos + 1 + node.child(0).nodeSize
      const tr = editor.state.tr.insert(at, editor.schema.nodes.paragraph.create())
      setOptionAt(tr, pos, 'open', true)
      tr.setSelection(TextSelection.create(tr.doc, at + 1))
      editor.view.dispatch(tr)
      return true
    }
    return editor.commands.setToggleOpen(pos, !isToggleOpen(node.attrs.blockOptions as Option[] | null))
  }
  return false
}

const LIST_NODES = new Set(['bulletList', 'orderedList', 'taskList'])
const ITEM_NODES = new Set(['listItem', 'taskItem'])

/**
 * Tab / Shift-Tab with blocks selected: indent the selected lists' items (all
 * but each list's first, which has nothing to nest under) or unindent their
 * nested items. Always handled while blocks are selected (focus stays here).
 */
export function indentBlocks(editor: Editor, dir: 1 | -1): boolean {
  const range = blockSelectionRange(editor.state)
  if (!range) return false
  // Work on one list at a time, last first, so earlier positions stay valid.
  const lists = range.blocks.filter((b) => LIST_NODES.has(b.node.type.name)).reverse()
  for (const { node, pos } of lists) {
    const items: { pos: number; node: PMNode; depth: number }[] = []
    node.descendants((child, offset) => {
      if (ITEM_NODES.has(child.type.name)) {
        const depth = editor.state.doc.resolve(pos + 1 + offset).depth
        items.push({ pos: pos + 1 + offset, node: child, depth })
      }
      return true
    })
    const top = Math.min(...items.map((i) => i.depth))
    const chosen = dir === 1 ? items.filter((i) => i.depth === top).slice(1) : items.filter((i) => i.depth > top)
    if (chosen.length === 0) continue
    const first = chosen[0]
    const last = chosen[chosen.length - 1]
    const from = Selection.findFrom(editor.state.doc.resolve(first.pos + 1), 1, true)
    const to = Selection.findFrom(editor.state.doc.resolve(last.pos + last.node.nodeSize - 1), -1, true)
    if (!from || !to) continue
    const type = first.node.type.name
    editor.view.dispatch(
      editor.state.tr
        .setSelection(TextSelection.between(from.$from, to.$to))
        .setMeta(blockSelectionKey, { set: null } satisfies Meta),
    )
    if (dir === 1) editor.commands.sinkListItem(type)
    else editor.commands.liftListItem(type)
  }
  const again = rangeByIndex(editor.state.doc, range.parentStart, range.first, range.last)
  if (again) editor.view.dispatch(selectRange(editor.state.tr, again))
  return true
}

// ---------------------------------------------------------------------------
// Copying

/** The serialized source of the target blocks: their original bytes when unedited. */
export function blocksSource(editor: Editor, range: BlockRange | null = targetRange(editor.state)): string {
  if (!range) return ''
  const nodes = range.blocks.map((b, i) => (i === range.blocks.length - 1 ? withTrailing(b.node, null) : b.node))
  const doc = editor.schema.topNodeType.create(null, nodes)
  // Serialize a document of just these blocks with the editor's serializer.
  const view = Object.create(editor) as Editor
  Object.defineProperty(view, 'state', { value: { doc } })
  return serializeBody(view)
}

async function writeClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard?.writeText(text)
  } catch {
    // No clipboard access (tests, or a denied permission): nothing to do.
  }
}

/** Mod-Shift-c: copy the target blocks' source. */
export function copyBlocksAsMarkdown(editor: Editor): boolean {
  const text = blocksSource(editor)
  if (!text) return false
  void writeClipboard(text)
  return true
}

function onClipboard(view: EditorView, event: ClipboardEvent, cut: boolean, editor: Editor): boolean {
  const range = blockSelectionRange(view.state)
  if (!range || !event.clipboardData) return false
  event.clipboardData.setData('text/plain', blocksSource(editor, range))
  event.preventDefault()
  if (cut) deleteBlocks(editor)
  return true
}

// ---------------------------------------------------------------------------

function decorations(state: EditorState): DecorationSet {
  const range = blockSelectionRange(state)
  if (!range) return DecorationSet.empty
  return DecorationSet.create(
    state.doc,
    range.blocks.map((b) => Decoration.node(b.pos, b.pos + b.node.nodeSize, { class: 'block-selected' })),
  )
}

export const BlockSelection = Extension.create({
  name: 'blockSelection',
  // Before StarterKit's keymaps (Backspace, Tab, Mod-a) and after the slash menu.
  priority: 900,

  addKeyboardShortcuts() {
    const editor = this.editor
    const selected = () => !!getBlockSelection(editor.state)
    const hierarchy = (level: Hierarchy) => () => forEachTargetBlock(editor, (e) => e.commands.setHierarchy(level))
    const align = (value: 'center' | 'right' | null) => () => setOptionOnBlocks(editor, 'align', value)
    return keymapFor({
      bold: () => withTargetSelection(editor, (e) => e.commands.toggleBold()),
      italic: () => withTargetSelection(editor, (e) => e.commands.toggleItalic()),
      underline: () => withTargetSelection(editor, (e) => e.commands.toggleUnderline()),
      strikethrough: () => withTargetSelection(editor, (e) => e.commands.toggleStrike()),
      codeToken: () => withTargetSelection(editor, (e) => e.commands.toggleCode()),
      mathToken: () => {
        const { from, to, empty } = editor.state.selection
        if (empty || selected()) return false
        const text = editor.state.doc.textBetween(from, to)
        if (!text || text.includes('\n')) return false
        return editor.chain().deleteSelection().insertInlineMath(text).run()
      },
      heading1: hierarchy('H1'),
      heading2: hierarchy('H2'),
      heading3: hierarchy('H3'),
      heading4: hierarchy('H4'),
      toDo: () => withTargetSelection(editor, (e) => e.commands.setListType(inAncestor(e, ['taskList']) ? null : 'todo')),
      toggle: () => withTargetSelection(editor, (e) => (inAncestor(e, ['toggle']) ? e.commands.unwrapToggle() : e.commands.wrapInToggle())),
      toggleCodeBlock: () => withTargetSelection(editor, (e) => e.commands.toggleCodeBlock()),
      toggleMathBlock: () => toggleMathBlock(editor),
      textAlignLeft: align(null),
      textAlignCenter: align('center'),
      textAlignRight: align('right'),
      selectActiveBlock: () => selectActiveBlock(editor),
      expandBlockSelectionUpwards: () => expandBlockSelection(editor, -1),
      expandBlockSelectionDownwards: () => expandBlockSelection(editor, 1),
      selectAllBlocks: () => selectAllBlocks(editor),
      deleteBlocks: () => selected() && deleteBlocks(editor),
      duplicateBlocks: () => selected() && duplicateBlocks(editor),
      copyBlocksAsMarkdown: () => copyBlocksAsMarkdown(editor),
      moveSelectedBlocksUp: () => moveBlocks(editor, -1),
      moveSelectedBlocksDown: () => moveBlocks(editor, 1),
      indentBlocks: () => indentBlocks(editor, 1),
      unindentBlocks: () => indentBlocks(editor, -1),
      toggleTodoInBlockWithCursor: () => toggleTodoInBlock(editor),
      toggleToggleInBlockWithCursor: () => toggleToggleInBlock(editor),
      insertBlockAbove: () => insertBlock(editor, 'above'),
      insertBlockBelow: () => insertBlock(editor, 'below'),
    })
  },

  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin<BlockSelectionState>({
        key: blockSelectionKey,
        state: {
          init: () => null,
          apply(tr, value) {
            const meta = tr.getMeta(blockSelectionKey) as Meta | undefined
            if (meta) return meta.set
            if (!value) return null
            // A selection change of its own (a click, an arrow key, typing) ends the block selection.
            if (tr.selectionSet) return null
            if (!tr.docChanged) return value
            const anchor = tr.mapping.mapResult(value.anchor, 1)
            const head = tr.mapping.mapResult(value.head, 1)
            if (anchor.deleted || head.deleted) return null
            return rangeBetween(tr.doc, anchor.pos, head.pos) ? { anchor: anchor.pos, head: head.pos } : null
          },
        },
        props: {
          decorations: (state) => decorations(state),
          attributes: (state): Record<string, string> =>
            getBlockSelection(state) ? { class: 'has-block-selection' } : {},
          handleTextInput(view, _from, _to, text) {
            const range = blockSelectionRange(view.state)
            if (!range) return false
            const { schema } = view.state
            const tr = view.state.tr.replaceWith(range.from, range.to, schema.nodes.paragraph.create(null, schema.text(text)))
            tr.setSelection(TextSelection.create(tr.doc, range.from + 1 + text.length))
            view.dispatch(setBlockSelectionIn(tr, null))
            return true
          },
          handleDOMEvents: {
            copy: (view, event) => onClipboard(view, event, false, editor),
            cut: (view, event) => onClipboard(view, event, true, editor),
          },
        },
      }),
    ]
  },
})
