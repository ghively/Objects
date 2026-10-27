/**
 * The block style sub-menus ("Hierarchy", "List", "Quote", "Color", "Icon"),
 * rendered inside a dropdown menu's content (Task 12's block menu). Each item
 * applies to the current block through the document model's commands
 * (`setHierarchy`, `setListType`, `setBlockOption`, `toggleBlockquote`), which
 * also cover a block selection once one exists.
 *
 * Strings are Capacities' (`blocksMenu.*`, `styles.color`, `tokensMenu.color.*`,
 * `colorThemes.*`, `ControlDropdown.custom.*`) except where marked "our string".
 */
import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
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
import { blockChain, type Hierarchy, type ListType } from '../nodes/blockOptions'
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
  return style
}

/** Turn the current block into a quote, or back (`toggleBlockquote`), keeping the layout option off. */
export function setQuote(editor: Editor, on: boolean): boolean {
  const { quote } = currentBlockStyle(editor)
  if (quote === on) return true
  return editor.chain().focus().toggleBlockquote().run()
}

/** Turn the standout layout on or off (making the block a quote first when it is not one). */
export function setStandout(editor: Editor, on: boolean): boolean {
  const { quote } = currentBlockStyle(editor)
  if (!quote) {
    if (!on) return true
    if (!editor.chain().focus().toggleBlockquote().run()) return false
  }
  return editor.chain().focus().setBlockOption('quote', on ? 'standout' : null).run()
}

/** Set a text or background colour, or remove the colour of that kind (`null`). */
export function setBlockColor(editor: Editor, kind: ColorKind, color: (typeof BLOCK_COLORS)[number] | null): boolean {
  if (color) return editor.chain().focus().setBlockOption('color', colorValue(kind, color)).run()
  const current = parseColorValue(currentBlockStyle(editor).color)
  if (!current || current.kind !== kind) return true
  return editor.chain().focus().setBlockOption('color', null).run()
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
            <DropdownMenuItem key={h.level} onSelect={() => editor.chain().focus().setHierarchy(h.level).run()}>
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
            <DropdownMenuItem key={l.name} onSelect={() => editor.chain().focus().setListType(l.type).run()}>
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
              editor.chain().focus().setBlockOption('icon', next ? next.val : null).run()
              onDone?.()
            }}
          />
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </>
  )
}
