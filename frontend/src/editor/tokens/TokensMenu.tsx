/**
 * The text-selection toolbar (`tokensMenu.*`): Bold, Italic, … "Highlight
 * text", "Turn Into", "Create object from text selection." and the rest.
 * Stub: Task 25 mounts it in `Editor.tsx`; Task 26 fills it, keeping the name
 * and props.
 */
import type { Editor } from '@tiptap/core'

export type TokensMenuProps = { editor: Editor | null; path: string }

export function TokensMenu(_props: TokensMenuProps) {
  return null
}
