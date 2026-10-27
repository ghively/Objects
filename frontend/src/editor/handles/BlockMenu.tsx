/**
 * The block menu (Task 12), opened by clicking a block's drag handle (the
 * block is then the block selection): "Turn Into", Task 8's "Hierarchy",
 * "List", "Quote", "Color" and "Icon" menus, "Insert block above/below",
 * "Move up/down", "Duplicate", "Remove style" and "Delete". Each row shows its
 * shortcut keys from the registry. Strings are Capacities' (keys beside them).
 */
import type { Editor } from '@tiptap/core'
import type { ReactNode } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { formatKeys, keysFor } from '@/lib/shortcuts'
import {
  deleteBlocks,
  duplicateBlocks,
  insertBlock,
  moveBlocks,
  removeStyle,
  turnInto,
  type TurnIntoKind,
} from '../extensions/blockSelection'
import { BlockStyleMenu } from '../menus/BlockStyleMenu'

export const BLOCK_MENU_TEXT = {
  turnInto: 'Turn Into', // tokensMenu.turnInto.name
  insertAbove: 'Insert block above', // BlockMenu.insertAbove
  insertBelow: 'Insert block below', // BlockMenu.insertBelow
  moveUp: 'Move up', // tokensMenu.moveUp.shortName
  moveDown: 'Move down', // tokensMenu.moveDown.shortName
  duplicate: 'Duplicate', // EntityMenu.duplicateObject.text
  removeStyle: 'Remove style', // blocksMenu.operations.removeStyle
  delete: 'Delete', // general.delete
}

/** "Turn Into" items: name (Capacities' key), kind, and the shortcut id whose keys the row shows. */
export const TURN_INTO_ITEMS: readonly { kind: TurnIntoKind; name: string; shortcut?: string }[] = [
  { kind: 'text', name: 'Text' }, // blocks.TextBlock.name
  { kind: 'H1', name: 'Heading 1', shortcut: 'heading1' }, // ControlDropdown.custom.block_H1.name
  { kind: 'H2', name: 'Heading 2', shortcut: 'heading2' },
  { kind: 'H3', name: 'Heading 3', shortcut: 'heading3' },
  { kind: 'H4', name: 'Heading 4', shortcut: 'heading4' },
  { kind: 'S', name: 'Small' }, // block_S
  { kind: 'bullet', name: 'Bullet list' }, // block_bullet
  { kind: 'numerical', name: 'Numbered list' }, // block_numerical
  { kind: 'alphabetical', name: 'Alphabetical list' }, // block_alphabetical
  { kind: 'roman', name: 'Roman list' }, // block_roman
  { kind: 'todo', name: 'To-do', shortcut: 'toDo' }, // block_todo
  { kind: 'toggle', name: 'Toggle', shortcut: 'toggle' }, // block_toggle
  { kind: 'quote', name: 'Quote block' }, // block_quote
  { kind: 'code', name: 'Code', shortcut: 'toggleCodeBlock' }, // blocks.CodeBlock.name
]

/** The registry's first key for `id`, formatted for display (empty when it has none). */
export function shortcutHint(id: string | undefined): string {
  if (!id) return ''
  const keys = keysFor(id)
  return keys.length ? formatKeys(keys[0]) : ''
}

function Row({ onSelect, shortcut, children }: { onSelect: () => void; shortcut?: string; children: ReactNode }) {
  const hint = shortcutHint(shortcut)
  return (
    <DropdownMenuItem onSelect={onSelect}>
      {children}
      {hint && <DropdownMenuShortcut>{hint}</DropdownMenuShortcut>}
    </DropdownMenuItem>
  )
}

export interface BlockMenuProps {
  editor: Editor
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Where the menu is anchored (the drag handle's rectangle). */
  anchor: { left: number; top: number; width: number; height: number } | null
}

export function BlockMenu({ editor, open, onOpenChange, anchor }: BlockMenuProps) {
  const close = () => onOpenChange(false)
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden
          data-block-menu-anchor=""
          style={{
            position: 'fixed',
            left: anchor?.left ?? 0,
            top: anchor?.top ?? 0,
            width: anchor?.width ?? 0,
            height: anchor?.height ?? 0,
            pointerEvents: 'none',
          }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="bottom" className="min-w-[220px]" onCloseAutoFocus={(e) => e.preventDefault()}>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>{BLOCK_MENU_TEXT.turnInto}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-[420px] overflow-auto">
            {TURN_INTO_ITEMS.map((t) => (
              <Row key={t.kind} shortcut={t.shortcut} onSelect={() => turnInto(editor, t.kind)}>
                {t.name}
              </Row>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <BlockStyleMenu editor={editor} onDone={close} />
        <DropdownMenuSeparator />
        <Row shortcut="insertBlockAbove" onSelect={() => insertBlock(editor, 'above')}>
          {BLOCK_MENU_TEXT.insertAbove}
        </Row>
        <Row shortcut="insertBlockBelow" onSelect={() => insertBlock(editor, 'below')}>
          {BLOCK_MENU_TEXT.insertBelow}
        </Row>
        <Row shortcut="moveSelectedBlocksUp" onSelect={() => moveBlocks(editor, -1)}>
          {BLOCK_MENU_TEXT.moveUp}
        </Row>
        <Row shortcut="moveSelectedBlocksDown" onSelect={() => moveBlocks(editor, 1)}>
          {BLOCK_MENU_TEXT.moveDown}
        </Row>
        <Row shortcut="duplicateBlocks" onSelect={() => duplicateBlocks(editor)}>
          {BLOCK_MENU_TEXT.duplicate}
        </Row>
        <DropdownMenuSeparator />
        <Row onSelect={() => removeStyle(editor)}>{BLOCK_MENU_TEXT.removeStyle}</Row>
        <Row shortcut="deleteBlocks" onSelect={() => deleteBlocks(editor)}>
          {BLOCK_MENU_TEXT.delete}
        </Row>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
