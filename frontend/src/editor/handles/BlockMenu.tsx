/**
 * The block menu (Task 12), opened by clicking a block's drag handle (the
 * block is then the block selection). Capacities' live block menu (catalog
 * section 6, read 2026-11-02; labels from the English strings), in its order:
 *
 * 1. "Hierarchy (<current>)" ▸, "List" ▸, "To-do", "Quote", "Toggle",
 *    "Group" (Ctrl+G) (`BlockStyleMenu` without its "Icon" row);
 * 2. (Capacities' "AI assistant...": M10, not here yet)
 *    "Turn into..." ▸ (the object picker: the types, a to-do's "Turn into
 *    task object", "Turn into whiteboard"), "Copy" ▸ ("Copy blocks", "Copy as
 *    Markdown", "Copy block reference" for one block), "Duplicate" (Ctrl+D),
 *    "Remove" (Backspace, red trash).
 *
 * The bundle's "Icon" ▸ and "Insert block above / below" rows are not in the
 * live menu: the block-selection bar's icon dropdown sets icons, and the `+`
 * handle and Alt+Enter / Alt+Shift+Enter insert blocks.
 *
 * A last section holds Object's own rows that nothing else reaches
 * (`BlockStyleExtras` without Color, which the selection bar has: Alignment,
 * Standout, Indent, Unindent). Several selected blocks show "<n> selected" on
 * top. Rows show their shortcut keys from the registry.
 */
import type { Editor } from '@tiptap/core'
import type { ReactNode } from 'react'
import { Icon } from '@/components/Icon'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { TypeDef } from '@/api/types'
import { useLinkIndex } from '@/links/linkIndex'
import { NOT_AVAILABLE, NotBuiltYet } from '@/lib/notBuilt'
import { formatKeys, keysFor } from '@/lib/shortcuts'
import { TypeChip } from '@/shell/Sidebar'
import { isWhiteboardType } from '@/whiteboard/isWhiteboard'
import {
  blockSelectionRange,
  copyBlocksAsMarkdown,
  deleteBlocks,
  duplicateBlocks,
  targetRange,
  type TurnIntoKind,
} from '../extensions/blockSelection'
import { showToast } from '../media/upload'
import { BlockStyleExtras, BlockStyleMenu } from '../menus/BlockStyleMenu'
import { copyBlockReference } from '../nodes/blockRef'
import { hasTodoAt, turnIntoObject, turnIntoWhiteboard, turnTodoIntoTask } from '../turnInto'

export const BLOCK_MENU_TEXT = {
  insertAbove: 'Insert block above', // BlockMenu.insertAbove
  insertBelow: 'Insert block below', // BlockMenu.insertBelow
  turnInto: 'Turn into...', // ActionItems.turnBlocksInto.title
  copy: 'Copy', // ActionItems.copy.title
  copyBlocks: 'Copy blocks', // ActionItems.copyBlocks.title
  copyAsMarkdown: 'Copy as Markdown', // ActionItems.copyBlocksAsMarkdown.title
  copyBlockReference: 'Copy block reference', // ActionItems.copyBlockReference.title
  duplicate: 'Duplicate', // ActionItems.duplicateBlocks.title
  remove: 'Remove', // ActionItems.deleteBlocks.title
  selected: (n: number) => `${n} selected`, // blocksMenu.blocksSelected
  turnIntoTaskObject: 'Turn into task object', // components.RootTask.turnBlockIntoTaskObject
  turnIntoWhiteboard: 'Turn into whiteboard', // Whiteboard.turnInto.action
}

/** Run an async block action; a part another task hasn't built yet shows "Not available yet". */
function run(action: () => Promise<boolean>): void {
  void action().catch((err) => {
    if (err instanceof NotBuiltYet) showToast(NOT_AVAILABLE)
  })
}

/** The tokens menu's "Turn Into" items: name (Capacities' key), kind, and the shortcut id whose keys the row shows. */
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

function Row({
  onSelect,
  shortcut,
  icon,
  variant,
  children,
}: {
  onSelect: () => void
  shortcut?: string
  icon?: string
  variant?: 'destructive'
  children: ReactNode
}) {
  const hint = shortcutHint(shortcut)
  return (
    <DropdownMenuItem onSelect={onSelect} variant={variant}>
      {icon && <Icon name={icon} size={16} />}
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
  const types = useLinkIndex((s) => s.types).filter((t: TypeDef) => !t.readOnlyReason)
  const todo = open && hasTodoAt(editor)
  const selected = open ? (blockSelectionRange(editor.state)?.blocks.length ?? 0) : 0
  const targetCount = open ? (targetRange(editor.state)?.blocks.length ?? 0) : 0
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
        {selected > 1 && <DropdownMenuLabel className="text-muted-foreground">{BLOCK_MENU_TEXT.selected(selected)}</DropdownMenuLabel>}
        <BlockStyleMenu editor={editor} onDone={close} icon={false} />
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Icon name="ph-arrow-u-down-right" size={16} />
            {BLOCK_MENU_TEXT.turnInto}
            {shortcutHint('turnIntoObject') && <DropdownMenuShortcut>{shortcutHint('turnIntoObject')}</DropdownMenuShortcut>}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-[420px] overflow-auto">
            {types.map((t) => (
              <DropdownMenuItem
                key={t.id}
                onSelect={() => run(() => (isWhiteboardType(t) ? turnIntoWhiteboard(editor) : turnIntoObject(editor, t.id)))}
              >
                <TypeChip type={t} size={18} />
                {t.name}
              </DropdownMenuItem>
            ))}
            {!types.some(isWhiteboardType) && (
              <Row onSelect={() => run(() => turnIntoWhiteboard(editor))}>{BLOCK_MENU_TEXT.turnIntoWhiteboard}</Row>
            )}
            {todo && (
              <Row shortcut="turnBlockIntoTaskObject" onSelect={() => run(() => turnTodoIntoTask(editor))}>
                {BLOCK_MENU_TEXT.turnIntoTaskObject}
              </Row>
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Icon name="ph-copy" size={16} />
            {BLOCK_MENU_TEXT.copy}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {/* Object's block clipboard is the blocks' Markdown source, so both rows copy it. */}
            <Row icon="ph-copy" onSelect={() => copyBlocksAsMarkdown(editor)}>
              {BLOCK_MENU_TEXT.copyBlocks}
            </Row>
            <Row icon="ph-copy" shortcut="copyBlocksAsMarkdown" onSelect={() => copyBlocksAsMarkdown(editor)}>
              {BLOCK_MENU_TEXT.copyAsMarkdown}
            </Row>
            {targetCount === 1 && (
              <Row icon="ph-copy" shortcut="copyBlockReference" onSelect={() => copyBlockReference(editor)}>
                {BLOCK_MENU_TEXT.copyBlockReference}
              </Row>
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <Row icon="ph-copy" shortcut="duplicateBlocks" onSelect={() => duplicateBlocks(editor)}>
          {BLOCK_MENU_TEXT.duplicate}
        </Row>
        <Row icon="ph-trash" variant="destructive" shortcut="deleteBlocks" onSelect={() => deleteBlocks(editor)}>
          {BLOCK_MENU_TEXT.remove}
        </Row>
        <DropdownMenuSeparator />
        <BlockStyleExtras editor={editor} color={false} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
