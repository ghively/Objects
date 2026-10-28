/**
 * Whiteboard helpers other lanes call (M8 Task 22):
 * - `turnBlocksIntoWhiteboard` ("Turn into whiteboard", `Whiteboard.turnInto.action`): a new
 *   board titled `title` with each editor block as a node, top to bottom in one column: an object
 *   embed (`![[Title]]`, with or without its `<!-- block: … -->` options) becomes an entity node,
 *   anything else a text node holding the block's Markdown. Resolves with the board's path; on a
 *   failure it throws `Could not create whiteboard` (`Whiteboard.turnInto.failed`).
 * - `addObjectToWhiteboard` ("Add to whiteboard", `Whiteboard.addTo.action`): opens the dialog;
 *   resolves with the board the object was added to (rejects when the dialog is closed).
 * - `placeObjectOnBoard`: adds an entity node for an object right of a board's content and saves
 *   the board (one retry on a stale revision).
 */
import { whiteboardApi, type WhiteboardApi } from '@/api/whiteboardClient'
import { RevisionConflictError } from '@/api/client'
import type { WhiteboardData, WhiteboardNode } from '@/api/whiteboardTypes'
import { classifyEmbedLine } from '@/editor/annotations'
import { addEntityRightOfContent, DEFAULT_ENTITY_HEIGHT, newId } from './actions'
import { useAddToWhiteboard } from './AddToWhiteboardDialog'
import { wikilinkFor } from './linkText'
import { DEFAULT_NODE_WIDTH, emptyBoard, GRID, LINK_BLOCK_MIN_WIDTH, nextContentZ } from './model'

/** `Whiteboard.turnInto.failed` */
export const TURN_INTO_FAILED = 'Could not create whiteboard'

/** Space between the nodes of a turned-into board (one grid cell; our choice). */
export const COLUMN_GAP = GRID

/** A line of block options (M7's annotation grammar) before a block. */
const OPTION_LINE = /^\s*<!--[\s\S]*?-->\s*$/

/** The object an editor block embeds (`[[Title]]`), or null when the block isn't one object embed. */
export function embeddedLink(markdown: string): string | null {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim() !== '')
  while (lines.length > 1 && OPTION_LINE.test(lines[0])) lines.shift()
  if (lines.length !== 1) return null
  const c = classifyEmbedLine(lines[0])
  return c && c.kind === 'objectEmbed' ? `[[${c.target}]]` : null
}

/**
 * The height a text node is laid out with before it is measured: one grid cell per line, at
 * least two (our estimate; the node sizes itself to its text once shown).
 */
export function estimatedTextHeight(markdown: string): number {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n').length
  return Math.max(GRID * 2, lines * GRID)
}

/** The board `turnBlocksIntoWhiteboard` writes: the blocks as nodes in one column from the origin. */
export function boardFromBlocks(markdownBlocks: readonly string[]): WhiteboardData {
  const board = emptyBoard()
  let y = 0
  for (const markdown of markdownBlocks) {
    if (!markdown.trim()) continue
    const id = newId()
    const blockId = newId()
    const link = embeddedLink(markdown)
    const z = nextContentZ(Object.values(board.nodes))
    let node: WhiteboardNode
    if (link) {
      node = { id, kind: 'block', blockId, position: { x: 0, y }, width: LINK_BLOCK_MIN_WIDTH, height: DEFAULT_ENTITY_HEIGHT, z }
      board.blocks[blockId] = { type: 'entity', link }
      y += DEFAULT_ENTITY_HEIGHT + COLUMN_GAP
    } else {
      // Width set, height left to the text (the node grows to fit, as a text block does).
      node = { id, kind: 'block', blockId, position: { x: 0, y }, width: DEFAULT_NODE_WIDTH, z }
      board.blocks[blockId] = { type: 'text', markdown }
      y += estimatedTextHeight(markdown) + COLUMN_GAP
    }
    board.nodes[id] = node
  }
  return board
}

/** Create a board titled `title` holding `markdownBlocks` as nodes; resolves with its path. */
export async function turnBlocksIntoWhiteboard(
  markdownBlocks: string[],
  title: string,
  client: Pick<WhiteboardApi, 'createWhiteboard' | 'board' | 'saveBoard'> = whiteboardApi,
): Promise<string> {
  try {
    const created = await client.createWhiteboard(title)
    const board = boardFromBlocks(markdownBlocks)
    const current = await client.board(created.path)
    await client.saveBoard(created.path, { ...current.board, ...board }, current.revision)
    return created.path
  } catch (err) {
    throw new Error(TURN_INTO_FAILED, { cause: err })
  }
}

/**
 * Adds an entity node for `objectPath` to the board at `boardPath`, right of its content, and
 * saves it. A stale revision (the board changed meanwhile) is re-read and tried once more.
 */
export async function placeObjectOnBoard(
  boardPath: string,
  objectPath: string,
  client: Pick<WhiteboardApi, 'board' | 'saveBoard'> = whiteboardApi,
  link: string = wikilinkFor(objectPath),
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const res = await client.board(boardPath)
    if (res.readOnlyReason) throw new Error(res.readOnlyReason)
    const next = addEntityRightOfContent(res.board, link)
    try {
      await client.saveBoard(boardPath, next, res.revision)
      return
    } catch (err) {
      if (attempt === 0 && err instanceof RevisionConflictError) continue
      throw err
    }
  }
}

/** Add `objectPath` to a board the user picks; resolves with the board's path. */
export function addObjectToWhiteboard(objectPath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    useAddToWhiteboard.getState().open(objectPath, { resolve, reject })
  })
}
