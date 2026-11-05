/**
 * M10: the editor's entries into the AI assistant (the slash menu's "Ask AI about this block" and
 * "Add tags to block using AI", the block menu's "AI assistant...", the selection toolbar's and the
 * block-selection bar's "AI"). Each builds an `AiSeed` for `openAiChat` (`@/ai/store`, the
 * contract): the block(s) or selected text, the edited object as context, and the two callbacks
 * the chat panel calls once the user accepts an answer:
 *
 * - `onReplace(text)` puts the text in place of what was asked about: blocks as Markdown parsed
 *   into blocks (the paste reader, `pasteBlocks`; plain text is one paragraph per line, as a
 *   plain-text paste), a text selection as plain text.
 * - `onInsertBelow(text)` inserts it as new blocks after the block(s) (for a text selection,
 *   after the block holding it).
 *
 * The chat panel takes the focus, and the user may go on editing before accepting, so the range
 * is remembered when the chat opens and mapped through every later transaction. If what it covers
 * no longer matches what was sent (edited, deleted, or the page reloaded), replace inserts below
 * instead and never overwrites newer text. Accepting after the page was closed changes nothing and
 * says so (our string).
 */
import type { Editor } from '@tiptap/core'
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import { openAiChat, type AiSeed } from '@/ai/store'
import type { AiMode } from '@/api/types'
import { blocksSource, getBlockSelection, pasteBlocks, setBlockSelectionIn, targetRange, type BlockRange } from './extensions/blockSelection'
import { showToast } from './media/upload'
import { BLOCK_PARENTS } from './nodes/blockOptions'
import { editorObjectPath } from './nodes/blockRef'

export const AI_TEXT = {
  /** Slash menu (catalog audit item 41, "Use the AI Assistant"). */
  askBlock: 'Ask AI about this block',
  tagBlock: 'Add tags to block using AI',
  /** Block handle menu (catalog section 6). */
  assistant: 'AI assistant...',
  /** Selection toolbar's sparkle and the block-selection bar's button (catalog section 6). */
  ai: 'AI',
  /** Our string: an answer accepted after its page was closed. */
  closed: 'The page was closed, so the AI answer was not applied',
}

/** The icon of every AI entry (the catalog's "AI sparkle"). */
export const AI_ICON = 'ph-sparkle'

/** The edited object as the request's context, when the editor knows it. */
function contextOf(editor: Editor): Pick<AiSeed, 'contextPaths'> {
  const path = editorObjectPath(editor)
  return path ? { contextPaths: [path] } : {}
}

/** A range kept in step with the editor's later edits (mapped through each transaction). */
interface Anchor {
  from: number
  to: number
}

function track(editor: Editor, from: number, to: number): Anchor {
  const anchor: Anchor = { from, to }
  const onTransaction = ({ transaction }: { transaction: Transaction }) => {
    if (!transaction.docChanged) return
    // Text typed at either edge stays outside the range.
    anchor.from = transaction.mapping.map(anchor.from, 1)
    anchor.to = Math.max(anchor.from, transaction.mapping.map(anchor.to, -1))
  }
  editor.on('transaction', onTransaction)
  return anchor
}

/** One paragraph per non-empty line (a plain-text paste); none for blank text. */
function plainParagraphs(editor: Editor, text: string): PMNode[] {
  const { paragraph } = editor.schema.nodes
  return text
    .split(/\r\n?|\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => paragraph.create(null, editor.schema.text(line)))
}

/** Accepted text as blocks: Markdown read as the paste reader reads it, else plain paragraphs. */
function blocksFromText(editor: Editor, text: string): PMNode[] {
  const clean = text.replace(/\r\n?/g, '\n').trim()
  if (!clean) return []
  return pasteBlocks(editor, clean) ?? plainParagraphs(editor, clean)
}

/** The position after the block holding `pos` (the deepest block whose parent holds blocks). */
function afterBlockAt(doc: PMNode, pos: number): number {
  const at = Math.max(0, Math.min(pos, doc.content.size))
  const $p = doc.resolve(at)
  if (BLOCK_PARENTS.has($p.parent.type.name)) return at
  for (let d = $p.depth; d >= 1; d--) if (BLOCK_PARENTS.has($p.node(d - 1).type.name)) return $p.after(d)
  return doc.content.size
}

/** Insert `nodes` after the block holding `pos`; at the end of the page when they don't fit there. */
function insertAfter(tr: Transaction, pos: number, nodes: PMNode[]): void {
  try {
    tr.insert(afterBlockAt(tr.doc, pos), nodes)
  } catch {
    tr.insert(tr.doc.content.size, nodes)
  }
}

/** Run `change` on a fresh transaction and dispatch it (nothing when the editor is gone). */
function apply(editor: Editor, change: (tr: Transaction) => void): void {
  if (editor.isDestroyed) {
    showToast(AI_TEXT.closed)
    return
  }
  const tr = editor.state.tr
  change(tr)
  if (!tr.docChanged) return
  if (getBlockSelection(editor.state)) setBlockSelectionIn(tr, null)
  editor.view.dispatch(tr.scrollIntoView())
}

/**
 * The seed for asking about blocks: the block selection, else the block with the cursor (the
 * slash menu's), sent as their Markdown source.
 */
export function blocksSeed(editor: Editor, mode: AiMode, range: BlockRange | null = targetRange(editor.state)): AiSeed {
  if (!range) return { mode, ...contextOf(editor), block: null }
  const original = Fragment.from(range.blocks.map((b) => b.node))
  const anchor = track(editor, range.from, range.to)
  const unchanged = () => {
    const { doc } = editor.state
    if (anchor.from >= anchor.to || anchor.to > doc.content.size) return false
    const slice = doc.slice(anchor.from, anchor.to)
    return slice.openStart === 0 && slice.openEnd === 0 && slice.content.eq(original)
  }
  return {
    mode,
    ...contextOf(editor),
    block: blocksSource(editor, range).replace(/(?:\r?\n)+$/, ''),
    onReplace: (text) =>
      apply(editor, (tr) => {
        const nodes = blocksFromText(editor, text)
        if (!nodes.length) return
        if (!unchanged()) return insertAfter(tr, anchor.to, nodes)
        try {
          tr.replaceWith(anchor.from, anchor.to, nodes)
        } catch {
          insertAfter(tr, anchor.to, nodes)
        }
      }),
    onInsertBelow: (text) =>
      apply(editor, (tr) => {
        const nodes = blocksFromText(editor, text)
        if (nodes.length) insertAfter(tr, anchor.to, nodes)
      }),
  }
}

/** Open the assistant about the block selection (or the cursor's block). */
export function openBlocksAi(editor: Editor, mode: AiMode = 'askBlock'): void {
  openAiChat(blocksSeed(editor, mode))
}

/** The selected text, blocks separated by a line break; null for an empty selection. */
function selectedText(editor: Editor, from: number, to: number): string | null {
  if (from >= to) return null
  const text = editor.state.doc.textBetween(from, to, '\n', ' ')
  return text.trim() === '' ? null : text
}

/**
 * The seed for the selection toolbar's sparkle: the selected text, in the plain chat mode. Null
 * when nothing is selected.
 */
export function selectionSeed(editor: Editor): AiSeed | null {
  const { from, to } = editor.state.selection
  const text = selectedText(editor, from, to)
  if (text === null) return null
  const anchor = track(editor, from, to)
  const unchanged = () => anchor.to <= editor.state.doc.content.size && selectedText(editor, anchor.from, anchor.to) === text
  return {
    mode: 'chat',
    ...contextOf(editor),
    block: text,
    onReplace: (answer) =>
      apply(editor, (tr) => {
        const paragraphs = plainParagraphs(editor, answer)
        if (!paragraphs.length) return
        if (!unchanged()) return insertAfter(tr, anchor.to, paragraphs)
        try {
          if (paragraphs.length === 1) tr.insertText(paragraphs[0].textContent, anchor.from, anchor.to)
          // Several lines: the first joins the text before the selection, the last the text after it.
          else tr.replace(anchor.from, anchor.to, new Slice(Fragment.from(paragraphs), 1, 1))
        } catch {
          insertAfter(tr, anchor.to, paragraphs)
        }
      }),
    onInsertBelow: (answer) =>
      apply(editor, (tr) => {
        const paragraphs = plainParagraphs(editor, answer)
        if (paragraphs.length) insertAfter(tr, anchor.to, paragraphs)
      }),
  }
}

/** Open the assistant about the selected text. */
export function openSelectionAi(editor: Editor): void {
  const seed = selectionSeed(editor)
  if (seed) openAiChat(seed)
}
