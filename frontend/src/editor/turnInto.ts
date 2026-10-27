/**
 * Turn a block into an object, a task or a Task object (M8). Stub: Task 25
 * fixes the signatures (the editor's shortcuts and the block menu call them);
 * Task 27 fills the bodies, keeping these names and signatures.
 *
 * - `turnIntoObject`: the block's text becomes the title of a new object of
 *   type `typeId`, its children the body, and the block becomes an embed of it.
 * - `turnIntoTask`: the block becomes a Task titled with its text.
 * - `turnTodoIntoTask`: a to-do becomes a Task (status Done when checked).
 *
 * Each resolves `true` when it changed the document. `pos` names the block
 * (default: the block at the selection).
 */
import type { Editor } from '@tiptap/core'
import { NotBuiltYet } from '@/lib/notBuilt'

export type TurnIntoOptions = { pos?: number }

export async function turnIntoObject(_editor: Editor, _typeId?: string | null, _opts: TurnIntoOptions = {}): Promise<boolean> {
  throw new NotBuiltYet('turnIntoObject')
}

export async function turnIntoTask(_editor: Editor, _opts: TurnIntoOptions = {}): Promise<boolean> {
  throw new NotBuiltYet('turnIntoTask')
}

export async function turnTodoIntoTask(_editor: Editor, _opts: TurnIntoOptions = {}): Promise<boolean> {
  throw new NotBuiltYet('turnTodoIntoTask')
}
