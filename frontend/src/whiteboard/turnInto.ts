/**
 * Whiteboard helpers other lanes call (M8 Task 22 fills them): turn editor blocks into a new board
 * ("Turn into whiteboard") and add an object to a board ("Add to whiteboard"). Until then each
 * throws `NotBuiltYet`; callers show "Not available yet".
 */
import { NotBuiltYet } from '@/lib/notBuilt'

/** Create a board titled `title` holding `markdownBlocks` as text nodes; resolves with its path. */
export async function turnBlocksIntoWhiteboard(markdownBlocks: string[], title: string): Promise<string> {
  void markdownBlocks
  void title
  throw new NotBuiltYet('turnBlocksIntoWhiteboard')
}

/** Add `objectPath` to a board the user picks; resolves with the board's path. */
export async function addObjectToWhiteboard(objectPath: string): Promise<string> {
  void objectPath
  throw new NotBuiltYet('addObjectToWhiteboard')
}
