/**
 * The block-selection bar (catalog section 6): shown at the bottom of the
 * page while blocks are selected (one or more). Left, "N block(s) · M words" opening the selection's
 * text stats; middle, Bold, Italic, Strikethrough, Underline, the Hierarchy and List dropdowns,
 * Toggle, Quote, To-do, the Icon and Color dropdowns; right, "Turn blocks into" (the object picker
 * the block menu's "Turn into..." shows), "Move" (to today's or tomorrow's daily note, or a new page),
 * delete (red), "AI" (M10: the AI chat about the selected blocks, as the block menu's "AI
 * assistant..."; gone while "Hide AI features" is on) and close.
 *
 * Left out: the "Tag" dropdown, which tags blocks: Object's Markdown has no block tags, and
 * inventing them is out (CLAUDE.md: no invented schema).
 *
 * Every button acts on the selected blocks (the block menu's functions) and the block selection
 * stays, so several can be applied in turn. Strings follow the behaviour catalog unless
 * marked "our string".
 */
import type { Editor } from '@tiptap/core'
import { BoldIcon, ItalicIcon, StrikethroughIcon, UnderlineIcon, XIcon } from 'lucide-react'
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useAiHidden } from '@/ai/store'
import type { Icon as IconValue } from '@/api/types'
import { Icon, isIconifyId } from '@/components/Icon'
import { IconPicker } from '@/components/IconPicker'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { plainText, TEXT_STATS_TEXT, textStats, type TextStats } from '@/object/textStats'
import {
  blockSelectionRange,
  blocksSource,
  clearBlockSelection,
  deleteBlocks,
  getBlockSelection,
  selectBlocks,
  withTargetSelection,
} from '../extensions/blockSelection'
import { AI_ICON, AI_TEXT, openBlocksAi, useAiBlocked } from '../aiEntries'
import { HANDLE_TEXT } from '../handles/BlockHandles'
import { TurnIntoObjectItems } from '../handles/BlockMenu'
import {
  Check,
  ColorList,
  currentBlockStyle,
  HIERARCHY_ITEMS,
  LIST_ITEMS,
  RowIcon,
  setBlocksHierarchy,
  setBlocksIcon,
  setBlocksListType,
  setQuote,
  setTodo,
  setToggle,
  T,
} from '../menus/BlockStyleMenu'
import { hasTodoAt } from '../turnInto'
import { moveBlocks, type MoveTarget } from './moveBlocks'
import './blockSelectionBar.css'

export const BLOCK_BAR_TEXT = {
  toolbar: 'Block selection', // our string (the bar's accessible name)
  /** The block count and the word count. */
  count: (blocks: number, words: number) => `${HANDLE_TEXT.blocks(blocks)} · ${words} ${words === 1 ? 'word' : 'words'}`,
  stats: TEXT_STATS_TEXT.header,
  bold: 'Bold',
  italic: 'Italic',
  strikethrough: 'Strikethrough',
  underline: 'Underline',
  hierarchy: T.hierarchy,
  list: T.list,
  toggle: T.toggle,
  quote: T.quote,
  todo: T.todo, // the block menu's own label
  icon: T.icon,
  color: T.color,
  colorText: 'Text',
  colorBackground: 'Background',
  turnInto: 'Turn blocks into',
  move: 'Move',
  today: 'Today',
  todayHint: "Move the selection into today's daily note",
  tomorrow: 'Tomorrow',
  tomorrowHint: "Move the selection into tomorrow's daily note",
  newPage: 'New page',
  newPageHint: 'Move the selection onto a new page',
  delete: 'Delete selected blocks',
  ai: AI_TEXT.ai,
  clear: 'Clear selection',
}

/** The bar's buttons after the count, in order (their accessible names). */
export const BLOCK_BAR_ITEMS: readonly string[] = [
  BLOCK_BAR_TEXT.bold,
  BLOCK_BAR_TEXT.italic,
  BLOCK_BAR_TEXT.strikethrough,
  BLOCK_BAR_TEXT.underline,
  BLOCK_BAR_TEXT.hierarchy,
  BLOCK_BAR_TEXT.list,
  BLOCK_BAR_TEXT.toggle,
  BLOCK_BAR_TEXT.quote,
  BLOCK_BAR_TEXT.todo,
  BLOCK_BAR_TEXT.icon,
  BLOCK_BAR_TEXT.color,
  BLOCK_BAR_TEXT.turnInto,
  BLOCK_BAR_TEXT.move,
  BLOCK_BAR_TEXT.delete,
  BLOCK_BAR_TEXT.ai, // M10, while AI features are not hidden
  BLOCK_BAR_TEXT.clear,
]

/** The bar's distance from the bottom of the window, px (our choice: the old count pill's). */
const BOTTOM = 24

/** M32: the least room between the bar and either side of the window, px (the CSS `max-width` leaves the same). */
export const BAR_EDGE_GAP = 16

/**
 * M32: where the bar's centre goes: the text column's centre (`centre`), moved just enough that a
 * bar `width` wide stays `BAR_EDGE_GAP` inside a window `viewport` wide. A bar wider than that room
 * (it scrolls sideways then) is centred in the window.
 */
export function barCentre(centre: number, width: number, viewport: number): number {
  const half = width / 2
  const min = BAR_EDGE_GAP + half
  const max = viewport - BAR_EDGE_GAP - half
  if (min > max) return viewport / 2
  return Math.min(Math.max(centre, min), max)
}

/**
 * Run `fn` on the selected blocks, then select the blocks it left (a range command such as a mark
 * or a list ends the block selection; the bar keeps it, so another button can follow).
 */
export function keepBlockSelection(editor: Editor, fn: () => boolean): boolean {
  const range = blockSelectionRange(editor.state)
  const ok = fn()
  if (!range || editor.isDestroyed || getBlockSelection(editor.state)) return ok
  const { doc, selection } = editor.state
  const blockAt = (pos: number): number | null => {
    const $p = doc.resolve(pos)
    return $p.depth > range.depth ? $p.before(range.depth + 1) : null
  }
  const a = blockAt(selection.from)
  const b = blockAt(selection.to)
  if (a !== null && b !== null) selectBlocks(editor, a, b)
  return ok
}

type Mark = 'bold' | 'italic' | 'strike' | 'underline'

function toggleMark(editor: Editor, mark: Mark): boolean {
  return keepBlockSelection(editor, () =>
    withTargetSelection(editor, (e) => {
      const chain = e.chain().focus()
      if (mark === 'bold') return chain.toggleBold().run()
      if (mark === 'italic') return chain.toggleItalic().run()
      if (mark === 'strike') return chain.toggleStrike().run()
      return chain.toggleUnderline().run()
    }),
  )
}

/** The selection's block count and text stats, or null when no blocks are selected. */
function selectionInfo(editor: Editor): { blocks: number; stats: TextStats } | null {
  const range = blockSelectionRange(editor.state)
  if (!range) return null
  return { blocks: range.blocks.length, stats: textStats(plainText(blocksSource(editor, range))) }
}

const BUTTON = 'block-bar-button'

function BarButton({
  label,
  onClick,
  pressed,
  className,
  children,
}: {
  label: string
  onClick: () => void
  pressed?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={cn(BUTTON, className)}
      // Keep the editor's focus and selection.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

/** A dropdown behind a bar button; `children` renders the menu's rows. */
function BarDropdown({
  label,
  trigger,
  children,
  open,
  onOpenChange,
  contentClassName,
}: {
  label: string
  trigger: ReactNode
  children: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  contentClassName?: string
}) {
  return (
    <DropdownMenu modal={false} open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={label} title={label} className={BUTTON} onMouseDown={(e) => e.preventDefault()}>
          {trigger}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="center"
        className={contentClassName}
        onCloseAutoFocus={(e) => e.preventDefault()}
        // The editor takes the focus back a frame after a bar action (`commands.focus()`); that must
        // not close a dropdown opened meanwhile. A click outside or Escape still closes it.
        onFocusOutside={(e) => e.preventDefault()}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function StatsRows({ stats }: { stats: TextStats }) {
  const rows: [number, readonly [string, string]][] = [
    [stats.words, TEXT_STATS_TEXT.word],
    [stats.sentences, TEXT_STATS_TEXT.sentence],
    [stats.paragraphs, TEXT_STATS_TEXT.paragraph],
    [stats.characters, TEXT_STATS_TEXT.character],
  ]
  return (
    <ul className="px-2 py-1 text-[14px]">
      {rows.map(([n, forms]) => (
        <li key={forms[1]} className="py-0.5">
          {`${n.toLocaleString()} ${n === 1 ? forms[0] : forms[1]}`}
        </li>
      ))}
    </ul>
  )
}

export function BlockSelectionBar({ editor }: { editor: Editor }) {
  const [, setTick] = useState(0)
  const [iconOpen, setIconOpen] = useState(false)
  // Hidden too on a page excluded from AI or a template (M10).
  const aiBlocked = useAiBlocked(editor)
  const aiHidden = useAiHidden() || aiBlocked

  // Redraw on every transaction: the selection, the counts and the pressed states follow it.
  useEffect(() => {
    const onTransaction = () => setTick((n) => n + 1)
    editor.on('transaction', onTransaction)
    return () => {
      editor.off('transaction', onTransaction)
    }
  }, [editor])

  // M32: keep the bar inside the window. It is centred under the text column, which sits off
  // centre beside the sidebar: at 1440 px and narrower its end passed the window's edge.
  const barRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const place = () => {
      const bar = barRef.current
      if (!bar || editor.isDestroyed) return
      const rect = editor.view.dom.getBoundingClientRect()
      const viewport = window.innerWidth
      const centre = rect.width ? rect.left + rect.width / 2 : viewport / 2
      bar.style.left = `${barCentre(centre, bar.offsetWidth, viewport)}px`
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  })

  const info = editor.isDestroyed ? null : selectionInfo(editor)
  if (!info) return null
  const style = currentBlockStyle(editor)
  const iconValue: IconValue | null = style.icon ? { type: isIconifyId(style.icon) ? 'iconify' : 'emoji', val: style.icon } : null
  const rect = editor.view.dom.getBoundingClientRect()
  const left = rect.width ? rect.left + rect.width / 2 : '50%'
  const keep = (fn: () => boolean) => () => keepBlockSelection(editor, fn)
  const move = (target: MoveTarget) => () => void moveBlocks(editor, target).catch(() => {})

  return createPortal(
    <div ref={barRef} role="toolbar" aria-label={BLOCK_BAR_TEXT.toolbar} className="block-selection-bar" style={{ left, bottom: BOTTOM }}>
      <BarDropdown label={BLOCK_BAR_TEXT.count(info.blocks, info.stats.words)} trigger={<span className="px-1">{BLOCK_BAR_TEXT.count(info.blocks, info.stats.words)}</span>}>
        <DropdownMenuLabel>{BLOCK_BAR_TEXT.stats}</DropdownMenuLabel>
        <StatsRows stats={info.stats} />
      </BarDropdown>
      <span className="block-bar-divider" aria-hidden />
      <BarButton label={BLOCK_BAR_TEXT.bold} pressed={editor.isActive('bold')} onClick={() => toggleMark(editor, 'bold')}>
        <BoldIcon aria-hidden />
      </BarButton>
      <BarButton label={BLOCK_BAR_TEXT.italic} pressed={editor.isActive('italic')} onClick={() => toggleMark(editor, 'italic')}>
        <ItalicIcon aria-hidden />
      </BarButton>
      <BarButton label={BLOCK_BAR_TEXT.strikethrough} pressed={editor.isActive('strike')} onClick={() => toggleMark(editor, 'strike')}>
        <StrikethroughIcon aria-hidden />
      </BarButton>
      <BarButton label={BLOCK_BAR_TEXT.underline} pressed={editor.isActive('underline')} onClick={() => toggleMark(editor, 'underline')}>
        <UnderlineIcon aria-hidden />
      </BarButton>
      <BarDropdown label={BLOCK_BAR_TEXT.hierarchy} trigger={<Icon name="ph-text-h" size={18} />}>
        {HIERARCHY_ITEMS.map((h) => (
          <DropdownMenuItem key={h.level} onSelect={keep(() => setBlocksHierarchy(editor, h.level))}>
            <RowIcon icon={h.icon} />
            {h.name}
            <Check on={style.hierarchy === h.level} />
          </DropdownMenuItem>
        ))}
      </BarDropdown>
      <BarDropdown label={BLOCK_BAR_TEXT.list} trigger={<Icon name="ph-list" size={18} />}>
        {LIST_ITEMS.map((l, i) => (
          <Fragment key={l.name}>
            {i === 1 && <DropdownMenuSeparator />}
            <DropdownMenuItem onSelect={keep(() => setBlocksListType(editor, l.type))}>
              <RowIcon icon={l.icon} alt={l.alt} />
              {l.name}
              <Check on={(l.type ?? 'none') === style.list} />
            </DropdownMenuItem>
          </Fragment>
        ))}
      </BarDropdown>
      <BarButton label={BLOCK_BAR_TEXT.toggle} pressed={style.toggle} onClick={keep(() => setToggle(editor, !style.toggle))}>
        <Icon name="ph-caret-right-fill" size={18} />
      </BarButton>
      <BarButton label={BLOCK_BAR_TEXT.quote} pressed={style.quote} onClick={keep(() => setQuote(editor, !style.quote))}>
        <Icon name="ph-quotes" size={18} />
      </BarButton>
      <BarButton label={BLOCK_BAR_TEXT.todo} pressed={style.list === 'todo'} onClick={keep(() => setTodo(editor, style.list !== 'todo'))}>
        <Icon name="ph-check-square" size={18} />
      </BarButton>
      <BarDropdown
        label={BLOCK_BAR_TEXT.icon}
        trigger={<Icon name="ph-smiley" size={18} />}
        open={iconOpen}
        onOpenChange={setIconOpen}
        contentClassName="p-0"
      >
        <IconPicker
          value={iconValue}
          onChange={(next) => {
            keepBlockSelection(editor, () => setBlocksIcon(editor, next ? next.val : null))
            setIconOpen(false)
          }}
        />
      </BarDropdown>
      <BarDropdown label={BLOCK_BAR_TEXT.color} trigger={<Icon name="ph-palette" size={18} />} contentClassName="max-h-[420px] overflow-auto">
        <DropdownMenuLabel>{BLOCK_BAR_TEXT.colorText}</DropdownMenuLabel>
        <ColorList editor={editor} kind="text" current={style.color} />
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{BLOCK_BAR_TEXT.colorBackground}</DropdownMenuLabel>
        <ColorList editor={editor} kind="bg" current={style.color} />
      </BarDropdown>
      <span className="block-bar-divider" aria-hidden />
      <BarDropdown
        label={BLOCK_BAR_TEXT.turnInto}
        trigger={<span className="px-1">{BLOCK_BAR_TEXT.turnInto}</span>}
        contentClassName="max-h-[420px] overflow-auto"
      >
        <TurnIntoObjectItems editor={editor} todo={hasTodoAt(editor)} />
      </BarDropdown>
      <BarDropdown label={BLOCK_BAR_TEXT.move} trigger={<span className="px-1">{BLOCK_BAR_TEXT.move}</span>}>
        <DropdownMenuItem title={BLOCK_BAR_TEXT.todayHint} onSelect={move('today')}>
          {BLOCK_BAR_TEXT.today}
        </DropdownMenuItem>
        <DropdownMenuItem title={BLOCK_BAR_TEXT.tomorrowHint} onSelect={move('tomorrow')}>
          {BLOCK_BAR_TEXT.tomorrow}
        </DropdownMenuItem>
        <DropdownMenuItem title={BLOCK_BAR_TEXT.newPageHint} onSelect={move('newPage')}>
          {BLOCK_BAR_TEXT.newPage}
        </DropdownMenuItem>
      </BarDropdown>
      <BarButton label={BLOCK_BAR_TEXT.delete} className="block-bar-delete" onClick={() => deleteBlocks(editor)}>
        <Icon name="ph-trash" size={18} />
      </BarButton>
      {!aiHidden && (
        <BarButton label={BLOCK_BAR_TEXT.ai} onClick={() => openBlocksAi(editor, 'askBlock')}>
          <Icon name={AI_ICON} size={18} />
        </BarButton>
      )}
      <BarButton label={BLOCK_BAR_TEXT.clear} onClick={() => clearBlockSelection(editor)}>
        <XIcon aria-hidden />
      </BarButton>
    </div>,
    document.body,
  )
}
