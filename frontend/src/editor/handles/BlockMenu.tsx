/**
 * The block menu (Task 12), opened by clicking a block's drag handle (the
 * block is then the block selection). The block menu (catalog
 * section 6, read 2026-11-02; labels from the English strings), in its order:
 *
 * 1. "Hierarchy (<current>)" ▸, "List" ▸, "To-do", "Quote", "Toggle",
 *    "Group" (Ctrl+G) (`BlockStyleMenu` without its "Icon" row);
 * 2. "AI assistant..." (M10: opens the AI chat about the blocks, `aiEntries`; gone while
 *    "Hide AI features" is on), "Turn into..." ▸ (the object picker: the types, a to-do's "Turn into
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
import { useAiHidden } from '@/ai/store'
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
import { AI_ICON, AI_TEXT, openBlocksAi, useAiBlocked } from '../aiEntries'
import { showToast } from '../media/upload'
import { BlockStyleExtras, BlockStyleMenu } from '../menus/BlockStyleMenu'
import { copyBlockReference } from '../nodes/blockRef'
import { LINK_CARD_TEXT, linkToCard, soleLinkBlock } from '../linkCard'
import { SUGGEST_TEXT } from '@/create/typeSuggest'
import { hasTodoAt, suggestedTurnType, turnIntoObject, turnIntoWhiteboard, turnTitleAt, turnTodoIntoTask } from '../turnInto'

export const BLOCK_MENU_TEXT = {
  insertAbove: 'Insert block above',
  insertBelow: 'Insert block below',
  turnInto: 'Turn into...',
  copy: 'Copy',
  copyBlocks: 'Copy blocks',
  copyAsMarkdown: 'Copy as Markdown',
  copyBlockReference: 'Copy block reference',
  duplicate: 'Duplicate',
  remove: 'Remove',
  selected: (n: number) => `${n} selected`,
  turnIntoTaskObject: 'Turn into task object',
  turnIntoWhiteboard: 'Turn into whiteboard',
}

/** Run an async block action; a part another task hasn't built yet shows "Not available yet". */
function run(action: () => Promise<boolean>): void {
  void action().catch((err) => {
    if (err instanceof NotBuiltYet) showToast(NOT_AVAILABLE)
  })
}

/** The "Turn Into" items: name, kind, and the shortcut id whose keys the row shows. */
export const TURN_INTO_ITEMS: readonly { kind: TurnIntoKind; name: string; shortcut?: string }[] = [
  { kind: 'text', name: 'Text' },
  { kind: 'H1', name: 'Heading 1', shortcut: 'heading1' },
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
  { kind: 'code', name: 'Code', shortcut: 'toggleCodeBlock' },
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

/**
 * The object picker behind "Turn into..." (and the block-selection bar's "Turn blocks into"): the
 * writable types, "Turn into whiteboard" when no type is the whiteboard one, and a to-do's "Turn
 * into task object". Render inside a dropdown menu's content. M29: the suggested type for the
 * block's title comes first, marked "Suggested"; the others keep their order.
 */
export function TurnIntoObjectItems({ editor, todo }: { editor: Editor; todo: boolean }) {
  const writable = useLinkIndex((s) => s.types).filter((t: TypeDef) => !t.readOnlyReason)
  const suggestedId = suggestedTurnType(turnTitleAt(editor))
  const top = suggestedId ? writable.find((t) => t.id === suggestedId) : undefined
  const types = top ? [top, ...writable.filter((t) => t !== top)] : writable
  return (
    <>
      {types.map((t) => (
        <DropdownMenuItem
          key={t.id}
          data-turn-type={t.id}
          onSelect={() => run(() => (isWhiteboardType(t) ? turnIntoWhiteboard(editor) : turnIntoObject(editor, t.id)))}
        >
          <TypeChip type={t} size={18} />
          {t.name}
          {t === top && (
            <span className="ml-auto rounded bg-hover px-1.5 text-[12px] text-fg-muted">{SUGGEST_TEXT.suggested}</span>
          )}
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
    </>
  )
}

export function BlockMenu({ editor, open, onOpenChange, anchor }: BlockMenuProps) {
  const close = () => onOpenChange(false)
  const todo = open && hasTodoAt(editor)
  const selected = open ? (blockSelectionRange(editor.state)?.blocks.length ?? 0) : 0
  const targetCount = open ? (targetRange(editor.state)?.blocks.length ?? 0) : 0
  const linkLine = open && editor.isEditable && !!soleLinkBlock(editor)
  // Hidden too on a page excluded from AI or a template (M10).
  const aiBlocked = useAiBlocked(editor)
  const aiHidden = useAiHidden() || aiBlocked
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
        {!aiHidden && (
          <Row icon={AI_ICON} onSelect={() => openBlocksAi(editor, 'askBlock')}>
            {AI_TEXT.assistant}
          </Row>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Icon name="ph-arrow-u-down-right" size={16} />
            {BLOCK_MENU_TEXT.turnInto}
            {shortcutHint('turnIntoObject') && <DropdownMenuShortcut>{shortcutHint('turnIntoObject')}</DropdownMenuShortcut>}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-[420px] overflow-auto">
            <TurnIntoObjectItems editor={editor} todo={todo} />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {linkLine && (
          <Row icon="ph-arrow-u-down-right" onSelect={() => linkToCard(editor)}>
            {LINK_CARD_TEXT.toCard}
          </Row>
        )}
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
