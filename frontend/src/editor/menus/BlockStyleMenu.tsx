/**
 * The block menu's style rows, rendered inside a dropdown menu's content
 * (Task 12's block menu). `BlockStyleMenu` is Capacities' first block-menu
 * section, in its order (reference check 2026-10-28, 2e): "Hierarchy
 * (<current>)" ▸ (Standard, Small, Heading 1–4), "List" ▸, "To-do", "Icon" ▸,
 * "Quote", "Toggle", "Group". `BlockStyleExtras` holds the rows Capacities'
 * block menu does not have but Object has no other way to reach: "Color" ▸,
 * "Standout" (our string), "Indent" / "Unindent". Each item
 * applies to every target block (the block selection, else the block with the
 * cursor), as the block menu's other rows and the shortcuts do: per block
 * through `forEachTargetBlock` (hierarchy, quote, colour, icon), or over the
 * whole range through `withTargetSelection` (a list joins the blocks into one).
 *
 * M8 (Task 26): with the caret in a list item (and no block selection) the
 * colour, the icon and Standard / Small act on that one item, written as its
 * item comment (`- Buy milk <!-- item: color=text-red -->`); headings and the
 * list type still act on the list. "Indent" / "Unindent" rows
 * (`tokensMenu.indent.shortName`, `tokensMenu.unindent.shortName`) nest the
 * block under the one before it, or move it back out (a list item sinks or
 * lifts; a block selection indents its list items as Tab does).
 *
 * Strings are Capacities' (`blocksMenu.*`, `styles.color`, `tokensMenu.color.*`,
 * `colorThemes.*`, `ControlDropdown.custom.*`) except where marked "our string".
 */
import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { CheckIcon } from 'lucide-react'
import { Fragment } from 'react'
import type { Icon as IconValue } from '@/api/types'
import { Icon, isIconifyId } from '@/components/Icon'
import { IconPicker } from '@/components/IconPicker'
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu'
import { formatKeys, keysFor } from '@/lib/shortcuts'
import type { Option } from '../annotations'
import {
  blockSelectionRange,
  clearBlockSelection,
  forEachTargetBlock,
  indentBlocks,
  setOptionOnBlocks,
  targetRange,
  withTargetSelection,
} from '../extensions/blockSelection'
import { blockChain, optionApplies, type Hierarchy, type ListType } from '../nodes/blockOptions'
import { currentItemOptions, listItemAt } from '../nodes/listItemOptions'
import {
  BLOCK_COLORS,
  bgColorToken,
  colorMenuName,
  colorValue,
  parseColorValue,
  textColorToken,
  type ColorKind,
} from './colors'

export const T = {
  hierarchy: 'Hierarchy', // blocksMenu.hierarchy.title
  list: 'List', // blocksMenu.list.title
  todo: 'To-do', // the block menu's own label
  quote: 'Quote', // ActionItems.setBlockQuoteInterface.title
  toggle: 'Toggle', // the block menu's own label
  group: 'Group', // ActionItems.groupBlocks.title
  quoteBlock: 'Quote block', // ControlDropdown.custom.block_quote.name
  standout: 'Standout', // our string (Capacities' quote.layout "standout" has no label in the strings file)
  color: 'Color', // styles.color
  textColor: 'Text color', // tokensMenu.color.title
  backgroundColor: 'Background color', // tokensMenu.color.background
  removeText: 'Remove text color', // colorThemes.theme-remove-text-color
  removeBg: 'Remove background color', // colorThemes.theme-remove-bg-color
  icon: 'Icon', // ControlDropdown.custom.block_icon.name
  indent: 'Indent', // tokensMenu.indent.shortName
  unindent: 'Unindent', // tokensMenu.unindent.shortName
  alignment: 'Alignment', // EditorPanel.shortLabels.alignment
}

export type BlockAlign = 'left' | 'center' | 'right'

/** Capacities' alignment items (`shortcuts.textAlign*.name`, icons `ph-text-align-*-bold`); left is the default, never written. */
export const ALIGN_ITEMS: readonly { align: BlockAlign; name: string; icon: string }[] = [
  { align: 'left', name: 'Align text left', icon: 'ph-text-align-left-bold' },
  { align: 'center', name: 'Text align center', icon: 'ph-text-align-center-bold' },
  { align: 'right', name: 'Text align right', icon: 'ph-text-align-right-bold' },
]

/** Whether the menu acts on one list item: the caret is in an item and there is no block selection. */
export function inListItem(editor: Editor): boolean {
  if (blockSelectionRange(editor.state)) return false
  return listItemAt(editor.state.tr) !== null
}

function itemOption(editor: Editor, key: string): string | true | undefined {
  return currentItemOptions(editor.state.tr).find((o) => o.key === key)?.value
}

/** Capacities' Hierarchy sub-menu, in its order, with its icons. */
export const HIERARCHY_ITEMS: readonly { level: Hierarchy; name: string; icon: string }[] = [
  { level: 'Base', name: 'Standard', icon: 'ph-text-t' }, // blocksMenu.hierarchy.Base
  { level: 'S', name: 'Small', icon: 'ph-text-aa' }, // blocksMenu.hierarchy.S
  { level: 'H1', name: 'Heading 1', icon: 'ph-text-h-one' },
  { level: 'H2', name: 'Heading 2', icon: 'ph-text-h-two' },
  { level: 'H3', name: 'Heading 3', icon: 'ph-text-h-three' },
  { level: 'H4', name: 'Heading 4', icon: 'ph-text-h-four' },
]

/** Capacities' List sub-menu: "No listing" in its own section, then the four list types (`a)` and `i)` are text icons). */
export const LIST_ITEMS: readonly { type: ListType | null; name: string; icon: string | null; alt?: string }[] = [
  { type: null, name: 'No listing', icon: 'ph-placeholder' }, // blocksMenu.list.none
  { type: 'bullet', name: 'Bulleted', icon: 'ph-list-bullets' }, // blocksMenu.list.bullet
  { type: 'numerical', name: 'Numbered', icon: 'ph-list-numbers' }, // blocksMenu.list.numerical
  { type: 'alphabetical', name: 'Alphabetical', icon: null, alt: 'a)' }, // blocksMenu.list.alphabetical
  { type: 'roman', name: 'Roman', icon: null, alt: 'i)' }, // blocksMenu.list.roman
]

/** "Hierarchy (Standard)": the title with the current block's level, as Capacities labels the row. */
export function hierarchyLabel(level: Hierarchy | null): string {
  const name = HIERARCHY_ITEMS.find((h) => h.level === (level ?? 'Base'))?.name ?? 'Standard'
  return `${T.hierarchy} (${name})`
}

export interface BlockStyle {
  hierarchy: Hierarchy | null
  list: ListType | 'none' | null
  toggle: boolean
  quote: boolean
  standout: boolean
  color: string | null
  icon: string | null
}

function optionOf(node: PMNode, key: string): string | true | undefined {
  return ((node.attrs.blockOptions as Option[] | null) ?? []).find((o) => o.key === key)?.value
}

/** The current block's style, for the menus' check marks. */
export function currentBlockStyle(editor: Editor): BlockStyle {
  const chain = blockChain(editor.state.tr)
  const leaf = chain[0]?.node
  const style: BlockStyle = { hierarchy: null, list: 'none', toggle: false, quote: false, standout: false, color: null, icon: null }
  if (!leaf) return style
  const name = leaf.type.name
  if (name === 'paragraph') style.hierarchy = optionOf(leaf, 'small') === true ? 'S' : 'Base'
  else if (name === 'heading') style.hierarchy = `H${leaf.attrs.level}` as Hierarchy
  const $from = editor.state.selection.$from
  for (let d = $from.depth; d >= 1; d--) {
    if ($from.node(d).type.name === 'toggle') style.toggle = true
  }
  for (let d = $from.depth; d >= 1; d--) {
    const n = $from.node(d)
    if (n.type.name === 'bulletList') {
      style.list = 'bullet'
      break
    }
    if (n.type.name === 'taskList') {
      style.list = 'todo'
      break
    }
    if (n.type.name === 'orderedList') {
      const t = optionOf(n, 'list')
      style.list = t === 'alphabetical' || t === 'roman' ? t : 'numerical'
      break
    }
  }
  if (name === 'blockquote') {
    style.quote = true
    style.standout = optionOf(leaf, 'quote') === 'standout'
  }
  for (const b of chain) {
    const c = optionOf(b.node, 'color')
    if (typeof c === 'string') {
      style.color = c
      break
    }
  }
  const icon = optionOf(leaf, 'icon')
  style.icon = typeof icon === 'string' ? icon : null
  if (inListItem(editor)) {
    // One item: its own options.
    style.hierarchy = itemOption(editor, 'small') === true ? 'S' : 'Base'
    const c = itemOption(editor, 'color')
    style.color = typeof c === 'string' ? c : null
    const i = itemOption(editor, 'icon')
    style.icon = typeof i === 'string' ? i : null
  }
  return style
}

/** Turn the target blocks into quotes, or back (`toggleBlockquote`), keeping the layout option off. */
export function setQuote(editor: Editor, on: boolean): boolean {
  editor.commands.focus()
  return forEachTargetBlock(editor, (e) => {
    if (currentBlockStyle(e).quote === on) return true
    return e.commands.toggleBlockquote()
  })
}

/** Turn the standout layout on or off (making each target block a quote first when it is not one). */
export function setStandout(editor: Editor, on: boolean): boolean {
  editor.commands.focus()
  return forEachTargetBlock(editor, (e) => {
    if (!currentBlockStyle(e).quote) {
      if (!on) return true
      if (!e.commands.toggleBlockquote()) return false
    }
    return e.commands.setBlockOption('quote', on ? 'standout' : null)
  })
}

/** Set a text or background colour on the target blocks, or remove the colour of that kind (`null`). */
export function setBlockColor(editor: Editor, kind: ColorKind, color: (typeof BLOCK_COLORS)[number] | null): boolean {
  editor.commands.focus()
  if (inListItem(editor)) {
    if (color) return editor.commands.setListItemOptions({ color: colorValue(kind, color) })
    const current = parseColorValue(currentBlockStyle(editor).color)
    if (!current || current.kind !== kind) return true
    return editor.commands.setListItemOptions({ color: null })
  }
  return forEachTargetBlock(editor, (e) => {
    if (color) return e.commands.setBlockOption('color', colorValue(kind, color))
    const current = parseColorValue(currentBlockStyle(e).color)
    if (!current || current.kind !== kind) return true
    return e.commands.setBlockOption('color', null)
  })
}

/** Set the hierarchy (Standard, Small, Heading 1-4) of every target block. */
export function setBlocksHierarchy(editor: Editor, level: Hierarchy): boolean {
  editor.commands.focus()
  if ((level === 'S' || level === 'Base') && inListItem(editor)) {
    return editor.commands.setListItemOptions({ small: level === 'S' ? true : null })
  }
  return forEachTargetBlock(editor, (e) => e.commands.setHierarchy(level))
}

/** "To-do": make the target blocks to-dos, or take the to-do away (`on` false). */
export function setTodo(editor: Editor, on: boolean): boolean {
  return setBlocksListType(editor, on ? 'todo' : null)
}

/** "Toggle": add a toggle to the target blocks, or remove it (as the `toggle` shortcut does). */
export function setToggle(editor: Editor, on: boolean): boolean {
  editor.commands.focus()
  return withTargetSelection(editor, (e) => (on ? e.commands.wrapInToggle() : e.commands.unwrapToggle()))
}

/** "Group": group the target blocks, or ungroup the group they are in (`ActionItems.groupBlocks.shortcut.title`). */
export function toggleGroupBlocks(editor: Editor): boolean {
  editor.commands.focus()
  return withTargetSelection(editor, (e) => e.commands.toggleGroup())
}

/** Make the target blocks one list of `type`, or no list (`null`). */
export function setBlocksListType(editor: Editor, type: ListType | null): boolean {
  editor.commands.focus()
  return withTargetSelection(editor, (e) => e.commands.setListType(type))
}

/** Set (or with `null` remove) the icon of every target block. */
export function setBlocksIcon(editor: Editor, icon: string | null): boolean {
  editor.commands.focus()
  if (inListItem(editor)) return editor.commands.setListItemOptions({ icon })
  return forEachTargetBlock(editor, (e) => e.commands.setBlockOption('icon', icon))
}

/**
 * The alignment the block menu offers for the target blocks: the first target block's
 * (or the list item's) current alignment, or null when no target block takes `align`.
 */
export function currentAlignment(editor: Editor): BlockAlign | null {
  const value = (v: string | true | undefined): BlockAlign => (v === 'center' || v === 'right' ? v : 'left')
  if (inListItem(editor)) return value(itemOption(editor, 'align'))
  const blocks = targetRange(editor.state)?.blocks ?? []
  const first = blocks.find((b) => optionApplies('align', b.node))
  return first ? value(optionOf(first.node, 'align')) : null
}

/** Align the target blocks that take `align` (a list item at the caret: that item); left removes the option. */
export function setBlocksAlignment(editor: Editor, align: BlockAlign): boolean {
  const value = align === 'left' ? null : align
  editor.commands.focus()
  if (inListItem(editor)) return editor.commands.setListItemOptions({ align: value })
  return setOptionOnBlocks(editor, 'align', value)
}

/** Put the caret at the start of the child at `index` of the block parent whose content starts at `parentStart`. */
function caretIntoChild(editor: Editor, parentStart: number, index: number): boolean {
  const doc = editor.state.doc
  const parent = parentStart === 0 ? doc : doc.resolve(parentStart).parent
  if (index < 0 || index >= parent.childCount) return false
  let pos = parentStart
  for (let i = 0; i < index; i++) pos += parent.child(i).nodeSize
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(doc.resolve(pos + 1))))
  return true
}

const LIST_NODES = new Set(['bulletList', 'orderedList', 'taskList'])

/**
 * "Indent" (`dir` 1) / "Unindent" (-1).
 * - A block selection holding lists indents their items as Tab does. Other
 *   selected blocks are nested one by one under the block before the first
 *   (Unindent moves the first selected block out, the ones after it going
 *   with it as its children: outliner semantics, our choice).
 * - A list item at the caret sinks or lifts.
 * - Any other block nests under the block before it, or moves out of its
 *   indent container.
 */
export function indentRow(editor: Editor, dir: 1 | -1): boolean {
  const range = blockSelectionRange(editor.state)
  if (range) {
    if (range.blocks.some((b) => LIST_NODES.has(b.node.type.name))) return indentBlocks(editor, dir)
    clearBlockSelection(editor)
    if (dir === -1) {
      return caretIntoChild(editor, range.parentStart, range.first) && editor.commands.unindentBlock()
    }
    let ok = false
    // Each indent merges the block at `first` into the container before it, so the next one moves to `first`.
    for (let k = range.first; k <= range.last; k++) {
      if (!caretIntoChild(editor, range.parentStart, range.first) || !editor.commands.indentBlock()) break
      ok = true
    }
    editor.commands.focus()
    return ok
  }
  editor.commands.focus()
  const item = listItemAt(editor.state.tr)
  if (item) {
    const name = item.node.type.name
    return dir === 1 ? editor.commands.sinkListItem(name) : editor.commands.liftListItem(name)
  }
  return dir === 1 ? editor.commands.indentBlock() : editor.commands.unindentBlock()
}

function Check({ on }: { on: boolean }) {
  return <CheckIcon className="ml-auto size-4" style={{ visibility: on ? 'visible' : 'hidden' }} aria-hidden />
}

/** A row's left icon: a Phosphor icon, or Capacities' text icon (`a)`, `i)`). */
function RowIcon({ icon, alt, color }: { icon: string | null; alt?: string; color?: string }) {
  if (!icon) {
    return (
      <span aria-hidden className="inline-flex w-4 justify-center text-xs text-muted-foreground">
        {alt}
      </span>
    )
  }
  return (
    <span aria-hidden className="inline-flex" style={color ? { color } : undefined}>
      <Icon name={icon} size={16} />
    </span>
  )
}

function Swatch({ kind, color }: { kind: ColorKind; color: (typeof BLOCK_COLORS)[number] }) {
  return kind === 'text' ? (
    <span
      aria-hidden
      data-swatch={`${kind}-${color}`}
      className="inline-flex size-4 items-center justify-center rounded-sm border border-line text-[11px] font-semibold"
      style={{ color: textColorToken(color) }}
    >
      A
    </span>
  ) : (
    <span
      aria-hidden
      data-swatch={`${kind}-${color}`}
      className="inline-block size-4 rounded-sm border border-line"
      style={{ backgroundColor: bgColorToken(color) }}
    />
  )
}

function ColorList({ editor, kind, current }: { editor: Editor; kind: ColorKind; current: string | null }) {
  return (
    <>
      <DropdownMenuItem onSelect={() => setBlockColor(editor, kind, null)}>
        {kind === 'text' ? T.removeText : T.removeBg}
      </DropdownMenuItem>
      {BLOCK_COLORS.map((c) => (
        <DropdownMenuItem key={c} onSelect={() => setBlockColor(editor, kind, c)}>
          <Swatch kind={kind} color={c} />
          {colorMenuName(kind, c)}
          <Check on={current === colorValue(kind, c)} />
        </DropdownMenuItem>
      ))}
    </>
  )
}

export interface BlockStyleMenuProps {
  editor: Editor
  /** Called after an icon is picked or removed (the picker is not a menu item, so the menu stays open). */
  onDone?: () => void
}

/** The registry's first key for `id`, formatted for display (empty when it has none). */
function hint(id: string): string {
  const keys = keysFor(id)
  return keys.length ? formatKeys(keys[0]) : ''
}

function Shortcut({ id }: { id: string }) {
  const text = hint(id)
  return text ? <DropdownMenuShortcut>{text}</DropdownMenuShortcut> : null
}

/** Capacities' first block-menu section; render inside a `DropdownMenuContent`. */
export function BlockStyleMenu({ editor, onDone }: BlockStyleMenuProps) {
  const style = currentBlockStyle(editor)
  const iconValue: IconValue | null = style.icon
    ? { type: isIconifyId(style.icon) ? 'iconify' : 'emoji', val: style.icon }
    : null
  const shortcutOf: Partial<Record<Hierarchy, string>> = { H1: 'heading1', H2: 'heading2', H3: 'heading3', H4: 'heading4' }
  return (
    <>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <RowIcon icon="ph-text-h" />
          {hierarchyLabel(style.hierarchy)}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          {HIERARCHY_ITEMS.map((h) => (
            <DropdownMenuItem key={h.level} onSelect={() => setBlocksHierarchy(editor, h.level)}>
              <RowIcon icon={h.icon} />
              {h.name}
              {shortcutOf[h.level] && <Shortcut id={shortcutOf[h.level]!} />}
              <Check on={style.hierarchy === h.level} />
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <RowIcon icon="ph-list" />
          {T.list}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          {LIST_ITEMS.map((l, i) => (
            <Fragment key={l.name}>
              {i === 1 && <DropdownMenuSeparator />}
              <DropdownMenuItem onSelect={() => setBlocksListType(editor, l.type)}>
                <RowIcon icon={l.icon} alt={l.alt} />
                {l.name}
                <Check on={(l.type ?? 'none') === style.list} />
              </DropdownMenuItem>
            </Fragment>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuItem onSelect={() => setTodo(editor, style.list !== 'todo')}>
        <RowIcon icon="ph-check-square" />
        {T.todo}
        <Shortcut id="toDo" />
        <Check on={style.list === 'todo'} />
      </DropdownMenuItem>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <RowIcon icon="ph-smiley" />
          {T.icon}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="p-0">
          <IconPicker
            value={iconValue}
            onChange={(next) => {
              setBlocksIcon(editor, next ? next.val : null)
              onDone?.()
            }}
          />
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuItem onSelect={() => setQuote(editor, !style.quote)}>
        <RowIcon icon="ph-quotes" />
        {T.quote}
        <Check on={style.quote} />
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => setToggle(editor, !style.toggle)}>
        <RowIcon icon="ph-caret-right-fill" />
        {T.toggle}
        <Shortcut id="toggle" />
        <Check on={style.toggle} />
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => toggleGroupBlocks(editor)}>
        <RowIcon icon="ph-arrows-in" />
        {T.group}
      </DropdownMenuItem>
    </>
  )
}

/**
 * Object's own rows, kept because nothing else reaches them: block colour
 * with its "Remove … color" items (the slash menu only sets a colour),
 * "Alignment" ▸ (M9; Capacities offers alignment only for table cells, and Object's
 * block alignment has no keys, so this is its one entry point; shown only when a
 * target block takes `align`), the quote's standout layout, and indenting non-list blocks.
 */
export function BlockStyleExtras({ editor }: { editor: Editor }) {
  const style = currentBlockStyle(editor)
  const align = currentAlignment(editor)
  const subClass = 'max-h-[420px] overflow-auto'
  return (
    <>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>{T.color}</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>{T.textColor}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className={subClass}>
              <ColorList editor={editor} kind="text" current={style.color} />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>{T.backgroundColor}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className={subClass}>
              <ColorList editor={editor} kind="bg" current={style.color} />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      {align && (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>{T.alignment}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {ALIGN_ITEMS.map((a) => (
              <DropdownMenuItem key={a.align} onSelect={() => setBlocksAlignment(editor, a.align)}>
                <RowIcon icon={a.icon} />
                {a.name}
                <Check on={align === a.align} />
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      )}
      <DropdownMenuItem onSelect={() => setStandout(editor, !style.standout)}>
        {T.standout}
        <Check on={style.standout} />
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => indentRow(editor, 1)}>{T.indent}</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => indentRow(editor, -1)}>{T.unindent}</DropdownMenuItem>
    </>
  )
}
