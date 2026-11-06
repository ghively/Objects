/**
 * Switching a link between its two forms (Gene, 2026-11-06): an object card (`objectEmbed`,
 * `![[Title]]`) becomes a line holding the same inline link (`[[Title]]`), and a line holding
 * only an inline link becomes a card. Target and label carry over; the card's own block options
 * (its view and size) belong to the card and are dropped when it turns into a link.
 */
import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { targetRange } from './extensions/blockSelection'

/** Our strings: the card's `…` menu row and the block menu row. */
export const LINK_CARD_TEXT = {
  toLink: 'Turn into inline link',
  toCard: 'Turn into card',
}

/** The one inline link a paragraph holds (whitespace around it allowed), else null. */
function soleLink(block: PMNode): PMNode | null {
  if (block.type.name !== 'paragraph') return null
  let link: PMNode | null = null
  let other = false
  block.forEach((child) => {
    if (child.type.name === 'wikilink' && !link) link = child
    else if (!(child.isText && !(child.text ?? '').trim())) other = true
  })
  return other ? null : link
}

/** The target block when it is one paragraph holding only an inline link: its position and the link. */
export function soleLinkBlock(editor: Editor): { pos: number; target: string; label: string | null } | null {
  const range = targetRange(editor.state)
  if (!range || range.first !== range.last) return null
  const block = editor.state.doc.nodeAt(range.from)
  const link = block ? soleLink(block) : null
  if (!link) return null
  return { pos: range.from, target: String(link.attrs.target ?? ''), label: (link.attrs.label as string | null) ?? null }
}

/** Replace the card at `pos` with a paragraph holding the same link. False when no card is there. */
export function cardToLink(editor: Editor, pos: number): boolean {
  const card = editor.state.doc.nodeAt(pos)
  if (!card || card.type.name !== 'objectEmbed') return false
  const { schema } = editor.state
  const link = schema.nodes.wikilink.create({ target: card.attrs.target, label: card.attrs.label ?? null })
  const paragraph = schema.nodes.paragraph.create(null, link)
  editor.view.dispatch(editor.state.tr.replaceWith(pos, pos + card.nodeSize, paragraph))
  return true
}

/** Replace the target line (only an inline link) with a card of the same object. False when it isn't one. */
export function linkToCard(editor: Editor): boolean {
  const found = soleLinkBlock(editor)
  if (!found) return false
  const block = editor.state.doc.nodeAt(found.pos)!
  const card = editor.state.schema.nodes.objectEmbed.create({ target: found.target, label: found.label })
  editor.view.dispatch(editor.state.tr.replaceWith(found.pos, found.pos + block.nodeSize, card))
  return true
}
