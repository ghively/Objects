/**
 * The block style sub-menus ("Hierarchy", "List", "Quote", "Color", "Icon"),
 * rendered inside a dropdown menu's content (Task 12's block menu). Each item
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
import type { Icon as IconValue } from '@/api/types'
import { isIconifyId } from '@/components/Icon'
import { IconPicker } from '@/components/IconPicker'
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu'
import type { Option } from '../annotations'
import {
  blockSelectionRange,
  clearBlockSelection,
  forEachTargetBlock,
  indentBlocks,
  withTargetSelection,
} from '../extensions/blockSelection'
import { blockChain, type Hierarchy, type ListType } from '../nodes/blockOptions'
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
  quote: 'Quote', // blocksMenu.quote.title
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
}

/** Whether the menu acts on one list item: the caret is in an item and there is no block selection. */
export function inListItem(editor: Editor): boolean {
  if (blockSelectionRange(editor.state)) return false
  return listItemAt(editor.state.tr) !== null
}

function itemOption(editor: Editor, key: string): string | true | undefined {
  return currentItemOptions(editor.state.tr).find((o) => o.key === key)?.value
}

export const HIERARCHY_ITEMS: readonly { level: Hierarchy; name: string }[] = [
  { level: 'Base', name: 'Standard' }, // blocksMenu.hierarchy.Base
  { level: 'H1', name: 'Heading 1' },
  { level: 'H2', name: 'Heading 2' },
  { level: 'H3', name: 'Heading 3' },
  { level: 'H4', name: 'Heading 4' },
  { level: 'S', name: 'Small' }, // blocksMenu.hierarchy.S
]

export const LIST_ITEMS: readonly { type: ListType | null; name: string }[] = [
  { type: null, name: 'No listing' }, // blocksMenu.list.none
  { type: 'bullet', name: 'Bulleted' }, // blocksMenu.list.bullet
  { type: 'numerical', name: 'Numbered' }, // blocksMenu.list.numerical
  { type: 'alphabetical', name: 'Alphabetical' }, // blocksMenu.list.alphabetical
  { type: 'roman', name: 'Roman' }, // blocksMenu.list.roman
]

export interface BlockStyle {
  hierarchy: Hierarchy | null
  list: ListType | 'none' | null
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
  const style: BlockStyle = { hierarchy: null, list: 'none', quote: false, standout: false, color: null, icon: null }
  if (!leaf) return style
  const name = leaf.type.name
  if (name === 'paragraph') style.hierarchy = optionOf(leaf, 'small') === true ? 'S' : 'Base'
  else if (name === 'heading') style.hierarchy = `H${leaf.attrs.level}` as Hierarchy
  const $from = editor.state.selection.$from
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

/** The sub-menus; render inside a `DropdownMenuContent`. */
export function BlockStyleMenu({ editor, onDone }: BlockStyleMenuProps) {
  const style = currentBlockStyle(editor)
  const iconValue: IconValue | null = style.icon
    ? { type: isIconifyId(style.icon) ? 'iconify' : 'emoji', val: style.icon }
    : null
  const subClass = 'max-h-[420px] overflow-auto'
  return (
    <>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>{T.hierarchy}</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          {HIERARCHY_ITEMS.map((h) => (
            <DropdownMenuItem key={h.level} onSelect={() => setBlocksHierarchy(editor, h.level)}>
              {h.name}
              <Check on={style.hierarchy === h.level} />
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>{T.list}</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          {LIST_ITEMS.map((l) => (
            <DropdownMenuItem key={l.name} onSelect={() => setBlocksListType(editor, l.type)}>
              {l.name}
              <Check on={(l.type ?? 'none') === style.list} />
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>{T.quote}</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuItem onSelect={() => setQuote(editor, !style.quote)}>
            {T.quoteBlock}
            <Check on={style.quote} />
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setStandout(editor, !style.standout)}>
            {T.standout}
            <Check on={style.standout} />
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
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
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>{T.icon}</DropdownMenuSubTrigger>
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
      <DropdownMenuItem onSelect={() => indentRow(editor, 1)}>{T.indent}</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => indentRow(editor, -1)}>{T.unindent}</DropdownMenuItem>
    </>
  )
}
